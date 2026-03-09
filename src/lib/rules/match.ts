/**
 * Rule Matching Algorithm
 *
 * Matches a normalized transaction against the user's enabled CategoryRules.
 * Implements specificity-based scoring and conflict detection.
 *
 * Scoring (lower = more specific, wins):
 *   vendor_exact_amount   = 1
 *   vendor_amount_range   = 2
 *   vendor_contains_text  = 3
 *   vendor_only (default) = 4
 *
 * Conflict: top two candidates share the same score but different categoryIds
 * → returned as needs_review.
 */

import { CategoryRule } from '@prisma/client'
import prisma from '@/lib/db'

export type MatchResult =
  | { matched: true;  rule: CategoryRule; reason: string }
  | { matched: false; status: 'unmatched' | 'needs_review'; reason?: string }

/** Return the specificity score for a matchType (lower = more specific). */
function specificityScore(matchType: string): number {
  switch (matchType) {
    case 'vendor_exact_amount':  return 1
    case 'vendor_amount_range':  return 2
    case 'vendor_contains_text': return 3
    default:                     return 4  // vendor_only and any unknown type
  }
}

/** Human-readable reason string for a matched rule. */
function buildReason(matchType: string): string {
  switch (matchType) {
    case 'vendor_exact_amount':  return 'Vendor + Exact Amount'
    case 'vendor_amount_range':  return 'Vendor + Amount Range'
    case 'vendor_contains_text': return 'Vendor + Description'
    default:                     return 'Vendor only'
  }
}

/**
 * Match a single transaction against the user's enabled rules.
 *
 * @param vendorKey    - normalized vendor key (from normalizeVendor)
 * @param amountCents  - signed integer cents (negative = debit, positive = credit)
 * @param description  - raw/original transaction description for text matching
 * @param userId       - the authenticated user's id
 * @param accountId    - the transaction's account id (rules scoped to this account or global)
 */
export async function matchRules(
  vendorKey: string,
  amountCents: number,
  description: string,
  userId: string,
  accountId?: string,
): Promise<MatchResult> {
  // Step 1: Fetch all enabled rules for this user, scoped to the transaction's account.
  // Matches either by vendorKey (vendor_exact_amount rules) or matchValue (vendor_exact rules
  // created before vendorKey was populated for that type).
  const baseWhere = {
    userId,
    isEnabled: true,
    OR: [
      { scopeAccountId: null },
      ...(accountId ? [{ scopeAccountId: accountId }] : []),
    ],
  }
  const [keyRules, valueRules] = await Promise.all([
    prisma.categoryRule.findMany({ where: { ...baseWhere, vendorKey: vendorKey } }),
    // Backward-compat: vendor_exact rules stored with vendorKey='' use matchValue instead
    prisma.categoryRule.findMany({ where: { ...baseWhere, matchType: 'vendor_exact', matchValue: vendorKey, vendorKey: '' } }),
  ])
  const seen = new Set<string>()
  const allRules: typeof keyRules = []
  for (const r of [...keyRules, ...valueRules]) {
    if (!seen.has(r.id)) { seen.add(r.id); allRules.push(r) }
  }

  // Step 2: Filter to rules whose vendorKey (or matchValue for legacy) matches
  let candidates = allRules.filter(rule =>
    rule.vendorKey ? rule.vendorKey === vendorKey : rule.matchValue === vendorKey
  )

  // Step 3: Filter by appliesTo direction
  candidates = candidates.filter(rule => {
    if (rule.appliesTo === 'debits')  return amountCents < 0
    if (rule.appliesTo === 'credits') return amountCents > 0
    // 'both' always passes
    return true
  })

  // Step 4 & 5: Score and sort — specificity ASC, then priority ASC
  candidates.sort((a, b) => {
    const scoreDiff = specificityScore(a.matchType) - specificityScore(b.matchType)
    if (scoreDiff !== 0) return scoreDiff
    return a.priority - b.priority
  })

  // Step 6: No candidates → unmatched
  if (candidates.length === 0) {
    return { matched: false, status: 'unmatched' }
  }

  // Step 7: Conflict check — top two have same score but different categories
  if (candidates.length >= 2) {
    const topScore   = specificityScore(candidates[0].matchType)
    const secondScore = specificityScore(candidates[1].matchType)
    if (topScore === secondScore && candidates[0].categoryId !== candidates[1].categoryId) {
      return { matched: false, status: 'needs_review', reason: 'rule_conflict' }
    }
  }

  // Step 8: Apply match-type-specific check on the top candidate
  const top = candidates[0]
  const absAmount = Math.abs(amountCents)

  switch (top.matchType) {
    case 'vendor_exact_amount': {
      if (top.amountExact === null || top.amountExact === undefined) {
        return { matched: false, status: 'unmatched' }
      }
      if (top.amountExact !== absAmount) {
        return { matched: false, status: 'unmatched' }
      }
      break
    }

    case 'vendor_amount_range': {
      if (top.amountMin === null || top.amountMin === undefined ||
          top.amountMax === null || top.amountMax === undefined) {
        return { matched: false, status: 'unmatched' }
      }
      if (absAmount < top.amountMin || absAmount > top.amountMax) {
        return { matched: false, status: 'unmatched' }
      }
      break
    }

    case 'vendor_contains_text': {
      if (!top.containsText) {
        return { matched: false, status: 'unmatched' }
      }
      if (!description.toLowerCase().includes(top.containsText.toLowerCase())) {
        return { matched: false, status: 'unmatched' }
      }
      break
    }

    // vendor_only and any unknown matchType: always passes
    default:
      break
  }

  // Step 10 & 11: Build reason and return success
  const reason = buildReason(top.matchType)
  return { matched: true, rule: top, reason }
}
