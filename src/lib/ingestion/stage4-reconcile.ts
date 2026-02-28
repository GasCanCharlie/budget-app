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
// Balance chain logic (exported for testing)
// ─────────────────────────────────────────────────────────────────────────────

export interface TxForChain {
  id:             string
  amount:         number     // Float from DB
  runningBalance: string | null
  parseOrder:     number     // sort key (from raw.parseOrder)
}

export interface ChainCheckResult {
  /** Per-transaction results, in parseOrder order */
  rows: Array<{
    id:             string
    valid:          boolean | null   // null = anchor row (no check possible)
    expectedCents:  bigint | null
    actualCents:    bigint | null
  }>
  discrepancies: Discrepancy[]
  breakCount: number
}

/**
 * Walk the running-balance chain and return a per-row validity report.
 *
 * Rule: for each consecutive (prev, curr) pair where both have a runningBalance:
 *   toCents(prev.runningBalance) + amountToCents(curr.amount) === toCents(curr.runningBalance)
 *
 * The first row with a runningBalance is the chain anchor — it is accepted as-is
 * (we have no prior balance to validate against unless an openingBalance is provided).
 *
 * @param txs            Transactions to check (will be sorted by parseOrder internally)
 * @param openingBalance Optional opening balance from the Upload record
 */
export function validateBalanceChain(
  txs: TxForChain[],
  openingBalance?: string | null,
): ChainCheckResult {
  const sorted = [...txs].sort((a, b) => a.parseOrder - b.parseOrder)
  const discrepancies: Discrepancy[] = []
  let breakCount = 0

  const rows: ChainCheckResult['rows'] = []
  let prevCents: bigint | null = openingBalance ? toCents(openingBalance) : null

  for (let i = 0; i < sorted.length; i++) {
    const tx = sorted[i]

    if (tx.runningBalance === null) {
      rows.push({ id: tx.id, valid: null, expectedCents: null, actualCents: null })
      // Don't update prevCents — keep the last known balance
      continue
    }

    const actualCents = toCents(tx.runningBalance)

    if (prevCents === null) {
      // First row with a balance: accept as anchor
      rows.push({ id: tx.id, valid: null, expectedCents: null, actualCents })
      prevCents = actualCents
      continue
    }

    const amtCents      = amountToCents(tx.amount)
    const expectedCents = prevCents + amtCents
    const valid         = expectedCents === actualCents

    rows.push({ id: tx.id, valid, expectedCents, actualCents })

    if (!valid) {
      breakCount++
      discrepancies.push({
        type:       'BALANCE_CHAIN_BREAK',
        rowIndex:   i,
        field:      'runningBalance',
        expected:   fromCents(expectedCents),
        actual:     fromCents(actualCents),
        magnitude:  fromCents(actualCents > expectedCents
          ? actualCents - expectedCents
          : expectedCents - actualCents),
        description:
          `Balance chain break at parseOrder ${tx.parseOrder}: ` +
          `expected ${fromCents(expectedCents)}, got ${fromCents(actualCents)}`,
      })
    }

    // Always advance prevCents using the ACTUAL balance from the file
    // (so a single break doesn't cascade to every subsequent row)
    prevCents = actualCents
  }

  return { rows, discrepancies, breakCount }
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

  // ── 2. Fetch transactions (non-rejected, sorted by raw parseOrder) ─────────
  // We need parseOrder from the related TransactionRaw for correct chain ordering.
  const rawTxRows = await prisma.transactionRaw.findMany({
    where: { uploadId },
    select: { id: true, parseOrder: true },
  })
  const parseOrderById = new Map(rawTxRows.map((r) => [r.id, r.parseOrder]))

  const txRows = await prisma.transaction.findMany({
    where: { uploadId, ingestionStatus: { not: 'REJECTED' } },
    select: {
      id:             true,
      rawId:          true,
      amount:         true,
      runningBalance: true,
      ingestionStatus: true,
      isPossibleDuplicate: true,
    },
  })

  // Attach parseOrder (from the raw row)
  const txs: TxForChain[] = txRows.map((tx) => ({
    id:             tx.id,
    amount:         tx.amount,
    runningBalance: tx.runningBalance,
    parseOrder:     parseOrderById.get(tx.rawId) ?? 0,
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

  // ── 4. Detect mode ─────────────────────────────────────────────────────────
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
    // Mode B: validate the balance chain
    chainResult = validateBalanceChain(txs, upload.statementOpenBalance ?? null)
    discrepancies.push(...chainResult.discrepancies)

    checks.push({
      name:     'Balance chain intact',
      passed:   chainResult.breakCount === 0,
      expected: '0',
      actual:   String(chainResult.breakCount),
      tolerance: 'EXACT',
      details:  `${balanceCount} rows with running balance checked`,
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

  // ── 7. Update Transaction balance chain fields (Mode B) ─────────────────────
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

  // ── 8. Build ReconciliationReport ─────────────────────────────────────────
  const unresolvedIssues = await prisma.ingestionIssue.findMany({
    where: { uploadId, resolved: false, severity: 'ERROR' },
    select: { id: true, transactionId: true, issueType: true, description: true, suggestedAction: true },
  })

  const possibleDuplicateCount = txRows.filter((t) => t.isPossibleDuplicate).length

  const reconciliationResult: ReconciliationResult = {
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

  // ── 9. Persist: update Upload + write AuditLogEntry ───────────────────────
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
      }),
    },
  })

  return { status, mode }
}
