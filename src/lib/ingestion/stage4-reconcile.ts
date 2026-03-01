/**
 * Stage 4 — Reconcile
 *
 * Verifies that the set of imported transactions is complete and consistent.
 * Three modes are attempted in order; the first that applies is used:
 *
 *   A. STATEMENT_TOTALS  — bank export includes declared total credits/debits
 *                          or opening/closing balances.  Checks our computed
 *                          sums against those declared values to the cent.
 *   B. RUNNING_BALANCE   — per-row running balance column present (≥2 rows).
 *                          Walks the chain: prevBalance + amount = thisBalance.
 *                          Any break is a BALANCE_CHAIN_BREAK discrepancy.
 *   C. UNVERIFIABLE      — no declared totals, no running balance.
 *                          Reports summary stats but cannot prove completeness.
 *
 * Design contracts:
 *   - All arithmetic uses BigInt cents — no floating-point accumulation errors
 *   - Zero tolerance ("EXACT") for Mode A total checks
 *   - Balance chain validation updates Transaction.balanceChainValid/Expected/Actual
 *   - Writes one AuditLogEntry (stage = RECONCILE) per upload
 *   - Stores ReconciliationReport as JSON in Upload.reconciliationReport
 *   - Idempotent: can be rerun without creating duplicate data
 *   - Chronological sort (transactionDate → postedDate → referenceNumber →
 *     parseOrder) used for chain validation, not raw CSV row order
 */

import prisma from '@/lib/db'
import { PARSER_VERSION } from '@/types/ingestion'
import type {
  ReconciliationMode,
  ReconciliationStatus,
  ReconciliationCheck,
  Discrepancy,
  ReconciliationResult,
  ReconciliationReport,
} from '@/types/ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// BigInt decimal arithmetic (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a signed decimal string (e.g. "-1234.56") to integer cents.
 * Handles: leading minus, missing decimal part, extra decimal precision.
 * Rounds to the nearest cent (banker-safe — no half-cent inputs expected).
 */
export function toCents(decimal: string): bigint {
  const trimmed = decimal.trim()
  if (!trimmed || trimmed === '-') return BigInt(0)

  const isNeg = trimmed.startsWith('-')
  const abs   = isNeg ? trimmed.slice(1) : trimmed

  const dotIdx = abs.indexOf('.')
  let intStr: string
  let fracStr: string

  if (dotIdx === -1) {
    intStr  = abs
    fracStr = '00'
  } else {
    intStr  = abs.slice(0, dotIdx)
    // Take exactly 2 decimal digits (truncate extra, pad if short)
    fracStr = abs.slice(dotIdx + 1).padEnd(2, '0').slice(0, 2)
  }

  const cents = BigInt(intStr || '0') * BigInt(100) + BigInt(fracStr)
  return isNeg ? -cents : cents
}

/**
 * Convert integer cents back to a signed decimal string ("1234.56", "-42.50").
 */
export function fromCents(cents: bigint): string {
  const isNeg   = cents < BigInt(0)
  const abs     = isNeg ? -cents : cents
  const intPart = abs / BigInt(100)
  const frac    = abs % BigInt(100)
  return `${isNeg ? '-' : ''}${intPart}.${String(frac).padStart(2, '0')}`
}

/**
 * Convert a Float amount from the DB to exact cents.
 * Math.round(x * 100) is exact for all realistic financial amounts (< $90 trillion).
 */
export function amountToCents(amount: number): bigint {
  return BigInt(Math.round(amount * 100))
}

// ─────────────────────────────────────────────────────────────────────────────
// Mode detection (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

interface UploadTotalsSnapshot {
  statementTotalCredits:  string | null
  statementTotalDebits:   string | null
  statementOpenBalance:   string | null
  statementCloseBalance:  string | null
}

/**
 * Determine which reconciliation mode applies, given what data is available.
 * Tries A → B → C in order.
 *
 * @param snap         Statement-level fields from the Upload record
 * @param balanceCount Number of non-null runningBalance values in the batch
 */
