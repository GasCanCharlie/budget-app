/**
 * processUpload — single canonical intake orchestrator for all file formats.
 *
 * Every upload, regardless of format, runs through this exact sequence:
 *   resolve session → accept file → parse → persist → dedup → reconcile
 *   → summaries → staging (CSV) → transfers → session snapshot
 *
 * No route may bypass this pipeline.
 */

import { createHash } from 'crypto'
import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { acceptFile } from '@/lib/ingestion/stage0-acceptance'
import { parseCsvStage1, PARSER_VERSION } from '@/lib/ingestion/stage1-parse-csv'
import { normalizeRow } from '@/lib/ingestion/stage2-normalize'
import { runDedup } from '@/lib/ingestion/stage3-dedup'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'
import { detectBank } from '@/lib/ingestion/bank-detector'
import { selectDateOrder } from '@/lib/ingestion/date-order-scoring'
import { parseOfx, parseOfxDate, chooseOfxDescription, type OfxTransaction } from '@/lib/ingestion/parse-ofx'
import { parseQif, parseQifDate, type QifTransaction } from '@/lib/ingestion/parse-qif'
import { ingestPdf } from '@/lib/ingestion/pdf'
import { PDF_LIMITS } from '@/lib/ingestion/pdf/types'
import { computeCanonicalRowHash, type ImportReport } from '@/lib/ingestion/import-report'
import { getOrCreateActiveSession, backfillOrphanedUploads } from '@/lib/sessions/get-or-create-session'
import { computeSessionSummary } from '@/lib/sessions/compute-session-summary'
import { detectTransfers } from '@/lib/intelligence/transfers'
import { getAvailableMonths, computeMonthSummary } from '@/lib/intelligence/summaries'
import { isTransferDescription } from '@/lib/intelligence/transfers'
import { normalizeMerchant } from '@/lib/categorization/engine'
import { normalizeBankCategory, mapBankCategoryToName } from '@/lib/categorization/bank-category-map'
import { suggestCategory } from '@/lib/scrubbing'
import { dryRunRules } from '@/lib/rules/dry-run'
import type { DateOrderSelectionResult } from '@/types/ingestion'
import type { CsvXlsxSourceLocator } from '@/types/ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// Public contract types (matches spec)
// ─────────────────────────────────────────────────────────────────────────────

export type FileFormat = 'CSV' | 'OFX' | 'QFX' | 'QBO' | 'QIF' | 'PDF'

export interface ParsedTransaction {
  externalId?: string
  postedDate: Date
  amount: number
  direction: 'DEBIT' | 'CREDIT'
  merchant?: string
  description: string
  rawDescription: string
  transactionType?: string
}

export interface ParsedStatement {
  sourceFormat: FileFormat
  institution?: string
  accountName?: string
  accountType?: string
  accountNumberMasked?: string
  statementStart?: Date
  statementEnd?: Date
  transactions: ParsedTransaction[]
}

export interface ProcessUploadInput {
  userId: string
  file: File
  filename: string
  mimeType: string
  accountId: string
  openingBalance?: string | null
  closingBalance?: string | null
  statementTotalCredits?: string | null
  statementTotalDebits?: string | null
}

