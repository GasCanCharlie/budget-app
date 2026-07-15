import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

const SESSION_SELECT = {
  id: true, title: true, status: true,
  dateRangeStart: true, dateRangeEnd: true,
  accountCount: true, txCount: true, createdAt: true,
  uploads: {
    select: {
      id: true, filename: true, status: true, createdAt: true,
      rowCountAccepted: true,
      account: { select: { id: true, name: true, accountType: true, institution: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
}

// GET /api/sessions/active — find or create the user's active session, then backfill orphaned uploads
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session = await prisma.analysisSession.findFirst({
    where:   { userId: payload.userId, status: { in: ['ACTIVE', 'READY', 'PROCESSING'] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })

  // No active session but user may have orphaned uploads — bootstrap one for them
  if (!session) {
    const orphanedCount = await prisma.upload.count({
      where: { userId: payload.userId, sessionId: null },
    })
    if (orphanedCount > 0) {
      session = await prisma.analysisSession.create({
        data: { userId: payload.userId, title: 'Financial Autopsy', status: 'ACTIVE' },
        select: { id: true },
      })
    }
  }

  if (!session) return NextResponse.json({ session: null })

  // Attach any uploads that pre-date the session feature
  await prisma.upload.updateMany({
    where: { userId: payload.userId, sessionId: null },
    data:  { sessionId: session.id },
  })

  // Re-query after backfill so the upload list is complete
  const sessionWithUploads = await prisma.analysisSession.findUnique({
    where:  { id: session.id },
    select: SESSION_SELECT,
  })

  return NextResponse.json({ session: sessionWithUploads })
}
