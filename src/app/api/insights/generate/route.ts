/**
 * POST /api/insights/generate
 * Body: { year: number, month: number }
 * Auth: JWT cookie / Bearer
 *
 * Triggers a full insight computation pass for the given (userId, year, month).
 * Returns the ranked display cards (max 8) plus the generatedAt timestamp.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { computeInsights } from '@/lib/insights/compute'
import prisma from '@/lib/db'

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let year: number
  let month: number
  try {
    const body = (await req.json()) as { year?: unknown; month?: unknown }
    year = Number(body.year)
    month = Number(body.month)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      return NextResponse.json({ error: 'Invalid month' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  try {
    // Clear dismissed state so manual refresh always shows fresh cards
    await prisma.insightCard.updateMany({
      where: { userId: user.userId, year, month, isDismissed: true },
      data: { isDismissed: false },
    })

    const cards = await computeInsights(user.userId, year, month)
    return NextResponse.json({
      cards,
      generatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('POST /api/insights/generate error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
