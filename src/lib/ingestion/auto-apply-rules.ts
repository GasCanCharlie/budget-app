/**
 * Auto-Apply Rules Engine
 *
 * Runs immediately after import to apply user-created categorization rules.
 *
 * Rules are applied in priority order:
 *  1. Account-scoped exact vendor rules (highest priority)
 *  2. Global exact vendor rules
 *
 * A rule is applied only when:
 *  - rule.isEnabled = true
 *  - rule.confidence = 'high'
 *  - rule.matchType = 'vendor_exact' OR 'contains'
 *  - the normalized matchValue matches the transaction's normalized description
 *
 * Outcomes per transaction:
 *  - rule.mode = 'always' → set categoryId, assignedBy='rule', appliedRuleId, needsReview=false
 *  - rule.mode = 'ask'    → set needsReview=true only (no category assigned)
 *  - conflict (2+ rules match) → needsReview=true, no assignment
 *
 * Returns a summary of what was applied.
 */

import prisma from '@/lib/db'
import { normalizeForRule } from './vendor-normalize'

export interface AutoApplyResult {
  autoAssigned:  number   // transactions assigned via 'always' rule
  needsReview:   number   // transactions flagged via 'ask' rule or conflict
  skipped:       number   // transactions with no matching rule
  conflicts:     number   // transactions with multiple conflicting rules
}

/**
 * Run the auto-apply engine for all transactions in an upload.
 * Called at the end of the import pipeline (after transactions are persisted).
 */
export async function applyRulesToUpload(
  uploadId: string,
  userId: string,
  accountId: string,
): Promise<AutoApplyResult> {
  const result: AutoApplyResult = { autoAssigned: 0, needsReview: 0, skipped: 0, conflicts: 0 }

  // Load all enabled user rules (high confidence only)
  const rules = await prisma.categoryRule.findMany({
    where: {
      userId,
      isEnabled: true,
      confidence: 'high',
      isSystem: false,
    },
    orderBy: [
      // Account-scoped rules first (higher priority than global)
      { scopeAccountId: 'desc' },
      { priority: 'desc' },
      { createdAt: 'asc' },
    ],
  })

  if (rules.length === 0) return result

  // Load transactions in this upload that are not yet categorized
  const transactions = await prisma.transaction.findMany({
    where: {
      uploadId,
      appCategory: null,     // only uncategorized
      isExcluded: false,
    },
    select: {
      id: true,
      merchantNormalized: true,
      descriptionRaw: true,
      accountId: true,
    },
  })

  if (transactions.length === 0) return result

  // Build a normalized lookup key per transaction
  const txKeys = transactions.map(tx => ({
    id: tx.id,
    key: normalizeForRule(tx.merchantNormalized || tx.descriptionRaw),
    accountId: tx.accountId,
  }))

  // For each transaction, find matching rules
  for (const tx of txKeys) {
    const matching = rules.filter(rule => {
      // Account scope check
      if (rule.scopeAccountId && rule.scopeAccountId !== tx.accountId) return false

      const mv = rule.matchValue.toLowerCase().trim()
      if (rule.matchType === 'vendor_exact') return tx.key === mv
      if (rule.matchType === 'contains')     return tx.key.includes(mv) || mv.includes(tx.key)
      return false
    })

    if (matching.length === 0) {
      result.skipped++
      continue
    }

    if (matching.length > 1) {
      // Conflict — multiple rules match; flag for review, don't auto-assign
      await prisma.transaction.update({
        where: { id: tx.id },
        data: { needsReview: true },
      })
      result.conflicts++
      result.needsReview++
      continue
    }

    const rule = matching[0]

    if (rule.mode === 'always') {
      // Lookup category name for appCategory field
      const category = await prisma.category.findUnique({
        where: { id: rule.categoryId },
        select: { name: true },
      })
      if (!category) { result.skipped++; continue }

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          appCategory:    category.name,
          assignedBy:     'rule',
          appliedRuleId:  rule.id,
          needsReview:    false,
          reviewedByUser: false,
        },
      })
      result.autoAssigned++
    } else if (rule.mode === 'ask') {
      // Flag for review — user must confirm; do not assign category
      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          needsReview:   true,
          appliedRuleId: rule.id,  // which rule suggested this
        },
      })
      result.needsReview++
    }
  }

  return result
}
