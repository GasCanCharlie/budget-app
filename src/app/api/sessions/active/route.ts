import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { getOrCreateActiveSession, backfillOrphanedUploads, OPEN_STATUSES } from '@/lib/sessions/get-or-create-session'

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

// GET /api/sessions/active
// Returns the open session with all uploads, creating one if needed and backfilling orphans.
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only bootstrap a session if orphaned uploads exist — avoids creating empty sessions on first login.
  // Post-Phase-5: sessionId is non-nullable; this count will always be 0 for new uploads.
  // Kept as a safety net in case of DB-level manipulation or pre-Phase-5 data.
  const orphanCount = await prisma.upload.count({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where: { userId: payload.userId, sessionId: null as any },
  })

  let sessionId: string | null = null

  const openSession = await prisma.analysisSession.findFirst({
    where:   { userId: payload.userId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select:  { id: true },
  })

  if (openSession) {
    sessionId = openSession.id
  } else if (orphanCount > 0) {
    // Bootstrap: create session and attach orphans in one go
    const created = await getOrCreateActiveSession(payload.userId)
    sessionId = created.id
  }

  if (!sessionId) return NextResponse.json({ session: null })

  // Attach any uploads that pre-date session support
  if (orphanCount > 0) {
    await backfillOrphanedUploads(payload.userId, sessionId)
  }

  // Re-query after backfill so upload list is complete
  const session = await prisma.analysisSession.findUnique({
    where:  { id: sessionId },
    select: SESSION_SELECT,
  })

  return NextResponse.json({ session })
}
