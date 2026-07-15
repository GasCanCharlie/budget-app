import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// GET /api/sessions/active — get (or auto-create) the user's active session
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.analysisSession.findFirst({
    where:   { userId: payload.userId, status: { in: ['ACTIVE', 'READY', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, title: true, status: true,
      dateRangeStart: true, dateRangeEnd: true,
      accountCount: true, txCount: true, createdAt: true,
      uploads: {
        select: {
          id: true, filename: true, status: true, createdAt: true,
          rowCountAccepted: true,
          account: { select: { id: true, name: true, accountType: true, institution: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  return NextResponse.json({ session })
}
