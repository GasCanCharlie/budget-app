import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { detectSubscriptions } from '@/lib/intelligence/detect-subscriptions'

// GET /api/subscriptions — return detected subscription candidates
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subs = await prisma.subscriptionCandidate.findMany({
    where: { userId: payload.userId, isSuppressed: false },
    orderBy: { estimatedMonthlyAmount: 'desc' },
  })

  return NextResponse.json({ subscriptions: subs })
}

// POST /api/subscriptions/detect — scan transactions and upsert candidates
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const detected = await detectSubscriptions(payload.userId)
    return NextResponse.json({ detected })
  } catch (err) {
    console.error('POST /api/subscriptions error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