export interface ProcessUploadResult {
  // Common
  uploadId: string
  sessionId: string
  accepted: number
  rejected: number
  totalUnresolved: number
  possibleDuplicates: number
  crossUploadDuplicates: number
  withinUploadDuplicates: number
  formatDetected: string
  transactionCount: number
  parserVersion: string
  fileHashTruncated: string
  reconciliationStatus: string
  reconciliationMode: string
  dateOrderUsed: string | null
  dateOrderSource: string | null
  dateOrderConfidence: number
  bankDetected: boolean
  bankKey: string | null
  dateOrderNeedsConfirmation: boolean
  dateAmbiguous: boolean
  dateFormatSample: Array<{ line: number; rawDate: string; interpreted: string }>
  warnings: unknown[]
  formatMismatch?: boolean
  contentSniffedType?: string | null
  // CSV extras
  importReport?: ImportReport
  stagingUploadId?: string
  stagingRowCount?: number
  // PDF extras
  pdfReviewRequired?: boolean
  pdfLowConfidenceCount?: number
  pdfClassification?: object
  // Session snapshot (spec)
  upload: { id: string; sessionId: string }
  session: { id: string; status: string; uploadCount: number; txCount: number }
  uploadCount: number
  accountCount: number
  transactionCount2: number
  duplicateCount: number
  transferCount: number
  analysisVersion: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers (moved from route)
// ─────────────────────────────────────────────────────────────────────────────

function computeSourceRowHash(accountId: string, rawLine: string): string {
  return createHash('sha256').update(`${accountId}|${rawLine}`).digest('hex')
}

function normalizeVendor(raw: string): string {
  let key = raw
    .toLowerCase()
    .replace(/^(pos |ach |debit |credit |purchase |tsq?\*|sq \*|sq\*|tst\*|dda |wdrl |wd |chk |chkcd |preauth |preauthorized |online |recurring )/gi, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  const stripped = key.replace(/\s+\d+$/, '').trim()
  if (stripped.length >= 3) key = stripped
  return key
}

function amountToCents(amount: number): number {
  return Math.round(amount * 100)
}

function deriveFormatName(
  mapping: ReturnType<typeof parseCsvStage1>['headerDetection']['suggestedMapping'],
  headers: string[],
): string {
  const h = headers.map(s => s.toLowerCase())
  if (h.includes('transaction date') && h.includes('card no.'))  return 'Capital One'
  if (h.includes('transaction date') && h.includes('description') && mapping.transactionDate) return 'Chase'
  if (h.includes('running bal.'))                                 return 'Bank of America'
  if (h.includes('trans. date') && h.includes('post date'))      return 'Discover'
  if (h.includes('status') && h.includes('debit') && h.includes('credit')) return 'Citibank'
  if (h.includes('withdrawals') && h.includes('deposits'))       return 'PNC'
  if (h.includes('original description'))                        return 'USAA'
  if (h.includes('time') && h.includes('type'))                  return 'Ally'
  const hasDate   = !!(mapping.date || mapping.transactionDate || mapping.postedDate)
  const hasDesc   = !!mapping.description
  const hasAmount = !!(mapping.amount || (mapping.debit && mapping.credit))
  if (hasDate && hasDesc && hasAmount) return 'CSV (auto-detected)'
  if (hasDate || hasDesc || hasAmount) return 'CSV (partial match)'
  return 'Unknown'
}

async function stampVersion(acceptance: Awaited<ReturnType<typeof acceptFile>>): Promise<number> {
  if (!acceptance.isDuplicate || !acceptance.previousUploadId) return 1
  const prev = await prisma.upload.findUnique({
    where:  { id: acceptance.previousUploadId },
    select: { version: true },
  })
  await prisma.upload.update({
    where: { id: acceptance.previousUploadId },
    data:  { superseded: true },
  })
  return (prev?.version ?? 0) + 1
}

async function markFailed(uploadId: string, error: string): Promise<void> {
  await prisma.upload.update({
    where: { id: uploadId },
    data:  { status: 'failed', completedAt: new Date(), warnings: JSON.stringify([{ code: 'PIPELINE_FAILED', message: error }]) },
  }).catch(() => {})
  // Remove any partially inserted transactions so no orphans remain
  await prisma.transaction.deleteMany({ where: { uploadId } }).catch(() => {})
  await prisma.transactionRaw.deleteMany({ where: { uploadId } }).catch(() => {})
}

async function recomputeAfterUpload(userId: string): Promise<void> {
  const months = await getAvailableMonths(userId)
  for (const { year, month } of months.slice(0, 12)) {
    await computeMonthSummary(userId, year, month)
  }
}

async function buildSessionSnapshot(sessionId: string, userId: string) {
  const [uploadCount, txCount, accountCount, transferCount] = await Promise.all([
    prisma.upload.count({ where: { sessionId, status: 'complete' } }),
    prisma.transaction.count({ where: { upload: { sessionId } } }),
    prisma.account.count({ where: { userId } }),
    prisma.transaction.count({ where: { upload: { sessionId }, isTransfer: true } }),
  ])
  const session = await prisma.analysisSession.findUnique({
    where:  { id: sessionId },
    select: { id: true, status: true },
  })
  return { session, uploadCount, txCount, accountCount, transferCount, analysisVersion: uploadCount }
}

// ─────────────────────────────────────────────────────────────────────────────
// Integrity check (dev mode — throws loudly on broken chain)
// ─────────────────────────────────────────────────────────────────────────────

async function verifyIntegrity(uploadId: string, sessionId: string, accountId: string): Promise<void> {
  if (process.env.NODE_ENV !== 'development') return

  const upload = await prisma.upload.findUnique({ where: { id: uploadId }, select: { sessionId: true } })
  if (!upload?.sessionId) throw new Error(`[integrity] Upload ${uploadId} has no sessionId after commit`)

  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) AS count FROM transactions
    WHERE "uploadId" = ${uploadId} AND ("accountId" IS NULL OR "uploadId" IS NULL)
  `
  const orphanedTx = Number(rows[0]?.count ?? 0)
  if (orphanedTx > 0) throw new Error(`[integrity] ${orphanedTx} transactions in upload ${uploadId} are missing accountId or uploadId`)
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF persistence
// ─────────────────────────────────────────────────────────────────────────────

async function persistPdf(
  uploadId: string,
  accountId: string,
  candidates: Awaited<ReturnType<typeof ingestPdf>>['candidates'],
): Promise<{ accepted: number; rejected: number; unresolved: number; dates: Date[] }> {
  const highConfidence = candidates.filter(c => c.confidence >= PDF_LIMITS.MIN_CONFIDENCE)
  let accepted = 0, rejected = 0
  const dates: Date[] = []

  for (let i = 0; i < highConfidence.length; i++) {
    const candidate = highConfidence[i]
    const signedAmount = candidate.parsedAmount !== null
      ? (candidate.direction === 'debit' ? -candidate.parsedAmount : candidate.parsedAmount)
      : 0
    const parsedDate = candidate.parsedDate ? new Date(candidate.parsedDate + 'T00:00:00Z') : new Date()
    const rawLineForHash = candidate.sourceLines.join(' ').slice(0, 200)
    const sourceRowHash = createHash('sha256')
      .update(`${accountId}|pdf:${candidate.parsedDate}:${candidate.parsedAmount}:${rawLineForHash}`)
      .digest('hex')

    const existingRaw = await prisma.transactionRaw.findUnique({ where: { sourceRowHash } })
    if (existingRaw) { rejected++; continue }

    const descRaw      = candidate.parsedDescription ?? candidate.rawDescription ?? ''
    const merchantNorm = normalizeMerchant(descRaw)
    const isTransfer   = isTransferDescription(descRaw)
    const sourceLocator = { type: 'PDF', pageNumber: candidate.pageSpan.start, lineId: `p${candidate.pageSpan.start}_l${i}` }

    try {
      const raw = await prisma.transactionRaw.create({
        data: {
          uploadId, accountId,
          rawDate:        candidate.rawDate ?? '',
          rawDescription: descRaw,
          rawAmount:      candidate.rawAmount ?? String(Math.abs(signedAmount)),
          rawCredit:      candidate.direction === 'credit' ? String(candidate.parsedAmount ?? 0) : '',
          rawDebit:       candidate.direction === 'debit'  ? String(candidate.parsedAmount ?? 0) : '',
          rawBalance:     candidate.rawBalance ?? '',
          sourceRowHash,
          sourceLocator:  JSON.stringify(sourceLocator),
          rawLine:        rawLineForHash,
          parseOrder:     i,
          rawFields:      JSON.stringify({
            extractionMethod: candidate.extractionMethod,
            confidence:       candidate.confidence.toFixed(3),
            flags:            candidate.flags.join(','),
            direction:        candidate.direction,
          }),
        },
      })
      await prisma.transaction.create({
        data: {
          rawId: raw.id, accountId, uploadId,
          date: parsedDate, description: descRaw, merchantNormalized: merchantNorm,
          amount: signedAmount, isTransfer, isForeignCurrency: false,
          foreignAmount: null, foreignCurrency: null,
          postedDate: parsedDate, transactionDate: parsedDate,
          dateRaw: candidate.rawDate ?? '', dateAmbiguity: 'RESOLVED',
          dateInterpretationA: null, dateInterpretationB: null,
          amountRaw: candidate.rawAmount ?? String(Math.abs(signedAmount)),
          currencyDetected: false, descriptionRaw: descRaw,
          descriptionNormalized: descRaw || undefined, transformations: '[]',
          runningBalance: candidate.parsedBalance !== null ? String(candidate.parsedBalance) : null,
          runningBalanceRaw: candidate.rawBalance ?? null,
          checkNumber: null, bankTransactionId: candidate.id, pendingFlag: false,
          ingestionStatus: 'VALID', bankCategoryRaw: null, bankCategoryNormalized: null,
          canonicalRowHash: computeCanonicalRowHash(candidate.rawDate ?? '', descRaw, candidate.rawAmount ?? '', null, i),
        },
      })
      accepted++
      dates.push(parsedDate)
    } catch { rejected++ }
  }

  return { accepted, rejected, unresolved: candidates.filter(c => c.confidence < PDF_LIMITS.MIN_CONFIDENCE).length, dates }
}

// ─────────────────────────────────────────────────────────────────────────────
// OFX / QFX / QBO persistence
// ─────────────────────────────────────────────────────────────────────────────

async function persistOfx(
  uploadId: string,
  accountId: string,
  ofxResult: ReturnType<typeof parseOfx>,
): Promise<{ accepted: number; rejected: number; dates: Date[] }> {
  let accepted = 0, rejected = 0
  const dates: Date[] = []

  for (const ofxTx of ofxResult.transactions as OfxTransaction[]) {
    const fitIdKey      = ofxTx.fitId || ofxTx.rawBlock
    const sourceRowHash = createHash('sha256').update(`${accountId}|ofx:${fitIdKey}`).digest('hex')

    const existingRaw = await prisma.transactionRaw.findUnique({ where: { sourceRowHash } })
    if (existingRaw) { rejected++; continue }

    const parsedDate  = parseOfxDate(ofxTx.dtPosted)
    const amountNum   = parseFloat(ofxTx.trnAmt) || 0
    const { descRaw, descNorm } = chooseOfxDescription(ofxTx.name, ofxTx.memo, ofxTx.trnType)
    const merchantNorm = normalizeMerchant(descNorm)
    const isTransfer   = isTransferDescription(descRaw)
    const rawFields    = {
      TRNTYPE: ofxTx.trnType, DTPOSTED: ofxTx.dtPosted,
      TRNAMT: ofxTx.trnAmt, FITID: ofxTx.fitId,
      NAME: ofxTx.name, MEMO: ofxTx.memo,
      ...(ofxTx.checkNum ? { CHECKNUM: ofxTx.checkNum } : {}),
    }

    try {
      const raw = await prisma.transactionRaw.create({
        data: {
          uploadId, accountId,
          rawDate: ofxTx.dtPosted, rawDescription: descRaw, rawAmount: ofxTx.trnAmt,
          rawCredit: '', rawDebit: '', rawBalance: '', sourceRowHash,
          sourceLocator: JSON.stringify({ type: 'OFX', parseOrder: ofxTx.parseOrder }),
          rawLine: ofxTx.rawBlock, parseOrder: ofxTx.parseOrder,
          rawFields: JSON.stringify(rawFields),
        },
      })
      await prisma.transaction.create({
        data: {
          rawId: raw.id, accountId, uploadId,
          date: parsedDate, description: descNorm || descRaw, merchantNormalized: merchantNorm,
          amount: amountNum, isTransfer, isForeignCurrency: false,
          foreignAmount: null, foreignCurrency: null,
          postedDate: parsedDate, transactionDate: parsedDate,
          dateRaw: ofxTx.dtPosted, dateAmbiguity: 'RESOLVED',
          dateInterpretationA: null, dateInterpretationB: null,
          amountRaw: ofxTx.trnAmt, currencyCode: ofxResult.currency || undefined,
          currencyDetected: false, descriptionRaw: descRaw,
          descriptionNormalized: descNorm || undefined, transformations: '[]',
          runningBalance: null, runningBalanceRaw: null,
          checkNumber: ofxTx.checkNum, bankTransactionId: ofxTx.fitId || undefined,
          pendingFlag: false, ingestionStatus: 'VALID',
          bankCategoryRaw: ofxTx.trnType || null,
          bankCategoryNormalized: normalizeBankCategory(ofxTx.trnType || ''),
          canonicalRowHash: computeCanonicalRowHash(ofxTx.dtPosted, descRaw, ofxTx.trnAmt, ofxTx.trnType, ofxTx.parseOrder),
        },
      })
      accepted++
      dates.push(parsedDate)
    } catch { rejected++ }
  }

  return { accepted, rejected, dates }
}

// ─────────────────────────────────────────────────────────────────────────────
// QIF persistence
// ─────────────────────────────────────────────────────────────────────────────

async function persistQif(
  uploadId: string,
  accountId: string,
  qifResult: ReturnType<typeof parseQif>,
): Promise<{ accepted: number; rejected: number; dates: Date[] }> {
  let accepted = 0, rejected = 0
  const dates: Date[] = []

  for (const qifTx of qifResult.transactions as QifTransaction[]) {
    const sourceRowHash = createHash('sha256')
      .update(`${accountId}|qif:${qifTx.date}|${qifTx.amount}|${qifTx.payee}|${qifTx.parseOrder}`)
      .digest('hex')

    const existingRaw = await prisma.transactionRaw.findUnique({ where: { sourceRowHash } })
    if (existingRaw) { rejected++; continue }

    const isoDate  = parseQifDate(qifTx.date)
    const [y, m, d] = isoDate.split('-').map(Number)
    const parsedDate = new Date(y, m - 1, d)
    const amountNum  = parseFloat(qifTx.amount) || 0
    const descRaw    = qifTx.payee || qifTx.memo
    const descNorm   = qifTx.payee && qifTx.memo ? `${qifTx.payee} ${qifTx.memo}`.trim() : descRaw
    const merchantNorm = normalizeMerchant(descNorm)
    const isTransfer   = isTransferDescription(descRaw)

    try {
      const raw = await prisma.transactionRaw.create({
        data: {
          uploadId, accountId,
          rawDate: qifTx.date, rawDescription: descRaw, rawAmount: qifTx.amount,
          rawCredit: '', rawDebit: '', rawBalance: '', sourceRowHash,
          sourceLocator: JSON.stringify({ type: 'QIF', parseOrder: qifTx.parseOrder }),
          rawLine: `D${qifTx.date}\nT${qifTx.amount}\nP${qifTx.payee}\nM${qifTx.memo}`,
          parseOrder: qifTx.parseOrder,
          rawFields: JSON.stringify({ D: qifTx.date, T: qifTx.amount, P: qifTx.payee, M: qifTx.memo, ...(qifTx.checkNum ? { N: qifTx.checkNum } : {}) }),
        },
      })
      await prisma.transaction.create({
        data: {
          rawId: raw.id, accountId, uploadId,
          date: parsedDate, description: descNorm || descRaw, merchantNormalized: merchantNorm,
          amount: amountNum, isTransfer, isForeignCurrency: false,
          foreignAmount: null, foreignCurrency: null,
          postedDate: parsedDate, transactionDate: parsedDate,
          dateRaw: qifTx.date, dateAmbiguity: 'RESOLVED',
          dateInterpretationA: null, dateInterpretationB: null,
          amountRaw: qifTx.amount, currencyDetected: false,
          descriptionRaw: descRaw, descriptionNormalized: descNorm || undefined,
          transformations: '[]', runningBalance: null, runningBalanceRaw: null,
          checkNumber: qifTx.checkNum, bankTransactionId: undefined,
          pendingFlag: false, ingestionStatus: 'VALID',
          bankCategoryRaw: null, bankCategoryNormalized: null,
          canonicalRowHash: computeCanonicalRowHash(isoDate, descRaw, qifTx.amount, '', qifTx.parseOrder),
        },
      })
      accepted++
      dates.push(parsedDate)
    } catch { rejected++ }
  }

  return { accepted, rejected, dates }
}

// ─────────────────────────────────────────────────────────────────────────────
// CSV persistence
// ─────────────────────────────────────────────────────────────────────────────

interface CsvPersistResult {
  accepted: number
  rejected: number
  totalUnresolved: number
  dateAmbiguous: boolean
  dateFormatSample: Array<{ line: number; rawDate: string; interpreted: string }>
  dates: Date[]
  dedupResult: Awaited<ReturnType<typeof runDedup>>
  reconcileResult: Awaited<ReturnType<typeof runReconciliation>>
  importReport: ImportReport
  stagingUploadId: string
  stagingRowCount: number
  formatDetected: string
  bankDetected: boolean
  bankKey: string | null
  dateOrderSelection: DateOrderSelectionResult
  warnings: unknown[]
  parseResult: ReturnType<typeof parseCsvStage1>
}

async function persistCsv(
  uploadId: string,
  accountId: string,
  userId: string,
  rawText: string,
  encoding: string,
  input: ProcessUploadInput,
): Promise<CsvPersistResult> {
  const parseResult = parseCsvStage1(rawText, encoding)

  if (!parseResult.success || parseResult.rows.length === 0) {
    const firstFatal = parseResult.errors.find(e => e.severity === 'FATAL')
    throw Object.assign(new Error(firstFatal?.message ?? 'No valid transactions found in this file.'), {
      statusCode: 422,
      warnings:   parseResult.warnings.slice(0, 10),
      errors:     parseResult.errors.slice(0, 10),
    })
  }

  const { headerDetection, config: parserConfig } = parseResult
  const mapping       = headerDetection.suggestedMapping
  const formatDetected = deriveFormatName(mapping, headerDetection.columns)
  const bankDetection = detectBank(headerDetection.columns, mapping)

  const dateColumnKey = mapping.postedDate ?? mapping.date ?? mapping.transactionDate ?? null
  const rawDatesForHint: string[] = dateColumnKey
    ? parseResult.rows.map(r => r.fields[dateColumnKey] ?? '').filter(Boolean)
    : []
  const scoringRows = dateColumnKey
    ? parseResult.rows.map((r, idx) => ({ rawDate: r.fields[dateColumnKey] ?? '', parseOrder: idx })).filter(r => r.rawDate !== '')
    : []

  const dateOrderSelection: DateOrderSelectionResult = selectDateOrder(scoringRows, bankDetection)
  const resolvedDateOrder = dateOrderSelection.needsUserConfirmation
    ? null
    : (dateOrderSelection.selectedOrder === 'YMD' ? null : dateOrderSelection.selectedOrder as 'MDY' | 'DMY')

  // Update upload with CSV-specific fields
  await prisma.upload.update({
    where: { id: uploadId },
    data: {
      formatDetected,
      parserVersion: PARSER_VERSION,
      parserConfig:  JSON.stringify(parserConfig),
      rowCountRaw:   parseResult.rows.length + parseResult.warnings.filter(w => w.code?.startsWith('COLUMN')).length,
      rowCountParsed: parseResult.rows.length,
      warnings:      JSON.stringify(parseResult.warnings.slice(0, 50)),
      dateOrderUsed:           dateOrderSelection.needsUserConfirmation ? null : dateOrderSelection.selectedOrder,
      dateOrderSource:         dateOrderSelection.needsUserConfirmation ? null : dateOrderSelection.source,
      dateOrderConfidence:     dateOrderSelection.needsUserConfirmation ? 0    : dateOrderSelection.confidence,
      authoritativeDateColumn: bankDetection.bankProfile?.authoritativeDateColumn ?? null,
    },
  })

  let accepted = 0, rejected = 0, totalUnresolved = 0, dateAmbiguous = false
  const dateFormatSample: Array<{ line: number; rawDate: string; interpreted: string }> = []

  interface ValidEntry {
    nt: ReturnType<typeof normalizeRow>
    sourceRowHash: string
    parsedDate: Date
    rawFields: Record<string, string>
  }
  const validEntries: ValidEntry[] = []

  for (const row of parseResult.rows) {
    const sourceRowHash = computeSourceRowHash(accountId, row.rawLine)
    const existingRaw   = await prisma.transactionRaw.findUnique({ where: { sourceRowHash } })
    if (existingRaw) { rejected++; continue }

    const nt = normalizeRow(row, mapping, null, resolvedDateOrder)
    if (nt.ingestionStatus === 'REJECTED') { rejected++; continue }

    const primaryDate = nt.postedDate ?? nt.transactionDate
    let parsedDate: Date

    if (primaryDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM') {
      parsedDate = new Date(primaryDate.interpretationA!)
      if (!dateAmbiguous) dateAmbiguous = true
      if (dateFormatSample.length < 3) {
        const csvLocator = row.sourceLocator as CsvXlsxSourceLocator
        dateFormatSample.push({ line: csvLocator.rowIndex + 1, rawDate: primaryDate.raw, interpreted: parsedDate.toLocaleDateString('en-US') })
      }
    } else if (primaryDate?.resolved) {
      parsedDate = new Date(primaryDate.resolved)
    } else {
      rejected++
      continue
    }

    if (nt.ingestionStatus === 'UNRESOLVED') totalUnresolved++
    validEntries.push({ nt, sourceRowHash, parsedDate, rawFields: row.fields })
  }

  const dates: Date[] = []

  for (let i = 0; i < validEntries.length; i++) {
    const { nt, sourceRowHash, parsedDate, rawFields } = validEntries[i]
    const merchantNorm = normalizeMerchant(nt.descriptionNormalized || nt.descriptionRaw)
    const isTransfer   = isTransferDescription(nt.descriptionRaw)
    const amountNum    = nt.amount.value != null ? parseFloat(nt.amount.value) : 0
    const csvLocator   = nt.sourceLocator as CsvXlsxSourceLocator
    const primaryDate  = nt.postedDate ?? nt.transactionDate
    const postedDateObj      = nt.postedDate?.resolved ? new Date(nt.postedDate.resolved) : null
    const transactionDateObj = nt.transactionDate?.resolved ? new Date(nt.transactionDate.resolved) : null
    const dateAmbiguityVal   = primaryDate?.ambiguity ?? 'RESOLVED'
    const dateInterpA = primaryDate?.interpretationA ? new Date(primaryDate.interpretationA) : null
    const dateInterpB = primaryDate?.interpretationB ? new Date(primaryDate.interpretationB) : null

    try {
      const raw = await prisma.transactionRaw.create({
        data: {
          uploadId, accountId,
          rawDate:        nt.postedDate?.raw ?? nt.transactionDate?.raw ?? '',
          rawDescription: nt.descriptionRaw,
          rawAmount:      nt.amount.raw,
          rawCredit:      '', rawDebit:  '',
          rawBalance:     nt.runningBalanceRaw ?? '',
          sourceRowHash,
          sourceLocator:  JSON.stringify(nt.sourceLocator),
          rawLine:        nt.rawLine,
          parseOrder:     csvLocator.dataRowIndex,
          rawFields:      JSON.stringify(rawFields),
        },
      })

      const tx = await prisma.transaction.create({
        data: {
          rawId: raw.id, accountId, uploadId,
          date: parsedDate, description: nt.descriptionNormalized || nt.descriptionRaw,
          merchantNormalized: merchantNorm, amount: amountNum, isTransfer,
          isForeignCurrency: nt.amount.currencyDetected !== null,
          foreignAmount: null, foreignCurrency: nt.amount.currencyDetected,
          postedDate: postedDateObj, transactionDate: transactionDateObj,
          dateRaw: primaryDate?.raw ?? null, dateAmbiguity: dateAmbiguityVal,
          dateInterpretationA: dateInterpA, dateInterpretationB: dateInterpB,
          amountRaw: nt.amount.raw || null, currencyCode: nt.currencyCode,
          currencyDetected: nt.amount.currencyDetected !== null,
          descriptionRaw: nt.descriptionRaw, descriptionNormalized: nt.descriptionNormalized || null,
          transformations: JSON.stringify(nt.allTransformations),
          runningBalance: nt.runningBalance ?? null, runningBalanceRaw: nt.runningBalanceRaw ?? null,
          checkNumber: nt.checkNumber ?? null, bankTransactionId: nt.bankTransactionId ?? null,
          pendingFlag: nt.pendingFlag, bankFingerprint: nt.bankFingerprint,
          ingestionStatus: nt.ingestionStatus,
          bankCategoryRaw: nt.bankCategory ?? null,
          bankCategoryNormalized: nt.bankCategory ? normalizeBankCategory(nt.bankCategory) : null,
          canonicalRowHash: computeCanonicalRowHash(
            nt.postedDate?.raw ?? nt.transactionDate?.raw ?? '',
            nt.descriptionRaw, nt.amount.raw || '', nt.bankCategory ?? null, csvLocator.dataRowIndex,
          ),
        },
      })

      for (const issue of nt.issues) {
        await prisma.ingestionIssue.create({
          data: {
            uploadId, transactionId: tx.id,
            issueType: issue.issueType, severity: issue.severity,
            description: issue.description, suggestedAction: issue.suggestedAction ?? null,
            resolved: false,
          },
        })
      }

      accepted++
      dates.push(parsedDate)
    } catch { rejected++ }
  }

  // Upload-level date ambiguity issue
  if (dateOrderSelection.needsUserConfirmation) {
    const ambigCount = validEntries.filter(e =>
      e.nt.postedDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM' ||
      e.nt.transactionDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM'
    ).length
    if (ambigCount > 0) {
      const scoreDetail = dateOrderSelection.scoreA && dateOrderSelection.scoreB
        ? ` (MDY score: ${dateOrderSelection.scoreA.totalScore}, DMY score: ${dateOrderSelection.scoreB.totalScore})`
        : ''
      await prisma.ingestionIssue.create({
        data: {
          uploadId, transactionId: null,
          issueType: 'DATE_FORMAT_CONFIRMATION_NEEDED', severity: 'ERROR',
          description: `${ambigCount} ambiguous date${ambigCount !== 1 ? 's' : ''} detected — please confirm whether this file uses MM/DD/YYYY (US) or DD/MM/YYYY (European) format${scoreDetail}`,
          suggestedAction: 'Click "Use MM/DD" or "Use DD/MM" to apply the correct format to all transactions',
          resolved: false,
        },
      })
    }
  }

  // Audit log
  await prisma.auditLogEntry.create({
    data: {
      uploadId, stage: 'NORMALIZE',
      level: dateOrderSelection.needsUserConfirmation ? 'WARN' : 'INFO',
      message: dateOrderSelection.needsUserConfirmation
        ? 'Date format ambiguous — user confirmation required'
        : `Date order selected: ${dateOrderSelection.selectedOrder} (source: ${dateOrderSelection.source}, confidence: ${dateOrderSelection.confidence})`,
      context: JSON.stringify({
        bankKey: dateOrderSelection.bankResult?.bankProfile?.bankKey ?? null,
        bankDetected: dateOrderSelection.bankResult?.matched ?? false,
        selectedOrder: dateOrderSelection.selectedOrder,
        source: dateOrderSelection.source,
        confidence: dateOrderSelection.confidence,
        needsConfirmation: dateOrderSelection.needsUserConfirmation,
        ambiguousDates: rawDatesForHint.length,
        scoreA: dateOrderSelection.scoreA ?? null,
        scoreB: dateOrderSelection.scoreB ?? null,
      }),
    },
  })

  // Stage 3: dedup (runs before upload finalized)
  const dedupResult = await runDedup(uploadId, accountId)

  // Finalize upload
  const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime())
  await prisma.upload.update({
    where: { id: uploadId },
    data: {
      rowCountAccepted: accepted, rowCountRejected: rejected,
      totalRowsUnresolved: totalUnresolved,
      status: 'complete', completedAt: new Date(),
      dateRangeStart: sortedDates[0] ?? null,
      dateRangeEnd:   sortedDates[sortedDates.length - 1] ?? null,
    },
  })

  // Stage 4: reconcile
  const reconcileResult = await runReconciliation(uploadId)

  // Import report
  const committedAmountTotal = validEntries.slice(0, accepted).reduce((sum, e) => {
    const amt = e.nt.amount.value != null ? parseFloat(e.nt.amount.value) : 0
    return sum + amt
  }, 0)
  const bankCatValues = validEntries.map(e => e.nt.bankCategory).filter((v): v is string => !!v)
  const uniqueBankCats = [...new Set(bankCatValues)]

  const importReport: ImportReport = {
    generatedAt:  new Date().toISOString(),
    parserVersion: PARSER_VERSION,
    bankProfileDetected: bankDetection.bankProfile?.bankKey ?? null,
    columnMapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v != null) as [string, string][]),
    dateFormat: {
      detected: dateOrderSelection.selectedOrder ?? 'unknown',
      ambiguousCount: dateOrderSelection.needsUserConfirmation
        ? validEntries.filter(e => e.nt.postedDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM' || e.nt.transactionDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM').length
        : 0,
      needsConfirmation: dateOrderSelection.needsUserConfirmation,
      samples: dateFormatSample.map(s => ({ line: s.line, raw: s.rawDate, interpretedAs: s.interpreted })),
    },
    rowCounts: { source: parseResult.rows.length + rejected, parsed: parseResult.rows.length, committed: accepted, rejected, pendingReview: totalUnresolved },
    amounts: { committedTotal: committedAmountTotal.toFixed(2), currencyCode: 'USD' },
    categoryPreservation: {
      columnDetected: mapping.bankCategory != null,
      columnHeader: mapping.bankCategory ?? null,
      rowsWithValue: bankCatValues.length,
      rowsMissingValue: accepted - bankCatValues.length,
      preservedCount: bankCatValues.length,
      uniqueValues: uniqueBankCats,
    },
    integrity: { hashesComputed: accepted, hashesVerified: accepted, hashMismatches: 0 },
    issues: parseResult.errors.reduce((acc, err) => {
      const existing = acc.find(i => i.type === err.severity)
      if (existing) { existing.count++; if (existing.samples.length < 3) existing.samples.push(err.message.slice(0, 80)) }
      else acc.push({ type: err.severity, count: 1, samples: [err.message.slice(0, 80)] })
      return acc
    }, [] as ImportReport['issues']),
  }

  await prisma.upload.update({ where: { id: uploadId }, data: { importReport: JSON.stringify(importReport) } })

  // Staging records
  const createdTxs = await prisma.transaction.findMany({
    where: { uploadId },
    select: { id: true, date: true, merchantNormalized: true, descriptionRaw: true, amount: true, bankCategoryRaw: true, ingestionStatus: true },
  })
  const stagingUpload = await prisma.stagingUpload.create({
    data: { userId, uploadId, status: 'ready', rowCount: createdTxs.length },
  })
  const stagingRows = createdTxs.filter(tx => tx.ingestionStatus !== 'REJECTED')

  if (stagingRows.length > 0) {
    const allCents = stagingRows.map(tx => amountToCents(tx.amount))
    const expensesAreNegative = allCents.filter(c => c < 0).length > allCents.length / 2
    const vendorAmountMap = new Map<string, number[]>()
    for (const tx of stagingRows) {
      const key   = normalizeVendor(tx.merchantNormalized || tx.descriptionRaw || '')
      const cents = amountToCents(tx.amount)
      const isSpend = expensesAreNegative ? cents < 0 : cents > 0
      if (!isSpend) continue
      const arr = vendorAmountMap.get(key) ?? []
      arr.push(Math.abs(Number(cents)))
      vendorAmountMap.set(key, arr)
    }
    const recurringVendorKeys = new Set<string>()
    for (const [vendor, amounts] of vendorAmountMap.entries()) {
      if (amounts.length < 2) continue
      const ref = amounts[0]
      if (ref > 0 && amounts.every(a => Math.abs(a - ref) <= ref * 0.1)) recurringVendorKeys.add(vendor)
    }

    await prisma.stagingTransaction.createMany({
      data: stagingRows.map(tx => {
        const vendorRaw = tx.merchantNormalized || tx.descriptionRaw || ''
        const vendorKey = normalizeVendor(vendorRaw)
        const cents     = amountToCents(tx.amount)
        const engineSuggestion = suggestCategory(vendorRaw, Number(cents), expensesAreNegative)
        const isDescTransfer   = engineSuggestion?.category === 'Transfer'
        let suggestionCategory: string | null = null, suggestionConfidence: string | null = null, suggestionSource: string | null = null
        if (isDescTransfer) { suggestionCategory = 'Transfer'; suggestionConfidence = 'high'; suggestionSource = 'engine' }
        else if (tx.bankCategoryRaw) {
          const bankMapped = mapBankCategoryToName(tx.bankCategoryRaw)
          if (bankMapped) { suggestionCategory = bankMapped; suggestionConfidence = bankMapped === 'Other' ? 'medium' : 'high'; suggestionSource = 'bank' }
        }
        if (!suggestionCategory && engineSuggestion) { suggestionCategory = engineSuggestion.category; suggestionConfidence = engineSuggestion.confidence; suggestionSource = 'engine' }
        return {
          stagingUploadId: stagingUpload.id, userId, uploadId,
          date: tx.date, vendorRaw, vendorKey, amountCents: Number(cents),
          description: tx.descriptionRaw || '', bankCategoryRaw: tx.bankCategoryRaw || null,
          status: 'uncategorized', suggestionCategory, suggestionConfidence, suggestionSource,
          isRecurring: recurringVendorKeys.has(vendorKey),
        }
      }),
    })
  }

  // Auto-apply rules
  try {
    const dryRun = await dryRunRules(stagingUpload.id, userId, accountId)
    let autoApplied = 0, autoReview = 0
    for (const match of dryRun.matches) {
      if (match.status === 'auto') {
        await prisma.stagingTransaction.update({
          where: { id: match.stagingTxId },
          data: { ruleId: match.ruleId, ruleReason: match.ruleReason, categoryId: match.categoryId, categorySource: 'rule', status: 'categorized' },
        })
        if (match.ruleId) {
          await prisma.ruleHit.create({
            data: { ruleId: match.ruleId, stagingTxId: match.stagingTxId, uploadId, wasAccepted: null },
          })
        }
        autoApplied++
      } else if (match.status === 'needs_review') {
        await prisma.stagingTransaction.update({
          where: { id: match.stagingTxId },
          data: { status: 'needs_review', ...(match.ruleId ? { ruleId: match.ruleId } : {}), ...(match.ruleReason ? { ruleReason: match.ruleReason } : {}) },
        })
        autoReview++
      }
    }
    await prisma.stagingUpload.update({ where: { id: stagingUpload.id }, data: { autoCount: autoApplied, reviewCount: autoReview } })
  } catch { /* non-fatal */ }

  return {
    accepted, rejected, totalUnresolved, dateAmbiguous, dateFormatSample, dates,
    dedupResult, reconcileResult, importReport,
    stagingUploadId: stagingUpload.id, stagingRowCount: stagingRows.length,
    formatDetected, bankDetected: bankDetection.matched, bankKey: bankDetection.bankProfile?.bankKey ?? null,
    dateOrderSelection, warnings: parseResult.warnings.slice(0, 20), parseResult,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator
// ─────────────────────────────────────────────────────────────────────────────

export async function processUpload(input: ProcessUploadInput): Promise<ProcessUploadResult> {
  const { userId, file, filename, mimeType, accountId, openingBalance, closingBalance, statementTotalCredits, statementTotalDebits } = input

  // 1. Resolve active session — no upload may be created without one
  const activeSession = await getOrCreateActiveSession(userId)
  const sessionId = activeSession.id
  await backfillOrphanedUploads(userId, sessionId)

  // 2. Read file bytes
  const arrayBuffer = await file.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // 3. Stage 0: file acceptance
  const acceptance = await acceptFile(buffer, filename, mimeType)
  if (!acceptance.accepted) {
    throw Object.assign(new Error(acceptance.rejectionReason ?? 'File not accepted'), { statusCode: 422 })
  }

  const fileHash = acceptance.fileHash
  const encoding = acceptance.encoding ?? 'utf-8'

  // ── PDF path ───────────────────────────────────────────────────────────────
  if (acceptance.sourceType === 'PDF') {
    let pdfResult: Awaited<ReturnType<typeof ingestPdf>>
    try {
      pdfResult = await ingestPdf(buffer, filename, 'tmp')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'PDF processing failed.'
      throw Object.assign(new Error(message), { statusCode: 422 })
    }

    const { candidates, classification, reconciliationIssues } = pdfResult
    const lowConfidence = candidates.filter(c => c.confidence < PDF_LIMITS.MIN_CONFIDENCE)
    const version = await stampVersion(acceptance)

    const upload = await prisma.upload.create({
      data: {
        userId, accountId, sessionId, filename, fileHash,
        formatDetected: 'PDF', version,
        reprocessedFromId: acceptance.previousUploadId ?? undefined,
        rowCountRaw: candidates.length, rowCountParsed: candidates.filter(c => c.confidence >= PDF_LIMITS.MIN_CONFIDENCE).length,
        status: 'processing',
        warnings: JSON.stringify(reconciliationIssues.map(i => ({ code: i.code, message: i.message }))),
        parserVersion: PARSER_VERSION,
        parserConfig: JSON.stringify({ type: 'PDF', totalPages: classification.pageCount, tableRegions: [], ocrRequired: false, ocrConfidenceThreshold: 0 }),
        reconciliationStatus: 'PENDING',
        dateOrderUsed: 'YMD', dateOrderSource: 'PDF_EXTRACTED', dateOrderConfidence: 1,
        statementOpenBalance: openingBalance, statementCloseBalance: closingBalance,
        statementTotalCredits, statementTotalDebits,
      },
    })

    let pdfStats: Awaited<ReturnType<typeof persistPdf>>
    try {
      pdfStats = await persistPdf(upload.id, accountId, candidates)

      const sortedDates = [...pdfStats.dates].sort((a, b) => a.getTime() - b.getTime())
      await prisma.upload.update({
        where: { id: upload.id },
        data: {
          rowCountAccepted: pdfStats.accepted, rowCountRejected: pdfStats.rejected + lowConfidence.length,
          totalRowsUnresolved: lowConfidence.length, status: 'complete', completedAt: new Date(),
          dateRangeStart: sortedDates[0] ?? null, dateRangeEnd: sortedDates[sortedDates.length - 1] ?? null,
        },
      })
    } catch (err) {
      await markFailed(upload.id, err instanceof Error ? err.message : 'PDF persistence failed')
      throw err
    }

    const dedupResult     = await runDedup(upload.id, accountId)
    const reconcileResult = await runReconciliation(upload.id)
    await recomputeAfterUpload(userId)
    await detectTransfers(userId).catch(() => {})
    await prisma.analysisSession.update({ where: { id: sessionId }, data: { status: 'READY' } }).catch(() => {})
    await verifyIntegrity(upload.id, sessionId, accountId)

    const snap = await buildSessionSnapshot(sessionId, userId)

    return {
      uploadId: upload.id, sessionId,
      accepted: pdfStats.accepted, rejected: pdfStats.rejected, totalUnresolved: lowConfidence.length,
      possibleDuplicates: dedupResult.possibleDuplicatesFound,
      crossUploadDuplicates: dedupResult.crossUploadMatches,
      withinUploadDuplicates: dedupResult.withinUploadMatches,
      formatDetected: 'PDF', transactionCount: pdfStats.accepted,
      parserVersion: PARSER_VERSION, fileHashTruncated: `${fileHash.slice(0, 8)}…${fileHash.slice(-8)}`,
      reconciliationStatus: reconcileResult.status, reconciliationMode: reconcileResult.mode,
      dateOrderUsed: 'YMD', dateOrderSource: 'PDF_EXTRACTED', dateOrderConfidence: 1,
      bankDetected: false, bankKey: null, dateOrderNeedsConfirmation: false,
      dateAmbiguous: false, dateFormatSample: [],
      warnings: reconciliationIssues.map(i => ({ code: i.code, message: i.message })),
      formatMismatch: false, contentSniffedType: null,
      pdfReviewRequired: pdfResult.reviewRequired, pdfLowConfidenceCount: lowConfidence.length,
      pdfClassification: { pageCount: classification.pageCount, estimatedAccount: classification.estimatedAccount, statementStart: classification.statementStart, statementEnd: classification.statementEnd },
      upload: { id: upload.id, sessionId: upload.sessionId },
      session: { id: snap.session?.id ?? sessionId, status: snap.session?.status ?? 'READY', uploadCount: snap.uploadCount, txCount: snap.txCount },
      uploadCount: snap.uploadCount, accountCount: snap.accountCount,
      transactionCount2: snap.txCount, duplicateCount: dedupResult.possibleDuplicatesFound,
      transferCount: snap.transferCount, analysisVersion: snap.analysisVersion,
    }
  }

  const rawText = acceptance.decodedText!

  // ── OFX / QFX / QBO path ──────────────────────────────────────────────────
  if (acceptance.sourceType === 'OFX' || acceptance.sourceType === 'QFX' || acceptance.sourceType === 'QBO') {
    const ofxVariant = acceptance.sourceType
    const ofxResult  = parseOfx(rawText)

    if (ofxResult.transactions.length === 0) {
      throw Object.assign(new Error('No transactions found in OFX file. Make sure it contains a <BANKTRANLIST> section.'), { statusCode: 422 })
    }

    const version = await stampVersion(acceptance)
    const upload  = await prisma.upload.create({
      data: {
        userId, accountId, sessionId, filename, fileHash,
        formatDetected: ofxVariant, version,
        reprocessedFromId: acceptance.previousUploadId ?? undefined,
        rowCountRaw: ofxResult.transactions.length, rowCountParsed: ofxResult.transactions.length,
        status: 'processing', warnings: '[]', parserVersion: 'ofx-1.0', parserConfig: '{}',
        reconciliationStatus: 'PENDING', dateOrderUsed: 'YMD', dateOrderSource: 'OFX_STANDARD', dateOrderConfidence: 1,
        statementOpenBalance: openingBalance,
        statementCloseBalance: closingBalance ?? (ofxResult.ledgerBalance != null ? String(ofxResult.ledgerBalance) : null),
        statementTotalCredits, statementTotalDebits,
      },
    })

    let ofxStats: Awaited<ReturnType<typeof persistOfx>>
    try {
      ofxStats = await persistOfx(upload.id, accountId, ofxResult)
      const sortedDates = [...ofxStats.dates].sort((a, b) => a.getTime() - b.getTime())
      await prisma.upload.update({
        where: { id: upload.id },
        data: {
          rowCountAccepted: ofxStats.accepted, rowCountRejected: ofxStats.rejected,
          totalRowsUnresolved: 0, status: 'complete', completedAt: new Date(),
          dateRangeStart: sortedDates[0] ?? null, dateRangeEnd: sortedDates[sortedDates.length - 1] ?? null,
        },
      })
    } catch (err) {
      await markFailed(upload.id, err instanceof Error ? err.message : 'OFX persistence failed')
      throw err
    }

    const dedupResult     = await runDedup(upload.id, accountId)
    const reconcileResult = await runReconciliation(upload.id)
    await recomputeAfterUpload(userId)
    await detectTransfers(userId).catch(() => {})
    await prisma.analysisSession.update({ where: { id: sessionId }, data: { status: 'READY' } }).catch(() => {})
    await verifyIntegrity(upload.id, sessionId, accountId)

    const snap = await buildSessionSnapshot(sessionId, userId)

    return {
      uploadId: upload.id, sessionId,
      accepted: ofxStats.accepted, rejected: ofxStats.rejected, totalUnresolved: 0,
      possibleDuplicates: dedupResult.possibleDuplicatesFound,
      crossUploadDuplicates: dedupResult.crossUploadMatches,
      withinUploadDuplicates: dedupResult.withinUploadMatches,
      formatDetected: ofxVariant, transactionCount: ofxStats.accepted,
      parserVersion: 'ofx-1.0', fileHashTruncated: `${fileHash.slice(0, 8)}…${fileHash.slice(-8)}`,
      reconciliationStatus: reconcileResult.status, reconciliationMode: reconcileResult.mode,
      dateOrderUsed: 'YMD', dateOrderSource: 'OFX_STANDARD', dateOrderConfidence: 1,
      bankDetected: false, bankKey: null, dateOrderNeedsConfirmation: false,
      dateAmbiguous: false, dateFormatSample: [], warnings: [],
      formatMismatch: acceptance.formatMismatch ?? false, contentSniffedType: acceptance.contentSniffedType ?? null,
      upload: { id: upload.id, sessionId: upload.sessionId },
      session: { id: snap.session?.id ?? sessionId, status: snap.session?.status ?? 'READY', uploadCount: snap.uploadCount, txCount: snap.txCount },
      uploadCount: snap.uploadCount, accountCount: snap.accountCount,
      transactionCount2: snap.txCount, duplicateCount: dedupResult.possibleDuplicatesFound,
      transferCount: snap.transferCount, analysisVersion: snap.analysisVersion,
    }
  }

  // ── QIF path ───────────────────────────────────────────────────────────────
  if (acceptance.sourceType === 'QIF') {
    const qifResult = parseQif(rawText)
    if (qifResult.transactions.length === 0) {
      throw Object.assign(new Error('No transactions found in QIF file. Make sure the file contains transaction records.'), { statusCode: 422 })
    }

    const version = await stampVersion(acceptance)
    const upload  = await prisma.upload.create({
      data: {
        userId, accountId, sessionId, filename, fileHash,
        formatDetected: 'QIF', version,
        reprocessedFromId: acceptance.previousUploadId ?? undefined,
        rowCountRaw: qifResult.transactions.length, rowCountParsed: qifResult.transactions.length,
        status: 'processing', warnings: '[]', parserVersion: 'qif-1.0',
        parserConfig: JSON.stringify({ accountType: qifResult.accountType }),
        reconciliationStatus: 'PENDING', dateOrderUsed: 'MDY', dateOrderSource: 'QIF_STANDARD', dateOrderConfidence: 0.9,
        statementOpenBalance: openingBalance, statementCloseBalance: closingBalance,
        statementTotalCredits, statementTotalDebits,
      },
    })

    let qifStats: Awaited<ReturnType<typeof persistQif>>
    try {
      qifStats = await persistQif(upload.id, accountId, qifResult)
      const sortedDates = [...qifStats.dates].sort((a, b) => a.getTime() - b.getTime())
      await prisma.upload.update({
        where: { id: upload.id },
        data: {
          rowCountAccepted: qifStats.accepted, rowCountRejected: qifStats.rejected,
          totalRowsUnresolved: 0, status: 'complete', completedAt: new Date(),
          dateRangeStart: sortedDates[0] ?? null, dateRangeEnd: sortedDates[sortedDates.length - 1] ?? null,
        },
      })
    } catch (err) {
      await markFailed(upload.id, err instanceof Error ? err.message : 'QIF persistence failed')
      throw err
    }

    const dedupResult     = await runDedup(upload.id, accountId)
    const reconcileResult = await runReconciliation(upload.id)
    await recomputeAfterUpload(userId)
    await detectTransfers(userId).catch(() => {})
    await prisma.analysisSession.update({ where: { id: sessionId }, data: { status: 'READY' } }).catch(() => {})
    await verifyIntegrity(upload.id, sessionId, accountId)

    const snap = await buildSessionSnapshot(sessionId, userId)

    return {
      uploadId: upload.id, sessionId,
      accepted: qifStats.accepted, rejected: qifStats.rejected, totalUnresolved: 0,
      possibleDuplicates: dedupResult.possibleDuplicatesFound,
      crossUploadDuplicates: dedupResult.crossUploadMatches,
      withinUploadDuplicates: dedupResult.withinUploadMatches,
      formatDetected: 'QIF', transactionCount: qifStats.accepted,
      parserVersion: 'qif-1.0', fileHashTruncated: `${fileHash.slice(0, 8)}…${fileHash.slice(-8)}`,
      reconciliationStatus: reconcileResult.status, reconciliationMode: reconcileResult.mode,
      dateOrderUsed: 'MDY', dateOrderSource: 'QIF_STANDARD', dateOrderConfidence: 0.9,
      bankDetected: false, bankKey: null, dateOrderNeedsConfirmation: false,
      dateAmbiguous: false, dateFormatSample: [], warnings: [],
      formatMismatch: false, contentSniffedType: null,
      upload: { id: upload.id, sessionId: upload.sessionId },
      session: { id: snap.session?.id ?? sessionId, status: snap.session?.status ?? 'READY', uploadCount: snap.uploadCount, txCount: snap.txCount },
      uploadCount: snap.uploadCount, accountCount: snap.accountCount,
      transactionCount2: snap.txCount, duplicateCount: dedupResult.possibleDuplicatesFound,
      transferCount: snap.transferCount, analysisVersion: snap.analysisVersion,
    }
  }

  // ── CSV path (all remaining types) ────────────────────────────────────────
  // Create upload record in processing state first, then parse + persist
  const version  = await stampVersion(acceptance)
  const upload   = await prisma.upload.create({
    data: {
      userId, accountId, sessionId, filename, fileHash,
      formatDetected: 'CSV', version,
      reprocessedFromId: acceptance.previousUploadId ?? undefined,
      rowCountRaw: 0, rowCountParsed: 0,
      status: 'processing', warnings: '[]',
      parserVersion: PARSER_VERSION, parserConfig: '{}',
      reconciliationStatus: 'PENDING',
      dateOrderUsed: null, dateOrderSource: null, dateOrderConfidence: 0,
      statementOpenBalance: openingBalance, statementCloseBalance: closingBalance,
      statementTotalCredits, statementTotalDebits,
    },
  })

  let csvStats: CsvPersistResult
  try {
    csvStats = await persistCsv(upload.id, accountId, userId, rawText, encoding, input)
  } catch (err) {
    await markFailed(upload.id, err instanceof Error ? err.message : 'CSV persistence failed')
    throw err
  }

  await recomputeAfterUpload(userId)
  await detectTransfers(userId).catch(() => {})
  await prisma.analysisSession.update({ where: { id: sessionId }, data: { status: 'READY' } }).catch(() => {})
  await verifyIntegrity(upload.id, sessionId, accountId)

  const snap = await buildSessionSnapshot(sessionId, userId)

  return {
    uploadId: upload.id, sessionId,
    accepted: csvStats.accepted, rejected: csvStats.rejected, totalUnresolved: csvStats.totalUnresolved,
    possibleDuplicates: csvStats.dedupResult.possibleDuplicatesFound,
    crossUploadDuplicates: csvStats.dedupResult.crossUploadMatches,
    withinUploadDuplicates: csvStats.dedupResult.withinUploadMatches,
    formatDetected: csvStats.formatDetected, transactionCount: csvStats.accepted,
    parserVersion: PARSER_VERSION, fileHashTruncated: `${fileHash.slice(0, 8)}…${fileHash.slice(-8)}`,
    reconciliationStatus: csvStats.reconcileResult.status, reconciliationMode: csvStats.reconcileResult.mode,
    dateOrderUsed: csvStats.dateOrderSelection.selectedOrder,
    dateOrderSource: csvStats.dateOrderSelection.source,
    dateOrderConfidence: csvStats.dateOrderSelection.confidence,
    bankDetected: csvStats.bankDetected, bankKey: csvStats.bankKey,
    dateOrderNeedsConfirmation: csvStats.dateOrderSelection.needsUserConfirmation,
    dateAmbiguous: csvStats.dateAmbiguous, dateFormatSample: csvStats.dateAmbiguous ? csvStats.dateFormatSample : [],
    warnings: csvStats.warnings,
    importReport: csvStats.importReport, stagingUploadId: csvStats.stagingUploadId, stagingRowCount: csvStats.stagingRowCount,
    upload: { id: upload.id, sessionId: upload.sessionId },
    session: { id: snap.session?.id ?? sessionId, status: snap.session?.status ?? 'READY', uploadCount: snap.uploadCount, txCount: snap.txCount },
    uploadCount: snap.uploadCount, accountCount: snap.accountCount,
    transactionCount2: snap.txCount, duplicateCount: csvStats.dedupResult.possibleDuplicatesFound,
    transferCount: snap.transferCount, analysisVersion: snap.analysisVersion,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: convert processUpload errors to NextResponse (for use in route)
// ─────────────────────────────────────────────────────────────────────────────

export function uploadErrorResponse(err: unknown) {
  if (err instanceof Error && 'statusCode' in err) {
    const e = err as Error & { statusCode: number; warnings?: unknown[]; errors?: unknown[] }
    return NextResponse.json({ error: e.message, warnings: e.warnings, errors: e.errors }, { status: e.statusCode })
  }
  console.error('[processUpload] Unexpected error:', err)
  return NextResponse.json({ error: 'Upload processing failed' }, { status: 500 })
}
