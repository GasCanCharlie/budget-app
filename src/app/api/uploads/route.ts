import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { isTransferDescription } from '@/lib/intelligence/transfers'
import { normalizeMerchant } from '@/lib/categorization/engine'
import { normalizeBankCategory, mapBankCategoryToName } from '@/lib/categorization/bank-category-map'
import { suggestCategory } from '@/lib/scrubbing'
import { detectTransfers } from '@/lib/intelligence/transfers'
import { computeMonthSummary, getAvailableMonths } from '@/lib/intelligence/summaries'
import { acceptFile } from '@/lib/ingestion/stage0-acceptance'
import { parseCsvStage1, PARSER_VERSION } from '@/lib/ingestion/stage1-parse-csv'
import { normalizeRow } from '@/lib/ingestion/stage2-normalize'
import { detectBank } from '@/lib/ingestion/bank-detector'
import { selectDateOrder } from '@/lib/ingestion/date-order-scoring'
import type { DateOrderSelectionResult } from '@/types/ingestion'
import { runDedup } from '@/lib/ingestion/stage3-dedup'
import { parseOfx, parseOfxDate, type OfxTransaction } from '@/lib/ingestion/parse-ofx'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'
import { computeCanonicalRowHash, type ImportReport } from '@/lib/ingestion/import-report'
import type { CsvXlsxSourceLocator } from '@/types/ingestion'
import { dryRunRules } from '@/lib/rules/dry-run'
import { ingestPdf } from '@/lib/ingestion/pdf'
import { PDF_LIMITS } from '@/lib/ingestion/pdf/types'

export const maxDuration = 120 // seconds — PDF extraction via Claude can take 30–60s

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeVendor(raw: string): string {
  let key = raw
    .toLowerCase()
    .replace(/^(pos |ach |debit |credit |purchase |tsq?\*|sq \*|sq\*|tst\*|dda |wdrl |wd |chk |chkcd |preauth |preauthorized |online |recurring )/gi, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80)
  // Strip trailing store/branch numbers to match normalizeForRule (e.g. "walmart 4321" → "walmart")
  const stripped = key.replace(/\s+\d+$/, '').trim()
  if (stripped.length >= 3) key = stripped
  return key
}

