/**
 * PDF Reconciliation
 *
 * Validates extracted CandidateTransactions and produces ReconciliationIssue[].
 * No repair in v1 — issues are flagged and low-confidence rows go to review queue.
 */

import type { CandidateTransaction, PdfClassification, ReconciliationIssue } from './types'
import { PDF_LIMITS } from './types'

const MAX_PLAUSIBLE_AMOUNT = 1_000_000 // $1M — above this is likely a parse error
const DATE_WINDOW_DAYS = 7             // tolerance for dates outside statement period

/**
 * Parse an ISO date string to a Date object (UTC).
 * Returns null if invalid.
 */
function parseIsoDate(iso: string | null): Date | null {
  if (!iso) return null
  const d = new Date(iso + 'T00:00:00Z')
  return isNaN(d.getTime()) ? null : d
}

/**
 * Normalize a description string for duplicate detection.
 * Lowercased, whitespace collapsed, leading/trailing stripped.
 */
function normalizeDescription(desc: string | null): string {
  if (!desc) return ''
  return desc.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Run validation checks on the list of candidates.
 * Returns a list of ReconciliationIssue records.
 * Low-confidence candidates are flagged but not removed — the orchestrator
 * decides what to do with them (review queue in v1).
 */
export function reconcileCandidates(
  candidates: CandidateTransaction[],
  classification: PdfClassification,
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = []

  const stmtStart = parseIsoDate(classification.statementStart)
  const stmtEnd = parseIsoDate(classification.statementEnd)
  const windowMs = DATE_WINDOW_DAYS * 24 * 60 * 60 * 1000

  // ── 1. Date range check ────────────────────────────────────────────────────
  if (stmtStart && stmtEnd) {
    const outOfRangeIds: string[] = []
    for (const candidate of candidates) {
      if (!candidate.parsedDate) continue
      const txDate = parseIsoDate(candidate.parsedDate)
      if (!txDate) continue
      const tooEarly = txDate.getTime() < stmtStart.getTime() - windowMs
      const tooLate = txDate.getTime() > stmtEnd.getTime() + windowMs
      if (tooEarly || tooLate) {
        outOfRangeIds.push(candidate.id)
      }
    }
    if (outOfRangeIds.length > 0) {
      issues.push({
        code: 'OUT_OF_RANGE_DATE',
        severity: 'warning',
        candidateIds: outOfRangeIds,
        message: `${outOfRangeIds.length} transaction(s) have dates outside the statement period (${classification.statementStart} to ${classification.statementEnd}) plus ${DATE_WINDOW_DAYS} day tolerance.`,
      })
    }
  }

  // ── 2. Amount plausibility check ───────────────────────────────────────────
  const hugAmountIds: string[] = []
  for (const candidate of candidates) {
    if (candidate.parsedAmount !== null && candidate.parsedAmount > MAX_PLAUSIBLE_AMOUNT) {
      hugAmountIds.push(candidate.id)
    }
  }
  if (hugAmountIds.length > 0) {
    issues.push({
      code: 'MISSING_AMOUNT',
      severity: 'error',
      candidateIds: hugAmountIds,
      message: `${hugAmountIds.length} transaction(s) have amounts exceeding $${MAX_PLAUSIBLE_AMOUNT.toLocaleString()} — likely a parse error.`,
    })
  }

  // ── 3. Duplicate detection ─────────────────────────────────────────────────
  // Flag candidates with identical (date + amount + description) within same extraction
  type DedupKey = string
  const seen = new Map<DedupKey, string[]>() // key → [candidateId, ...]

  for (const candidate of candidates) {
    const key: DedupKey = [
      candidate.parsedDate ?? 'nodate',
      candidate.parsedAmount !== null ? candidate.parsedAmount.toFixed(2) : 'noamt',
      normalizeDescription(candidate.parsedDescription),
    ].join('|')

    const existing = seen.get(key) ?? []
    existing.push(candidate.id)
    seen.set(key, existing)
  }

  for (const [, ids] of seen.entries()) {
    if (ids.length > 1) {
      issues.push({
        code: 'DUPLICATE_TRANSACTION',
        severity: 'warning',
        candidateIds: ids,
        message: `${ids.length} transactions appear to be duplicates (same date, amount, and description).`,
      })
    }
  }

  // ── 4. Low confidence flagging ─────────────────────────────────────────────
  const lowConfidenceIds = candidates
    .filter((c) => c.confidence < PDF_LIMITS.MIN_CONFIDENCE)
    .map((c) => c.id)

  if (lowConfidenceIds.length > 0) {
    issues.push({
      code: 'LOW_CONFIDENCE',
      severity: 'warning',
      candidateIds: lowConfidenceIds,
      message: `${lowConfidenceIds.length} transaction(s) have confidence below ${PDF_LIMITS.MIN_CONFIDENCE} and require manual review.`,
    })
  }

  // ── 5. Missing critical fields ─────────────────────────────────────────────
  const partialIds: string[] = []
  for (const candidate of candidates) {
    // A candidate is "partial" if it's missing BOTH date AND amount
    if (!candidate.parsedDate && candidate.parsedAmount === null) {
      partialIds.push(candidate.id)
    }
  }
  if (partialIds.length > 0) {
    issues.push({
      code: 'PARTIAL_ROW',
      severity: 'error',
      candidateIds: partialIds,
      message: `${partialIds.length} transaction(s) are missing both date and amount — likely misclassified non-transaction lines.`,
    })
  }

  return issues
}
