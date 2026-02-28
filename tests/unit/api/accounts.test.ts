/**
 * Unit tests for the accounts API endpoints.
 *
 * Routes under test:
 *   GET    /api/accounts            → src/app/api/accounts/route.ts
 *   POST   /api/accounts            → src/app/api/accounts/route.ts
 *   PATCH  /api/accounts/[id]       → src/app/api/accounts/[id]/route.ts
 *   DELETE /api/accounts/[id]       → src/app/api/accounts/[id]/route.ts
 *   POST   /api/accounts/[id]/reset → src/app/api/accounts/[id]/reset/route.ts
 *
 * NOTE: There is no GET /api/accounts/[id] handler in the current codebase.
 * The ownership-check tests that were specified for that route are covered
 * here via the PATCH handler which uses the same verifyOwnership() helper.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Mock @/lib/auth — must be hoisted before the route imports below
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', () => ({ getUserFromRequest: vi.fn() }))

// ---------------------------------------------------------------------------
// Mock @/lib/db — provide a full prisma mock with all methods used by the
// accounts routes: account.findMany, account.create, account.findFirst,
// account.update, account.delete, and $transaction.
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => {
  const account = {
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  }

  // $transaction receives a callback and calls it with a "tx" object that
  // mirrors the top-level prisma client (we reuse the same mock shapes).
  const txMock = {
    transaction: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    categoryHistory: { deleteMany: vi.fn() },
    transactionLink: { deleteMany: vi.fn() },
    transactionRaw: { deleteMany: vi.fn() },
    upload: { deleteMany: vi.fn() },
    monthCategoryTotal: { deleteMany: vi.fn() },
    monthSummary: { deleteMany: vi.fn() },
    account: {
      delete: vi.fn(),
    },
  }

  const $transaction = vi.fn(async (cb: (tx: typeof txMock) => unknown) => cb(txMock))

  return {
    default: { account, $transaction, _txMock: txMock },
  }
})

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

import { GET as listAccounts, POST as createAccount } from '@/app/api/accounts/route'
import { PATCH as patchAccount, DELETE as deleteAccount } from '@/app/api/accounts/[id]/route'
import { POST as resetAccount } from '@/app/api/accounts/[id]/reset/route'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal NextRequest stand-in for the routes under test. */
function makeReq(body?: object, headers: Record<string, string> = {}) {
  return {
    json: async () => body ?? {},
    headers: { get: (k: string) => headers[k] ?? null },
    cookies: { get: () => undefined },
  } as any
}

/** Standard account fixture owned by user_1. */
const ACCOUNT_FIXTURE = {
  id: 'acct_1',
  userId: 'user_1',
  name: 'Checking',
  institution: 'Chase',
  accountType: 'checking',
  currency: 'USD',
  createdAt: new Date(),
  archivedAt: null,
}

/** Standard authenticated user payload. */
const AUTH_USER = { userId: 'user_1', email: 'test@example.com' }

/** Convenience cast to access the internal tx mock. */
const txMock = (prisma as any)._txMock

// ---------------------------------------------------------------------------
// beforeEach — reset all mocks and restore default authenticated user
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getUserFromRequest).mockReturnValue(AUTH_USER)

  // Restore $transaction default behaviour after resetAllMocks clears it.
  ;(prisma.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (cb: (tx: typeof txMock) => unknown) => cb(txMock),
  )

  // Default tx sub-mocks used by both DELETE and reset routes.
  txMock.transaction.findMany.mockResolvedValue([])
  txMock.transaction.deleteMany.mockResolvedValue({ count: 0 })
  txMock.transaction.count.mockResolvedValue(0)
  txMock.categoryHistory.deleteMany.mockResolvedValue({ count: 0 })
  txMock.transactionLink.deleteMany.mockResolvedValue({ count: 0 })
  txMock.transactionRaw.deleteMany.mockResolvedValue({ count: 0 })
  txMock.upload.deleteMany.mockResolvedValue({ count: 0 })
  txMock.monthCategoryTotal.deleteMany.mockResolvedValue({ count: 0 })
  txMock.monthSummary.deleteMany.mockResolvedValue({ count: 0 })
  txMock.account.delete.mockResolvedValue(ACCOUNT_FIXTURE)
})

// ===========================================================================
// GET /api/accounts
// ===========================================================================

