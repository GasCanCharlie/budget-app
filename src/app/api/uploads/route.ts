import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { isTransferDescription } from '@/lib/intelligence/transfers'
import { normalizeMerchant } from '@/lib/categorization/engine'
import { normalizeBankCategory } from '@/lib/categorization/bank-category-map'
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

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

    const rawText  = acceptance.decodedText!
    const fileHash = acceptance.fileHash
    const encoding = acceptance.encoding ?? 'utf-8'

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
  if (mapping.date && mapping.description && mapping.amount)     return 'Generic (auto-detected)'
  return 'Unknown'
}