export function detectMode(
  snap: UploadTotalsSnapshot,
  balanceCount: number,
): ReconciliationMode {
  const hasTotals =
    (!!snap.statementTotalCredits && !!snap.statementTotalDebits) ||
    (!!snap.statementOpenBalance  && !!snap.statementCloseBalance)

  if (hasTotals) return 'STATEMENT_TOTALS'
  if (balanceCount >= 2) return 'RUNNING_BALANCE'
  return 'UNVERIFIABLE'
}

// ─────────────────────────────────────────────────────────────────────────────
// Balance model detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whether the bank's running balance column reflects the balance AFTER or
 * BEFORE the current transaction is applied.
 *
 * AFTER:  prevBalance + currAmount = currBalance  (most common)
 * BEFORE: prevBalance + prevAmount = currBalance  (some European banks)
 */
export type BalanceModel = 'AFTER' | 'BEFORE'

// ─────────────────────────────────────────────────────────────────────────────
// Balance chain logic (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

export interface TxForChain {
  id:              string
  amount:          number        // Float from DB
  runningBalance:  string | null
  parseOrder:      number        // sort key (from raw.parseOrder)
  postedDate:      string | null // ISO date string (Transaction.postedDate)
  transactionDate: string | null // ISO date string (Transaction.transactionDate = effective date)
  referenceNumber: string | null // Transaction.bankTransactionId for stable ordering
}

export interface ChainCheckResult {
  /** Per-transaction results, in reconOrder order */
  rows: Array<{
    id:             string
    reconOrder:     number
    valid:          boolean | null   // null = anchor row (no check possible)
    expectedCents:  bigint | null
    actualCents:    bigint | null
  }>
  discrepancies:  Discrepancy[]
  breakCount:     number
  reconOrderMap:  Map<string, number>
  rowsReordered:  number
}

/**
 * Delta statistics describing discrepancy patterns.
 * Used to detect whether a constant balance offset (e.g. an opening balance
 * included in all running-balance values) explains every chain break.
 */
export interface DeltaStats {
  isConstantOffset: boolean
  /** fromCents representation of the constant delta; null if not constant */
  offsetValue:      string | null
  /** Number of BALANCE_CHAIN_BREAK discrepancies analysed */
  offsetCount:      number
  /** breakCount / totalRows * 100, rounded to 1 decimal */
  coveragePercent:  number
}

/**
 * Detect whether the CSV export is ordered newest-first or oldest-first by
 * comparing the date of the row with the smallest parseOrder against the row
 * with the largest parseOrder.
 *
 *   Newest-first: parseOrder 0 has the latest date  → use DESC parseOrder tiebreaker
 *   Oldest-first: parseOrder 0 has the earliest date → use ASC  parseOrder tiebreaker
 *
 * The tiebreaker controls how same-date transactions are sequenced within a day.
 * Most banks that export newest-first also sequence same-day transactions newest-
 * first, so within a day we must sort by descending parseOrder to get chronological
 * (oldest-first) order for the AFTER model check.
 */
export function detectCsvParseOrderDir(txs: TxForChain[]): 'asc' | 'desc' {
  const withDates = txs.filter(t => (t.transactionDate ?? t.postedDate) !== null)
  if (withDates.length < 2) return 'asc'

  const sorted = [...withDates].sort((a, b) => a.parseOrder - b.parseOrder)
  const first = sorted[0]
  const last  = sorted[sorted.length - 1]

  const firstDate = first.transactionDate ?? first.postedDate ?? ''
  const lastDate  = last.transactionDate  ?? last.postedDate  ?? ''

  // If the first CSV row has a later date, the export is newest-first
  return firstDate > lastDate ? 'desc' : 'asc'
}

/**
 * Build a deterministic chronological ordering map for the given transactions.
 *
 * Sort precedence (dates ascending, tiebreaker direction configurable):
 *   1. transactionDate (effective / value date) — ascending
 *   2. postedDate — ascending
 *   3. referenceNumber (bankTransactionId) — lexicographic ascending
 *   4. parseOrder — ascending (oldest-first CSV) or descending (newest-first CSV)
 *
 * Use {@link detectCsvParseOrderDir} to determine the correct `parseOrderDir`.
 *
 * @param txs           Transactions to order
 * @param parseOrderDir Tiebreaker direction when all date/ref keys are equal.
 *                      'asc' for oldest-first CSVs (default), 'desc' for newest-first.
 * @returns Map<txId, reconOrder> where reconOrder is 0-based position.
 */
