import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// GET /api/sessions — list all sessions (active first, then archived)
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sessions = await prisma.analysisSession.findMany({
    where:   { userId: payload.userId },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, title: true, status: true,
      dateRangeStart: true, dateRangeEnd: true,
      accountCount: true, txCount: true,
      createdAt: true, archivedAt: true,
      uploads: {
        select: {
          account: { select: { id: true, name: true, accountType: true } },
        },
        distinct: ['accountId'],
      },
    },
  })

  return NextResponse.json({ sessions })
}

// POST /api/sessions — create a new ACTIVE session (or return existing active one)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { title?: string; forceNew?: boolean }

  // Only one ACTIVE session at a time
  if (!body.forceNew) {
    const existing = await prisma.analysisSession.findFirst({
      where:   { userId: payload.userId, status: { in: ['ACTIVE', 'READY', 'PROCESSING'] } },
      orderBy: { createdAt: 'desc' },
    })
    if (existing) return NextResponse.json({ session: existing, created: false })
  }

  const session = await prisma.analysisSession.create({
    data: {
      userId: payload.userId,
      title:  body.title ?? 'Financial Autopsy',
      status: 'ACTIVE',
    },
  })

  return NextResponse.json({ session, created: true }, { status: 201 })
}
