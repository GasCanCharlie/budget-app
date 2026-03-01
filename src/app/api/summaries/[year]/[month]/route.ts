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

  const [availableMonths, rolling] = await Promise.all([
    getAvailableMonths(payload.userId),
    getRollingAverages(payload.userId, year, month, 3),
  ])

  return NextResponse.json({ summary, availableMonths, rolling })
}