export function computeReconOrder(
  txs: TxForChain[],
  parseOrderDir: 'asc' | 'desc' = 'asc',
): Map<string, number> {
  const sorted = [...txs].sort((a, b) => {
    // 1. transactionDate
    const tdA = a.transactionDate ?? ''
    const tdB = b.transactionDate ?? ''
    if (tdA < tdB) return -1
    if (tdA > tdB) return  1

    // 2. postedDate
    const pdA = a.postedDate ?? ''
    const pdB = b.postedDate ?? ''
    if (pdA < pdB) return -1
    if (pdA > pdB) return  1

    // 3. referenceNumber (lexicographic)
    const rnA = a.referenceNumber ?? ''
    const rnB = b.referenceNumber ?? ''
    if (rnA < rnB) return -1
    if (rnA > rnB) return  1

    // 4. parseOrder tiebreaker — direction depends on CSV sort order
    return parseOrderDir === 'asc'
      ? a.parseOrder - b.parseOrder
      : b.parseOrder - a.parseOrder
  })

  const map = new Map<string, number>()
  sorted.forEach((tx, i) => map.set(tx.id, i))
  return map
}

/**
 * Probe the first k rows that have a runningBalance and decide whether the
 * bank records the balance AFTER or BEFORE each transaction.
 *
 * AFTER model: prevBalance + currAmount  === currBalance
 * BEFORE model: prevBalance + prevAmount === currBalance
 *
 * @param sortedTxs Transactions already sorted in reconOrder
 * @param k         Max sample size (default 20)
 */
export function detectBalanceModel(
  sortedTxs: TxForChain[],
  k = 20,
): { model: BalanceModel; needsReview: boolean } {
  // Collect up to k consecutive pairs where both rows have a runningBalance
  type Sample = { prevBal: bigint; prevAmt: bigint; currAmt: bigint; currBal: bigint }
  const samples: Sample[] = []

  let prevIdx: number | null = null

  for (let i = 0; i < sortedTxs.length && samples.length < k; i++) {
    const tx = sortedTxs[i]
    if (tx.runningBalance === null) {
      // Keep prevIdx so we can check the next balance row against it
      continue
    }

    if (prevIdx !== null) {
      const prev = sortedTxs[prevIdx]
      samples.push({
        prevBal: toCents(prev.runningBalance!),
        prevAmt: amountToCents(prev.amount),
        currAmt: amountToCents(tx.amount),
        currBal: toCents(tx.runningBalance),
      })
    }

    prevIdx = i
  }

  if (samples.length < 2) {
    return { model: 'AFTER', needsReview: true }
  }

  let afterMismatches  = 0
  let beforeMismatches = 0

  for (const s of samples) {
    if (s.prevBal + s.currAmt !== s.currBal) afterMismatches++
    if (s.prevBal + s.prevAmt !== s.currBal) beforeMismatches++
  }

  const threshold = samples.length * 0.3  // 30% mismatch rate

  if (afterMismatches === beforeMismatches) {
    // Tie — default to AFTER and flag for review
    return { model: 'AFTER', needsReview: true }
  }

  if (afterMismatches < beforeMismatches) {
    return { model: 'AFTER', needsReview: afterMismatches > threshold }
  }

  return { model: 'BEFORE', needsReview: beforeMismatches > threshold }
}

/**
 * Analyse discrepancy deltas to detect a constant balance offset.
 *
 * A constant offset (e.g. the bank includes an opening balance in all running
 * balances, or the statement uses a different sign convention) will produce
 * the same signed delta for every break.  If ≥80 % of deltas match the first
 * delta, we flag it as a constant offset.
 *
 * @param discrepancies Full discrepancy list from validateBalanceChain
 * @param totalRows     Total number of transactions in the upload
 */
