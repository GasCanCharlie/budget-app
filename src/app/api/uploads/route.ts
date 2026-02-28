import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { categorizeBatch } from '@/lib/categorization/engine'
import { isTransferDescription } from '@/lib/intelligence/transfers'
import { normalizeMerchant } from '@/lib/categorization/engine'
import { computeMonthSummary, getAvailableMonths } from '@/lib/intelligence/summaries'
import { acceptFile } from '@/lib/ingestion/stage0-acceptance'
import { parseCsvStage1, PARSER_VERSION } from '@/lib/ingestion/stage1-parse-csv'
import { normalizeRow } from '@/lib/ingestion/stage2-normalize'
import { runDedup } from '@/lib/ingestion/stage3-dedup'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'
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
      const status = acceptance.isDuplicate ? 409 : 422
      return NextResponse.json(
        {
          error: acceptance.rejectionReason,
          ...(acceptance.isDuplicate && { uploadId: acceptance.existingUploadId }),
        },
        { status },
      )
    }

    const rawText  = acceptance.decodedText!
    const fileHash = acceptance.fileHash
    const encoding = acceptance.encoding ?? 'utf-8'

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

    // ── Create Upload record ──────────────────────────────────────────────────
    const upload = await prisma.upload.create({
      data: {
        userId:              payload.userId,
        accountId,
        filename:            file.name,
        fileHash,
        formatDetected,
        rowCountRaw:         parseResult.rows.length +
                             parseResult.warnings.filter((w) => w.code?.startsWith('COLUMN')).length,
        rowCountParsed:      parseResult.rows.length,
        status:              'processing',
        warnings:            JSON.stringify(parseResult.warnings.slice(0, 50)),
        parserVersion:       PARSER_VERSION,
        parserConfig:        JSON.stringify(parserConfig),
        reconciliationStatus: 'PENDING',
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

    // Collect inputs for batch categorisation (only for non-rejected rows)
    interface ValidEntry {
      nt: ReturnType<typeof normalizeRow>
      sourceRowHash: string
      parsedDate: Date                    // the Date object we'll store in Transaction.date
      rawFields: Record<string, string>   // captured here so index stays correct after skips
    }
    const validEntries: ValidEntry[] = []
    const txInputs: { description: string; amount: number }[] = []

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

      // Stage 2: normalize
      const nt = normalizeRow(row, mapping)

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
      txInputs.push({
        description: nt.descriptionRaw,
        amount:      nt.amount.value != null ? parseFloat(nt.amount.value) : 0,
      })
    }

    // ── Batch categorise ──────────────────────────────────────────────────────
    const categories = await categorizeBatch(txInputs, payload.userId)

    // ── Persist TransactionRaw + Transaction + IngestionIssues ───────────────
    for (let i = 0; i < validEntries.length; i++) {
      const { nt, sourceRowHash, parsedDate, rawFields } = validEntries[i]
      const cat = categories[i]

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
            categoryId:           cat.categoryId,
            categorizationSource: cat.source,
            confidenceScore:      cat.confidence,
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
        reconciliationStatus: reconcileResult.status,
        reconciliationMode:   reconcileResult.mode,
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
