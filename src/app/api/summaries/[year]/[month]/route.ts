import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { computeMonthSummary, getAvailableMonths, getRollingAverages } from '@/lib/intelligence/summaries'

export async function GET(
  req: NextRequest,
  { params }: { params: { year: string; month: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const year  = parseInt(params.year)
  const month = parseInt(params.month)

  // Issue 14: guard NaN and reject obviously out-of-range values
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year/month' }, { status: 400 })
  }

  // ── Strict Mode Gate ───────────────────────────────────────────────────────
  // Financial analysis only runs on fully-structured datasets.
  // If ANY transactions in this month are uncategorized, block analysis and
  // return categorization_required state with minimal metadata.
  const monthStart = new Date(year, month - 1, 1)
  const monthEnd   = new Date(year, month, 0, 23, 59, 59, 999)

  const txBaseWhere = {
    account:    { userId: payload.userId },
    date:       { gte: monthStart, lte: monthEnd },
    isTransfer: false,
    isExcluded: false,
    isDuplicate: false,
    amount:     { not: 0 },
  }

  const [totalCount, uncategorizedCount, availableMonths] = await Promise.all([
    prisma.transaction.count({ where: txBaseWhere }),
    prisma.transaction.count({ where: { ...txBaseWhere, appCategory: null } }),
    getAvailableMonths(payload.userId),
  ])

  if (uncategorizedCount > 0) {
    // Minimal metadata for the gate UI
    const boundary = await prisma.transaction.aggregate({
      where:  txBaseWhere,
      _min:   { date: true },
      _max:   { date: true },
    })
    const accounts = await prisma.account.findMany({
      where:   { userId: payload.userId },
      select:  { name: true },
      take:    3,
    })

    return NextResponse.json({
      dashboardState:     'categorization_required',
      uncategorizedCount,
      totalCount,
      categorizedCount:   totalCount - uncategorizedCount,
      dateRangeStart:     boundary._min.date ?? null,
      dateRangeEnd:       boundary._max.date ?? null,
      accountNames:       accounts.map(a => a.name),
      availableMonths,
      rolling:            null,
      summary:            null,
    })
  }

  // ── Analysis Unlocked — full computation ───────────────────────────────────
  const existing = await prisma.monthSummary.findUnique({
    where: { userId_year_month: { userId: payload.userId, year, month } },
  })

  let summary
  try {
    summary = await computeMonthSummary(payload.userId, year, month)
  } catch (error) {
    console.error(`Failed to compute summary for ${year}-${month}:`, error)
    if (existing?.isStale === false) {
      await prisma.monthSummary.update({
        where: { id: existing.id },
        data:  { isStale: true },
      }).catch(() => {/* best-effort */})
    }
    return NextResponse.json({ error: 'Failed to compute monthly summary' }, { status: 500 })
  }

  const rolling = await getRollingAverages(payload.userId, year, month, 3)

  return NextResponse.json({
    dashboardState:     'analysis_unlocked',
    uncategorizedCount: 0,
    totalCount,
    summary,
    availableMonths,
    rolling,
  })
}