export function analyzeDiscrepancyPattern(
  discrepancies: Discrepancy[],
  totalRows: number,
): DeltaStats {
  const breaks = discrepancies.filter((d) => d.type === 'BALANCE_CHAIN_BREAK')

  if (breaks.length === 0) {
    return {
      isConstantOffset: false,
      offsetValue:      null,
      offsetCount:      0,
      coveragePercent:  0,
    }
  }

  // signed delta = actual - expected (using toCents on the stored strings)
  const deltas = breaks.map((d) => toCents(d.actual) - toCents(d.expected))
  const firstDelta = deltas[0]

  const matchCount = deltas.filter((d) => d === firstDelta).length
  const ratio      = matchCount / deltas.length

  const isConstantOffset = ratio >= 0.8
  const coveragePercent  = Math.round((breaks.length / Math.max(totalRows, 1)) * 1000) / 10

  return {
    isConstantOffset,
    offsetValue:  isConstantOffset ? fromCents(firstDelta) : null,
    offsetCount:  breaks.length,
    coveragePercent,
  }
}

/**
 * Walk the running-balance chain and return a per-row validity report.
 *
 * Supports two balance models:
 *   AFTER  (default): prevBalance + currAmount = currBalance
 *   BEFORE:           prevBalance + prevAmount = currBalance
 *
 * Rows are sorted chronologically via computeReconOrder() before validation.
 * rowsReordered counts how many rows appear in a different position under the
 * chronological sort versus their original parseOrder.
 *
 * The first row with a runningBalance is the chain anchor — it is accepted
 * as-is (we have no prior balance to validate against unless an openingBalance
 * is provided).
 *
 * @param txs            Transactions to check
 * @param openingBalance Optional opening balance from the Upload record
 * @param model          Balance model to apply (default: AFTER)
 */
