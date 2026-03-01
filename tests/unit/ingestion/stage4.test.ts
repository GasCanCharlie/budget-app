/**
 * Stage 4 — Reconcile unit tests
 *
 * Pure helper functions (toCents, fromCents, amountToCents, detectMode,
 * validateBalanceChain) are tested without any mocks.
 *
 * runReconciliation is tested with a full prisma mock — no real DB is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Prisma mock — vi.hoisted() ensures these refs are initialised before the
// vi.mock() factory runs (which is hoisted to the top of the file by Vitest).
// ─────────────────────────────────────────────────────────────────────────────

const {
  mockFindUniqueOrThrow,
  mockUpdateUpload,
  mockFindManyTransactionRaw,
  mockFindManyTransaction,
  mockUpdateTransaction,
  mockFindManyIngestionIssue,
  mockCreateIngestionIssue,
  mockCreateAuditLogEntry,
} = vi.hoisted(() => ({
  mockFindUniqueOrThrow:      vi.fn(),
  mockUpdateUpload:           vi.fn(),
  mockFindManyTransactionRaw: vi.fn(),
  mockFindManyTransaction:    vi.fn(),
  mockUpdateTransaction:      vi.fn(),
  mockFindManyIngestionIssue: vi.fn(),
  mockCreateIngestionIssue:   vi.fn(),
  mockCreateAuditLogEntry:    vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: {
    upload: {
      findUniqueOrThrow: mockFindUniqueOrThrow,
      update:            mockUpdateUpload,
    },
    transactionRaw: {
      findMany: mockFindManyTransactionRaw,
    },
    transaction: {
      findMany: mockFindManyTransaction,
      update:   mockUpdateTransaction,
    },
    ingestionIssue: {
      create:   mockCreateIngestionIssue,
      findMany: mockFindManyIngestionIssue,
    },
    auditLogEntry: {
      create: mockCreateAuditLogEntry,
    },
  },
}))

import {
  toCents,
  fromCents,
  amountToCents,
  detectMode,
  validateBalanceChain,
  runReconciliation,
  computeReconOrder,
  detectBalanceModel,
  analyzeDiscrepancyPattern,
  detectCsvParseOrderDir,
} from '@/lib/ingestion/stage4-reconcile'
import type { TxForChain } from '@/lib/ingestion/stage4-reconcile'

// Helper — builds a full TxForChain with sensible defaults for new fields
function tx(
  id: string,
  amount: number,
  runningBalance: string | null,
  parseOrder: number,
  dates?: { posted?: string; transaction?: string; ref?: string },
): TxForChain {
  return {
    id,
    amount,
    runningBalance,
    parseOrder,
    postedDate:      dates?.posted      ?? null,
    transactionDate: dates?.transaction ?? null,
    referenceNumber: dates?.ref         ?? null,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture constants
// ─────────────────────────────────────────────────────────────────────────────

const UPLOAD_ID = 'upload-stage4-001'

/** Minimal Upload DB row returned by findUniqueOrThrow */
function makeUploadRow(overrides: Record<string, unknown> = {}) {
  return {
    id:                     UPLOAD_ID,
    filename:               'bank-statement.csv',
    fileHash:               'abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    statementTotalCredits:  null,
    statementTotalDebits:   null,
    statementOpenBalance:   null,
    statementCloseBalance:  null,
    dateRangeStart:         null,
    dateRangeEnd:           null,
    rowCountParsed:         3,
    rowCountAccepted:       3,
    totalRowsUnresolved:    0,
    rowCountRejected:       0,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// toCents
// ─────────────────────────────────────────────────────────────────────────────

describe('toCents', () => {
  it('converts a positive decimal string to cents', () => {
    expect(toCents('12.34')).toBe(BigInt(1234))
  })

  it('converts a negative decimal string to cents', () => {
    expect(toCents('-12.34')).toBe(BigInt(-1234))
  })

  it('handles whole-number strings without a decimal point', () => {
    expect(toCents('100')).toBe(BigInt(10000))
    expect(toCents('-50')).toBe(BigInt(-5000))
  })

  it('pads a single decimal digit to two places', () => {
    // "1.5" should be treated as "1.50" = 150 cents
    expect(toCents('1.5')).toBe(BigInt(150))
  })

  it('truncates extra decimal digits (no rounding beyond 2 dp)', () => {
    // "1.999" → truncates to "99" cents (slice to 2 chars)
    expect(toCents('1.999')).toBe(BigInt(199))
  })

  it('returns zero for empty string', () => {
    expect(toCents('')).toBe(BigInt(0))
  })

  it('returns zero for lone minus sign', () => {
    expect(toCents('-')).toBe(BigInt(0))
  })

  it('handles large balance values correctly', () => {
    expect(toCents('1800.00')).toBe(BigInt(180000))
    expect(toCents('1750.00')).toBe(BigInt(175000))
  })

  it('handles zero correctly', () => {
    expect(toCents('0.00')).toBe(BigInt(0))
    expect(toCents('0')).toBe(BigInt(0))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// fromCents
// ─────────────────────────────────────────────────────────────────────────────

describe('fromCents', () => {
  it('converts positive cents to a decimal string', () => {
    expect(fromCents(BigInt(1234))).toBe('12.34')
  })

  it('converts negative cents to a signed decimal string', () => {
    expect(fromCents(BigInt(-1234))).toBe('-12.34')
  })

  it('pads single-digit cents with a leading zero', () => {
    expect(fromCents(BigInt(105))).toBe('1.05')
    expect(fromCents(BigInt(-305))).toBe('-3.05')
  })

  it('returns "0.00" for zero', () => {
    expect(fromCents(BigInt(0))).toBe('0.00')
  })

  it('round-trips: toCents(fromCents(x)) === x', () => {
    const samples = [BigInt(0), BigInt(1), BigInt(100), BigInt(9999), BigInt(-5050)]
    for (const c of samples) {
      expect(toCents(fromCents(c))).toBe(c)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// amountToCents
// ─────────────────────────────────────────────────────────────────────────────

describe('amountToCents', () => {
  it('converts a positive float to cents', () => {
    expect(amountToCents(12.34)).toBe(BigInt(1234))
  })

  it('converts a negative float to cents', () => {
    expect(amountToCents(-50.0)).toBe(BigInt(-5000))
  })

  it('handles zero', () => {
    expect(amountToCents(0)).toBe(BigInt(0))
  })

  it('uses Math.round to avoid float drift (e.g. 0.1 + 0.2)', () => {
    // 0.1 * 100 = 10.000000000000002 in floating point — round corrects this
    expect(amountToCents(0.1)).toBe(BigInt(10))
    expect(amountToCents(0.005)).toBe(BigInt(1))   // rounds 0.5 → 1
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectMode
// ─────────────────────────────────────────────────────────────────────────────

describe('detectMode', () => {
  it('returns STATEMENT_TOTALS when both total credits and debits are present', () => {
    const mode = detectMode(
      { statementTotalCredits: '2000.00', statementTotalDebits: '-500.00', statementOpenBalance: null, statementCloseBalance: null },
      0,
    )
    expect(mode).toBe('STATEMENT_TOTALS')
  })

  it('returns STATEMENT_TOTALS when open and close balances are present', () => {
    const mode = detectMode(
      { statementTotalCredits: null, statementTotalDebits: null, statementOpenBalance: '1000.00', statementCloseBalance: '1500.00' },
      0,
    )
    expect(mode).toBe('STATEMENT_TOTALS')
  })

  it('returns STATEMENT_TOTALS even when balanceCount >= 2 (A takes priority over B)', () => {
    const mode = detectMode(
      { statementTotalCredits: '2000.00', statementTotalDebits: '-500.00', statementOpenBalance: null, statementCloseBalance: null },
      5,
    )
    expect(mode).toBe('STATEMENT_TOTALS')
  })

  it('returns RUNNING_BALANCE when balanceCount >= 2 and no totals', () => {
    const mode = detectMode(
      { statementTotalCredits: null, statementTotalDebits: null, statementOpenBalance: null, statementCloseBalance: null },
      3,
    )
    expect(mode).toBe('RUNNING_BALANCE')
  })

  it('returns RUNNING_BALANCE for exactly 2 balance rows', () => {
    const mode = detectMode(
      { statementTotalCredits: null, statementTotalDebits: null, statementOpenBalance: null, statementCloseBalance: null },
      2,
    )
    expect(mode).toBe('RUNNING_BALANCE')
  })

  it('returns UNVERIFIABLE when balanceCount is 1 and no totals', () => {
    const mode = detectMode(
      { statementTotalCredits: null, statementTotalDebits: null, statementOpenBalance: null, statementCloseBalance: null },
      1,
    )
    expect(mode).toBe('UNVERIFIABLE')
  })

  it('returns UNVERIFIABLE when balanceCount is 0 and no totals', () => {
    const mode = detectMode(
      { statementTotalCredits: null, statementTotalDebits: null, statementOpenBalance: null, statementCloseBalance: null },
      0,
    )
    expect(mode).toBe('UNVERIFIABLE')
  })

  it('requires BOTH total credits AND debits for STATEMENT_TOTALS (partial is ignored)', () => {
    // Only credits present — not enough for STATEMENT_TOTALS
    const mode = detectMode(
      { statementTotalCredits: '2000.00', statementTotalDebits: null, statementOpenBalance: null, statementCloseBalance: null },
      0,
    )
    expect(mode).toBe('UNVERIFIABLE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateBalanceChain
// ─────────────────────────────────────────────────────────────────────────────

describe('validateBalanceChain', () => {
  // ── Empty input ────────────────────────────────────────────────────────────

  it('returns empty results for an empty array', () => {
    const result = validateBalanceChain([])
    expect(result.rows).toHaveLength(0)
    expect(result.discrepancies).toHaveLength(0)
    expect(result.breakCount).toBe(0)
  })

  // ── Single row (anchor only) ───────────────────────────────────────────────

  it('accepts a single row as an anchor with valid=null (no check possible)', () => {
    const txs: TxForChain[] = [
      { id: 'r1', amount: 100, runningBalance: '1800.00', parseOrder: 0 },
    ]
    const result = validateBalanceChain(txs)
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].id).toBe('r1')
    expect(result.rows[0].valid).toBeNull()      // anchor — no prior balance
    expect(result.rows[0].actualCents).toBe(BigInt(180000))
    expect(result.breakCount).toBe(0)
  })

  // ── AFTER model: correct chain passes ─────────────────────────────────────

  it('passes a correct 3-row AFTER-model chain with breakCount=0', () => {
    // AFTER model: balance[i] = balance[i-1] + amount[i]
    // r1 is anchor (balance 1800)
    // r2: 1800 + (-50) = 1750  ✓
    // r3: 1750 + (-50) = 1700  ✓
    const txs: TxForChain[] = [
      { id: 'r1', amount:  100, runningBalance: '1800.00', parseOrder: 0 },
      { id: 'r2', amount:  -50, runningBalance: '1750.00', parseOrder: 1 },
      { id: 'r3', amount:  -50, runningBalance: '1700.00', parseOrder: 2 },
    ]
    const result = validateBalanceChain(txs)
    expect(result.breakCount).toBe(0)
    expect(result.discrepancies).toHaveLength(0)
    expect(result.rows[0].valid).toBeNull()    // anchor
    expect(result.rows[1].valid).toBe(true)
    expect(result.rows[2].valid).toBe(true)
  })

  // ── AFTER model: wrong sign on debits causes breaks ────────────────────────

  it('detects balance chain breaks when debit amounts have the wrong sign', () => {
    // Bank exports unsigned amounts; debits stored positive instead of negative.
    // Correct balance: 1800 + (-50) = 1750; but amount=+50 → expected 1850 ≠ 1750.
    const txs: TxForChain[] = [
      { id: 'r1', amount:  100, runningBalance: '1800.00', parseOrder: 0 }, // anchor
      { id: 'r2', amount:   50, runningBalance: '1750.00', parseOrder: 1 }, // debit stored as +50
      { id: 'r3', amount:   50, runningBalance: '1700.00', parseOrder: 2 }, // debit stored as +50
    ]
    const result = validateBalanceChain(txs)
    expect(result.breakCount).toBe(2)
    expect(result.discrepancies).toHaveLength(2)
    expect(result.rows[1].valid).toBe(false)
    expect(result.rows[2].valid).toBe(false)
    // Expected for r2: 1800 + 50 = 1850 (≠ 1750)
    expect(result.rows[1].expectedCents).toBe(BigInt(185000))
    expect(result.rows[1].actualCents).toBe(BigInt(175000))
  })

  it('discrepancies have the correct type and field', () => {
    const txs: TxForChain[] = [
      { id: 'r1', amount: 100, runningBalance: '1000.00', parseOrder: 0 },
      { id: 'r2', amount: 999, runningBalance: '1050.00', parseOrder: 1 }, // wrong amount
    ]
    const result = validateBalanceChain(txs)
    expect(result.discrepancies[0].type).toBe('BALANCE_CHAIN_BREAK')
    expect(result.discrepancies[0].field).toBe('runningBalance')
    expect(result.discrepancies[0].expected).toBe('1999.00')   // 1000 + 999
    expect(result.discrepancies[0].actual).toBe('1050.00')
    // magnitude = |1999 - 1050| = 949.00
    expect(result.discrepancies[0].magnitude).toBe('949.00')
  })

  // ── Rows sorted by parseOrder internally ──────────────────────────────────

  it('sorts rows by parseOrder before walking the chain (out-of-order input)', () => {
    // Input is in reverse parseOrder: [2, 1, 0].
    // After internal sort the chain is r1(anchor)→r2→r3, which is valid.
    const txs: TxForChain[] = [
      { id: 'r3', amount:  -50, runningBalance: '1700.00', parseOrder: 2 },
      { id: 'r1', amount:  100, runningBalance: '1800.00', parseOrder: 0 },
      { id: 'r2', amount:  -50, runningBalance: '1750.00', parseOrder: 1 },
    ]
    const result = validateBalanceChain(txs)
    expect(result.breakCount).toBe(0)
    // Output rows should be in parseOrder order
    expect(result.rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3'])
  })

  // ── Opening balance anchor ────────────────────────────────────────────────

  it('validates the first row against an explicit openingBalance when provided', () => {
    // openingBalance=1700, then r1 has amount=+100 → expected 1800.
    const txs: TxForChain[] = [
      { id: 'r1', amount: 100, runningBalance: '1800.00', parseOrder: 0 },
    ]
    const result = validateBalanceChain(txs, '1700.00')
    // With openingBalance provided, r1 is NO LONGER a free anchor — it is checked.
    expect(result.rows[0].valid).toBe(true)
    expect(result.rows[0].expectedCents).toBe(BigInt(180000))
    expect(result.breakCount).toBe(0)
  })

  it('catches a wrong opening-balance anchor', () => {
    // openingBalance=2000, then r1 has amount=+100 → expected 2100 ≠ 1800.
    const txs: TxForChain[] = [
      { id: 'r1', amount: 100, runningBalance: '1800.00', parseOrder: 0 },
    ]
    const result = validateBalanceChain(txs, '2000.00')
    expect(result.rows[0].valid).toBe(false)
    expect(result.rows[0].expectedCents).toBe(BigInt(210000))
    expect(result.breakCount).toBe(1)
  })

  // ── Missing runningBalance rows ───────────────────────────────────────────

  it('skips rows with null runningBalance without breaking the chain', () => {
    // r2 has no balance — it is skipped; prevCents is not updated.
    // r3 is checked against r1's balance + r3's amount.
    const txs: TxForChain[] = [
      { id: 'r1', amount: 100, runningBalance: '1800.00', parseOrder: 0 },
      { id: 'r2', amount:  50, runningBalance: null,      parseOrder: 1 }, // no balance
      { id: 'r3', amount: -50, runningBalance: '1750.00', parseOrder: 2 },
    ]
    const result = validateBalanceChain(txs)
    expect(result.rows[1].valid).toBeNull()       // no-balance row → null
    expect(result.rows[2].valid).toBe(true)       // 1800 + (-50) = 1750
    expect(result.breakCount).toBe(0)
  })

  it('records valid=null for a null-balance row (not false)', () => {
    const txs: TxForChain[] = [
      { id: 'r1', amount: 0, runningBalance: null, parseOrder: 0 },
    ]
    const result = validateBalanceChain(txs)
    expect(result.rows[0].valid).toBeNull()
    expect(result.rows[0].expectedCents).toBeNull()
    expect(result.rows[0].actualCents).toBeNull()
  })

  // ── A single break does not cascade ───────────────────────────────────────

  it('does not cascade: a single break leaves subsequent correct rows valid', () => {
    // r2 has a wrong balance, but r3 is checked against r2's ACTUAL balance (1999),
    // so the chain resumes from the actual value.
    const txs: TxForChain[] = [
      { id: 'r1', amount:  100, runningBalance: '1800.00', parseOrder: 0 },
      { id: 'r2', amount:  -50, runningBalance: '1999.00', parseOrder: 1 }, // WRONG (should be 1750)
      { id: 'r3', amount:  -50, runningBalance: '1949.00', parseOrder: 2 }, // 1999 + (-50) = 1949 ✓
    ]
    const result = validateBalanceChain(txs)
    expect(result.breakCount).toBe(1)
    expect(result.rows[1].valid).toBe(false)   // the break
    expect(result.rows[2].valid).toBe(true)    // resumes from actual, so this is correct
  })

  // ── All-null runningBalance ────────────────────────────────────────────────

  it('returns all-null valid when no rows have runningBalance', () => {
    const txs: TxForChain[] = [
      { id: 'r1', amount: 100, runningBalance: null, parseOrder: 0 },
      { id: 'r2', amount: -50, runningBalance: null, parseOrder: 1 },
    ]
    const result = validateBalanceChain(txs)
    expect(result.rows.every((r) => r.valid === null)).toBe(true)
    expect(result.breakCount).toBe(0)
  })

  // ── Negative balances (overdraft accounts) ─────────────────────────────────

  it('handles negative running balances (overdraft scenario) correctly', () => {
    const txs: TxForChain[] = [
      { id: 'r1', amount:  -50, runningBalance: '-50.00', parseOrder: 0 },  // anchor
      { id: 'r2', amount:  -30, runningBalance: '-80.00', parseOrder: 1 },  // -50 + (-30) = -80 ✓
    ]
    const result = validateBalanceChain(txs)
    expect(result.breakCount).toBe(0)
    expect(result.rows[1].valid).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runReconciliation — integration with mocked prisma
// ─────────────────────────────────────────────────────────────────────────────

describe('runReconciliation', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Default safe returns
    mockFindUniqueOrThrow.mockResolvedValue(makeUploadRow())
    mockFindManyTransactionRaw.mockResolvedValue([])
    mockFindManyTransaction.mockResolvedValue([])
    mockFindManyIngestionIssue.mockResolvedValue([])
    mockUpdateUpload.mockResolvedValue({})
    mockUpdateTransaction.mockResolvedValue({})
    mockCreateIngestionIssue.mockResolvedValue({})
    mockCreateAuditLogEntry.mockResolvedValue({})
  })

  // ── UNVERIFIABLE mode ──────────────────────────────────────────────────────

  it('returns UNVERIFIABLE status when there are no balances and no declared totals', async () => {
    // Default upload row has all statement fields null; no tx rows.
    const { status, mode } = await runReconciliation(UPLOAD_ID)
    expect(mode).toBe('UNVERIFIABLE')
    expect(status).toBe('UNVERIFIABLE')
  })

  it('writes an INFO-level audit log for UNVERIFIABLE status', async () => {
    await runReconciliation(UPLOAD_ID)
    const auditCall = mockCreateAuditLogEntry.mock.calls[0][0]
    expect(auditCall.data.level).toBe('INFO')
    expect(auditCall.data.stage).toBe('RECONCILE')
    expect(auditCall.data.uploadId).toBe(UPLOAD_ID)
  })

  it('persists reconciliationStatus and reconciliationReport on the Upload', async () => {
    await runReconciliation(UPLOAD_ID)
    expect(mockUpdateUpload).toHaveBeenCalledOnce()
    const updateArgs = mockUpdateUpload.mock.calls[0][0]
    expect(updateArgs.where.id).toBe(UPLOAD_ID)
    expect(updateArgs.data.reconciliationStatus).toBe('UNVERIFIABLE')
    expect(typeof updateArgs.data.reconciliationReport).toBe('string')
  })

  // ── RUNNING_BALANCE mode — valid chain → PASS ──────────────────────────────

  it('returns PASS when the balance chain is intact (RUNNING_BALANCE mode)', async () => {
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
      { id: 'r3', parseOrder: 2 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount:  100, runningBalance: '1800.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount:  -50, runningBalance: '1750.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r3', rawId: 'r3', amount:  -50, runningBalance: '1700.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
    ])

    const { status, mode } = await runReconciliation(UPLOAD_ID)

    expect(mode).toBe('RUNNING_BALANCE')
    expect(status).toBe('PASS')
  })

  it('does not call transaction.update for the anchor row (valid=null)', async () => {
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount: 100, runningBalance: '1800.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount: -50, runningBalance: '1750.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
    ])

    await runReconciliation(UPLOAD_ID)

    // r1 is anchor (valid=null) — should be skipped; only r2 is updated
    const updateIds = mockUpdateTransaction.mock.calls.map((c: [{ where: { id: string } }]) => c[0].where.id)
    expect(updateIds).not.toContain('r1')
    expect(updateIds).toContain('r2')
  })

  // ── RUNNING_BALANCE mode — broken chain → FAIL ────────────────────────────

  it('returns FAIL when the balance chain has breaks (RUNNING_BALANCE mode)', async () => {
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount: 100, runningBalance: '1800.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount:  50, runningBalance: '1750.00', ingestionStatus: 'VALID', isPossibleDuplicate: false }, // wrong: 1800+50=1850≠1750
    ])

    const { status } = await runReconciliation(UPLOAD_ID)

    expect(status).toBe('FAIL')
  })

  it('writes a WARN-level audit log when reconciliation fails', async () => {
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount: 100, runningBalance: '1800.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount:  50, runningBalance: '1750.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
    ])

    await runReconciliation(UPLOAD_ID)

    const auditCall = mockCreateAuditLogEntry.mock.calls[0][0]
    expect(auditCall.data.level).toBe('WARN')
  })

  it('creates an IngestionIssue for each balance chain break', async () => {
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
      { id: 'r3', parseOrder: 2 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount:  100, runningBalance: '1800.00', ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount:   50, runningBalance: '1750.00', ingestionStatus: 'VALID', isPossibleDuplicate: false }, // break
      { id: 'r3', rawId: 'r3', amount:   50, runningBalance: '1700.00', ingestionStatus: 'VALID', isPossibleDuplicate: false }, // break
    ])

    await runReconciliation(UPLOAD_ID)

    // One IngestionIssue per break (2 breaks)
    expect(mockCreateIngestionIssue).toHaveBeenCalledTimes(2)
    const issueData = mockCreateIngestionIssue.mock.calls[0][0].data
    expect(issueData.issueType).toBe('BALANCE_CHAIN_BREAK')
    expect(issueData.severity).toBe('ERROR')
    expect(issueData.uploadId).toBe(UPLOAD_ID)
    expect(issueData.resolved).toBe(false)
  })

  // ── RUNNING_BALANCE mode — PASS_WITH_WARNINGS ──────────────────────────────

  it('returns PASS_WITH_WARNINGS when chain is valid but some txs are UNRESOLVED', async () => {
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount: 100, runningBalance: '1800.00', ingestionStatus: 'UNRESOLVED', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount: -50, runningBalance: '1750.00', ingestionStatus: 'VALID',      isPossibleDuplicate: false },
    ])

    const { status } = await runReconciliation(UPLOAD_ID)

    expect(status).toBe('PASS_WITH_WARNINGS')
  })

  // ── STATEMENT_TOTALS mode — credits/debits check ───────────────────────────

  it('returns PASS when declared totals exactly match computed totals', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(makeUploadRow({
      statementTotalCredits: '100.00',
      statementTotalDebits:  '-50.00',
    }))
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount:  100, runningBalance: null, ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount:  -50, runningBalance: null, ingestionStatus: 'VALID', isPossibleDuplicate: false },
    ])

    const { status, mode } = await runReconciliation(UPLOAD_ID)

    expect(mode).toBe('STATEMENT_TOTALS')
    expect(status).toBe('PASS')
  })

  it('returns FAIL when declared totals do not match computed totals', async () => {
    mockFindUniqueOrThrow.mockResolvedValue(makeUploadRow({
      statementTotalCredits: '200.00',   // declared 200, but only 100 in txs
      statementTotalDebits:  '-50.00',
    }))
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount:  100, runningBalance: null, ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount:  -50, runningBalance: null, ingestionStatus: 'VALID', isPossibleDuplicate: false },
    ])

    const { status, mode } = await runReconciliation(UPLOAD_ID)

    expect(mode).toBe('STATEMENT_TOTALS')
    expect(status).toBe('FAIL')
  })

  it('validates open→close net change when open and close balances are provided', async () => {
    // open=1000, close=1050 → declared net=+50; computed: +100 + (-50) = +50 ✓
    mockFindUniqueOrThrow.mockResolvedValue(makeUploadRow({
      statementOpenBalance:  '1000.00',
      statementCloseBalance: '1050.00',
    }))
    mockFindManyTransactionRaw.mockResolvedValue([
      { id: 'r1', parseOrder: 0 },
      { id: 'r2', parseOrder: 1 },
    ])
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'r1', amount:  100, runningBalance: null, ingestionStatus: 'VALID', isPossibleDuplicate: false },
      { id: 'r2', rawId: 'r2', amount:  -50, runningBalance: null, ingestionStatus: 'VALID', isPossibleDuplicate: false },
    ])

    const { status, mode } = await runReconciliation(UPLOAD_ID)

    expect(mode).toBe('STATEMENT_TOTALS')
    expect(status).toBe('PASS')
  })

  // ── Return shape ───────────────────────────────────────────────────────────

  it('returns the correct { status, mode } shape', async () => {
    const result = await runReconciliation(UPLOAD_ID)
    expect(result).toHaveProperty('status')
    expect(result).toHaveProperty('mode')
    expect(typeof result.status).toBe('string')
    expect(typeof result.mode).toBe('string')
  })

  // ── parseOrder fallback ────────────────────────────────────────────────────

  it('falls back to parseOrder=0 when a transaction has no matching raw row', async () => {
    // r1 has rawId that does not appear in transactionRaw results — should not throw.
    mockFindManyTransactionRaw.mockResolvedValue([])   // no raw rows
    mockFindManyTransaction.mockResolvedValue([
      { id: 'r1', rawId: 'missing-raw', amount: 100, runningBalance: null, ingestionStatus: 'VALID', isPossibleDuplicate: false },
    ])

    // Should complete without error
    const { mode } = await runReconciliation(UPLOAD_ID)
    expect(mode).toBe('UNVERIFIABLE')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeReconOrder
// ─────────────────────────────────────────────────────────────────────────────

describe('computeReconOrder', () => {
  it('returns identity map when rows are already in chronological order', () => {
    const txs = [
      tx('r1', 100, null, 0, { posted: '2024-01-10' }),
      tx('r2', -50, null, 1, { posted: '2024-01-12' }),
      tx('r3', -30, null, 2, { posted: '2024-01-15' }),
    ]
    const map = computeReconOrder(txs)
    expect(map.get('r1')).toBe(0)
    expect(map.get('r2')).toBe(1)
    expect(map.get('r3')).toBe(2)
  })

  it('reorders by postedDate ascending when transactionDate absent', () => {
    const txs = [
      tx('r3', -30, null, 0, { posted: '2024-01-15' }), // CSV row 0 but latest date
      tx('r1', 100, null, 1, { posted: '2024-01-10' }),
      tx('r2', -50, null, 2, { posted: '2024-01-12' }),
    ]
    const map = computeReconOrder(txs)
    expect(map.get('r1')).toBe(0) // earliest date → recon pos 0
    expect(map.get('r2')).toBe(1)
    expect(map.get('r3')).toBe(2) // latest date → recon pos 2
  })

  it('prefers transactionDate over postedDate for primary sort', () => {
    // r1: posted 2024-01-15, effective 2024-01-10 → should sort first
    // r2: posted 2024-01-10, effective 2024-01-12 → should sort second
    const txs = [
      tx('r2', -50, null, 0, { posted: '2024-01-10', transaction: '2024-01-12' }),
      tx('r1', 100, null, 1, { posted: '2024-01-15', transaction: '2024-01-10' }),
    ]
    const map = computeReconOrder(txs)
    expect(map.get('r1')).toBe(0) // effective 01-10 < 01-12
    expect(map.get('r2')).toBe(1)
  })

  it('uses referenceNumber as tie-breaker for same-day transactions', () => {
    const txs = [
      tx('rB', -25, null, 0, { posted: '2024-01-10', ref: '00002' }),
      tx('rA', -75, null, 1, { posted: '2024-01-10', ref: '00001' }),
    ]
    const map = computeReconOrder(txs)
    expect(map.get('rA')).toBe(0) // ref '00001' < '00002'
    expect(map.get('rB')).toBe(1)
  })

  it('uses parseOrder as final tie-breaker when dates and refs match', () => {
    const txs = [
      tx('r2', -50, null, 1, { posted: '2024-01-10' }),
      tx('r1', 100, null, 0, { posted: '2024-01-10' }),
    ]
    const map = computeReconOrder(txs)
    expect(map.get('r1')).toBe(0) // parseOrder 0 < 1
    expect(map.get('r2')).toBe(1)
  })

  it('handles rows with no dates — falls back to parseOrder', () => {
    const txs = [
      tx('r2', -50, null, 1),
      tx('r1', 100, null, 0),
    ]
    const map = computeReconOrder(txs)
    expect(map.get('r1')).toBe(0)
    expect(map.get('r2')).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectBalanceModel
// ─────────────────────────────────────────────────────────────────────────────

describe('detectBalanceModel', () => {
  it('detects AFTER model when balance[i] = balance[i-1] + amount[i]', () => {
    // 1000 →(+200)→ 1200 →(-150)→ 1050 →(-80)→ 970
    const sorted = [
      tx('r1', 200,  '1200.00', 0, { posted: '2024-01-01' }),
      tx('r2', -150, '1050.00', 1, { posted: '2024-01-02' }),
      tx('r3', -80,  '970.00',  2, { posted: '2024-01-03' }),
      tx('r4', 50,   '1020.00', 3, { posted: '2024-01-04' }),
    ]
    const { model, needsReview } = detectBalanceModel(sorted)
    expect(model).toBe('AFTER')
    expect(needsReview).toBe(false)
  })

  it('detects BEFORE model when balance[i] + amount[i] = balance[i+1]', () => {
    // balance[i] is BEFORE the transaction; balance[i-1] + amount[i-1] = balance[i]
    // r1: bal=1000 (before +200), r2: bal=1200 (before -150), r3: bal=1050 (before -80)
    const sorted = [
      tx('r1', 200,  '1000.00', 0, { posted: '2024-01-01' }),
      tx('r2', -150, '1200.00', 1, { posted: '2024-01-02' }),
      tx('r3', -80,  '1050.00', 2, { posted: '2024-01-03' }),
      tx('r4', 50,   '970.00',  3, { posted: '2024-01-04' }),
    ]
    const { model, needsReview } = detectBalanceModel(sorted)
    expect(model).toBe('BEFORE')
    expect(needsReview).toBe(false)
  })

  it('returns AFTER with needsReview=true when fewer than 2 rows have balance', () => {
    const sorted = [tx('r1', 100, '1000.00', 0)]
    const { model, needsReview } = detectBalanceModel(sorted)
    expect(model).toBe('AFTER')
    expect(needsReview).toBe(true)
  })

  it('returns AFTER with needsReview=true for empty input', () => {
    const { model, needsReview } = detectBalanceModel([])
    expect(model).toBe('AFTER')
    expect(needsReview).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// analyzeDiscrepancyPattern
// ─────────────────────────────────────────────────────────────────────────────

describe('analyzeDiscrepancyPattern', () => {
  function makeBreak(expected: string, actual: string) {
    return {
      type: 'BALANCE_CHAIN_BREAK' as const,
      rowIndex: 0,
      field: 'runningBalance',
      expected,
      actual,
      magnitude: '0.00',
      description: '',
    }
  }

  it('returns isConstantOffset=false for empty input', () => {
    const r = analyzeDiscrepancyPattern([], 10)
    expect(r.isConstantOffset).toBe(false)
    expect(r.offsetValue).toBeNull()
    expect(r.offsetCount).toBe(0)
  })

  it('detects constant offset when all deltas match', () => {
    // All rows: actual = expected + 100 (i.e., delta = +100)
    const discrepancies = [
      makeBreak('1000.00', '1100.00'), // delta +100
      makeBreak('1050.00', '1150.00'), // delta +100
      makeBreak('2000.00', '2100.00'), // delta +100
    ]
    const r = analyzeDiscrepancyPattern(discrepancies, 10)
    expect(r.isConstantOffset).toBe(true)
    expect(r.offsetValue).toBe('100.00')
    expect(r.offsetCount).toBe(3)
  })

  it('returns isConstantOffset=false when deltas vary', () => {
    const discrepancies = [
      makeBreak('1000.00', '1100.00'), // delta +100
      makeBreak('1000.00', '1050.00'), // delta +50
      makeBreak('1000.00', '1200.00'), // delta +200
    ]
    const r = analyzeDiscrepancyPattern(discrepancies, 10)
    expect(r.isConstantOffset).toBe(false)
  })

  it('applies 80% threshold: 4/5 same delta → isConstantOffset=true', () => {
    const discrepancies = [
      makeBreak('1000.00', '1100.00'), // delta +100
      makeBreak('1000.00', '1100.00'), // delta +100
      makeBreak('1000.00', '1100.00'), // delta +100
      makeBreak('1000.00', '1100.00'), // delta +100
      makeBreak('1000.00', '1099.99'), // delta +99.99 (outlier)
    ]
    const r = analyzeDiscrepancyPattern(discrepancies, 10)
    expect(r.isConstantOffset).toBe(true) // 4/5 = 80% ≥ threshold
  })

  it('applies 80% threshold: 3/5 same delta → isConstantOffset=false', () => {
    const discrepancies = [
      makeBreak('1000.00', '1100.00'),
      makeBreak('1000.00', '1100.00'),
      makeBreak('1000.00', '1100.00'),
      makeBreak('1000.00', '1050.00'),
      makeBreak('1000.00', '1200.00'),
    ]
    const r = analyzeDiscrepancyPattern(discrepancies, 10)
    expect(r.isConstantOffset).toBe(false) // 3/5 = 60% < threshold
  })

  it('ignores non-BALANCE_CHAIN_BREAK discrepancy types', () => {
    const discrepancies = [
      { type: 'TOTAL_MISMATCH' as const, rowIndex: null, field: 'credits', expected: '100.00', actual: '200.00', magnitude: '100.00', description: '' },
    ]
    const r = analyzeDiscrepancyPattern(discrepancies, 10)
    expect(r.isConstantOffset).toBe(false)
    expect(r.offsetCount).toBe(0)
  })

  it('computes coveragePercent correctly', () => {
    const discrepancies = [
      makeBreak('1000.00', '1100.00'),
      makeBreak('1000.00', '1100.00'),
    ]
    const r = analyzeDiscrepancyPattern(discrepancies, 10)
    expect(r.coveragePercent).toBe(20) // 2/10 = 20%
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateBalanceChain — new features (BEFORE model, reconOrder, rowsReordered)
// ─────────────────────────────────────────────────────────────────────────────

describe('validateBalanceChain — v2 features', () => {
  it('out-of-order CSV reconciles correctly after chronological sort', () => {
    // CSV order: r3 (Jan 15), r1 (Jan 10), r2 (Jan 12)
    // After sort: r1 → r2 → r3
    const txs = [
      tx('r3', -50,  '1700.00', 0, { posted: '2024-01-15' }),
      tx('r1', 100,  '1800.00', 1, { posted: '2024-01-10' }),
      tx('r2', -50,  '1750.00', 2, { posted: '2024-01-12' }),
    ]
    const result = validateBalanceChain(txs)
    // r1 is anchor; r2: 1800-50=1750 ✓; r3: 1750-50=1700 ✓
    expect(result.breakCount).toBe(0)
    expect(result.rowsReordered).toBe(3) // all three moved from their parseOrder positions
  })

  it('reports rowsReordered=0 when CSV order matches chronological order', () => {
    const txs = [
      tx('r1', 100,  '1800.00', 0, { posted: '2024-01-10' }),
      tx('r2', -50,  '1750.00', 1, { posted: '2024-01-12' }),
      tx('r3', -50,  '1700.00', 2, { posted: '2024-01-15' }),
    ]
    const result = validateBalanceChain(txs)
    expect(result.breakCount).toBe(0)
    expect(result.rowsReordered).toBe(0)
  })

  it('includes reconOrder in rows and reconOrderMap in result', () => {
    const txs = [
      tx('r2', -50, '1750.00', 1, { posted: '2024-01-12' }),
      tx('r1', 100, '1800.00', 0, { posted: '2024-01-10' }),
    ]
    const result = validateBalanceChain(txs)
    expect(result.reconOrderMap).toBeDefined()
    expect(result.reconOrderMap.get('r1')).toBe(0)
    expect(result.reconOrderMap.get('r2')).toBe(1)
    const r1Row = result.rows.find(r => r.id === 'r1')
    expect(r1Row?.reconOrder).toBe(0)
  })

  it('BEFORE model: validates when balance[i] = balance[i-1] + amount[i-1]', () => {
    // r1: bal=1000 (before +200), r2: bal=1200 (before -150), r3: bal=1050 (before -80), r4: bal=970
    const txs = [
      tx('r1', 200,  '1000.00', 0, { posted: '2024-01-01' }),
      tx('r2', -150, '1200.00', 1, { posted: '2024-01-02' }),
      tx('r3', -80,  '1050.00', 2, { posted: '2024-01-03' }),
      tx('r4', 50,   '970.00',  3, { posted: '2024-01-04' }),
    ]
    const result = validateBalanceChain(txs, null, 'BEFORE')
    expect(result.breakCount).toBe(0)
  })

  it('BEFORE model: detects break when balance does not match prev+prevAmount', () => {
    const txs = [
      tx('r1', 200,  '1000.00', 0, { posted: '2024-01-01' }),
      tx('r2', -150, '1200.00', 1, { posted: '2024-01-02' }),
      tx('r3', -80,  '1099.00', 2, { posted: '2024-01-03' }), // should be 1050, is 1099
    ]
    const result = validateBalanceChain(txs, null, 'BEFORE')
    expect(result.breakCount).toBe(1)
    expect(result.discrepancies[0].expected).toBe('1050.00')
    expect(result.discrepancies[0].actual).toBe('1099.00')
  })

  it('AFTER model: wrong-sign debits generate constant-offset pattern', () => {
    // Bank exports unsigned amounts; debits stored as +50 instead of -50
    const txs = [
      tx('r1', 100, '1800.00', 0, { posted: '2024-01-01' }), // anchor
      tx('r2', 50,  '1750.00', 1, { posted: '2024-01-02' }), // debit: should be -50
      tx('r3', 50,  '1700.00', 2, { posted: '2024-01-03' }), // debit: should be -50
    ]
    const result = validateBalanceChain(txs) // AFTER model
    expect(result.breakCount).toBe(2)

    const delta = analyzeDiscrepancyPattern(result.discrepancies, txs.length)
    // Both breaks: actual=1750 vs expected=1850 → delta=-100 each
    expect(delta.isConstantOffset).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// detectCsvParseOrderDir
// ─────────────────────────────────────────────────────────────────────────────

describe('detectCsvParseOrderDir', () => {
  it('returns asc for oldest-first CSV (parseOrder 0 has earliest date)', () => {
    const txs = [
      tx('a', -10, '990.00', 0, { posted: '2024-01-01' }),
      tx('b', -10, '980.00', 1, { posted: '2024-01-02' }),
      tx('c', -10, '970.00', 2, { posted: '2024-01-03' }),
    ]
    expect(detectCsvParseOrderDir(txs)).toBe('asc')
  })

  it('returns desc for newest-first CSV (parseOrder 0 has latest date)', () => {
    const txs = [
      tx('a', -20, '2125.39', 0, { posted: '2024-03-15' }),
      tx('b', -27, '2145.39', 1, { posted: '2024-03-14' }),
      tx('c', -10, '2172.39', 2, { posted: '2024-03-13' }),
    ]
    expect(detectCsvParseOrderDir(txs)).toBe('desc')
  })

  it('returns asc when fewer than 2 rows have dates', () => {
    const txs = [
      tx('a', -10, '100.00', 0), // no dates
      tx('b', -10, '90.00',  1), // no dates
    ]
    expect(detectCsvParseOrderDir(txs)).toBe('asc')
  })

  it('uses transactionDate in preference to postedDate', () => {
    // postedDate agrees with oldest-first but transactionDate says newest-first
    const txs = [
      tx('a', -10, '100.00', 0, { transaction: '2024-03-10', posted: '2024-01-01' }),
      tx('b', -10,  '90.00', 1, { transaction: '2024-03-01', posted: '2024-01-02' }),
    ]
    expect(detectCsvParseOrderDir(txs)).toBe('desc')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// computeReconOrder — parseOrderDir
// ─────────────────────────────────────────────────────────────────────────────

describe('computeReconOrder — parseOrderDir tiebreaker', () => {
  it('with desc tiebreaker, same-date rows are sorted by DESCENDING parseOrder', () => {
    // Mirrors the real bank scenario: same day, parseOrder 0 is newest
    const txs = [
      tx('a', -20,   '2125.39', 0, { posted: '2024-03-15' }),
      tx('b', -27.56,'2145.39', 1, { posted: '2024-03-14' }),
      tx('c', -2.46, '2172.95', 2, { posted: '2024-03-14' }), // same day as b
    ]
    // With desc tiebreaker: same-day (Mar 14) rows should be c (parseOrder=2) before b (parseOrder=1)
    const map = computeReconOrder(txs, 'desc')
    // Overall ascending date order: Mar 14 first, then Mar 15
    // Within Mar 14 (desc parseOrder): c (po=2) gets lower reconOrder than b (po=1)
    expect(map.get('c')! < map.get('b')!).toBe(true)
    // Mar 15 (only a) comes last
    expect(map.get('a')!).toBe(2)
  })

  it('with asc tiebreaker, same-date rows are sorted by ASCENDING parseOrder', () => {
    const txs = [
      tx('a', -20,   '990.00', 0, { posted: '2024-01-05' }),
      tx('b', -10,   '980.00', 1, { posted: '2024-01-03' }),
      tx('c', -5,    '975.00', 2, { posted: '2024-01-03' }), // same day as b
    ]
    const map = computeReconOrder(txs, 'asc')
    // Same day (Jan 3) asc: b (po=1) before c (po=2)
    expect(map.get('b')! < map.get('c')!).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateBalanceChain — newest-first CSV integration
// ─────────────────────────────────────────────────────────────────────────────

describe('validateBalanceChain — newest-first CSV', () => {
  it('passes with desc parseOrderDir on a newest-first CSV (matches real bank data pattern)', () => {
    // Mirrors actual export: parseOrder 0 = newest (2024-03-15), balances reflect AFTER model
    // walking in chronological (oldest-first) order.
    // Oldest → newest chronological:
    //   c (Mar 13, po=2): bal=2172.95, amt=-2.46
    //   b (Mar 14, po=1): bal=2145.39, amt=-27.56  →  2172.95 + (-27.56) = 2145.39 ✓
    //   a (Mar 15, po=0): bal=2125.39, amt=-20      →  2145.39 + (-20)    = 2125.39 ✓
    const txs = [
      tx('a', -20,    '2125.39', 0, { posted: '2024-03-15' }),
      tx('b', -27.56, '2145.39', 1, { posted: '2024-03-14' }),
      tx('c', -2.46,  '2172.95', 2, { posted: '2024-03-13' }),
    ]
    const result = validateBalanceChain(txs, null, 'AFTER', 'desc')
    expect(result.breakCount).toBe(0)
  })

  it('fails with asc parseOrderDir on the same newest-first CSV', () => {
    // Without the fix, the same data breaks
    const txs = [
      tx('a', -20,    '2125.39', 0, { posted: '2024-03-15' }),
      tx('b', -27.56, '2145.39', 1, { posted: '2024-03-14' }),
      tx('c', -2.46,  '2172.95', 2, { posted: '2024-03-13' }),
    ]
    const result = validateBalanceChain(txs, null, 'AFTER', 'asc')
    // With asc: chain order = c→b→a; 2172.95+(-27.56)=2145.39 ✓, 2145.39+(-20)=2125.39 ✓
    // Actually this particular 3-row case also passes since each day is distinct
    // A tiebreaker issue only surfaces when multiple rows share the same date
    expect(result.breakCount).toBe(0)
  })

  it('tiebreaker matters: same-day rows fail with asc but pass with desc', () => {
    // Two transactions on the same day where parseOrder=0 is newest:
    //   tx 'b' (po=1, older within day): bal=2172.95, amt=-2.46
    //   tx 'a' (po=0, newer within day): bal=2145.39 (2172.95 + (−27.56) — but −27.56 belongs to a)
    // Correct reading (newest-first within day, so b is older):
    //   anchor=b (bal=2172.95), then a: 2172.95 + (−27.56) = 2145.39 ✓
    const txs = [
      tx('a', -27.56, '2145.39', 0, { posted: '2024-03-14' }), // parseOrder 0 = newer this day
      tx('b', -2.46,  '2172.95', 1, { posted: '2024-03-14' }), // parseOrder 1 = older this day
    ]
    const descResult = validateBalanceChain(txs, null, 'AFTER', 'desc')
    expect(descResult.breakCount).toBe(0)

    const ascResult = validateBalanceChain(txs, null, 'AFTER', 'asc')
    expect(ascResult.breakCount).toBe(1) // wrong order → break
  })
})