describe('GET /api/accounts', () => {
  it('returns 200 with list of accounts for authenticated user', async () => {
    const accountWithCount = { ...ACCOUNT_FIXTURE, _count: { transactions: 3 } }
    ;(prisma.account.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([accountWithCount])

    const req = makeReq()
    const res = await listAccounts(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.accounts).toHaveLength(1)
    expect(body.accounts[0].id).toBe('acct_1')
    expect(body.accounts[0]._count.transactions).toBe(3)

    // Ensure the query was scoped to the authenticated user and excludes archived.
    expect(prisma.account.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: 'user_1', archivedAt: null }),
      }),
    )
  })

  it('returns 401 when request is unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq()
    const res = await listAccounts(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(prisma.account.findMany).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /api/accounts
// ===========================================================================

describe('POST /api/accounts', () => {
  it('returns 201 with newly created account on valid body', async () => {
    const created = { ...ACCOUNT_FIXTURE, id: 'acct_new' }
    ;(prisma.account.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)

    const req = makeReq({ name: 'Checking', institution: 'Chase', accountType: 'checking' })
    const res = await createAccount(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.account.id).toBe('acct_new')
    expect(body.account.name).toBe('Checking')
    expect(prisma.account.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Checking', userId: 'user_1' }),
      }),
    )
  })

  it('returns 400 when name is missing', async () => {
    const req = makeReq({ institution: 'Chase' })
    const res = await createAccount(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(typeof body.error).toBe('string')
    expect(prisma.account.create).not.toHaveBeenCalled()
  })

  it('returns 400 when name is an empty string', async () => {
    const req = makeReq({ name: '' })
    const res = await createAccount(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(typeof body.error).toBe('string')
    expect(prisma.account.create).not.toHaveBeenCalled()
  })

  it('returns 401 when request is unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq({ name: 'Savings' })
    const res = await createAccount(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(prisma.account.create).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// GET /api/accounts/[id]
//
// NOTE: There is no GET handler exported from src/app/api/accounts/[id]/route.ts
// in the current codebase. The ownership-verification behaviour described in
// the spec is therefore exercised through the PATCH handler (which uses the
// identical verifyOwnership helper). If a GET handler is added in future,
// these tests should be moved / duplicated against it directly.
// ===========================================================================

describe('GET /api/accounts/[id] (ownership via PATCH)', () => {
  it('returns 200 (account) when account is owned by the authenticated user', async () => {
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_FIXTURE)
    ;(prisma.account.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...ACCOUNT_FIXTURE,
      name: 'Updated',
    })

    const req = makeReq({ name: 'Updated' })
    const res = await patchAccount(req, { params: { id: 'acct_1' } })

    expect(res.status).toBe(200)
    expect(prisma.account.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'acct_1', userId: 'user_1' } }),
    )
  })

  it('returns 404 when account does not exist', async () => {
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const req = makeReq({ name: 'X' })
    const res = await patchAccount(req, { params: { id: 'acct_missing' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Account not found')
  })

  it('returns 404 when account is owned by a different user', async () => {
    // findFirst returns null when the WHERE clause includes userId:'user_1'
    // but the account belongs to 'user_other' — simulated by returning null.
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    vi.mocked(getUserFromRequest).mockReturnValue({
      userId: 'user_other',
      email: 'other@example.com',
    })

    const req = makeReq({ name: 'Steal' })
    const res = await patchAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Account not found')
  })

  it('returns 401 when request is unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq({ name: 'X' })
    const res = await patchAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(prisma.account.findFirst).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// PATCH /api/accounts/[id]
// ===========================================================================

describe('PATCH /api/accounts/[id]', () => {
  it('returns 200 with updated account when name is patched', async () => {
    const updated = { ...ACCOUNT_FIXTURE, name: 'Business Checking' }
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_FIXTURE)
    ;(prisma.account.update as ReturnType<typeof vi.fn>).mockResolvedValue(updated)

    const req = makeReq({ name: 'Business Checking' })
    const res = await patchAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.account.name).toBe('Business Checking')
    expect(prisma.account.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'acct_1' },
        data: expect.objectContaining({ name: 'Business Checking' }),
      }),
    )
  })

  it('returns 404 when account is not found', async () => {
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const req = makeReq({ name: 'Ghost' })
    const res = await patchAccount(req, { params: { id: 'acct_ghost' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Account not found')
    expect(prisma.account.update).not.toHaveBeenCalled()
  })

  it('returns 401 when request is unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq({ name: 'No Auth' })
    const res = await patchAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(prisma.account.findFirst).not.toHaveBeenCalled()
    expect(prisma.account.update).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// DELETE /api/accounts/[id]
// ===========================================================================

describe('DELETE /api/accounts/[id]', () => {
  it('returns 200 with success:true after deleting account and all related data', async () => {
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_FIXTURE)
    // Simulate 2 transactions belonging to this account (both in same month).
    txMock.transaction.findMany.mockResolvedValue([
      { id: 'tx_1', date: new Date('2024-03-15') },
      { id: 'tx_2', date: new Date('2024-03-22') },
    ])
    txMock.transaction.deleteMany.mockResolvedValue({ count: 2 })
    // After deleting, no remaining transactions in that month for the user.
    txMock.transaction.count.mockResolvedValue(0)

    const req = makeReq()
    const res = await deleteAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.deletedTransactions).toBe(2)

    // Verify the account deletion step was called.
    expect(txMock.account.delete).toHaveBeenCalledWith({ where: { id: 'acct_1' } })
  })

  it('returns 404 when account is not found', async () => {
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const req = makeReq()
    const res = await deleteAccount(req, { params: { id: 'acct_ghost' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Account not found')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 401 when request is unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq()
    const res = await deleteAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(prisma.account.findFirst).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// POST /api/accounts/[id]/reset
// ===========================================================================

describe('POST /api/accounts/[id]/reset', () => {
  it('returns 200 with deleted transaction count after wiping account data', async () => {
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(ACCOUNT_FIXTURE)
    txMock.transaction.findMany.mockResolvedValue([
      { id: 'tx_1', date: new Date('2024-06-01') },
      { id: 'tx_2', date: new Date('2024-06-15') },
      { id: 'tx_3', date: new Date('2024-06-20') },
    ])
    txMock.transaction.deleteMany.mockResolvedValue({ count: 3 })
    txMock.upload.deleteMany.mockResolvedValue({ count: 1 })
    txMock.transaction.count.mockResolvedValue(0)

    const req = makeReq()
    const res = await resetAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.deletedTransactions).toBe(3)
    expect(body.accountName).toBe('Checking')

    // The account row itself must NOT be deleted in a reset.
    expect(txMock.account.delete).not.toHaveBeenCalled()
  })

  it('returns 404 when account is not found or belongs to a different user', async () => {
    ;(prisma.account.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const req = makeReq()
    const res = await resetAccount(req, { params: { id: 'acct_other' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body.error).toBe('Account not found')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('returns 401 when request is unauthenticated', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq()
    const res = await resetAccount(req, { params: { id: 'acct_1' } })
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
    expect(prisma.account.findFirst).not.toHaveBeenCalled()
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})
