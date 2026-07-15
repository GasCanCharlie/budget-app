import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  default: {
    upload: {
      findMany:   vi.fn(),
      updateMany: vi.fn(),
    },
    analysisSession: {
      findFirst:  vi.fn(),
      findMany:   vi.fn(),
      create:     vi.fn(),
      update:     vi.fn(),
      updateMany: vi.fn(),
      groupBy:    vi.fn(),
    },
    transaction: {
      count: vi.fn(),
    },
    account: {
      count: vi.fn(),
    },
  },
}))

vi.mock('@/lib/sessions/get-or-create-session', () => ({
  OPEN_STATUSES:           ['ACTIVE', 'READY', 'PROCESSING'],
  getOrCreateActiveSession: vi.fn(),
  backfillOrphanedUploads:  vi.fn(),
}))

vi.mock('@/lib/sessions/compute-session-summary', () => ({
  computeSessionSummary: vi.fn(),
}))

vi.mock('@/lib/sessions/detect-cross-account-transfers', () => ({
  detectCrossAccountTransfers: vi.fn(),
}))

vi.mock('@/lib/ingestion/stage3-dedup', () => ({
  runDedup: vi.fn(),
}))

vi.mock('@/lib/ingestion/stage4-reconcile', () => ({
  runReconciliation: vi.fn(),
}))

vi.mock('@/lib/intelligence/transfers', () => ({
  detectTransfers: vi.fn(),
}))

vi.mock('@/lib/intelligence/summaries', () => ({
  getAvailableMonths: vi.fn(),
  computeMonthSummary: vi.fn(),
}))

// ─── Imports (after vi.mock) ─────────────────────────────────────────────────

import prisma from '@/lib/db'
import { getOrCreateActiveSession, backfillOrphanedUploads } from '@/lib/sessions/get-or-create-session'
import { computeSessionSummary } from '@/lib/sessions/compute-session-summary'
import { detectCrossAccountTransfers } from '@/lib/sessions/detect-cross-account-transfers'
import { runDedup } from '@/lib/ingestion/stage3-dedup'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'
import { detectTransfers } from '@/lib/intelligence/transfers'
import { getAvailableMonths, computeMonthSummary } from '@/lib/intelligence/summaries'
import { repairSessionIntegrity } from '@/lib/sessions/repair-session-integrity'

// ─── Fixtures ────────────────────────────────────────────────────────────────

const USER_ID  = 'user_abc'
const SESSION_ID = 'session_xyz'

function setupCleanUser() {
  // No orphaned uploads, no multiple sessions — nothing to do
  vi.mocked(prisma.upload.findMany).mockResolvedValue([])
  vi.mocked(prisma.analysisSession.groupBy).mockResolvedValue([])
  vi.mocked(prisma.analysisSession.findMany).mockResolvedValue([
    { id: SESSION_ID } as never,
  ])
  vi.mocked(getOrCreateActiveSession).mockResolvedValue({ id: SESSION_ID, status: 'ACTIVE' })
  vi.mocked(backfillOrphanedUploads).mockResolvedValue(0)
  vi.mocked(prisma.transaction.count).mockResolvedValue(0)
  vi.mocked(prisma.account.count).mockResolvedValue(1)
}

function setupUserWithOrphans() {
  // One orphaned upload
  vi.mocked(prisma.upload.findMany)
    .mockResolvedValueOnce([{ userId: USER_ID } as never])     // findMany for orphan discovery
    .mockResolvedValueOnce([{ id: 'session_xyz', } as never])  // findMany for open sessions
    .mockResolvedValueOnce([{ id: 'upload_1', accountId: 'acct_1' } as never]) // session uploads
  vi.mocked(prisma.analysisSession.groupBy).mockResolvedValue([])
  vi.mocked(prisma.analysisSession.findMany).mockResolvedValue([
    { id: SESSION_ID } as never,
  ])
  vi.mocked(getOrCreateActiveSession).mockResolvedValue({ id: SESSION_ID, status: 'ACTIVE' })
  vi.mocked(backfillOrphanedUploads).mockResolvedValue(1)
  vi.mocked(runDedup).mockResolvedValue({ possibleDuplicatesFound: 0 } as never)
  vi.mocked(runReconciliation).mockResolvedValue({ status: 'PASS', mode: 'UNVERIFIABLE' } as never)
  vi.mocked(detectTransfers).mockResolvedValue(0)
  vi.mocked(detectCrossAccountTransfers).mockResolvedValue(0)
  vi.mocked(getAvailableMonths).mockResolvedValue([{ year: 2024, month: 3 }])
  vi.mocked(computeMonthSummary).mockResolvedValue({} as never)
  vi.mocked(computeSessionSummary).mockResolvedValue(null)
  vi.mocked(prisma.transaction.count).mockResolvedValue(83)
  vi.mocked(prisma.account.count).mockResolvedValue(2)
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks()
})