export function validateBalanceChain(
  txs: TxForChain[],
  openingBalance?: string | null,
  model: BalanceModel = 'AFTER',
  parseOrderDir: 'asc' | 'desc' = 'asc',
): ChainCheckResult {
  // Build the deterministic chronological ordering
  const reconOrderMap = computeReconOrder(txs, parseOrderDir)

  // Sort by reconOrder
  const sorted = [...txs].sort(
    (a, b) => (reconOrderMap.get(a.id) ?? 0) - (reconOrderMap.get(b.id) ?? 0),
  )

  // Count rows whose chronological position differs from their parseOrder rank.
  // We compare reconOrder position to a rank computed from parseOrder.
  const parseOrderRank = new Map<string, number>()
  ;[...txs]
    .sort((a, b) => a.parseOrder - b.parseOrder)
    .forEach((tx, i) => parseOrderRank.set(tx.id, i))

  let rowsReordered = 0
  for (const tx of txs) {
    const recon = reconOrderMap.get(tx.id) ?? 0
    const parse = parseOrderRank.get(tx.id) ?? 0
    if (recon !== parse) rowsReordered++
  }

  const discrepancies: Discrepancy[] = []
  let breakCount = 0

  const rows: ChainCheckResult['rows'] = []

  if (model === 'AFTER') {
    // ── AFTER model ──────────────────────────────────────────────────────────
    // prevBalance + currAmount = currBalance
    let prevCents: bigint | null = openingBalance ? toCents(openingBalance) : null

    for (let i = 0; i < sorted.length; i++) {
      const tx         = sorted[i]
      const reconOrder = reconOrderMap.get(tx.id) ?? i

      if (tx.runningBalance === null) {
        rows.push({ id: tx.id, reconOrder, valid: null, expectedCents: null, actualCents: null })
        // Don't update prevCents — keep the last known balance
        continue
      }

      const actualCents = toCents(tx.runningBalance)

      if (prevCents === null) {
        // First row with a balance: accept as anchor
        rows.push({ id: tx.id, reconOrder, valid: null, expectedCents: null, actualCents })
        prevCents = actualCents
        continue
      }

      const amtCents      = amountToCents(tx.amount)
      const expectedCents = prevCents + amtCents
      const valid         = expectedCents === actualCents

      rows.push({ id: tx.id, reconOrder, valid, expectedCents, actualCents })

      if (!valid) {
        breakCount++
        discrepancies.push({
          type:       'BALANCE_CHAIN_BREAK',
          rowIndex:   reconOrder,
          field:      'runningBalance',
          expected:   fromCents(expectedCents),
          actual:     fromCents(actualCents),
          magnitude:  fromCents(
            actualCents > expectedCents
              ? actualCents - expectedCents
              : expectedCents - actualCents,
          ),
          description:
            `Balance break at recon position ${reconOrder + 1}: ` +
            `expected ${fromCents(expectedCents)}, got ${fromCents(actualCents)}`,
        })
      }

      // Always advance prevCents using the ACTUAL balance from the file
      // (so a single break doesn't cascade to every subsequent row)
      prevCents = actualCents
    }

  } else {
    // ── BEFORE model ─────────────────────────────────────────────────────────
    // prevBalance + prevAmount = currBalance
    // The current row's balance was set BEFORE the current transaction applied.
    // That means the previous row's balance + the previous row's amount should
    // equal the current row's balance.
    let prevBalCents: bigint | null = openingBalance ? toCents(openingBalance) : null
    let prevAmtCents: bigint | null = null
    let anchorSet = false

    for (let i = 0; i < sorted.length; i++) {
      const tx         = sorted[i]
      const reconOrder = reconOrderMap.get(tx.id) ?? i
      const currAmtCents = amountToCents(tx.amount)

      if (tx.runningBalance === null) {
        // No balance on this row — update prevAmtCents for BEFORE-model tracking
        rows.push({ id: tx.id, reconOrder, valid: null, expectedCents: null, actualCents: null })
        prevAmtCents = currAmtCents
        continue
      }

      const actualCents = toCents(tx.runningBalance)

      if (!anchorSet) {
        // First row with a balance: accept as anchor regardless of openingBalance
        rows.push({ id: tx.id, reconOrder, valid: null, expectedCents: null, actualCents })
        prevBalCents = actualCents
        prevAmtCents = currAmtCents
        anchorSet    = true
        continue
      }

      if (prevBalCents === null || prevAmtCents === null) {
        // Should not occur after anchor is set, but guard anyway
        rows.push({ id: tx.id, reconOrder, valid: null, expectedCents: null, actualCents })
        prevBalCents = actualCents
        prevAmtCents = currAmtCents
        continue
      }

      // BEFORE model: prevBalance + prevAmount = currBalance
      const expectedCents = prevBalCents + prevAmtCents
      const valid         = expectedCents === actualCents

      rows.push({ id: tx.id, reconOrder, valid, expectedCents, actualCents })

      if (!valid) {
        breakCount++
        discrepancies.push({
          type:       'BALANCE_CHAIN_BREAK',
          rowIndex:   reconOrder,
          field:      'runningBalance',
          expected:   fromCents(expectedCents),
          actual:     fromCents(actualCents),
          magnitude:  fromCents(
            actualCents > expectedCents
              ? actualCents - expectedCents
              : expectedCents - actualCents,
          ),
          description:
            `Balance break at recon position ${reconOrder + 1}: ` +
            `expected ${fromCents(expectedCents)}, got ${fromCents(actualCents)}`,
        })
      }

      // Advance: use actual balance (not expected) to prevent cascade
      prevBalCents = actualCents
      prevAmtCents = currAmtCents
    }
  }

  return { rows, discrepancies, breakCount, reconOrderMap, rowsReordered }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run Stage 4 reconciliation for the given upload.
 *
 * Should be called after the Upload record has been finalised (status = 'complete').
 *
 * @param uploadId  The upload to reconcile
 */
export async function runReconciliation(
  uploadId: string,
): Promise<{ status: ReconciliationStatus; mode: ReconciliationMode }> {

  // ── 1. Fetch Upload ────────────────────────────────────────────────────────
  const upload = await prisma.upload.findUniqueOrThrow({ where: { id: uploadId } })

  // ── 2. Fetch transactions (non-rejected, with all fields needed for chain) ─
  // We need parseOrder from the related TransactionRaw for correct chain ordering.
  const rawTxRows = await prisma.transactionRaw.findMany({
    where: { uploadId },
    select: { id: true, parseOrder: true },
  })
  const parseOrderById = new Map(rawTxRows.map((r) => [r.id, r.parseOrder]))

  const txRows = await prisma.transaction.findMany({
    where: { uploadId, ingestionStatus: { not: 'REJECTED' } },
    select: {
      id:                  true,
      rawId:               true,
      amount:              true,
      runningBalance:      true,
      ingestionStatus:     true,
      isPossibleDuplicate: true,
      postedDate:          true,
      transactionDate:     true,
      bankTransactionId:   true,
    },
  })

  // Attach parseOrder and date fields (convert Date objects to ISO date strings)
  const txs: TxForChain[] = txRows.map((tx) => ({
    id:              tx.id,
    amount:          tx.amount,
    runningBalance:  tx.runningBalance,
    parseOrder:      parseOrderById.get(tx.rawId) ?? 0,
    postedDate:      tx.postedDate      ? tx.postedDate.toISOString().split('T')[0]      : null,
    transactionDate: tx.transactionDate ? tx.transactionDate.toISOString().split('T')[0] : null,
    referenceNumber: tx.bankTransactionId ?? null,
  }))

  // ── 3. Compute aggregate totals using BigInt cents ─────────────────────────
  let totalCreditsCents = BigInt(0)
  let totalDebitsCents  = BigInt(0)

  for (const tx of txs) {
    const c = amountToCents(tx.amount)
    if (c > BigInt(0)) totalCreditsCents += c
    else               totalDebitsCents  += c   // stays negative
  }

  const netChangeCents = totalCreditsCents + totalDebitsCents

  const totalCredits = fromCents(totalCreditsCents)
  const totalDebits  = fromCents(totalDebitsCents)
  const netChange    = fromCents(netChangeCents)

  // ── 4. Detect CSV sort direction + mode ───────────────────────────────────
  // Newest-first CSVs require DESC parseOrder as the same-day tiebreaker so
  // that within-day transactions are visited oldest-first during chain validation.
  const csvParseOrderDir = detectCsvParseOrderDir(txs)

  const balanceCount = txs.filter((t) => t.runningBalance !== null).length
  const mode = detectMode(
    {
      statementTotalCredits:  upload.statementTotalCredits  ?? null,
      statementTotalDebits:   upload.statementTotalDebits   ?? null,
      statementOpenBalance:   upload.statementOpenBalance   ?? null,
      statementCloseBalance:  upload.statementCloseBalance  ?? null,
    },
    balanceCount,
  )

  // ── 5. Run mode-specific checks ────────────────────────────────────────────
  const checks: ReconciliationCheck[] = []
  const discrepancies: Discrepancy[] = []
  let chainResult: ChainCheckResult | null = null
  let detectedModel: { model: BalanceModel; needsReview: boolean } = {
    model:       'AFTER',
    needsReview: false,
  }
  let deltaStats: DeltaStats | null = null

  if (mode === 'STATEMENT_TOTALS') {
    // Mode A checks
    if (upload.statementTotalCredits && upload.statementTotalDebits) {
      const declaredCredits = toCents(upload.statementTotalCredits)
      const declaredDebits  = toCents(upload.statementTotalDebits)

      checks.push({
        name:     'Total credits match',
        passed:   totalCreditsCents === declaredCredits,
        expected: fromCents(declaredCredits),
        actual:   totalCredits,
        tolerance: 'EXACT',
      })

      checks.push({
        name:     'Total debits match',
        passed:   totalDebitsCents === declaredDebits,
        expected: fromCents(declaredDebits),
        actual:   totalDebits,
        tolerance: 'EXACT',
      })
    }

    if (upload.statementOpenBalance && upload.statementCloseBalance) {
      const openCents  = toCents(upload.statementOpenBalance)
      const closeCents = toCents(upload.statementCloseBalance)
      const declaredNet = closeCents - openCents

      checks.push({
        name:     'Net change matches open→close',
        passed:   netChangeCents === declaredNet,
        expected: fromCents(declaredNet),
        actual:   netChange,
        tolerance: 'EXACT',
        details:  `Open: ${upload.statementOpenBalance}, Close: ${upload.statementCloseBalance}`,
      })
    }

    // Flag any check failures as TOTAL_MISMATCH discrepancies
    for (const check of checks) {
      if (!check.passed) {
        discrepancies.push({
          type:        'TOTAL_MISMATCH',
          rowIndex:    null,
          field:       check.name,
          expected:    check.expected,
          actual:      check.actual,
          magnitude:   fromCents(
            toCents(check.actual) > toCents(check.expected)
              ? toCents(check.actual)  - toCents(check.expected)
              : toCents(check.expected) - toCents(check.actual),
          ),
          description: `${check.name}: declared ${check.expected}, computed ${check.actual}`,
        })
      }
    }

  } else if (mode === 'RUNNING_BALANCE') {
    // Mode B: detect balance model, then validate the chain chronologically

    // Sort txs by reconOrder (with the detected CSV direction) for model detection
    const reconOrderMap = computeReconOrder(txs, csvParseOrderDir)
    const sortedForDetection = [...txs].sort(
      (a, b) => (reconOrderMap.get(a.id) ?? 0) - (reconOrderMap.get(b.id) ?? 0),
    )

    detectedModel = detectBalanceModel(sortedForDetection)

    chainResult = validateBalanceChain(
      txs,
      upload.statementOpenBalance ?? null,
      detectedModel.model,
      csvParseOrderDir,
    )
    discrepancies.push(...chainResult.discrepancies)

    // Analyse discrepancy pattern for constant-offset detection
    deltaStats = analyzeDiscrepancyPattern(chainResult.discrepancies, txs.length)

    checks.push({
      name:      'Balance chain intact',
      passed:    chainResult.breakCount === 0,
      expected:  '0 breaks',
      actual:    `${chainResult.breakCount} break${chainResult.breakCount === 1 ? '' : 's'}`,
      tolerance: 'EXACT',
      details:
        `Model: ${detectedModel.model}` +
        `${detectedModel.needsReview ? ' (auto-detected, review recommended)' : ''}. ` +
        `${balanceCount} rows with running balance; ` +
        `${chainResult.rowsReordered} rows reordered for chronological validation.`,
    })
  }

  // ── 6. Determine final status ──────────────────────────────────────────────
  const hasUnresolved = txRows.some((tx) => tx.ingestionStatus === 'UNRESOLVED')

  let status: ReconciliationStatus
  if (mode === 'UNVERIFIABLE') {
    status = 'UNVERIFIABLE'
  } else {
    const allPassed = checks.every((c) => c.passed)
    if (allPassed && discrepancies.length === 0) {
      status = hasUnresolved ? 'PASS_WITH_WARNINGS' : 'PASS'
    } else {
      status = 'FAIL'
    }
  }

  // ── 7. Clean up stale balance-chain data from any previous run ────────────
  //  Ensures runReconciliation is idempotent: delete old BALANCE_CHAIN_BREAK
  //  issues and reset per-transaction fields before writing new results.
  if (chainResult) {
    await prisma.ingestionIssue.deleteMany({
      where: { uploadId, issueType: 'BALANCE_CHAIN_BREAK' },
    })
    await prisma.transaction.updateMany({
      where: { uploadId },
      data: { balanceChainValid: null, balanceChainExpected: null, balanceChainActual: null },
    })
  }

  // ── 8. Update Transaction balance chain fields (Mode B) ─────────────────────
  if (chainResult) {
    for (const row of chainResult.rows) {
      if (row.valid === null) continue // anchor or no-balance row — skip
      await prisma.transaction.update({
        where: { id: row.id },
        data: {
          balanceChainValid:    row.valid,
          balanceChainExpected: row.expectedCents !== null ? fromCents(row.expectedCents) : null,
          balanceChainActual:   row.actualCents   !== null ? fromCents(row.actualCents)   : null,
        },
      })

      if (!row.valid) {
        // Create IngestionIssue for the break
        await prisma.ingestionIssue.create({
          data: {
            uploadId,
            transactionId:  row.id,
            issueType:      'BALANCE_CHAIN_BREAK',
            severity:       'ERROR',
            description:    `Running balance break: expected ${fromCents(row.expectedCents!)}, got ${fromCents(row.actualCents!)}`,
            suggestedAction: 'Check if a transaction is missing or if the amount is incorrect',
            resolved:        false,
          },
        })
      }
    }
  }

  // ── 9. Build ReconciliationReport ─────────────────────────────────────────
  const unresolvedIssues = await prisma.ingestionIssue.findMany({
    where: { uploadId, resolved: false, severity: 'ERROR' },
    select: { id: true, transactionId: true, issueType: true, description: true, suggestedAction: true },
  })

  const possibleDuplicateCount = txRows.filter((t) => t.isPossibleDuplicate).length

  const reconciliationResult: ReconciliationResult & {
    balanceModel?:  BalanceModel
    needsReview?:   boolean
    deltaStats?:    DeltaStats
    rowsReordered?: number
  } = {
    mode,
    status,
    checks,
    discrepancies,
    summary: {
      totalCredits,
      totalDebits,
      netChange,
      startBalance: upload.statementOpenBalance  ?? null,
      endBalance:   upload.statementCloseBalance ?? null,
      computedEndBalance: upload.statementOpenBalance
        ? fromCents(toCents(upload.statementOpenBalance) + netChangeCents)
        : null,
    },
    // Extended fields for v2 UI (only populated in RUNNING_BALANCE mode)
    balanceModel:  mode === 'RUNNING_BALANCE' ? detectedModel.model         : undefined,
    needsReview:   mode === 'RUNNING_BALANCE' ? detectedModel.needsReview   : undefined,
    deltaStats:    mode === 'RUNNING_BALANCE' ? (deltaStats ?? undefined)   : undefined,
    rowsReordered: mode === 'RUNNING_BALANCE' ? chainResult?.rowsReordered  : undefined,
  }

  const report: ReconciliationReport = {
    uploadId,
    fileName:          upload.filename,
    fileHashTruncated: upload.fileHash.slice(0, 16),
    sourceType:        'CSV',
    periodStart:       upload.dateRangeStart?.toISOString().split('T')[0] ?? null,
    periodEnd:         upload.dateRangeEnd?.toISOString().split('T')[0]   ?? null,
    counts: {
      totalParsed:       upload.rowCountParsed,
      imported:          upload.rowCountAccepted,
      unresolved:        upload.totalRowsUnresolved,
      rejected:          upload.rowCountRejected,
      possibleDuplicates: possibleDuplicateCount,
    },
    sums: { totalCredits, totalDebits, netChange },
    reconciliation: reconciliationResult,
    unresolvedItems: unresolvedIssues.map((issue) => ({
      issueId:        issue.id,
      transactionId:  issue.transactionId ?? null,
      rowIndex:       -1,  // source row index not stored on IngestionIssue
      sourceLocator:  { type: 'CSV' as const, sheetName: null, rowIndex: -1, dataRowIndex: -1 },
      issueType:      issue.issueType as import('@/types/ingestion').IngestionIssueType,
      description:    issue.description,
      requiredAction: issue.suggestedAction ?? 'Review and resolve this issue',
    })),
    warnings: [],
    auditLogAvailable: true,
    parserVersion:     PARSER_VERSION,
    processedAt:       new Date().toISOString(),
  }

  // ── 10. Persist: update Upload + write AuditLogEntry ──────────────────────
  await prisma.upload.update({
    where: { id: uploadId },
    data: {
      reconciliationStatus: status,
      reconciliationReport: JSON.stringify(report),
    },
  })

  const logLevel = status === 'PASS' || status === 'PASS_WITH_WARNINGS' || status === 'UNVERIFIABLE'
    ? 'INFO'
    : 'WARN'

  await prisma.auditLogEntry.create({
    data: {
      uploadId,
      stage:   'RECONCILE',
      level:   logLevel,
      message: `Reconciliation ${status} (mode: ${mode})` +
               (discrepancies.length > 0 ? ` — ${discrepancies.length} discrepancy(ies)` : ''),
      context: JSON.stringify({
        mode,
        status,
        totalCredits,
        totalDebits,
        netChange,
        checksCount:         checks.length,
        discrepanciesCount:  discrepancies.length,
        balanceBreaks:       chainResult?.breakCount ?? 0,
        balanceModel:        mode === 'RUNNING_BALANCE' ? detectedModel.model       : undefined,
        needsReview:         mode === 'RUNNING_BALANCE' ? detectedModel.needsReview : undefined,
        rowsReordered:       chainResult?.rowsReordered ?? 0,
        csvParseOrderDir,
      }),
    },
  })

  // Write a second audit entry if rows were reordered for chronological validation
  if (chainResult && chainResult.rowsReordered > 0) {
    await prisma.auditLogEntry.create({
      data: {
        uploadId,
        stage:   'RECONCILE',
        level:   'INFO',
        message: `${chainResult.rowsReordered} rows reordered for chronological balance chain validation`,
        context: JSON.stringify({
          rowsReordered: chainResult.rowsReordered,
          model:         detectedModel.model,
        }),
      },
    })
  }

  return { status, mode }
}
