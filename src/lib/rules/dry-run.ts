/**
 * Dry-Run Rules Engine
 *
 * Runs all user rules against a staging upload's uncommitted transactions
 * without writing anything to the database.  Returns a summary of how many
 * transactions would be auto-categorized, flagged for review, or left
 * unmatched — along with per-transaction match details.
 */

import prisma from '@/lib/db'
import { matchRules } from './match'

export interface DryRunResult {
  /** Total number of staging transactions evaluated. */
  total:     number
  /** Transactions that would be auto-categorized (always mode + high confidence). */
  auto:      number
  /** Transactions that need human review (conflict or ask/non-high rule). */
  review:    number
  /** Transactions with no matching rule. */
  unmatched: number
  /** Per-transaction match details. */
  matches: Array<{
    stagingTxId: string
    vendorKey:   string
    ruleId:      string | null
    ruleReason:  string | null
    status:      'auto' | 'needs_review' | 'unmatched'
    categoryId:  string | null
  }>
}

/**
 * Simulate rule matching for all uncommitted staging transactions in an upload.
 *
 * @param stagingUploadId - the StagingUpload to evaluate
 * @param userId          - the authenticated user's id
 * @returns DryRunResult with aggregate counts and per-transaction details
 */
export async function dryRunRules(
  stagingUploadId: string,
  userId: string,
): Promise<DryRunResult> {
  // Step 1: Fetch all uncommitted staging transactions for this upload
  const stagingTxs = await prisma.stagingTransaction.findMany({
    where: {
      stagingUploadId,
      committedAt: null,
    },
  })

  const result: DryRunResult = {
    total:     stagingTxs.length,
    auto:      0,
    review:    0,
    unmatched: 0,
    matches:   [],
  }

  // Steps 2-6: Run match engine for each staging transaction
  for (const tx of stagingTxs) {
    const matchResult = await matchRules(
      tx.vendorKey,
      tx.amountCents,
      tx.description,
      userId,
    )

    if (matchResult.matched) {
      const { rule, reason } = matchResult

      // Step 3: auto — 'always' mode AND 'high' confidence
      if (rule.mode === 'always' && rule.confidence === 'high') {
        result.auto++
        result.matches.push({
          stagingTxId: tx.id,
          vendorKey:   tx.vendorKey,
          ruleId:      rule.id,
          ruleReason:  reason,
          status:      'auto',
          categoryId:  rule.categoryId,
        })
      } else {
        // Step 4: needs_review — 'ask' mode OR non-high confidence
        result.review++
        result.matches.push({
          stagingTxId: tx.id,
          vendorKey:   tx.vendorKey,
          ruleId:      rule.id,
          ruleReason:  reason,
          status:      'needs_review',
          categoryId:  rule.categoryId,
        })
      }
    } else {
      // Step 5: needs_review from conflict, or Step 6: unmatched
      if (!matchResult.matched && matchResult.status === 'needs_review') {
        result.review++
        result.matches.push({
          stagingTxId: tx.id,
          vendorKey:   tx.vendorKey,
          ruleId:      null,
          ruleReason:  matchResult.reason ?? null,
          status:      'needs_review',
          categoryId:  null,
        })
      } else {
        result.unmatched++
        result.matches.push({
          stagingTxId: tx.id,
          vendorKey:   tx.vendorKey,
          ruleId:      null,
          ruleReason:  null,
          status:      'unmatched',
          categoryId:  null,
        })
      }
    }
  }

  return result
}