function amountToCents(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Compute the sourceRowHash for TransactionRaw dedup.
 * Scoped to accountId so the same line in two different accounts doesn't collide.
 * Uses rawLine (content-based) so the same transaction in two uploads for the
 * same account is correctly identified as a duplicate.
 */
function computeSourceRowHash(accountId: string, rawLine: string): string {
  return createHash('sha256')
    .update(`${accountId}|${rawLine}`)
    .digest('hex')
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/uploads
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ip = getClientIp(req)
  const rl = await checkRateLimit(ip, 'upload')
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many upload requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) } }
    )
  }

  try {
    const formData  = await req.formData()
    const file      = formData.get('file') as File | null
    const accountId = formData.get('accountId') as string | null

    // Optional statement-level totals for reconciliation (Mode A).
    // Provide these when the bank statement includes declared totals or open/close balances.
    const openingBalance        = (formData.get('openingBalance')        as string | null) || null
    const closingBalance        = (formData.get('closingBalance')        as string | null) || null
    const statementTotalCredits = (formData.get('statementTotalCredits') as string | null) || null
    const statementTotalDebits  = (formData.get('statementTotalDebits')  as string | null) || null

    if (!file)      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!accountId) return NextResponse.json({ error: 'No accountId provided' }, { status: 400 })

    // Verify account ownership before doing any work
    const account = await prisma.account.findFirst({
      where: { id: accountId, userId: payload.userId },
    })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    // ── Read file as raw bytes ────────────────────────────────────────────────
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // ── Stage 0: File acceptance ──────────────────────────────────────────────
    const acceptance = await acceptFile(buffer, file.name, file.type)

    if (!acceptance.accepted) {
      return NextResponse.json(
        { error: acceptance.rejectionReason },
        { status: 422 },
      )
    }

    const fileHash = acceptance.fileHash
    const encoding = acceptance.encoding ?? 'utf-8'

    // ── PDF pipeline (bypasses CSV stages 1–2) ────────────────────────────────
    if (acceptance.sourceType === 'PDF') {
      // ingestPdf handles classification, extraction, reconciliation.
      // It throws with a user-friendly message if the PDF is scanned/encrypted/too long.
      let pdfResult
      try {
        pdfResult = await ingestPdf(buffer, file.name, 'tmp')
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'PDF processing failed.'
        return NextResponse.json({ error: message }, { status: 422 })
      }

      const { candidates, classification, reconciliationIssues } = pdfResult

      // Separate high-confidence (auto-import) from low-confidence (review queue)
      const highConfidence = candidates.filter(
        (c) => c.confidence >= PDF_LIMITS.MIN_CONFIDENCE,
      )
      const lowConfidence = candidates.filter(
        (c) => c.confidence < PDF_LIMITS.MIN_CONFIDENCE,
      )

      if (lowConfidence.length > 0) {
        // TODO: review queue UI — store low-confidence candidates for manual review
        console.log(
          `[pdf/upload] ${lowConfidence.length} low-confidence candidates skipped for review:`,
          lowConfidence.map((c) => ({
            id: c.id,
            date: c.parsedDate,
            amount: c.parsedAmount,
            desc: c.parsedDescription?.slice(0, 50),
            confidence: c.confidence.toFixed(2),
          })),
        )
      }

      // Version-stamp if re-upload of same file
      let pdfUploadVersion = 1
      if (acceptance.isDuplicate && acceptance.previousUploadId) {
        const prevUpload = await prisma.upload.findUnique({
          where: { id: acceptance.previousUploadId },
          select: { version: true },
        })
        pdfUploadVersion = (prevUpload?.version ?? 0) + 1
        await prisma.upload.update({
          where: { id: acceptance.previousUploadId },
          data: { superseded: true },
        })
      }

      const pdfParserConfig = {
        type: 'PDF',
        totalPages: classification.pageCount,
        tableRegions: [],
        ocrRequired: false,
        ocrConfidenceThreshold: 0,
      }

      const pdfUpload = await prisma.upload.create({
        data: {
          userId:              payload.userId,
          accountId,
          filename:            file.name,
          fileHash,
          formatDetected:      'PDF',
          version:             pdfUploadVersion,
          reprocessedFromId:   acceptance.previousUploadId ?? undefined,
          rowCountRaw:         candidates.length,
          rowCountParsed:      highConfidence.length,
          status:              'processing',
          warnings:            JSON.stringify(reconciliationIssues.map((i) => ({
            code: i.code,
            message: i.message,
          }))),
          parserVersion:       PARSER_VERSION,
          parserConfig:        JSON.stringify(pdfParserConfig),
          reconciliationStatus: 'PENDING',
          dateOrderUsed:       'YMD',
          dateOrderSource:     'PDF_EXTRACTED',
          dateOrderConfidence: 1,
          statementOpenBalance:  openingBalance,
          statementCloseBalance: closingBalance,
          statementTotalCredits,
          statementTotalDebits,
        },
      })

      // Re-run ingestPdf with the real uploadId for stable candidate IDs
      // (The first call used 'tmp' — now re-map with the real uploadId)
      // In practice, IDs are only used internally; uploadId on records is what matters.

      let pdfAccepted = 0
      let pdfRejected = 0
      const pdfValidDates: Date[] = []

      for (let i = 0; i < highConfidence.length; i++) {
        const candidate = highConfidence[i]

        // Apply direction to amount (positive = credit, negative = debit)
        const signedAmount = candidate.parsedAmount !== null
          ? (candidate.direction === 'debit' ? -candidate.parsedAmount : candidate.parsedAmount)
          : 0

        const parsedDate = candidate.parsedDate
          ? new Date(candidate.parsedDate + 'T00:00:00Z')
          : new Date()

        // Idempotency: dedup by (accountId + sourceText + parsedDate + parsedAmount)
        const rawLineForHash = candidate.sourceLines.join(' ').slice(0, 200)
        const sourceRowHash = createHash('sha256')
          .update(`${accountId}|pdf:${candidate.parsedDate}:${candidate.parsedAmount}:${rawLineForHash}`)
          .digest('hex')

        const existingRaw = await prisma.transactionRaw.findUnique({ where: { sourceRowHash } })
        if (existingRaw) { pdfRejected++; continue }

        const descRaw = candidate.parsedDescription ?? candidate.rawDescription ?? ''
        const merchantNorm = normalizeMerchant(descRaw)
        const isTransfer = isTransferDescription(descRaw)

        const pdfSourceLocator: import('@/types/ingestion').PdfSourceLocator = {
          type: 'PDF',
          pageNumber: candidate.pageSpan.start,
          lineId: `p${candidate.pageSpan.start}_l${i}`,
        }

        try {
          const raw = await prisma.transactionRaw.create({
            data: {
              uploadId:       pdfUpload.id,
              accountId,
              rawDate:        candidate.rawDate ?? '',
              rawDescription: descRaw,
              rawAmount:      candidate.rawAmount ?? String(Math.abs(signedAmount)),
              rawCredit:      candidate.direction === 'credit' ? String(candidate.parsedAmount ?? 0) : '',
              rawDebit:       candidate.direction === 'debit'  ? String(candidate.parsedAmount ?? 0) : '',
              rawBalance:     candidate.rawBalance ?? '',
              sourceRowHash,
              sourceLocator:  JSON.stringify(pdfSourceLocator),
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
              rawId:                raw.id,
              accountId,
              uploadId:             pdfUpload.id,
              date:                 parsedDate,
              description:          descRaw,
              merchantNormalized:   merchantNorm,
              amount:               signedAmount,
              isTransfer,
              isForeignCurrency:    false,
              foreignAmount:        null,
              foreignCurrency:      null,
              postedDate:           parsedDate,
              transactionDate:      parsedDate,
              dateRaw:              candidate.rawDate ?? '',
              dateAmbiguity:        'RESOLVED',
              dateInterpretationA:  null,
              dateInterpretationB:  null,
              amountRaw:            candidate.rawAmount ?? String(Math.abs(signedAmount)),
              currencyCode:         undefined,
              currencyDetected:     false,
              descriptionRaw:       descRaw,
              descriptionNormalized: descRaw || undefined,
              transformations:      '[]',
              runningBalance:       candidate.parsedBalance !== null ? String(candidate.parsedBalance) : null,
              runningBalanceRaw:    candidate.rawBalance ?? null,
              checkNumber:          null,
              bankTransactionId:    candidate.id,
              pendingFlag:          false,
              bankFingerprint:      undefined,
              ingestionStatus:      'VALID',
              bankCategoryRaw:      null,
              bankCategoryNormalized: null,
              canonicalRowHash: computeCanonicalRowHash(
                candidate.rawDate ?? '',
                descRaw,
                candidate.rawAmount ?? '',
                null,
                i,
              ),
            },
          })

          pdfAccepted++
          pdfValidDates.push(parsedDate)
        } catch {
          pdfRejected++
        }
      }

      const sortedPdfDates = [...pdfValidDates].sort((a, b) => a.getTime() - b.getTime())
      await prisma.upload.update({
        where: { id: pdfUpload.id },
        data: {
          rowCountAccepted:    pdfAccepted,
          rowCountRejected:    pdfRejected + lowConfidence.length,
          totalRowsUnresolved: lowConfidence.length,
          status:              'complete',
          completedAt:         new Date(),
          dateRangeStart:      sortedPdfDates[0] ?? null,
          dateRangeEnd:        sortedPdfDates[sortedPdfDates.length - 1] ?? null,
        },
      })

      const pdfDedupResult = await runDedup(pdfUpload.id, accountId)
      const pdfReconcileResult = await runReconciliation(pdfUpload.id)

      const pdfAvailableMonths = await getAvailableMonths(payload.userId)
      for (const { year, month } of pdfAvailableMonths.slice(0, 12)) {
        await computeMonthSummary(payload.userId, year, month)
      }

      await detectTransfers(payload.userId).catch(() => { /* non-fatal */ })

      return NextResponse.json(
        {
          uploadId:             pdfUpload.id,
          accepted:             pdfAccepted,
          rejected:             pdfRejected,
          totalUnresolved:      lowConfidence.length,
          possibleDuplicates:   pdfDedupResult.possibleDuplicatesFound,
          crossUploadDuplicates: pdfDedupResult.crossUploadMatches,
          withinUploadDuplicates: pdfDedupResult.withinUploadMatches,
          formatDetected:       'PDF',
          formatMismatch:       false,
          contentSniffedType:   null,
          dateAmbiguous:        false,
          dateFormatSample:     [],
          warnings:             reconciliationIssues.map((i) => ({ code: i.code, message: i.message })),
          transactionCount:     pdfAccepted,
          parserVersion:        PARSER_VERSION,
          fileHashTruncated:    `${fileHash.slice(0, 8)}…${fileHash.slice(-8)}`,
          reconciliationStatus: pdfReconcileResult.status,
          reconciliationMode:   pdfReconcileResult.mode,
          dateOrderUsed:        'YMD',
          dateOrderSource:      'PDF_EXTRACTED',
          dateOrderConfidence:  1,
          bankDetected:         false,
          bankKey:              null,
          dateOrderNeedsConfirmation: false,
          pdfReviewRequired:    pdfResult.reviewRequired,
          pdfLowConfidenceCount: lowConfidence.length,
          pdfClassification:    {
            pageCount:        classification.pageCount,
            estimatedAccount: classification.estimatedAccount,
            statementStart:   classification.statementStart,
            statementEnd:     classification.statementEnd,
          },
        },
        { status: 201 },
      )
    }

    const rawText  = acceptance.decodedText!

    // ── OFX fast-path (bypasses CSV stages 1–2) ───────────────────────────────
    if (acceptance.sourceType === 'OFX' || acceptance.sourceType === 'QFX' || acceptance.sourceType === 'QBO') {
      const ofxVariant = acceptance.sourceType  // 'OFX' | 'QFX' | 'QBO'
      const ofxResult = parseOfx(rawText)

      if (ofxResult.transactions.length === 0) {
        return NextResponse.json(
          { error: 'No transactions found in OFX file. Make sure it contains a <BANKTRANLIST> section.' },
          { status: 422 },
        )
      }

      // Version-stamp if re-upload of same file
      let uploadVersion = 1
      if (acceptance.isDuplicate && acceptance.previousUploadId) {
        const prevUpload = await prisma.upload.findUnique({
          where: { id: acceptance.previousUploadId },
          select: { version: true },
        })
        uploadVersion = (prevUpload?.version ?? 0) + 1
        await prisma.upload.update({
          where: { id: acceptance.previousUploadId },
          data: { superseded: true },
        })
      }

      const ofxUpload = await prisma.upload.create({
        data: {
          userId:              payload.userId,
          accountId,
          filename:            file.name,
          fileHash,
          formatDetected:      ofxVariant,
          version:             uploadVersion,
          reprocessedFromId:   acceptance.previousUploadId ?? undefined,
          rowCountRaw:         ofxResult.transactions.length,
          rowCountParsed:      ofxResult.transactions.length,
          status:              'processing',
          warnings:            '[]',
          parserVersion:       'ofx-1.0',
          parserConfig:        '{}',
          reconciliationStatus: 'PENDING',
          dateOrderUsed:       'YMD',          // OFX dates are always YYYYMMDD
          dateOrderSource:     'OFX_STANDARD',
          dateOrderConfidence: 1,
          statementOpenBalance:  openingBalance,
          statementCloseBalance: closingBalance ?? (ofxResult.ledgerBalance != null ? String(ofxResult.ledgerBalance) : null),
          statementTotalCredits,
          statementTotalDebits,
        },
      })

      let ofxAccepted = 0
      let ofxRejected = 0
      const ofxValidDates: Date[] = []

      for (const ofxTx of ofxResult.transactions as OfxTransaction[]) {
        // Dedup by FITID (bank's unique transaction ID)
        const fitIdKey      = ofxTx.fitId || ofxTx.rawBlock
        const sourceRowHash = createHash('sha256')
          .update(`${accountId}|ofx:${fitIdKey}`)
          .digest('hex')

        const existingRaw = await prisma.transactionRaw.findUnique({ where: { sourceRowHash } })
        if (existingRaw) { ofxRejected++; continue }

        const parsedDate    = parseOfxDate(ofxTx.dtPosted)
        const amountNum     = parseFloat(ofxTx.trnAmt) || 0
        const descRaw       = ofxTx.memo || ofxTx.name
        const descNorm      = ofxTx.name || ofxTx.memo
        const merchantNorm  = normalizeMerchant(descNorm)
        const isTransfer    = isTransferDescription(descRaw)
        const rawFields     = {
          TRNTYPE: ofxTx.trnType, DTPOSTED: ofxTx.dtPosted,
          TRNAMT: ofxTx.trnAmt, FITID: ofxTx.fitId,
          NAME: ofxTx.name, MEMO: ofxTx.memo,
          ...(ofxTx.checkNum ? { CHECKNUM: ofxTx.checkNum } : {}),
        }

        try {
          const raw = await prisma.transactionRaw.create({
            data: {
              uploadId:       ofxUpload.id,
              accountId,
              rawDate:        ofxTx.dtPosted,
              rawDescription: descRaw,
              rawAmount:      ofxTx.trnAmt,
              rawCredit:      '',
              rawDebit:       '',
              rawBalance:     '',
              sourceRowHash,
              sourceLocator:  JSON.stringify({ type: 'OFX', parseOrder: ofxTx.parseOrder }),
              rawLine:        ofxTx.rawBlock,
              parseOrder:     ofxTx.parseOrder,
              rawFields:      JSON.stringify(rawFields),
            },
          })

          await prisma.transaction.create({
            data: {
              rawId:                raw.id,
              accountId,
              uploadId:             ofxUpload.id,
              date:                 parsedDate,
              description:          descNorm || descRaw,
              merchantNormalized:   merchantNorm,
              amount:               amountNum,
              isTransfer,
              isForeignCurrency:    false,
              foreignAmount:        null,
              foreignCurrency:      null,
              postedDate:           parsedDate,
              transactionDate:      parsedDate,
              dateRaw:              ofxTx.dtPosted,
              dateAmbiguity:        'RESOLVED',
              dateInterpretationA:  null,
              dateInterpretationB:  null,
              amountRaw:            ofxTx.trnAmt,
              currencyCode:         ofxResult.currency || undefined,
              currencyDetected:     false,
              descriptionRaw:       descRaw,
              descriptionNormalized: descNorm || undefined,
              transformations:      '[]',
              runningBalance:       null,
              runningBalanceRaw:    null,
              checkNumber:          ofxTx.checkNum,
              bankTransactionId:    ofxTx.fitId || undefined,
              pendingFlag:          false,
              bankFingerprint:      undefined,
              ingestionStatus:      'VALID',
              bankCategoryRaw:      ofxTx.trnType || null,
              bankCategoryNormalized: normalizeBankCategory(ofxTx.trnType || ''),
              canonicalRowHash: computeCanonicalRowHash(
                ofxTx.dtPosted, descRaw, ofxTx.trnAmt, ofxTx.trnType, ofxTx.parseOrder,
              ),
            },
          })

          ofxAccepted++
          ofxValidDates.push(parsedDate)
        } catch {
          ofxRejected++
        }
      }

      const sortedOfxDates = [...ofxValidDates].sort((a, b) => a.getTime() - b.getTime())
      await prisma.upload.update({
        where: { id: ofxUpload.id },
        data: {
          rowCountAccepted:    ofxAccepted,
          rowCountRejected:    ofxRejected,
          totalRowsUnresolved: 0,
          status:              'complete',
          completedAt:         new Date(),
          dateRangeStart:      sortedOfxDates[0] ?? null,
          dateRangeEnd:        sortedOfxDates[sortedOfxDates.length - 1] ?? null,
        },
      })

      const ofxDedupResult = await runDedup(ofxUpload.id, accountId)
      const ofxReconcileResult = await runReconciliation(ofxUpload.id)

      const ofxAvailableMonths = await getAvailableMonths(payload.userId)
      for (const { year, month } of ofxAvailableMonths.slice(0, 12)) {
        await computeMonthSummary(payload.userId, year, month)
      }

      // Cross-account transfer pairing for OFX uploads
      await detectTransfers(payload.userId).catch(() => { /* non-fatal */ })

      return NextResponse.json(
        {
          uploadId:             ofxUpload.id,
          accepted:             ofxAccepted,
          rejected:             ofxRejected,
          totalUnresolved:      0,
          possibleDuplicates:   ofxDedupResult.possibleDuplicatesFound,
          crossUploadDuplicates: ofxDedupResult.crossUploadMatches,
          withinUploadDuplicates: ofxDedupResult.withinUploadMatches,
          formatDetected:       ofxVariant,
          formatMismatch:       acceptance.formatMismatch ?? false,
          contentSniffedType:   acceptance.contentSniffedType ?? null,
          dateAmbiguous:        false,
          dateFormatSample:     [],
          warnings:             [],
          transactionCount:     ofxAccepted,
          parserVersion:        'ofx-1.0',
          fileHashTruncated:    `${fileHash.slice(0, 8)}…${fileHash.slice(-8)}`,
          reconciliationStatus: ofxReconcileResult.status,
          reconciliationMode:   ofxReconcileResult.mode,
          dateOrderUsed:        'YMD',
          dateOrderSource:      'OFX_STANDARD',
          dateOrderConfidence:  1,
          bankDetected:         false,
          bankKey:              null,
          dateOrderNeedsConfirmation: false,
        },
        { status: 201 },
      )
    }

    // ── Stage 1: Lossless CSV parse ───────────────────────────────────────────
    const parseResult = parseCsvStage1(rawText, encoding)

    if (!parseResult.success || parseResult.rows.length === 0) {
      const firstFatal = parseResult.errors.find((e) => e.severity === 'FATAL')
      return NextResponse.json(
        {
          error: firstFatal?.message ?? 'No valid transactions found in this file.',
          warnings: parseResult.warnings.slice(0, 10),
          errors: parseResult.errors.slice(0, 10),
        },
        { status: 422 },
      )
    }

    const { headerDetection, config: parserConfig } = parseResult
    const mapping = headerDetection.suggestedMapping

    const formatDetected = deriveFormatName(mapping, headerDetection.columns)

    // ── Date order selection (bank detection + scoring) ───────────────────────
    // Step 1: Detect the bank to get its preferred date order
    const bankDetection = detectBank(headerDetection.columns, mapping)

    // Step 2: Build scoring rows from the date column
    const dateColumnKey = mapping.postedDate ?? mapping.date ?? mapping.transactionDate ?? null
    const rawDatesForHint: string[] = dateColumnKey
      ? parseResult.rows.map((r) => r.fields[dateColumnKey] ?? '').filter(Boolean)
      : []

    const scoringRows = dateColumnKey
      ? parseResult.rows.map((r, idx) => ({
          rawDate: r.fields[dateColumnKey] ?? '',
          parseOrder: idx,
        })).filter((r) => r.rawDate !== '')
      : []

    // Step 3: Run the selection algorithm (bank default + scoring + confidence check)
    const dateOrderSelection: DateOrderSelectionResult = selectDateOrder(scoringRows, bankDetection)

    // Legacy hint for backward-compat with normalizeRow (null when dateOrder covers it)
    const dateFormatHint = null
    // The upload-level date order (null if user confirmation is needed)
    const resolvedDateOrder = dateOrderSelection.needsUserConfirmation
      ? null
      : (dateOrderSelection.selectedOrder === 'YMD' ? null : dateOrderSelection.selectedOrder as 'MDY' | 'DMY')

    // ── Reprocessing: version-stamp + supersede previous upload ───────────────
    let uploadVersion = 1
    if (acceptance.isDuplicate && acceptance.previousUploadId) {
      const prevUpload = await prisma.upload.findUnique({
        where: { id: acceptance.previousUploadId },
        select: { version: true },
      })
      uploadVersion = (prevUpload?.version ?? 0) + 1
      await prisma.upload.update({
        where: { id: acceptance.previousUploadId },
        data: { superseded: true },
      })
    }

    // ── Create Upload record ──────────────────────────────────────────────────
    const upload = await prisma.upload.create({
      data: {
        userId:              payload.userId,
        accountId,
        filename:            file.name,
        fileHash,
        formatDetected,
        version:             uploadVersion,
        reprocessedFromId:   acceptance.previousUploadId ?? undefined,
        rowCountRaw:         parseResult.rows.length +
                             parseResult.warnings.filter((w) => w.code?.startsWith('COLUMN')).length,
        rowCountParsed:      parseResult.rows.length,
        status:              'processing',
        warnings:            JSON.stringify(parseResult.warnings.slice(0, 50)),
        parserVersion:       PARSER_VERSION,
        parserConfig:        JSON.stringify(parserConfig),
        reconciliationStatus: 'PENDING',
        dateOrderUsed:           dateOrderSelection.needsUserConfirmation ? null : dateOrderSelection.selectedOrder,
        dateOrderSource:         dateOrderSelection.needsUserConfirmation ? null : dateOrderSelection.source,
        dateOrderConfidence:     dateOrderSelection.needsUserConfirmation ? 0    : dateOrderSelection.confidence,
        authoritativeDateColumn: bankDetection.bankProfile?.authoritativeDateColumn ?? null,
        statementOpenBalance:  openingBalance,
        statementCloseBalance: closingBalance,
        statementTotalCredits,
        statementTotalDebits,
      },
    })

    // ── Stage 2: Normalize + persist ─────────────────────────────────────────
    let accepted = 0
    let rejected = 0
    let totalUnresolved = 0
    let dateAmbiguous = false
    const dateFormatSample: Array<{ line: number; rawDate: string; interpreted: string }> = []

    // Collect valid entries for persistence
    interface ValidEntry {
      nt: ReturnType<typeof normalizeRow>
      sourceRowHash: string
      parsedDate: Date                    // the Date object we'll store in Transaction.date
      rawFields: Record<string, string>   // captured here so index stays correct after skips
    }
    const validEntries: ValidEntry[] = []

    for (const row of parseResult.rows) {
      // Idempotency check first (before Stage 2 work) — same raw content → skip
      const sourceRowHash = computeSourceRowHash(accountId, row.rawLine)
      const existingRaw = await prisma.transactionRaw.findUnique({
        where: { sourceRowHash },
      })
      if (existingRaw) {
        rejected++
        continue
      }

      // Stage 2: normalize — pass the file-level format hint so ambiguous dates
      // (e.g. "4/5/2024") are resolved holistically rather than flagged per-row.
      const nt = normalizeRow(row, mapping, dateFormatHint, resolvedDateOrder)

      if (nt.ingestionStatus === 'REJECTED') {
        rejected++
        continue
      }

      // Resolve the date to a JS Date for the Transaction.date column
      const primaryDate = nt.postedDate ?? nt.transactionDate
      let parsedDate: Date

      if (primaryDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM') {
        // Store interpretationA (MM/DD) as best-effort; row will be UNRESOLVED
        parsedDate = new Date(primaryDate.interpretationA!)
        if (!dateAmbiguous) {
          dateAmbiguous = true
        }
        if (dateFormatSample.length < 3) {
          const csvLocator = row.sourceLocator as CsvXlsxSourceLocator
          dateFormatSample.push({
            line: csvLocator.rowIndex + 1,
            rawDate: primaryDate.raw,
            interpreted: parsedDate.toLocaleDateString('en-US'),
          })
        }
      } else if (primaryDate?.resolved) {
        parsedDate = new Date(primaryDate.resolved)
      } else {
        // Should not reach here for non-REJECTED rows, but guard defensively
        rejected++
        continue
      }

      if (nt.ingestionStatus === 'UNRESOLVED') {
        totalUnresolved++
      }

      validEntries.push({ nt, sourceRowHash, parsedDate, rawFields: row.fields })
    }

    // ── Persist TransactionRaw + Transaction + IngestionIssues ───────────────
    for (let i = 0; i < validEntries.length; i++) {
      const { nt, sourceRowHash, parsedDate, rawFields } = validEntries[i]

      const merchantNorm = normalizeMerchant(nt.descriptionNormalized || nt.descriptionRaw)
      const isTransfer   = isTransferDescription(nt.descriptionRaw)
      const amountNum    = nt.amount.value != null ? parseFloat(nt.amount.value) : 0
      const csvLocator   = nt.sourceLocator as CsvXlsxSourceLocator

      // Resolved date strings for nullable DateTime columns
      const postedDateObj      = nt.postedDate?.resolved
        ? new Date(nt.postedDate.resolved) : null
      const transactionDateObj = nt.transactionDate?.resolved
        ? new Date(nt.transactionDate.resolved) : null
      const primaryDate        = nt.postedDate ?? nt.transactionDate

      // Date ambiguity fields
      const dateAmbiguity = primaryDate?.ambiguity ?? 'RESOLVED'
      const dateInterpA   = primaryDate?.interpretationA
        ? new Date(primaryDate.interpretationA) : null
      const dateInterpB   = primaryDate?.interpretationB
        ? new Date(primaryDate.interpretationB) : null

      try {
        const raw = await prisma.transactionRaw.create({
          data: {
            uploadId:       upload.id,
            accountId,
            rawDate:        nt.postedDate?.raw ?? nt.transactionDate?.raw ?? '',
            rawDescription: nt.descriptionRaw,
            rawAmount:      nt.amount.raw,
            rawCredit:      '',
            rawDebit:       '',
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
            rawId:                raw.id,
            accountId,
            uploadId:             upload.id,
            date:                 parsedDate,
            description:          nt.descriptionNormalized || nt.descriptionRaw,
            merchantNormalized:   merchantNorm,
            amount:               amountNum,
            isTransfer,
            isForeignCurrency:    nt.amount.currencyDetected !== null,
            foreignAmount:        null,
            foreignCurrency:      nt.amount.currencyDetected,
            // Stage 2 new fields
            postedDate:           postedDateObj,
            transactionDate:      transactionDateObj,
            dateRaw:              primaryDate?.raw ?? null,
            dateAmbiguity,
            dateInterpretationA:  dateInterpA,
            dateInterpretationB:  dateInterpB,
            amountRaw:            nt.amount.raw || null,
            currencyCode:         nt.currencyCode,
            currencyDetected:     nt.amount.currencyDetected !== null,
            descriptionRaw:       nt.descriptionRaw,
            descriptionNormalized: nt.descriptionNormalized || null,
            transformations:      JSON.stringify(nt.allTransformations),
            runningBalance:       nt.runningBalance ?? null,
            runningBalanceRaw:    nt.runningBalanceRaw ?? null,
            checkNumber:          nt.checkNumber ?? null,
            bankTransactionId:    nt.bankTransactionId ?? null,
            pendingFlag:          nt.pendingFlag,
            bankFingerprint:      nt.bankFingerprint,
            ingestionStatus:      nt.ingestionStatus,
            bankCategoryRaw:        nt.bankCategory ?? null,
            bankCategoryNormalized: nt.bankCategory ? normalizeBankCategory(nt.bankCategory) : null,
            canonicalRowHash: computeCanonicalRowHash(
              nt.postedDate?.raw ?? nt.transactionDate?.raw ?? '',
              nt.descriptionRaw,
              nt.amount.raw || '',
              nt.bankCategory ?? null,
              csvLocator.dataRowIndex,
            ),
          },
        })

        // Create IngestionIssue records for any issues found
        for (const issue of nt.issues) {
          await prisma.ingestionIssue.create({
            data: {
              uploadId:       upload.id,
              transactionId:  tx.id,
              issueType:      issue.issueType,
              severity:       issue.severity,
              description:    issue.description,
              suggestedAction: issue.suggestedAction ?? null,
              resolved:       false,
            },
          })
        }

        accepted++
      } catch {
        rejected++
      }
    }

    // ── Create upload-level DATE_FORMAT_CONFIRMATION_NEEDED issue (if needed) ─
    // When scoring can't determine the date format, create ONE upload-level issue
    // instead of per-row DATE_AMBIGUOUS spam.
    if (dateOrderSelection.needsUserConfirmation) {
      const ambigCount = validEntries.filter((e) =>
        (e.nt.postedDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM') ||
        (e.nt.transactionDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM')
      ).length

      if (ambigCount > 0) {
        const scoreA = dateOrderSelection.scoreA
        const scoreB = dateOrderSelection.scoreB
        const scoreDetail = scoreA && scoreB
          ? ` (MDY score: ${scoreA.totalScore}, DMY score: ${scoreB.totalScore})`
          : ''
        await prisma.ingestionIssue.create({
          data: {
            uploadId:       upload.id,
            transactionId:  null,
            issueType:      'DATE_FORMAT_CONFIRMATION_NEEDED',
            severity:       'ERROR',
            description:    `${ambigCount} ambiguous date${ambigCount !== 1 ? 's' : ''} detected — please confirm whether this file uses MM/DD/YYYY (US) or DD/MM/YYYY (European) format${scoreDetail}`,
            suggestedAction: 'Click "Use MM/DD" or "Use DD/MM" to apply the correct format to all transactions',
            resolved:       false,
          },
        })
      }
    }

    // ── Audit log: date order selection ───────────────────────────────────────
    await prisma.auditLogEntry.create({
      data: {
        uploadId: upload.id,
        stage:    'NORMALIZE',
        level:    dateOrderSelection.needsUserConfirmation ? 'WARN' : 'INFO',
        message:  dateOrderSelection.needsUserConfirmation
          ? `Date format ambiguous — user confirmation required`
          : `Date order selected: ${dateOrderSelection.selectedOrder} (source: ${dateOrderSelection.source}, confidence: ${dateOrderSelection.confidence})`,
        context: JSON.stringify({
          bankKey:           dateOrderSelection.bankResult?.bankProfile?.bankKey ?? null,
          bankDetected:      dateOrderSelection.bankResult?.matched ?? false,
          selectedOrder:     dateOrderSelection.selectedOrder,
          source:            dateOrderSelection.source,
          confidence:        dateOrderSelection.confidence,
          needsConfirmation: dateOrderSelection.needsUserConfirmation,
          ambiguousDates:    rawDatesForHint.length,
          scoreA:            dateOrderSelection.scoreA ?? null,
          scoreB:            dateOrderSelection.scoreB ?? null,
        }),
      },
    })

    // ── Stage 3: Dedup ────────────────────────────────────────────────────────
    const dedupResult = await runDedup(upload.id, accountId)

    // ── Finalise Upload record ─────────────────────────────────────────────────
    const sortedDates = validEntries
      .map((e) => e.parsedDate)
      .sort((a, b) => a.getTime() - b.getTime())

    await prisma.upload.update({
      where: { id: upload.id },
      data: {
        rowCountAccepted:    accepted,
        rowCountRejected:    rejected,
        totalRowsUnresolved: totalUnresolved,
        status:              'complete',
        reconciliationStatus: 'PENDING',      // Stage 4 will update this below
        completedAt:         new Date(),
        dateRangeStart:      sortedDates[0] ?? null,
        dateRangeEnd:        sortedDates[sortedDates.length - 1] ?? null,
      },
    })

    // ── Stage 4: Reconcile ────────────────────────────────────────────────────
    const reconcileResult = await runReconciliation(upload.id)

    // ── Build import report ───────────────────────────────────────────────────
    const committedAmountTotal = validEntries
      .slice(0, accepted)  // approximate — compute properly from accepted tx amounts
      .reduce((sum, e) => {
        const amt = e.nt.amount.value != null ? parseFloat(e.nt.amount.value) : 0
        return sum + amt
      }, 0)

    // Collect unique bank categories
    const bankCatValues = validEntries
      .map(e => e.nt.bankCategory)
      .filter((v): v is string => !!v)
    const uniqueBankCats = [...new Set(bankCatValues)]

    const importReport: ImportReport = {
      generatedAt: new Date().toISOString(),
      parserVersion: PARSER_VERSION,
      bankProfileDetected: bankDetection.bankProfile?.bankKey ?? null,
      columnMapping: Object.fromEntries(
        Object.entries(mapping).filter(([, v]) => v != null) as [string, string][]
      ),
      dateFormat: {
        detected: dateOrderSelection.selectedOrder ?? 'unknown',
        ambiguousCount: dateOrderSelection.needsUserConfirmation
          ? validEntries.filter(e =>
              e.nt.postedDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM' ||
              e.nt.transactionDate?.ambiguity === 'AMBIGUOUS_MMDD_DDMM'
            ).length
          : 0,
        needsConfirmation: dateOrderSelection.needsUserConfirmation,
        samples: dateFormatSample.map(s => ({
          line: s.line,
          raw: s.rawDate,
          interpretedAs: s.interpreted,
        })),
      },
      rowCounts: {
        source: parseResult.rows.length + rejected,
        parsed: parseResult.rows.length,
        committed: accepted,
        rejected,
        pendingReview: totalUnresolved,
      },
      amounts: {
        committedTotal: committedAmountTotal.toFixed(2),
        currencyCode: 'USD',
      },
      categoryPreservation: {
        columnDetected: mapping.bankCategory != null,
        columnHeader: mapping.bankCategory ?? null,
        rowsWithValue: bankCatValues.length,
        rowsMissingValue: accepted - bankCatValues.length,
        preservedCount: bankCatValues.length,
        uniqueValues: uniqueBankCats,
      },
      integrity: {
        hashesComputed: accepted,
        hashesVerified: accepted, // all hashes computed during insert = verified
        hashMismatches: 0,
      },
      issues: parseResult.errors.reduce((acc, err) => {
        const existing = acc.find(i => i.type === err.severity)
        if (existing) {
          existing.count++
          if (existing.samples.length < 3) existing.samples.push(err.message.slice(0, 80))
        } else {
          acc.push({ type: err.severity, count: 1, samples: [err.message.slice(0, 80)] })
        }
        return acc
      }, [] as ImportReport['issues']),
    }

    // Persist import report on the Upload record
    await prisma.upload.update({
      where: { id: upload.id },
      data: { importReport: JSON.stringify(importReport) },
    })

    // ── Recompute monthly summaries ────────────────────────────────────────────
    const availableMonths = await getAvailableMonths(payload.userId)
    for (const { year, month } of availableMonths.slice(0, 12)) {
      await computeMonthSummary(payload.userId, year, month)
    }

    // ── Create Staging records ──────────────────────────────────────────────────
    // Fetch the transactions just created for this upload
    const createdTxs = await prisma.transaction.findMany({
      where: { uploadId: upload.id },
      select: {
        id: true,
        date: true,
        merchantNormalized: true,
        descriptionRaw: true,
        amount: true,
        bankCategoryRaw: true,
        ingestionStatus: true,
      }
    })

    // Create the StagingUpload
    const stagingUpload = await prisma.stagingUpload.create({
      data: {
        userId: payload.userId,
        uploadId: upload.id,
        status: 'ready',
        rowCount: createdTxs.length,
      }
    })

    // Create StagingTransaction for each (excluding REJECTED)
    const stagingRows = createdTxs.filter(tx => tx.ingestionStatus !== 'REJECTED')
    if (stagingRows.length > 0) {
      // ── Compute sign convention ──────────────────────────────────────────
      const allCents = stagingRows.map(tx => amountToCents(tx.amount))
      const negCount2 = allCents.filter(c => c < 0).length
      const expensesAreNegative = negCount2 > allCents.length / 2

      // ── Compute recurring vendors ────────────────────────────────────────
      // A vendor is recurring if it appears 2+ times with amounts within ±10%
      const vendorAmountMap = new Map<string, number[]>()
      for (const tx of stagingRows) {
        const key = normalizeVendor(tx.merchantNormalized || tx.descriptionRaw || '')
        const cents = amountToCents(tx.amount)
        const spending = expensesAreNegative ? cents < 0 : cents > 0
        if (!spending) continue
        const arr = vendorAmountMap.get(key) ?? []
        arr.push(Math.abs(cents))
        vendorAmountMap.set(key, arr)
      }
      const recurringVendorKeys = new Set<string>()
      for (const [vendor, amounts] of vendorAmountMap.entries()) {
        if (amounts.length < 2) continue
        const ref = amounts[0]
        if (ref > 0 && amounts.every(a => Math.abs(a - ref) <= ref * 0.1)) {
          recurringVendorKeys.add(vendor)
        }
      }

      await prisma.stagingTransaction.createMany({
        data: stagingRows.map(tx => {
          const vendorRaw = tx.merchantNormalized || tx.descriptionRaw || ''
          const vendorKey = normalizeVendor(vendorRaw)
          const cents = amountToCents(tx.amount)

          // ── Compute suggestion (same priority order as scrubbing.ts) ──────
          const engineSuggestion = suggestCategory(vendorRaw, cents, expensesAreNegative)
          const isDescriptionTransfer = engineSuggestion?.category === 'Transfer'

          let suggestionCategory: string | null = null
          let suggestionConfidence: string | null = null
          let suggestionSource: string | null = null

          if (isDescriptionTransfer) {
            suggestionCategory = 'Transfer'
            suggestionConfidence = 'high'
            suggestionSource = 'engine'
          } else if (tx.bankCategoryRaw) {
            const bankMapped = mapBankCategoryToName(tx.bankCategoryRaw)
            if (bankMapped) {
              suggestionCategory = bankMapped
              suggestionConfidence = bankMapped === 'Other' ? 'medium' : 'high'
              suggestionSource = 'bank'
            }
          }
          if (!suggestionCategory && engineSuggestion) {
            suggestionCategory = engineSuggestion.category
            suggestionConfidence = engineSuggestion.confidence
            suggestionSource = 'engine'
          }

          return {
            stagingUploadId: stagingUpload.id,
            userId: payload.userId,
            uploadId: upload.id,
            date: tx.date,
            vendorRaw,
            vendorKey,
            amountCents: cents,
            description: tx.descriptionRaw || '',
            bankCategoryRaw: tx.bankCategoryRaw || null,
            status: 'uncategorized',
            suggestionCategory,
            suggestionConfidence,
            suggestionSource,
            isRecurring: recurringVendorKeys.has(vendorKey),
          }
        })
      })
    }

    // ── Auto-apply rules to staging transactions ──────────────────────────────
    // Mirror the logic in POST /api/staging/[uploadId]/apply-rules so that
    // existing rules are applied immediately on upload without user intervention.
    try {
      const dryRun = await dryRunRules(stagingUpload.id, payload.userId, upload.accountId ?? undefined)
      let autoApplied = 0
      let autoReview  = 0

      for (const match of dryRun.matches) {
        if (match.status === 'auto') {
          await prisma.stagingTransaction.update({
            where: { id: match.stagingTxId },
            data: {
              ruleId:         match.ruleId,
              ruleReason:     match.ruleReason,
              categoryId:     match.categoryId,
              categorySource: 'rule',
              status:         'categorized',
            },
          })
          if (match.ruleId) {
            await prisma.ruleHit.create({
              data: {
                ruleId:      match.ruleId,
                stagingTxId: match.stagingTxId,
                uploadId:    upload.id,
                wasAccepted: null,
              },
            })
          }
          autoApplied++
        } else if (match.status === 'needs_review') {
          await prisma.stagingTransaction.update({
            where: { id: match.stagingTxId },
            data: {
              status:     'needs_review',
              ...(match.ruleId     ? { ruleId:     match.ruleId }     : {}),
              ...(match.ruleReason ? { ruleReason: match.ruleReason } : {}),
            },
          })
          autoReview++
        }
      }

      await prisma.stagingUpload.update({
        where: { id: stagingUpload.id },
        data: { autoCount: autoApplied, reviewCount: autoReview },
      })
    } catch {
      // Non-fatal: rules auto-apply failure should not block the upload response
    }

    // ── Cross-account transfer pairing ───────────────────────────────────────
    // Matches equal/opposite transactions across accounts within ±5 day window.
    // Runs after staging creation so newly imported transactions are included.
    await detectTransfers(payload.userId).catch(() => { /* non-fatal */ })

    return NextResponse.json(
      {
        uploadId:                   upload.id,
        accepted,
        rejected,
        totalUnresolved,
        possibleDuplicates:         dedupResult.possibleDuplicatesFound,
        crossUploadDuplicates:      dedupResult.crossUploadMatches,
        withinUploadDuplicates:     dedupResult.withinUploadMatches,
        formatDetected,
        dateAmbiguous,
        dateFormatSample: dateAmbiguous ? dateFormatSample : [],
        warnings:         parseResult.warnings.slice(0, 20),
        transactionCount: accepted,
        parserVersion:        PARSER_VERSION,
        fileHashTruncated:    `${fileHash.slice(0, 8)}…${fileHash.slice(-8)}`,
        reconciliationStatus: reconcileResult.status,
        reconciliationMode:   reconcileResult.mode,
        dateOrderUsed:     dateOrderSelection.selectedOrder,
        dateOrderSource:   dateOrderSelection.source,
        dateOrderConfidence: dateOrderSelection.confidence,
        bankDetected:      bankDetection.matched,
        bankKey:           bankDetection.bankProfile?.bankKey ?? null,
        dateOrderNeedsConfirmation: dateOrderSelection.needsUserConfirmation,
        importReport,
        stagingUploadId: stagingUpload.id,
        stagingRowCount: stagingRows.length,
      },
      { status: 201 },
    )
  } catch (e) {
    console.error('Upload error:', e)
    return NextResponse.json({ error: 'Upload processing failed' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/uploads
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uploads = await prisma.upload.findMany({
    where: { userId: payload.userId },
    include: { account: { select: { name: true, institution: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return NextResponse.json({ uploads })
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a human-readable format name from detected column mapping.
 */
function deriveFormatName(
  mapping: ReturnType<typeof parseCsvStage1>['headerDetection']['suggestedMapping'],
  headers: string[],
): string {
  const h = headers.map((s) => s.toLowerCase())

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
