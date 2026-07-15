import prisma from '@/lib/db'
import { OPEN_STATUSES } from './get-or-create-session'

export type IssueType =
  | 'orphaned_upload'
  | 'multiple_active_sessions'
  | 'missing_upload_session'
  | 'empty_open_session'

export interface IntegrityIssue {
  type:      IssueType
  userId?:   string
  uploadId?: string
  sessionId?: string
  detail:    string
}

export interface IntegrityReport {
  clean:  boolean
  issues: IntegrityIssue[]
  checkedAt: string
}

export async function checkSessionIntegrity(): Promise<IntegrityReport> {
  const issues: IntegrityIssue[] = []

  // 1. Uploads with no session (post-Phase-5 this should always be empty — kept as a defensive check)
  const orphans = await prisma.upload.findMany({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    where:  { sessionId: null as any },
    select: { id: true, userId: true },
  })
  for (const u of orphans) {
    issues.push({
      type:     'orphaned_upload',
      userId:   u.userId,
      uploadId: u.id,
      detail:   `Upload ${u.id} (user ${u.userId}) has no sessionId`,
    })
  }

  // 2. Users with more than one open session
  const groups = await prisma.analysisSession.groupBy({
    by:     ['userId'],
    where:  { status: { in: [...OPEN_STATUSES] } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  })
  for (const g of groups) {
    issues.push({
      type:   'multiple_active_sessions',
      userId: g.userId,
      detail: `User ${g.userId} has ${g._count.id} open sessions`,
    })
  }

  // 3. Uploads pointing to a session that doesn't exist
  // Post-Phase-5: all uploads have sessionId, so no filter needed
  const uploadsWithSession = await prisma.upload.findMany({
    select: { id: true, userId: true, sessionId: true },
  })
  const sessionIds = [...new Set(uploadsWithSession.map(u => u.sessionId))]
  const existingSessions = await prisma.analysisSession.findMany({
    where:  { id: { in: sessionIds } },
    select: { id: true },
  })
  const existingSet = new Set(existingSessions.map(s => s.id))
  for (const u of uploadsWithSession) {
    if (!existingSet.has(u.sessionId)) {
      issues.push({
        type:      'missing_upload_session',
        userId:    u.userId,
        uploadId:  u.id,
        sessionId: u.sessionId,
        detail:    `Upload ${u.id} references missing session ${u.sessionId}`,
      })
    }
  }

  // 4. Open sessions with zero uploads
  const openSessions = await prisma.analysisSession.findMany({
    where:  { status: { in: [...OPEN_STATUSES] } },
    select: { id: true, userId: true, _count: { select: { uploads: true } } },
  })
  for (const s of openSessions) {
    if (s._count.uploads === 0) {
      issues.push({
        type:      'empty_open_session',
        userId:    s.userId,
        sessionId: s.id,
        detail:    `Open session ${s.id} (user ${s.userId}) has no uploads`,
      })
    }
  }

  return {
    clean:     issues.length === 0,
    issues,
    checkedAt: new Date().toISOString(),
  }
}
