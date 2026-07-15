import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  default: {
    account: {
      findFirst: vi.fn(),
      count:     vi.fn(),
    },
    upload: {
      create:     vi.fn(),
      update:     vi.fn(),
      findMany:   vi.fn(),
      findUnique: vi.fn(),
      count:      vi.fn(),
    },
    transactionRaw: {
      create:     vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
    transaction: {
      create:     vi.fn(),
      findMany:   vi.fn(),
      count:      vi.fn(),
      deleteMany: vi.fn(),
    },
    ingestionIssue: {
      create: vi.fn(),
    },
    auditLogEntry: {
      create: vi.fn(),
    },
    stagingUpload: {
      create: vi.fn(),
      update: vi.fn(),
    },
    stagingTransaction: {
      createMany: vi.fn(),
      update:     vi.fn(),
    },
    analysisSession: {
      update:     vi.fn(),
      findUnique: vi.fn(),
    },
    ruleHit: {
      create: vi.fn(),
    },
  },
}))

vi.mock('@/lib/sessions/get-or-create-session', () => ({
  getOrCreateActiveSession: vi.fn(),
  backfillOrphanedUploads:  vi.fn(),
}))

vi.mock('@/lib/ingestion/stage0-acceptance', () => ({
  acceptFile: vi.fn(),
}))

vi.mock('@/lib/ingestion/stage1-parse-csv', () => ({
  parseCsvStage1:  vi.fn(),
  PARSER_VERSION: 'test-1.0',
}))

vi.mock('@/lib/ingestion/stage2-normalize', () => ({
  normalizeRow: vi.fn(),
}))

vi.mock('@/lib/ingestion/stage3-dedup', () => ({
  runDedup: vi.fn(),
}))

vi.mock('@/lib/ingestion/stage4-reconcile', () => ({
  runReconciliation: vi.fn(),
}))

vi.mock('@/lib/ingestion/bank-detector', () => ({
  detectBank: vi.fn(),
}))

vi.mock('@/lib/ingestion/date-order-scoring', () => ({
  selectDateOrder: vi.fn(),
}))

vi.mock('@/lib/ingestion/parse-ofx', () => ({
  parseOfx:             vi.fn(),
  parseOfxDate:         vi.fn(),
  chooseOfxDescription: vi.fn(),
}))

vi.mock('@/lib/ingestion/parse-qif', () => ({
  parseQif:     vi.fn(),
  parseQifDate: vi.fn(),
}))

vi.mock('@/lib/ingestion/pdf', () => ({
  ingestPdf: vi.fn(),
}))

vi.mock('@/lib/ingestion/pdf/types', () => ({
  PDF_LIMITS: { MIN_CONFIDENCE: 0.7 },
}))

vi.mock('@/lib/ingestion/import-report', () => ({
  computeCanonicalRowHash: vi.fn().mockReturnValue('canon_hash'),
}))

vi.mock('@/lib/rules/dry-run', () => ({
  dryRunRules: vi.fn().mockResolvedValue({ matches: [] }),
}))

vi.mock('@/lib/sessions/compute-session-summary', () => ({
  computeSessionSummary: vi.fn(),
}))

vi.mock('@/lib/intelligence/transfers', () => ({
  detectTransfers:       vi.fn().mockResolvedValue(0),
  isTransferDescription: vi.fn().mockReturnValue(false),
}))

vi.mock('@/lib/intelligence/summaries', () => ({
  getAvailableMonths:  vi.fn().mockResolvedValue([]),
  computeMonthSummary: vi.fn().mockResolvedValue({}),
}))

vi.mock('@/lib/categorization/engine', () => ({
  normalizeMerchant: vi.fn().mockReturnValue('test-merchant'),
}))

vi.mock('@/lib/categorization/bank-category-map', () => ({
  normalizeBankCategory: vi.fn().mockReturnValue(null),
  mapBankCategoryToName: vi.fn().mockReturnValue(null),
}))

vi.mock('@/lib/scrubbing', () => ({
  suggestCategory: vi.fn().mockReturnValue(null),
}))

// ─── Imports (after vi.mock) ──────────────────────────────────────────────────

