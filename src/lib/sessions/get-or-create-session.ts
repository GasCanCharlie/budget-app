import prisma from '@/lib/db'

export const OPEN_STATUSES = ['ACTIVE', 'READY', 'PROCESSING'] as const
type OpenStatus = typeof OPEN_STATUSES[number]

export interface ActiveSession {
  id:     string
  status: OpenStatus
}

/**
 * Returns the user's current open session, or creates one.
 *
 * Concurrency: if two requests both find no session and race to create one,
 * the one that loses the unique-constraint conflict refetches the winner.
 * The partial unique index on (userId) WHERE status IN ('ACTIVE','PROCESSING','READY')
 * is the database-level enforcement; this function is the application-level wrapper.
 */
export async function getOrCreateActiveSession(userId: string): Promise<ActiveSession> {
  const existing = await prisma.analysisSession.findFirst({
    where:   { userId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select:  { id: true, status: true },
  })
  if (existing) return existing as ActiveSession

  try {
    return await prisma.analysisSession.create({
      data:   { userId, title: 'Financial Autopsy', status: 'ACTIVE' },
      select: { id: true, status: true },
    }) as ActiveSession
  } catch (err) {
    // P2002 = unique constraint violation — another concurrent request created the session first
    const isRace =
      typeof err === 'object' && err !== null &&
      'code' in err && (err as { code: string }).code === 'P2002'
    if (!isRace) throw err

    const raced = await prisma.analysisSession.findFirst({
      where:   { userId, status: { in: [...OPEN_STATUSES] } },
      orderBy: { createdAt: 'desc' },
      select:  { id: true, status: true },
    })
    if (!raced) throw new Error('[session] Race condition: could not locate winning session')
    return raced as ActiveSession
  }
}

/**
 * Attaches uploads that pre-date session support to the given session.
 * Idempotent — skips uploads that already have a sessionId.
 * Returns the number of rows backfilled.
 */
export async function backfillOrphanedUploads(userId: string, sessionId: string): Promise<number> {
  const result = await prisma.upload.updateMany({
    where: { userId, sessionId: null },
    data:  { sessionId },
  })
  return result.count
}