describe('repairSessionIntegrity', () => {

  describe('no orphaned uploads', () => {
    it('returns zero repairs when no uploads are orphaned', async () => {
      vi.mocked(prisma.upload.findMany).mockResolvedValue([])
      vi.mocked(prisma.analysisSession.groupBy).mockResolvedValue([])

      const report = await repairSessionIntegrity()

      expect(report.usersProcessed).toBe(0)
      expect(report.uploadsRepaired).toBe(0)
      expect(report.sessionsCreated).toBe(0)
      expect(report.failures).toBe(0)
    })

    it('does not call runDedup or runReconciliation when nothing changed', async () => {
      vi.mocked(prisma.upload.findMany)
        .mockResolvedValueOnce([{ userId: USER_ID } as never])   // orphan discovery
        .mockResolvedValueOnce([{ id: SESSION_ID } as never])    // open sessions check
      vi.mocked(prisma.analysisSession.groupBy).mockResolvedValue([])
      vi.mocked(prisma.analysisSession.findMany).mockResolvedValue([{ id: SESSION_ID } as never])
      vi.mocked(getOrCreateActiveSession).mockResolvedValue({ id: SESSION_ID, status: 'ACTIVE' })
      vi.mocked(backfillOrphanedUploads).mockResolvedValue(0)
      vi.mocked(prisma.transaction.count).mockResolvedValue(0)
      vi.mocked(prisma.account.count).mockResolvedValue(0)

      await repairSessionIntegrity({ userId: USER_ID })

      expect(runDedup).not.toHaveBeenCalled()
      expect(runReconciliation).not.toHaveBeenCalled()
      expect(computeMonthSummary).not.toHaveBeenCalled()
    })
  })

  describe('orphaned uploads exist', () => {
    it('attaches uploads and runs full recomputation pipeline', async () => {
      setupUserWithOrphans()

      const report = await repairSessionIntegrity()

      expect(report.uploadsRepaired).toBe(1)
      expect(report.usersProcessed).toBe(1)
      expect(runDedup).toHaveBeenCalledOnce()
      expect(runReconciliation).toHaveBeenCalledOnce()
      expect(detectTransfers).toHaveBeenCalledWith(USER_ID)
      expect(detectCrossAccountTransfers).toHaveBeenCalledWith(SESSION_ID)
      expect(computeMonthSummary).toHaveBeenCalledWith(USER_ID, 2024, 3)
      expect(computeSessionSummary).toHaveBeenCalledWith(SESSION_ID, USER_ID)
    })

    it('reports correct transaction stats after repair', async () => {
      setupUserWithOrphans()

      const report = await repairSessionIntegrity()

      expect(report.users[0].txCount).toBe(83)
      expect(report.users[0].accountCount).toBe(2)
      expect(report.users[0].status).toBe('ok')
    })

    it('includes monthsRecomputed in user result', async () => {
      setupUserWithOrphans()
      vi.mocked(getAvailableMonths).mockResolvedValue([
        { year: 2024, month: 1 },
        { year: 2024, month: 2 },
        { year: 2024, month: 3 },
      ])

      const report = await repairSessionIntegrity()

      expect(report.users[0].monthsRecomputed).toBe(3)
      expect(computeMonthSummary).toHaveBeenCalledTimes(3)
    })
  })

  describe('idempotency', () => {
    it('second run with no orphans touches nothing', async () => {
      // Run 1: attach 1 upload
      setupUserWithOrphans()
      const run1 = await repairSessionIntegrity()
      expect(run1.uploadsRepaired).toBe(1)

      vi.resetAllMocks()

      // Run 2: no orphans remain
      vi.mocked(prisma.upload.findMany).mockResolvedValue([])
      vi.mocked(prisma.analysisSession.groupBy).mockResolvedValue([])
      const run2 = await repairSessionIntegrity()

      expect(run2.usersProcessed).toBe(0)
      expect(run2.uploadsRepaired).toBe(0)
      expect(runDedup).not.toHaveBeenCalled()
      expect(runReconciliation).not.toHaveBeenCalled()
      expect(computeMonthSummary).not.toHaveBeenCalled()
    })
  })

  describe('duplicate session collapse', () => {
    it('archives extra open sessions and moves their uploads to the newest', async () => {
      const EXTRA_ID = 'session_old'
      // Only detected via multi-session groupBy (no orphaned uploads)
      vi.mocked(prisma.upload.findMany)
        .mockResolvedValueOnce([{ userId: USER_ID } as never])  // orphan discovery
        .mockResolvedValueOnce([])                              // session uploads after collapse
      vi.mocked(prisma.analysisSession.groupBy).mockResolvedValue([
        { userId: USER_ID, _count: { id: 2 } } as never,
      ])
      // repairUser calls analysisSession.findMany to find open sessions
      vi.mocked(prisma.analysisSession.findMany).mockResolvedValueOnce([
        { id: SESSION_ID } as never,
        { id: EXTRA_ID } as never,
      ])
      vi.mocked(prisma.upload.updateMany).mockResolvedValue({ count: 0 } as never)
      vi.mocked(prisma.analysisSession.update).mockResolvedValue({} as never)
      vi.mocked(getOrCreateActiveSession).mockResolvedValue({ id: SESSION_ID, status: 'ACTIVE' })
      vi.mocked(backfillOrphanedUploads).mockResolvedValue(0)
      vi.mocked(detectTransfers).mockResolvedValue(0)
      vi.mocked(detectCrossAccountTransfers).mockResolvedValue(0)
      vi.mocked(getAvailableMonths).mockResolvedValue([])
      vi.mocked(computeSessionSummary).mockResolvedValue(null)
      vi.mocked(prisma.transaction.count).mockResolvedValue(0)
      vi.mocked(prisma.account.count).mockResolvedValue(0)

      const report = await repairSessionIntegrity()

      expect(prisma.upload.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: EXTRA_ID } })
      )
      expect(prisma.analysisSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: EXTRA_ID },
          data:  expect.objectContaining({ status: 'ARCHIVED' }),
        })
      )
      expect(report.duplicateSessionsRemoved).toBe(1)
    })
  })

  describe('per-user error isolation', () => {
    it('continues processing other users when one user fails', async () => {
      const USER_B = 'user_b'

      // Orphan discovery returns both users
      vi.mocked(prisma.upload.findMany)
        .mockResolvedValueOnce([{ userId: USER_ID } as never, { userId: USER_B } as never])
        .mockResolvedValue([]) // default for session uploads
      vi.mocked(prisma.analysisSession.groupBy).mockResolvedValue([])

      // USER_ID: open sessions → [], then getOrCreateActiveSession throws
      // USER_B:  open sessions → [], then getOrCreateActiveSession succeeds
      vi.mocked(prisma.analysisSession.findMany)
        .mockResolvedValueOnce([])  // USER_ID
        .mockResolvedValueOnce([])  // USER_B
      vi.mocked(getOrCreateActiveSession)
        .mockRejectedValueOnce(new Error('DB connection failed'))
        .mockResolvedValueOnce({ id: 'session_b', status: 'ACTIVE' })
      vi.mocked(backfillOrphanedUploads).mockResolvedValue(1)
      vi.mocked(detectTransfers).mockResolvedValue(0)
      vi.mocked(detectCrossAccountTransfers).mockResolvedValue(0)
      vi.mocked(getAvailableMonths).mockResolvedValue([])
      vi.mocked(computeSessionSummary).mockResolvedValue(null)
      vi.mocked(prisma.transaction.count).mockResolvedValue(0)
      vi.mocked(prisma.account.count).mockResolvedValue(0)

      const report = await repairSessionIntegrity()

      expect(report.usersProcessed).toBe(2)
      expect(report.failures).toBe(1)
      const failed = report.users.find(u => u.userId === USER_ID)
      expect(failed?.status).toBe('error')
      expect(failed?.error).toBe('DB connection failed')
    })
  })

  describe('userId filter', () => {
    it('only processes the specified user', async () => {
      vi.mocked(prisma.analysisSession.findMany).mockResolvedValue([{ id: SESSION_ID } as never])
      vi.mocked(getOrCreateActiveSession).mockResolvedValue({ id: SESSION_ID, status: 'ACTIVE' })
      vi.mocked(backfillOrphanedUploads).mockResolvedValue(0)
      vi.mocked(prisma.transaction.count).mockResolvedValue(0)
      vi.mocked(prisma.account.count).mockResolvedValue(0)

      await repairSessionIntegrity({ userId: USER_ID })

      // Should not query for all orphaned users
      expect(prisma.upload.findMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ where: { sessionId: null }, distinct: ['userId'] })
      )
      expect(getOrCreateActiveSession).toHaveBeenCalledWith(USER_ID)
    })
  })
})