import prisma from '@/lib/db'
import { getOrCreateActiveSession, backfillOrphanedUploads } from '@/lib/sessions/get-or-create-session'
import { acceptFile } from '@/lib/ingestion/stage0-acceptance'
import { parseCsvStage1 } from '@/lib/ingestion/stage1-parse-csv'
import { normalizeRow } from '@/lib/ingestion/stage2-normalize'
import { runDedup } from '@/lib/ingestion/stage3-dedup'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'
import { detectBank } from '@/lib/ingestion/bank-detector'
import { selectDateOrder } from '@/lib/ingestion/date-order-scoring'
import { parseOfx, parseOfxDate, chooseOfxDescription } from '@/lib/ingestion/parse-ofx'
import { parseQif, parseQifDate } from '@/lib/ingestion/parse-qif'
import { ingestPdf } from '@/lib/ingestion/pdf'
import { detectTransfers } from '@/lib/intelligence/transfers'
import { getAvailableMonths } from '@/lib/intelligence/summaries'
import { processUpload } from '@/lib/intake/process-upload'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID    = 'user_test'
const SESSION_ID = 'session_test'
const ACCOUNT_ID = 'acct_test'
const UPLOAD_ID  = 'upload_test'

function makeFile(name: string, type: string, content = 'data'): File {
  return new File([content], name, { type })
}

function makeBaseInput(overrides: Record<string, unknown> = {}) {
  return {
    userId:    USER_ID,
    file:      makeFile('test.csv', 'text/csv'),
    filename:  'test.csv',
    mimeType:  'text/csv',
    accountId: ACCOUNT_ID,
    ...overrides,
  }
}

// A valid normalized row returned by normalizeRow
const MOCK_NORMALIZED_ROW = {
  ingestionStatus: 'VALID',
  postedDate: { raw: '2024-01-01', resolved: '2024-01-01T00:00:00Z', ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null },
  transactionDate: null,
  descriptionRaw: 'STORE', descriptionNormalized: 'Store',
  amount: { raw: '-50.00', value: '-50.00', currencyDetected: null },
  runningBalance: null, runningBalanceRaw: null,
  checkNumber: null, bankTransactionId: null, pendingFlag: false,
  bankFingerprint: null, bankCategory: null,
  currencyCode: undefined, allTransformations: [], issues: [],
  rawLine: '2024-01-01,STORE,-50.00',
  sourceLocator: { type: 'CSV', rowIndex: 1, dataRowIndex: 0 },
}

const MOCK_CSV_ROW = {
  fields: { Date: '2024-01-01', Description: 'STORE', Amount: '-50.00' },
  rawLine: '2024-01-01,STORE,-50.00',
  sourceLocator: { type: 'CSV', rowIndex: 1, dataRowIndex: 0 },
}

// Default CSV parse result — one row so it doesn't hit the "no rows" guard
const MOCK_CSV_PARSE = {
  success: true,
  rows: [MOCK_CSV_ROW],
  warnings: [], errors: [],
  headerDetection: {
    columns: ['Date', 'Description', 'Amount'],
    suggestedMapping: { date: 'Date', description: 'Description', amount: 'Amount' },
  },
  config: {},
}

const MOCK_ACCEPTANCE_CSV = {
  accepted: true, fileHash: 'abc123', encoding: 'utf-8', decodedText: 'header\nrow1',
  sourceType: 'CSV', isDuplicate: false, previousUploadId: null,
  formatMismatch: false, contentSniffedType: null,
}

const MOCK_ACCEPTANCE_OFX = {
  accepted: true, fileHash: 'ofxhash', encoding: 'utf-8', decodedText: '<OFX>...</OFX>',
  sourceType: 'OFX', isDuplicate: false, previousUploadId: null,
  formatMismatch: false, contentSniffedType: null,
}

const MOCK_ACCEPTANCE_QIF = {
  accepted: true, fileHash: 'qifhash', encoding: 'utf-8', decodedText: '!Type:Bank\nD01/01/2024',
  sourceType: 'QIF', isDuplicate: false, previousUploadId: null,
  formatMismatch: false, contentSniffedType: null,
}

const MOCK_ACCEPTANCE_PDF = {
  accepted: true, fileHash: 'pdfhash', encoding: 'utf-8', decodedText: null,
  sourceType: 'PDF', isDuplicate: false, previousUploadId: null,
  formatMismatch: false, contentSniffedType: null,
}

const MOCK_UPLOAD = { id: UPLOAD_ID, sessionId: SESSION_ID }
const MOCK_DEDUP  = { possibleDuplicatesFound: 0, crossUploadMatches: 0, withinUploadMatches: 0 }
const MOCK_RECONCILE = { status: 'PASS', mode: 'UNVERIFIABLE' }
const MOCK_DATE_ORDER = {
  selectedOrder: 'MDY', source: 'auto', confidence: 0.9,
  needsUserConfirmation: false, scoreA: null, scoreB: null, bankResult: null,
}

