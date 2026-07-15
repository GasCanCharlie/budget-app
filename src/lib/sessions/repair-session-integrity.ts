import prisma from '@/lib/db'
import { getOrCreateActiveSession, backfillOrphanedUploads, OPEN_STATUSES } from './get-or-create-session'
import { computeSessionSummary } from './compute-session-summary'
import { detectCrossAccountTransfers } from './detect-cross-account-transfers'
import { runDedup } from '@/lib/ingestion/stage3-dedup'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'
import { detectTransfers } from '@/lib/intelligence/transfers'
import { getAvailableMonths, computeMonthSummary } from '@/lib/intelligence/summaries'

export interface RepairOptions {
  userId?: string
}

export interface UserRepairResult {
  userId: string
  sessionId: string
  sessionCreated: boolean
  uploadsAttached: number
  duplicateSessionsRemoved: number
  txCount: number
  transferCount: number
  excludedCount: number
  categorizedCount: number
  accountCount: number
  monthsRecomputed: number
  status: 'ok' | 'error'
  error?: string
  stack?: string
}

export interface RepairReport {
  usersProcessed: number
  sessionsCreated: number
  uploadsRepaired: number
  txReprocessed: number
  transfersDetected: number
  duplicateSessionsRemoved: number
  failures: number
  users: UserRepairResult[]
}

export async function repairSessionIntegrity(options: RepairOptions = {}): Promise<RepairReport> {
  const { userId: filterUserId } = options

  let userIds: string[]

  if (filterUserId) {
    userIds = [filterUserId]
  } else {
    // Collect users with orphaned uploads
    const orphanRows = await prisma.upload.findMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where:    { sessionId: null as any },
      select:   { userId: true },
      distinct: ['userId'],
    })
    const orphanUserIds = orphanRows.map(r => r.userId)

    // Also collect users with multiple open sessions
    const multiSessionUserIds = await findUsersWithMultipleSessions()

    userIds = [...new Set([...orphanUserIds, ...multiSessionUserIds])]
  }

  const report: RepairReport = {
    usersProcessed:          0,
    sessionsCreated:         0,
    uploadsRepaired:         0,
    txReprocessed:           0,
    transfersDetected:       0,
    duplicateSessionsRemoved: 0,
    failures:                0,
    users:                   [],
  }

  for (const userId of userIds) {
    report.usersProcessed++
    try {
      const result = await repairUser(userId)
      report.users.push(result)
      if (result.status === 'ok') {
        if (result.sessionCreated) report.sessionsCreated++
        report.uploadsRepaired         += result.uploadsAttached
        report.txReprocessed           += result.txCount
        report.transfersDetected       += result.transferCount
        report.duplicateSessionsRemoved += result.duplicateSessionsRemoved
      } else {
        report.failures++
      }
    } catch (err) {
      report.failures++
      report.users.push({
        userId,
        sessionId:               '',
        sessionCreated:          false,
        uploadsAttached:         0,
        duplicateSessionsRemoved: 0,
        txCount:                 0,
        transferCount:           0,
        excludedCount:           0,
        categorizedCount:        0,
        accountCount:            0,
        monthsRecomputed:        0,
        status:                  'error',
        error:                   err instanceof Error ? err.message : String(err),
        stack:                   err instanceof Error ? err.stack   : undefined,
      })
    }
  }

  return report
}

async function findUsersWithMultipleSessions(): Promise<string[]> {
  const groups = await prisma.analysisSession.groupBy({
    by:     ['userId'],
    where:  { status: { in: [...OPEN_STATUSES] } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  })
  return groups.map(g => g.userId)
}

async function repairUser(userId: string): Promise<UserRepairResult> {
  let duplicateSessionsRemoved = 0

  // Collapse duplicate open sessions: keep the newest, merge uploads, archive extras
  const openSessions = await prisma.analysisSession.findMany({
    where:   { userId, status: { in: [...OPEN_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select:  { id: true },
  })

  if (openSessions.length > 1) {
    const [keep, ...extras] = openSessions
    for (const extra of extras) {
      await prisma.upload.updateMany({
        where: { sessionId: extra.id },
        data:  { sessionId: keep.id },
      })
      await prisma.analysisSession.update({
        where: { id: extra.id },
        data:  { status: 'ARCHIVED', archivedAt: new Date() },
      })
      duplicateSessionsRemoved++
    }
  }

  const sessionExisted = openSessions.length > 0
  const activeSession  = await getOrCreateActiveSession(userId)
  const sessionId      = activeSession.id
  const sessionCreated = !sessionExisted

  // Attach any uploads with sessionId = null
  const uploadsAttached = await backfillOrphanedUploads(userId, sessionId)

  // Nothing changed — skip expensive recomputation, just gather current stats
  if (uploadsAttached === 0 && duplicateSessionsRemoved === 0 && !sessionCreated) {
    const stats = await gatherUserStats(userId)
    return {
      userId, sessionId, sessionCreated: false,
      uploadsAttached: 0, duplicateSessionsRemoved: 0,
      ...stats, monthsRecomputed: 0, status: 'ok',
    }
  }

  // Re-run stage 3 (dedup) and stage 4 (reconcile) for all complete uploads in session
  const sessionUploads = await prisma.upload.findMany({
    where:  { sessionId, status: 'complete' },
    select: { id: true, accountId: true },
  })

  for (const upload of sessionUploads) {
    await runDedup(upload.id, upload.accountId)
    await runReconciliation(upload.id)
  }

  // User-level transfer detection
  await detectTransfers(userId)

  // Session-level cross-account transfer detection
  await detectCrossAccountTransfers(sessionId)

  // Recompute all month summaries
  const months = await getAvailableMonths(userId)
  for (const { year, month } of months) {
    await computeMonthSummary(userId, year, month)
  }

  // Update session metadata: txCount, accountCount, dateRange, status
  await computeSessionSummary(sessionId, userId)

  const stats = await gatherUserStats(userId)

  return {
    userId, sessionId, sessionCreated,
    uploadsAttached, duplicateSessionsRemoved,
    ...stats, monthsRecomputed: months.length, status: 'ok',
  }
}

async function gatherUserStats(userId: string) {
  const base = { account: { userId }, isTransfer: false, isExcluded: false }
  const [txCount, transferCount, excludedCount, categorizedCount, accountCount] = await Promise.all([
    prisma.transaction.count({ where: { account: { userId } } }),
    prisma.transaction.count({ where: { account: { userId }, isTransfer: true } }),
    prisma.transaction.count({ where: { account: { userId }, isExcluded: true } }),
    prisma.transaction.count({ where: { ...base, appCategory: { not: null } } }),
    prisma.account.count({ where: { userId } }),
  ])
  return { txCount, transferCount, excludedCount, categorizedCount, accountCount }
}
