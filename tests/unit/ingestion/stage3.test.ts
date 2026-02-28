/**
 * Stage 3 — Dedup unit tests
 *
 * Pure helper functions (groupByKey, findWithinUploadDupes, escalateStatus)
 * are tested without any mocks.
 *
 * runDedup is tested with a full prisma mock — no real DB is touched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Prisma mock — vi.hoisted() ensures these refs are initialised before the
// vi.mock() factory runs (which is hoisted to the top of the file by Vitest).
// ─────────────────────────────────────────────────────────────────────────────

const {
  mockFindManyTransaction,
  mockFindUniqueTransaction,
  mockUpdateTransaction,
  mockFindFirstTransactionLink,
  mockCreateTransactionLink,
  mockCreateIngestionIssue,
  mockCreateAuditLogEntry,
} = vi.hoisted(() => ({
  mockFindManyTransaction:    vi.fn(),
  mockFindUniqueTransaction:  vi.fn(),
  mockUpdateTransaction:      vi.fn(),
  mockFindFirstTransactionLink: vi.fn(),
  mockCreateTransactionLink:  vi.fn(),
  mockCreateIngestionIssue:   vi.fn(),
  mockCreateAuditLogEntry:    vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: {
    transaction: {
      findMany:   mockFindManyTransaction,
      findUnique: mockFindUniqueTransaction,
      update:     mockUpdateTransaction,
    },
    transactionLink: {
      findFirst: mockFindFirstTransactionLink,
      create:    mockCreateTransactionLink,
    },
    ingestionIssue: {
      create: mockCreateIngestionIssue,
    },
    auditLogEntry: {
      create: mockCreateAuditLogEntry,
    },
  },
}))

import {
  groupByKey,
  findWithinUploadDupes,
  escalateStatus,
  runDedup,
} from '@/lib/ingestion/stage3-dedup'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

interface TxMinimalFixture {
  id: string
  bankFingerprint: string
  bankTransactionId: string | null
  ingestionStatus: string
  isPossibleDuplicate: boolean
}

function makeTx(overrides: Partial<TxMinimalFixture> & { id: string }): TxMinimalFixture {
  return {
    bankFingerprint:   'fp_' + overrides.id,
    bankTransactionId: null,
    ingestionStatus:   'VALID',
    isPossibleDuplicate: false,
    ...overrides,
  }
}

const UPLOAD_ID  = 'upload-001'
const ACCOUNT_ID = 'account-001'

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('groupByKey', () => {
  it('groups items by key correctly', () => {
    const items = [
      { id: 'tx1', key: 'fp_abc' },
      { id: 'tx2', key: 'fp_abc' },
      { id: 'tx3', key: 'fp_xyz' },
    ]
    const groups = groupByKey(items)
    expect(groups.get('fp_abc')).toEqual(['tx1', 'tx2'])
    expect(groups.get('fp_xyz')).toEqual(['tx3'])
  })

  it('skips items with empty key', () => {
    const items = [
      { id: 'tx1', key: '' },
      { id: 'tx2', key: 'fp_real' },
    ]
    const groups = groupByKey(items)
    expect(groups.size).toBe(1)
    expect(groups.has('')).toBe(false)
  })

  it('returns an empty map for empty input', () => {
    const groups = groupByKey([])
    expect(groups.size).toBe(0)
  })
})

describe('findWithinUploadDupes', () => {
  it('returns only groups with more than one member', () => {
    const groups = new Map<string, string[]>([
      ['fp_abc', ['tx1', 'tx2']],  // duplicate group
      ['fp_xyz', ['tx3']],          // singleton — not a duplicate
    ])
    const dupes = findWithinUploadDupes(groups)
    expect(dupes.has('fp_abc')).toBe(true)
    expect(dupes.has('fp_xyz')).toBe(false)
  })

  it('returns empty map when no group has more than one member', () => {
    const groups = new Map<string, string[]>([
      ['fp_a', ['tx1']],
      ['fp_b', ['tx2']],
    ])
    const dupes = findWithinUploadDupes(groups)
    expect(dupes.size).toBe(0)
  })
})

describe('escalateStatus', () => {
  it('escalates VALID → WARNING', () => {
    expect(escalateStatus('VALID')).toBe('WARNING')
  })

  it('leaves UNRESOLVED unchanged', () => {
    expect(escalateStatus('UNRESOLVED')).toBe('UNRESOLVED')
  })

  it('leaves REJECTED unchanged', () => {
    expect(escalateStatus('REJECTED')).toBe('REJECTED')
  })

  it('leaves WARNING unchanged', () => {
    expect(escalateStatus('WARNING')).toBe('WARNING')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// runDedup — integration of all DB interactions
// ─────────────────────────────────────────────────────────────────────────────

describe('runDedup', () => {
  beforeEach(() => {
    // resetAllMocks clears call history AND drains any queued mockResolvedValueOnce
    // values left over from a previous test.  clearAllMocks would leave the queue.
    vi.resetAllMocks()
    // Re-apply safe defaults after the reset
    mockFindManyTransaction.mockResolvedValue([])
    mockFindUniqueTransaction.mockResolvedValue(null)
    mockUpdateTransaction.mockResolvedValue({})
    mockFindFirstTransactionLink.mockResolvedValue(null)   // no existing link → create it
    mockCreateTransactionLink.mockResolvedValue({})
    mockCreateIngestionIssue.mockResolvedValue({})
    mockCreateAuditLogEntry.mockResolvedValue({})
  })

  // ── No-op when batch is empty ───────────────────────────────────────────────

  it('is a no-op and returns all-zero counts when the upload has no transactions', async () => {
    // First findMany (this upload's batch) returns empty
    mockFindManyTransaction.mockResolvedValueOnce([])

    const result = await runDedup(UPLOAD_ID, ACCOUNT_ID)

    expect(result).toEqual({
      possibleDuplicatesFound: 0,
      crossUploadMatches: 0,
      withinUploadMatches: 0,
      bankTxIdMatches: 0,
    })
    // Audit log should still be written
    expect(mockCreateAuditLogEntry).toHaveBeenCalledOnce()
    // No transaction update should happen
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
  })

  // ── No duplicates ───────────────────────────────────────────────────────────

  it('returns zero counts and writes INFO audit log when no duplicates exist', async () => {
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: 'fp_aaa' }),
      makeTx({ id: 'tx2', bankFingerprint: 'fp_bbb' }),
    ]

    // Call sequence: (1) this upload's batch, (2) cross-upload by fingerprint, (3) cross-upload by bankTxId
    mockFindManyTransaction
      .mockResolvedValueOnce(batch)   // this batch
      .mockResolvedValueOnce([])      // existing by fingerprint — none
      .mockResolvedValueOnce([])      // existing by bankTxId — none

    const result = await runDedup(UPLOAD_ID, ACCOUNT_ID)

    expect(result.possibleDuplicatesFound).toBe(0)
    expect(result.crossUploadMatches).toBe(0)
    expect(result.withinUploadMatches).toBe(0)
    expect(mockUpdateTransaction).not.toHaveBeenCalled()

    const auditCall = mockCreateAuditLogEntry.mock.calls[0][0]
    expect(auditCall.data.level).toBe('INFO')
  })

  // ── Within-upload fingerprint duplicates ────────────────────────────────────

  it('marks transactions with matching bankFingerprint as possible duplicates', async () => {
    const sharedFp = 'fp_shared'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: sharedFp }),
      makeTx({ id: 'tx2', bankFingerprint: sharedFp }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)  // this batch
      .mockResolvedValueOnce([])     // cross-upload by fingerprint — none
      .mockResolvedValueOnce([])     // cross-upload by bankTxId — none

    const result = await runDedup(UPLOAD_ID, ACCOUNT_ID)

    // Both transactions share a fingerprint → both flagged
    expect(result.possibleDuplicatesFound).toBe(2)
    expect(result.withinUploadMatches).toBe(2)
    expect(result.crossUploadMatches).toBe(0)
    expect(mockUpdateTransaction).toHaveBeenCalledTimes(2)
  })

  it('groups duplicates under the same duplicateGroupId (= bankFingerprint)', async () => {
    const sharedFp = 'fp_group42'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: sharedFp }),
      makeTx({ id: 'tx2', bankFingerprint: sharedFp }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runDedup(UPLOAD_ID, ACCOUNT_ID)

    // Every update call should receive duplicateGroupId = sharedFp
    const updateCalls = mockUpdateTransaction.mock.calls
    expect(updateCalls.length).toBe(2)
    for (const call of updateCalls) {
      expect(call[0].data.duplicateGroupId).toBe(sharedFp)
      expect(call[0].data.isPossibleDuplicate).toBe(true)
    }
  })

  it('does not mark the first occurrence as duplicate when all are unique (no-op path)', async () => {
    // Each transaction has its own unique fingerprint — zero duplicates
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: 'fp_unique_1' }),
      makeTx({ id: 'tx2', bankFingerprint: 'fp_unique_2' }),
      makeTx({ id: 'tx3', bankFingerprint: 'fp_unique_3' }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await runDedup(UPLOAD_ID, ACCOUNT_ID)

    expect(result.possibleDuplicatesFound).toBe(0)
    expect(mockUpdateTransaction).not.toHaveBeenCalled()
    expect(mockCreateIngestionIssue).not.toHaveBeenCalled()
  })

  it('skips flagging a transaction that is already marked isPossibleDuplicate', async () => {
    const sharedFp = 'fp_already_flagged'
    const batch: TxMinimalFixture[] = [
      // tx1 already flagged from a previous run
      makeTx({ id: 'tx1', bankFingerprint: sharedFp, isPossibleDuplicate: true }),
      makeTx({ id: 'tx2', bankFingerprint: sharedFp }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runDedup(UPLOAD_ID, ACCOUNT_ID)

    // Only tx2 should be updated (tx1 is already flagged so flagTransaction skips it)
    const updateCalls = mockUpdateTransaction.mock.calls
    expect(updateCalls.every((c: [{ where: { id: string } }]) => c[0].where.id !== 'tx1')).toBe(true)
  })

  // ── Cross-upload fingerprint duplicates ─────────────────────────────────────

  it('increments crossUploadMatches when a fingerprint matches a previous upload', async () => {
    const sharedFp = 'fp_cross'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx_new', bankFingerprint: sharedFp }),
    ]
    // Existing transaction from a different upload with the same fingerprint
    const existingTx = {
      id: 'tx_old',
      bankFingerprint: sharedFp,
      bankTransactionId: null,
      uploadId: 'upload-previous',
    }

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)        // this batch
      .mockResolvedValueOnce([existingTx]) // cross-upload by fingerprint — match!
      .mockResolvedValueOnce([])           // cross-upload by bankTxId — none

    // findUnique for the existing tx (to flag it too)
    mockFindUniqueTransaction.mockResolvedValueOnce({
      id: 'tx_old',
      bankFingerprint: sharedFp,
      bankTransactionId: null,
      ingestionStatus: 'VALID',
      isPossibleDuplicate: false,
    })

    const result = await runDedup(UPLOAD_ID, ACCOUNT_ID)

    expect(result.possibleDuplicatesFound).toBe(1)
    expect(result.crossUploadMatches).toBe(1)
    expect(result.withinUploadMatches).toBe(0)
  })

  // ── Audit log ───────────────────────────────────────────────────────────────

  it('writes a WARN-level audit log when duplicates are found', async () => {
    const sharedFp = 'fp_warn_audit'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: sharedFp }),
      makeTx({ id: 'tx2', bankFingerprint: sharedFp }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runDedup(UPLOAD_ID, ACCOUNT_ID)

    const auditCall = mockCreateAuditLogEntry.mock.calls[0][0]
    expect(auditCall.data.level).toBe('WARN')
    expect(auditCall.data.stage).toBe('DEDUP')
    expect(auditCall.data.uploadId).toBe(UPLOAD_ID)
  })

  it('writes an INFO-level audit log when no duplicates are found', async () => {
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: 'fp_solo' }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runDedup(UPLOAD_ID, ACCOUNT_ID)

    const auditCall = mockCreateAuditLogEntry.mock.calls[0][0]
    expect(auditCall.data.level).toBe('INFO')
  })

  // ── TransactionLink creation ─────────────────────────────────────────────────

  it('creates a TransactionLink between within-upload duplicate pair', async () => {
    const sharedFp = 'fp_link_test'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: sharedFp }),
      makeTx({ id: 'tx2', bankFingerprint: sharedFp }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runDedup(UPLOAD_ID, ACCOUNT_ID)

    // linkTransactions is called for each tx that needs a link to its peer
    expect(mockCreateTransactionLink).toHaveBeenCalled()
    const linkCall = mockCreateTransactionLink.mock.calls[0][0]
    expect(linkCall.data.linkType).toBe('POSSIBLE_DUPLICATE')
    expect(linkCall.data.confidence).toBe(0.9) // fingerprint-based confidence
  })

  it('does not create a duplicate TransactionLink when one already exists', async () => {
    const sharedFp = 'fp_idempotent'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: sharedFp }),
      makeTx({ id: 'tx2', bankFingerprint: sharedFp }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    // Simulate an existing link already present
    mockFindFirstTransactionLink.mockResolvedValue({ id: 'existing-link' })

    await runDedup(UPLOAD_ID, ACCOUNT_ID)

    // create should NOT be called because findFirst returned an existing link
    expect(mockCreateTransactionLink).not.toHaveBeenCalled()
  })

  // ── IngestionIssue creation ──────────────────────────────────────────────────

  it('creates an IngestionIssue for each flagged duplicate', async () => {
    const sharedFp = 'fp_issue_test'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: sharedFp }),
      makeTx({ id: 'tx2', bankFingerprint: sharedFp }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await runDedup(UPLOAD_ID, ACCOUNT_ID)

    expect(mockCreateIngestionIssue).toHaveBeenCalledTimes(2)
    const issueData = mockCreateIngestionIssue.mock.calls[0][0].data
    expect(issueData.issueType).toBe('POSSIBLE_DUPLICATE')
    expect(issueData.severity).toBe('WARNING')
    expect(issueData.uploadId).toBe(UPLOAD_ID)
    expect(issueData.resolved).toBe(false)
  })

  // ── bankTransactionId (Pass A) ───────────────────────────────────────────────

  it('flags duplicates matched by bankTransactionId and increments bankTxIdMatches', async () => {
    const bankTxId = 'BANK-TX-9999'
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: 'fp_a', bankTransactionId: bankTxId }),
      makeTx({ id: 'tx2', bankFingerprint: 'fp_b', bankTransactionId: bankTxId }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])   // cross by fingerprint — none
      .mockResolvedValueOnce([])   // cross by bankTxId — none

    const result = await runDedup(UPLOAD_ID, ACCOUNT_ID)

    expect(result.bankTxIdMatches).toBeGreaterThan(0)
    expect(result.possibleDuplicatesFound).toBeGreaterThan(0)
    // TransactionLink for bankTxId dupes uses confidence 1.0
    if (mockCreateTransactionLink.mock.calls.length > 0) {
      const linkData = mockCreateTransactionLink.mock.calls[0][0].data
      expect(linkData.confidence).toBe(1.0)
    }
  })

  // ── Return shape ─────────────────────────────────────────────────────────────

  it('returns the correct DedupResult shape', async () => {
    const batch: TxMinimalFixture[] = [
      makeTx({ id: 'tx1', bankFingerprint: 'fp_shape' }),
    ]

    mockFindManyTransaction
      .mockResolvedValueOnce(batch)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    const result = await runDedup(UPLOAD_ID, ACCOUNT_ID)

    expect(result).toHaveProperty('possibleDuplicatesFound')
    expect(result).toHaveProperty('crossUploadMatches')
    expect(result).toHaveProperty('withinUploadMatches')
    expect(result).toHaveProperty('bankTxIdMatches')
    expect(typeof result.possibleDuplicatesFound).toBe('number')
    expect(typeof result.crossUploadMatches).toBe('number')
    expect(typeof result.withinUploadMatches).toBe('number')
    expect(typeof result.bankTxIdMatches).toBe('number')
  })
})