function setupCommonMocks() {
  // Session
  vi.mocked(getOrCreateActiveSession).mockResolvedValue({ id: SESSION_ID, status: 'ACTIVE' })
  vi.mocked(backfillOrphanedUploads).mockResolvedValue(0)

  // Upload record
  vi.mocked(prisma.upload.create).mockResolvedValue(MOCK_UPLOAD as never)
  vi.mocked(prisma.upload.update).mockResolvedValue(MOCK_UPLOAD as never)
  vi.mocked(prisma.upload.count).mockResolvedValue(1)
  vi.mocked(prisma.upload.findMany).mockResolvedValue([])
  vi.mocked(prisma.upload.findUnique).mockResolvedValue(null)

  // transactionRaw
  vi.mocked(prisma.transactionRaw.findUnique).mockResolvedValue(null)
  vi.mocked(prisma.transactionRaw.create).mockResolvedValue({ id: 'raw1' } as never)
  vi.mocked(prisma.transactionRaw.deleteMany).mockResolvedValue({ count: 0 } as never)

  // transaction
  vi.mocked(prisma.transaction.create).mockResolvedValue({ id: 'tx1' } as never)
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([])
  vi.mocked(prisma.transaction.count).mockResolvedValue(5)
  vi.mocked(prisma.transaction.deleteMany).mockResolvedValue({ count: 0 } as never)

  // Other DB models
  vi.mocked(prisma.ingestionIssue.create).mockResolvedValue({} as never)
  vi.mocked(prisma.auditLogEntry.create).mockResolvedValue({} as never)
  vi.mocked(prisma.account.count).mockResolvedValue(1)
  vi.mocked(prisma.analysisSession.update).mockResolvedValue({} as never)
  vi.mocked(prisma.analysisSession.findUnique).mockResolvedValue({ id: SESSION_ID, status: 'READY' } as never)
  vi.mocked(prisma.stagingUpload.create).mockResolvedValue({ id: 'staging_test' } as never)
  vi.mocked(prisma.stagingUpload.update).mockResolvedValue({} as never)
  vi.mocked(prisma.stagingTransaction.createMany).mockResolvedValue({ count: 0 } as never)
  vi.mocked(prisma.stagingTransaction.update).mockResolvedValue({} as never)
  vi.mocked(prisma.ruleHit.create).mockResolvedValue({} as never)

  // Pipeline stages
  vi.mocked(runDedup).mockResolvedValue(MOCK_DEDUP as never)
  vi.mocked(runReconciliation).mockResolvedValue(MOCK_RECONCILE as never)
  vi.mocked(detectTransfers).mockResolvedValue(0)
  vi.mocked(getAvailableMonths).mockResolvedValue([])

  // CSV helpers
  vi.mocked(detectBank).mockReturnValue({ matched: false, bankProfile: null } as never)
  vi.mocked(selectDateOrder).mockReturnValue(MOCK_DATE_ORDER as never)
  vi.mocked(parseCsvStage1).mockReturnValue(MOCK_CSV_PARSE as never)
  vi.mocked(normalizeRow).mockReturnValue(MOCK_NORMALIZED_ROW as never)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
})

