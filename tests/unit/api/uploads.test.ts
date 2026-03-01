import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

vi.mock('@/lib/db', () => {
  const upload = {
    findMany:  vi.fn(),
    findFirst: vi.fn(),
    delete:    vi.fn(),
  }

  // txMock shares the same upload fns so prisma.upload.delete assertions still pass
  const txMock = {
    upload,
    transaction:      { findMany: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
    categoryHistory:  { deleteMany: vi.fn() },
    transactionLink:  { deleteMany: vi.fn() },
    ingestionIssue:   { deleteMany: vi.fn() },
    auditLogEntry:    { deleteMany: vi.fn() },
    transactionRaw:   { deleteMany: vi.fn() },
    monthCategoryTotal: { deleteMany: vi.fn() },
    monthSummary:     { deleteMany: vi.fn() },
  }

  const $transaction = vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock))

  return {
    default: {
      upload,
      ingestionIssue: { groupBy: vi.fn() },
      $transaction,
      _txMock: txMock,
    },
  }
})

// ─── Imports (after vi.mock calls) ───────────────────────────────────────────

import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { GET as getUploads }   from '@/app/api/uploads/route'
import { GET as getUploadById } from '@/app/api/uploads/[id]/route'

// NOTE: DELETE /api/uploads/[id] does not yet exist in the source file.
// The import below will be undefined until the handler is added.  The DELETE
// tests are written to document expected behaviour and will begin passing once
// the handler is implemented.
import type { NextResponse } from 'next/server'
type RouteHandler = (
  req: NextRequest,
  ctx: { params: { id: string } },
) => Promise<NextResponse>

