import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { OPEN_STATUSES } from '@/lib/sessions/get-or-create-session'

export const dynamic = 'force-dynamic'

// GET /api/sessions/snapshot
// Lightweight authoritative session metrics — COUNT queries only, no recompute.
// Use this anywhere a banner/header needs session health without the upload list weight.
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.analysisSession.findFirst({
    where:   { userId: payload.userId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select:  {
      id: true, title: true, status: true,
      dateRangeStart: true, dateRangeEnd: true,
    },
  })

  if (!session) return NextResponse.json({ snapshot: null })

  const [uploadCount, txCount, uncategorizedCount, transferCount, accounts] = await Promise.all([
    prisma.upload.count({
      where: { sessionId: session.id, status: 'complete' },
    }),
    prisma.transaction.count({
      where: { upload: { sessionId: session.id } },
    }),
    prisma.transaction.count({
      where: {
        upload:      { sessionId: session.id },
        isTransfer:  false,
        isExcluded:  false,
        appCategory: null,
      },
    }),
    prisma.transaction.count({
      where: { upload: { sessionId: session.id }, isTransfer: true },
    }),
    prisma.account.findMany({
      where:  { uploads: { some: { sessionId: session.id } } },
      select: { id: true, name: true, accountType: true, institution: true },
      take:   10,
    }),
  ])

  const monthsLoaded = session.dateRangeStart && session.dateRangeEnd
    ? Math.max(1, Math.round(
        (new Date(session.dateRangeEnd).getTime() - new Date(session.dateRangeStart).getTime())
        / (30 * 24 * 60 * 60 * 1000),
      ))
    : 0

  return NextResponse.json({
    snapshot: {
      sessionId:          session.id,
      status:             session.status,
      title:              session.title,
      uploadCount,
      txCount,
      uncategorizedCount,
      transferCount,
      accountCount:       accounts.length,
      dateRangeStart:     session.dateRangeStart?.toISOString() ?? null,
      dateRangeEnd:       session.dateRangeEnd?.toISOString() ?? null,
      monthsLoaded,
      hasData:            txCount > 0,
      accounts,
    },
  })
}