describe('processUpload', () => {

  // ── Scenario 1: Rejected file ─────────────────────────────────────────────
  describe('scenario 1: file rejected by stage0', () => {
    it('throws a 422 error with rejectionReason', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue({ accepted: false, rejectionReason: 'File type not supported', fileHash: '' } as never)

      await expect(processUpload(makeBaseInput())).rejects.toThrow('File type not supported')
    })

    it('sets statusCode 422 on the thrown error', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue({ accepted: false, rejectionReason: 'Too large', fileHash: '' } as never)

      const err = await processUpload(makeBaseInput()).catch(e => e)
      expect(err.statusCode).toBe(422)
    })
  })

  // ── Scenario 2: CSV — no rows ─────────────────────────────────────────────
  describe('scenario 2: CSV with no parseable rows', () => {
    it('marks upload as failed and throws', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_CSV as never)
      // Override: success:false triggers the no-rows guard
      vi.mocked(parseCsvStage1).mockReturnValue({
        success: false, rows: [], warnings: [], errors: [{ severity: 'FATAL', message: 'No columns found' }],
        headerDetection: { columns: [], suggestedMapping: {} }, config: {},
      } as never)

      await expect(processUpload(makeBaseInput())).rejects.toThrow('No columns found')
      expect(prisma.upload.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
      )
    })
  })

  // ── Scenario 3: CSV — happy path ──────────────────────────────────────────
  describe('scenario 3: CSV happy path', () => {
    it('returns expected shape with sessionId, uploadId, and session snapshot', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_CSV as never)

      const result = await processUpload(makeBaseInput())

      expect(result.uploadId).toBe(UPLOAD_ID)
      expect(result.sessionId).toBe(SESSION_ID)
      expect(result.formatDetected).toMatch(/csv/i)
      expect(result).toHaveProperty('session')
      expect(result).toHaveProperty('uploadCount')
    })

    it('calls getOrCreateActiveSession before creating the upload record', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_CSV as never)

      await processUpload(makeBaseInput())

      const getOrCreateOrder  = vi.mocked(getOrCreateActiveSession).mock.invocationCallOrder[0]
      const uploadCreateOrder = vi.mocked(prisma.upload.create).mock.invocationCallOrder[0]
      expect(getOrCreateOrder).toBeLessThan(uploadCreateOrder)
    })

    it('calls detectTransfers after persisting transactions', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_CSV as never)

      await processUpload(makeBaseInput())

      expect(detectTransfers).toHaveBeenCalledWith(USER_ID)
    })

    it('marks session READY after pipeline completes', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_CSV as never)

      await processUpload(makeBaseInput())

      expect(prisma.analysisSession.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: SESSION_ID }, data: { status: 'READY' } })
      )
    })
  })

  // ── Scenario 4: OFX happy path ────────────────────────────────────────────
  describe('scenario 4: OFX happy path', () => {
    it('returns OFX as formatDetected', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_OFX as never)
      vi.mocked(parseOfx).mockReturnValue({ transactions: [{ fitId: 'F1', dtPosted: '20240101', trnAmt: '-50.00', trnType: 'DEBIT', name: 'STORE', memo: '', parseOrder: 0, rawBlock: 'raw', checkNum: '' }], ledgerBalance: null, currency: 'USD' } as never)
      vi.mocked(parseOfxDate).mockReturnValue(new Date('2024-01-01'))
      vi.mocked(chooseOfxDescription).mockReturnValue({ descRaw: 'STORE', descNorm: 'Store' } as never)

      const result = await processUpload({ ...makeBaseInput(), file: makeFile('statement.ofx', 'application/ofx'), filename: 'statement.ofx', mimeType: 'application/ofx' })

      expect(result.formatDetected).toBe('OFX')
      expect(result.dateOrderUsed).toBe('YMD')
      expect(result.dateOrderSource).toBe('OFX_STANDARD')
    })
  })

  // ── Scenario 5: QIF happy path ────────────────────────────────────────────
  describe('scenario 5: QIF happy path', () => {
    it('returns QIF as formatDetected with MDY date order', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_QIF as never)
      vi.mocked(parseQif).mockReturnValue({ transactions: [{ date: '01/01/2024', amount: '-50.00', payee: 'STORE', memo: '', parseOrder: 0, checkNum: '' }], accountType: 'Bank' } as never)
      vi.mocked(parseQifDate).mockReturnValue('2024-01-01')

      const result = await processUpload({ ...makeBaseInput(), file: makeFile('statement.qif', 'application/qif'), filename: 'statement.qif', mimeType: 'application/qif' })

      expect(result.formatDetected).toBe('QIF')
      expect(result.dateOrderSource).toBe('QIF_STANDARD')
    })
  })

  // ── Scenario 6: PDF happy path ────────────────────────────────────────────
  describe('scenario 6: PDF happy path', () => {
    it('returns PDF format with pdfClassification in result', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_PDF as never)
      vi.mocked(ingestPdf).mockResolvedValue({
        candidates: [{
          confidence: 0.95, parsedDate: '2024-01-01', parsedAmount: 50,
          parsedDescription: 'STORE', rawDescription: 'STORE', direction: 'debit',
          rawDate: '01/01/2024', rawAmount: '50.00', rawBalance: '', parsedBalance: null,
          flags: [], extractionMethod: 'text', pageSpan: { start: 1, end: 1 },
          id: 'c1', sourceLines: ['line1'],
        }],
        classification: { pageCount: 2, estimatedAccount: 'Checking', statementStart: '2024-01-01', statementEnd: '2024-01-31' },
        reconciliationIssues: [], reviewRequired: false,
      } as never)

      const result = await processUpload({ ...makeBaseInput(), file: makeFile('statement.pdf', 'application/pdf'), filename: 'statement.pdf', mimeType: 'application/pdf' })

      expect(result.formatDetected).toBe('PDF')
      expect(result.pdfClassification).toBeDefined()
      expect(result.pdfLowConfidenceCount).toBe(0)
    })
  })

  // ── Scenario 7: OFX with empty transactions ───────────────────────────────
  describe('scenario 7: OFX with empty transaction list', () => {
    it('throws 422 when no OFX transactions found', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_OFX as never)
      vi.mocked(parseOfx).mockReturnValue({ transactions: [], ledgerBalance: null, currency: null } as never)

      const err = await processUpload(makeBaseInput()).catch(e => e)
      expect(err.statusCode).toBe(422)
      expect(err.message).toContain('No transactions found in OFX file')
    })
  })

  // ── Scenario 8: QIF with empty transactions ───────────────────────────────
  describe('scenario 8: QIF with empty transaction list', () => {
    it('throws 422 when no QIF transactions found', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_QIF as never)
      vi.mocked(parseQif).mockReturnValue({ transactions: [], accountType: 'Bank' } as never)

      const err = await processUpload(makeBaseInput()).catch(e => e)
      expect(err.statusCode).toBe(422)
      expect(err.message).toContain('No transactions found in QIF file')
    })
  })

  // ── Scenario 9: Duplicate file (version stamping) ─────────────────────────
  describe('scenario 9: duplicate file re-upload', () => {
    it('increments version and marks previous upload as superseded', async () => {
      setupCommonMocks()
      const prevUploadId = 'upload_prev'
      vi.mocked(acceptFile).mockResolvedValue({ ...MOCK_ACCEPTANCE_CSV, isDuplicate: true, previousUploadId: prevUploadId } as never)
      vi.mocked(prisma.upload.findUnique).mockResolvedValue({ id: prevUploadId, version: 1 } as never)

      await processUpload(makeBaseInput())

      expect(prisma.upload.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: prevUploadId }, data: { superseded: true } })
      )
      expect(prisma.upload.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ version: 2, reprocessedFromId: prevUploadId }) })
      )
    })
  })

  // ── Scenario 10: Session always resolved before upload record ─────────────
  describe('scenario 10: session resolution is guaranteed', () => {
    it('always calls getOrCreateActiveSession regardless of format', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_CSV as never)

      await processUpload(makeBaseInput())

      expect(getOrCreateActiveSession).toHaveBeenCalledWith(USER_ID)
      expect(backfillOrphanedUploads).toHaveBeenCalledWith(USER_ID, SESSION_ID)
    })
  })

  // ── Scenario 11: Upload marked failed on persistence error ────────────────
  describe('scenario 11: catastrophic persistence error', () => {
    it('calls markFailed when OFX transaction finalization throws', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_OFX as never)
      vi.mocked(parseOfx).mockReturnValue({ transactions: [{ fitId: 'F1', dtPosted: '20240101', trnAmt: '-50.00', trnType: 'DEBIT', name: 'STORE', memo: '', parseOrder: 0, rawBlock: 'raw', checkNum: '' }], ledgerBalance: null, currency: null } as never)
      vi.mocked(parseOfxDate).mockReturnValue(new Date('2024-01-01'))
      vi.mocked(chooseOfxDescription).mockReturnValue({ descRaw: 'STORE', descNorm: 'Store' } as never)
      vi.mocked(prisma.transactionRaw.create).mockResolvedValue({ id: 'raw1' } as never)
      vi.mocked(prisma.transaction.create).mockResolvedValue({ id: 'tx1' } as never)

      // Make the finalization upload.update (first call in OFX path) fail
      vi.mocked(prisma.upload.update).mockRejectedValueOnce(new Error('DB constraint'))

      await expect(processUpload(makeBaseInput())).rejects.toThrow()
      expect(prisma.upload.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) })
      )
    })
  })

  // ── Scenario 12: CSV date ambiguous — dateOrderNeedsConfirmation ──────────
  describe('scenario 12: CSV with ambiguous date format', () => {
    it('sets dateOrderNeedsConfirmation = true in result', async () => {
      setupCommonMocks()
      vi.mocked(acceptFile).mockResolvedValue(MOCK_ACCEPTANCE_CSV as never)
      vi.mocked(selectDateOrder).mockReturnValue({
        ...MOCK_DATE_ORDER,
        needsUserConfirmation: true,
        selectedOrder: null,
        source: null,
        confidence: 0,
        scoreA: { totalScore: 0.5 },
        scoreB: { totalScore: 0.5 },
      } as never)

      const result = await processUpload(makeBaseInput())

      expect(result.dateOrderNeedsConfirmation).toBe(true)
    })
  })
})
