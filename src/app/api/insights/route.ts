/**
 * GET /api/insights?year=&month=
 * Auth: JWT cookie / Bearer
 *
 * Returns cached InsightCard rows for the given (userId, year, month).
 * Only returns cards where isDismissed = false.
 * isStale = true when the newest card is > 1 hour old, or no cards exist.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import type { InsightCard } from '@/lib/insights/types'

const STALE_MS = 60 * 60 * 1000 // 1 hour

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const year = Number(searchParams.get('year'))
  const month = Number(searchParams.get('month'))

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
  }

  try {
    const rows = await prisma.insightCard.findMany({
      where: {
        userId: user.userId,
        year,
        month,
        isDismissed: false,
      },
      orderBy: { priority: 'asc' },
    })

    if (rows.length === 0) {
      return NextResponse.json({ cards: [], isStale: true })
    }

    const newest = rows.reduce((latest, r) =>
      r.generatedAt > latest.generatedAt ? r : latest,
    )
    const isStale = Date.now() - newest.generatedAt.getTime() > STALE_MS

    // Map DB rows to InsightCard shape expected by the client
    const cards = rows.map(r => ({
      id: r.id,
      card_type: r.cardType,
      priority: r.priority,
      title: r.title,
      summary: r.summary,
      supporting_data: r.supportingData,
      actions: r.actions,
      confidence: r.confidence,
      icon_suggestion: r.iconSuggestion,
      generated_at: r.generatedAt.toISOString(),
      year: r.year,
      month: r.month,
      numbers_used: (r.numbersUsed as InsightCard['numbers_used']) ?? [],
      filters: r.filters as InsightCard['filters'] ?? undefined,
    }))

    return NextResponse.json({ cards, isStale })
  } catch (err) {
    console.error('GET /api/insights error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
