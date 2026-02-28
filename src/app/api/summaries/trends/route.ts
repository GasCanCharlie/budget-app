import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { format } from 'date-fns'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/summaries/trends
// Returns monthly income/spending totals for the last N months (default 12).
// Query params:
//   months=12        — how many past months to include (max 36)
//   excludeCurrent=true — omit the current (potentially partial) month
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)

  // Issue 19: guard against NaN when the param is non-numeric
  const rawLookback = parseInt(searchParams.get('months') ?? '12')
  const lookback = Number.isNaN(rawLookback) ? 12 : Math.min(Math.max(rawLookback, 1), 36)

  // Issue 22: allow callers to exclude the current (partial) month
  const excludeCurrent = searchParams.get('excludeCurrent') === 'true'

  // Build the list of (year, month) tuples for the lookback window
  const now = new Date()
  let y = now.getFullYear()
  let m = now.getMonth() + 1

  if (excludeCurrent) {
    m--
    if (m === 0) { m = 12; y-- }
  }

  const slots: { year: number; month: number }[] = []
  for (let i = 0; i < lookback; i++) {
    slots.unshift({ year: y, month: m })
    m--
    if (m === 0) { m = 12; y-- }
  }

  // Fetch persisted summaries for those months
  const summaries = await prisma.monthSummary.findMany({
    where: {
      userId: payload.userId,
      OR: slots.map(s => ({ year: s.year, month: s.month })),
    },
  })

  const summaryMap = new Map(
    summaries.map(s => [`${s.year}-${s.month}`, s]),
  )

  // Return one entry per slot — null values for months with no data
  const months = slots.map(({ year, month }) => {
    const row = summaryMap.get(`${year}-${month}`)
    return {
      year,
      month,
      label:         format(new Date(year, month - 1, 1), 'MMM yy'),
      totalIncome:   row?.totalIncome   ?? null,
      totalSpending: row?.totalSpending ?? null,
      net:           row?.net           ?? null,
      hasData:       !!row,
    }
  })

  return NextResponse.json({ months })
}
