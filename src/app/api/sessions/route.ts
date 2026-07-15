import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { getOrCreateActiveSession } from '@/lib/sessions/get-or-create-session'

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

// POST /api/sessions — return or create the active session (forceNew archives the current one first)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { title?: string; forceNew?: boolean }

  if (body.forceNew) {
    // Archive the current open session before creating a fresh one
    await prisma.analysisSession.updateMany({
      where: { userId: payload.userId, status: { in: ['ACTIVE', 'READY', 'PROCESSING'] } },
      data:  { status: 'ARCHIVED', archivedAt: new Date() },
    })
    const fresh = await prisma.analysisSession.create({
      data: { userId: payload.userId, title: body.title ?? 'Financial Autopsy', status: 'ACTIVE' },
    })
    return NextResponse.json({ session: fresh, created: true }, { status: 201 })
  }

  const session = await getOrCreateActiveSession(payload.userId)
  return NextResponse.json({ session, created: false })
}
