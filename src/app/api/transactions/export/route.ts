import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { format } from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// CSV helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Escape a single CSV field value per RFC 4180. */
function csvField(value: string | number | boolean | null | undefined): string {
  if (value == null) return ''
  const s = String(value)
  // Quote if the value contains a comma, double-quote, newline, or carriage return
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function csvRow(fields: (string | number | boolean | null | undefined)[]): string {
  return fields.map(csvField).join(',')
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transactions/export
//
// Exports all matching transactions as a CSV file.
// Accepts the same filter params as GET /api/transactions:
//   year, month, category, search, ingestionFilter
// No pagination — returns ALL matching rows (up to 50 000).
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year            = searchParams.get('year')            ? parseInt(searchParams.get('year')!)    : null
  const month           = searchParams.get('month')           ? parseInt(searchParams.get('month')!)   : null
  const category        = searchParams.get('category')        || null
  const search          = searchParams.get('search')          || null
  const ingestionFilter = searchParams.get('ingestionFilter') || null

  const where: Record<string, unknown> = {
    account: { userId: payload.userId },
    isExcluded: false,
  }

  if (year && month) {
    const start = new Date(year, month - 1, 1)
    const end   = new Date(year, month, 0, 23, 59, 59)
    where['date'] = { gte: start, lte: end }
  }

  if (category) {
    where['OR'] = [
      { categoryId: category },
      { userOverrideCategoryId: category },
    ]
  }

  if (search) {
    where['OR'] = [
      { description: { contains: search } },
      { merchantNormalized: { contains: search } },
    ]
  }

  if (ingestionFilter === 'flagged') {
    where['ingestionStatus'] = { in: ['UNRESOLVED', 'WARNING'] }
  } else if (ingestionFilter === 'duplicate') {
    where['isPossibleDuplicate'] = true
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const transactions = await prisma.transaction.findMany({
    where: where as never,
    include: {
      category:         { select: { name: true } },
      overrideCategory: { select: { name: true } },
      account:          { select: { name: true } },
      upload:           { select: { filename: true } },
    },
    orderBy: { date: 'desc' },
    take: 50_000,
  })

  // ── Build CSV ──────────────────────────────────────────────────────────────

  const HEADER = csvRow([
    'Date',
    'Description',
    'Original Description',
    'Amount',
    'Currency',
    'Type',
    'Category',
    'Categorization Source',
    'Account',
    'Upload File',
    'Ingestion Status',
    'Is Pending',
    'Is Transfer',
    'Is Foreign Currency',
    'Foreign Currency',
    'Running Balance',
    'Check Number',
    'Bank Transaction ID',
  ])

  const rows = transactions.map(tx => {
    const effectiveCat = (tx.overrideCategory ?? tx.category)?.name ?? ''
    const type = tx.isTransfer ? 'transfer' : tx.amount >= 0 ? 'income' : 'expense'
    const source = tx.userOverrideCategoryId ? 'user' : tx.categorizationSource

    return csvRow([
      format(new Date(tx.date), 'yyyy-MM-dd'),
      tx.merchantNormalized || tx.description,
      tx.descriptionRaw,
      tx.amount.toFixed(2),
      tx.currencyCode,
      type,
      effectiveCat,
      source,
      tx.account?.name ?? '',
      tx.upload?.filename ?? '',
      tx.ingestionStatus,
      tx.pendingFlag,
      tx.isTransfer,
      tx.isForeignCurrency,
      tx.foreignCurrency ?? '',
      tx.runningBalance ?? '',
      tx.checkNumber ?? '',
      tx.bankTransactionId ?? '',
    ])
  })

  const csvBody = [HEADER, ...rows].join('\r\n')

  // ── Filename ───────────────────────────────────────────────────────────────

  let filenameSuffix = 'all'
  if (year && month) filenameSuffix = `${year}-${String(month).padStart(2, '0')}`
  else if (year)     filenameSuffix = String(year)
  const filename = `budgetlens-transactions-${filenameSuffix}.csv`

  return new NextResponse(csvBody, {
    status: 200,
    headers: {
      'Content-Type':        'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control':       'no-store',
    },
  })
}