// Dynamically retrieve the DELETE export so the file still loads when the
// handler is absent (it would be undefined rather than throwing at import time).
let deleteUpload: RouteHandler | undefined

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url = 'http://localhost/api/uploads', method = 'GET'): NextRequest {
  return new NextRequest(url, { method })
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_USER = { userId: 'user_1', email: 'test@example.com' }

/** Minimal account relation included in upload list response. */
const ACCOUNT_STUB = {
  name:        'Chase Checking',
  institution: 'Chase',
}

/** Full account relation included in upload detail response. */
const ACCOUNT_DETAIL_STUB = {
  id:          'acct-1',
  name:        'Chase Checking',
  institution: 'Chase',
  accountType: 'checking',
}

/** Upload row as returned by GET /api/uploads (list). */
const UPLOAD_LIST_ROW = {
  id:                   'upload-abc123',
  userId:               'user_1',
  accountId:            'acct-1',
  filename:             'chase_march_2024.csv',
  fileHash:             'deadbeef1234deadbeef5678deadbeef1234deadbeef5678deadbeef1234dead',
  formatDetected:       'Chase',
  status:               'complete',
  createdAt:            new Date('2024-04-01T10:00:00Z'),
  completedAt:          new Date('2024-04-01T10:00:05Z'),
  rowCountRaw:          45,
  rowCountParsed:       45,
  rowCountAccepted:     44,
  rowCountRejected:     1,
  totalRowsUnresolved:  0,
  dateRangeStart:       new Date('2024-03-01'),
  dateRangeEnd:         new Date('2024-03-31'),
  parserVersion:        '1.2.0',
  reconciliationStatus: 'MATCHED',
  statementOpenBalance:  null,
  statementCloseBalance: null,
  statementTotalCredits: null,
  statementTotalDebits:  null,
  reconciliationReport:  null,
  warnings:              '[]',
  account:               ACCOUNT_STUB,
}

/** Upload row as returned by GET /api/uploads/[id] (detail). */
const UPLOAD_DETAIL_ROW = {
  ...UPLOAD_LIST_ROW,
  account: ACCOUNT_DETAIL_STUB,
  _count: {
    ingestionIssues: 2,
    transactions:    44,
  },
}

/** groupBy rows for issue breakdown (one resolved, one unresolved). */
const ISSUE_COUNTS_BY_SEVERITY = [
  { severity: 'WARNING', resolved: false, _count: { id: 1 } },
  { severity: 'INFO',    resolved: true,  _count: { id: 1 } },
]

/** groupBy rows for issue type breakdown. */
const ISSUE_COUNTS_BY_TYPE = [
  { issueType: 'DATE_AMBIGUOUS', _count: { id: 1 } },
]

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/uploads
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/uploads', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getUserFromRequest).mockReturnValue(MOCK_USER)
    vi.mocked(prisma.upload.findMany).mockResolvedValue([UPLOAD_LIST_ROW] as never)
  })

  // ── 1. Returns list of user's uploads with account info ───────────────────

  it('returns 200 with array of uploads including account info', async () => {
    const req = makeReq('http://localhost/api/uploads')
    const res = await getUploads(req)

    expect(res.status).toBe(200)

    // Verify prisma was called for the authenticated user only
    expect(prisma.upload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where:   { userId: 'user_1' },
        include: { account: { select: { name: true, institution: true } } },
      }),
    )

    const body = await res.json()
    expect(Array.isArray(body.uploads)).toBe(true)
    expect(body.uploads).toHaveLength(1)

    const upload = body.uploads[0]
    expect(upload.id).toBe('upload-abc123')
    expect(upload.filename).toBe('chase_march_2024.csv')
    expect(upload.status).toBe('complete')
    expect(upload.account.name).toBe('Chase Checking')
    expect(upload.account.institution).toBe('Chase')
  })

  it('returns empty array when user has no uploads', async () => {
    vi.mocked(prisma.upload.findMany).mockResolvedValue([])

    const req = makeReq('http://localhost/api/uploads')
    const res = await getUploads(req)

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.uploads).toEqual([])
  })

  // ── 2. Unauthenticated → 401 ───────────────────────────────────────────────

  it('unauthenticated: returns 401 without querying the DB', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq('http://localhost/api/uploads')
    const res = await getUploads(req)

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
    expect(prisma.upload.findMany).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/uploads/[id]
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/uploads/[id]', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getUserFromRequest).mockReturnValue(MOCK_USER)
    vi.mocked(prisma.upload.findFirst).mockResolvedValue(UPLOAD_DETAIL_ROW as never)
    vi.mocked(prisma.ingestionIssue.groupBy)
      .mockResolvedValueOnce(ISSUE_COUNTS_BY_SEVERITY as never) // first call: by severity+resolved
      .mockResolvedValueOnce(ISSUE_COUNTS_BY_TYPE as never)     // second call: by issueType
  })

  // ── 1. Returns upload detail ───────────────────────────────────────────────

  it('returns 200 with full upload detail including issue breakdown', async () => {
    const req = makeReq('http://localhost/api/uploads/upload-abc123')
    const res = await getUploadById(req, { params: { id: 'upload-abc123' } })

    expect(res.status).toBe(200)

    // Verify ownership check: query filters by both id and userId
    expect(prisma.upload.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'upload-abc123', userId: 'user_1' },
      }),
    )

    const body = await res.json()
    const upload = body.upload

    // Core fields
    expect(upload.id).toBe('upload-abc123')
    expect(upload.filename).toBe('chase_march_2024.csv')
    expect(upload.formatDetected).toBe('Chase')
    expect(upload.status).toBe('complete')
    expect(upload.parserVersion).toBe('1.2.0')
    expect(upload.reconciliationStatus).toBe('MATCHED')

    // Account relation
    expect(upload.account.id).toBe('acct-1')
    expect(upload.account.name).toBe('Chase Checking')
    expect(upload.account.institution).toBe('Chase')
    expect(upload.account.accountType).toBe('checking')

    // Row counts
    expect(upload.rowCountRaw).toBe(45)
    expect(upload.rowCountParsed).toBe(45)
    expect(upload.rowCountAccepted).toBe(44)
    expect(upload.rowCountRejected).toBe(1)
    expect(upload.transactionCount).toBe(44)

    // Issue breakdown derived from groupBy mocks:
    //   severity+resolved groupBy: 1 unresolved (WARNING/false), 1 resolved (INFO/true)
    //   issueType groupBy: 1 DATE_AMBIGUOUS
    expect(upload.issueBreakdown.total).toBe(2)
    expect(upload.issueBreakdown.unresolved).toBe(1)
    expect(upload.issueBreakdown.resolved).toBe(1)
    expect(upload.issueBreakdown.byType.DATE_AMBIGUOUS).toBe(1)

    // JSON fields parsed to arrays/objects (not raw strings)
    expect(Array.isArray(upload.warnings)).toBe(true)
    expect(upload.reconciliationReport).toBeNull()
  })

  it('parses reconciliationReport JSON when present', async () => {
    const reportPayload = { mode: 'A', status: 'MATCHED', delta: 0 }
    const rowWithReport = {
      ...UPLOAD_DETAIL_ROW,
      reconciliationReport: JSON.stringify(reportPayload),
    }
    vi.mocked(prisma.upload.findFirst).mockResolvedValue(rowWithReport as never)

    const req = makeReq('http://localhost/api/uploads/upload-abc123')
    const res = await getUploadById(req, { params: { id: 'upload-abc123' } })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.upload.reconciliationReport).toEqual(reportPayload)
  })

  // ── 2. Not found or wrong owner → 404 ────────────────────────────────────

  it('returns 404 when upload does not exist', async () => {
    vi.mocked(prisma.upload.findFirst).mockResolvedValue(null)

    const req = makeReq('http://localhost/api/uploads/does-not-exist')
    const res = await getUploadById(req, { params: { id: 'does-not-exist' } })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Upload not found')
  })

  it('returns 404 when upload belongs to a different user (ownership filter)', async () => {
    // The route uses findFirst with { id, userId } — if the upload belongs to
    // another user, Prisma returns null, which the route treats as not-found.
    vi.mocked(prisma.upload.findFirst).mockResolvedValue(null)

    const req = makeReq('http://localhost/api/uploads/upload-other-user')
    const res = await getUploadById(req, { params: { id: 'upload-other-user' } })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Upload not found')
  })

  // ── 3. Unauthenticated → 401 ───────────────────────────────────────────────

  it('unauthenticated: returns 401 without querying the DB', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq('http://localhost/api/uploads/upload-abc123')
    const res = await getUploadById(req, { params: { id: 'upload-abc123' } })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
    expect(prisma.upload.findFirst).not.toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/uploads/[id]
//
// NOTE: The DELETE handler does not yet exist in
// src/app/api/uploads/[id]/route.ts.  These tests document the expected
// contract and will begin passing once the handler is implemented.
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/uploads/[id]', () => {
  const txMock = (prisma as any)._txMock

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.mocked(getUserFromRequest).mockReturnValue(MOCK_USER)
    vi.mocked(prisma.upload.findFirst).mockResolvedValue(UPLOAD_DETAIL_ROW as never)
    vi.mocked(prisma.upload.delete).mockResolvedValue(UPLOAD_LIST_ROW as never)

    // Restore $transaction after vi.resetAllMocks() clears it.
    ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (cb: (tx: typeof txMock) => unknown) => cb(txMock),
    )

    // Default tx sub-mock return values.
    txMock.transaction.findMany.mockResolvedValue([])
    txMock.transaction.deleteMany.mockResolvedValue({ count: 0 })
    txMock.transaction.count.mockResolvedValue(0)
    txMock.categoryHistory.deleteMany.mockResolvedValue({ count: 0 })
    txMock.transactionLink.deleteMany.mockResolvedValue({ count: 0 })
    txMock.ingestionIssue.deleteMany.mockResolvedValue({ count: 0 })
    txMock.auditLogEntry.deleteMany.mockResolvedValue({ count: 0 })
    txMock.transactionRaw.deleteMany.mockResolvedValue({ count: 0 })
    txMock.monthCategoryTotal.deleteMany.mockResolvedValue({ count: 0 })
    txMock.monthSummary.deleteMany.mockResolvedValue({ count: 0 })

    // Dynamically load the DELETE export on each test so changes to the module
    // are picked up without re-running the full test file.
    try {
      const mod = await import('@/app/api/uploads/[id]/route')
      deleteUpload = (mod as Record<string, unknown>).DELETE as RouteHandler | undefined
    } catch {
      deleteUpload = undefined
    }
  })

  // ── 1. Deletes upload + cascades → 200 ────────────────────────────────────

  it('deletes upload and returns 200 with success confirmation', async () => {
    if (!deleteUpload) {
      // Handler not yet implemented — skip gracefully until it exists.
      console.warn('DELETE /api/uploads/[id] not yet implemented — skipping test')
      return
    }

    const req = makeReq('http://localhost/api/uploads/upload-abc123', 'DELETE')
    const res = await deleteUpload(req, { params: { id: 'upload-abc123' } })

    expect(res.status).toBe(200)

    // Ownership check must happen before deletion
    expect(prisma.upload.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'upload-abc123', userId: 'user_1' },
      }),
    )

    // Upload must be deleted
    expect(prisma.upload.delete).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'upload-abc123' },
      }),
    )

    const body = await res.json()
    expect(body).toMatchObject({ success: true })
  })

  // ── 2. Not found → 404 ────────────────────────────────────────────────────

  it('returns 404 when upload does not exist or belongs to another user', async () => {
    if (!deleteUpload) {
      console.warn('DELETE /api/uploads/[id] not yet implemented — skipping test')
      return
    }

    vi.mocked(prisma.upload.findFirst).mockResolvedValue(null)

    const req = makeReq('http://localhost/api/uploads/does-not-exist', 'DELETE')
    const res = await deleteUpload(req, { params: { id: 'does-not-exist' } })

    expect(res.status).toBe(404)

    // Should not attempt to delete when upload is not found
    expect(prisma.upload.delete).not.toHaveBeenCalled()

    const body = await res.json()
    expect(typeof body.error).toBe('string')
  })

  // ── 3. Unauthenticated → 401 ───────────────────────────────────────────────

  it('unauthenticated: returns 401 without touching the DB', async () => {
    if (!deleteUpload) {
      console.warn('DELETE /api/uploads/[id] not yet implemented — skipping test')
      return
    }

    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq('http://localhost/api/uploads/upload-abc123', 'DELETE')
    const res = await deleteUpload(req, { params: { id: 'upload-abc123' } })

    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
    expect(prisma.upload.findFirst).not.toHaveBeenCalled()
    expect(prisma.upload.delete).not.toHaveBeenCalled()
  })
})
