import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoist mock objects so they are available inside vi.mock() factories ──────
const {
  mockTransaction,
  mockCategoryHistory,
  mockMonthSummary,
  mockCategoryRule,
  mockComputeMonthSummary,
  mockGetUser,
} = vi.hoisted(() => ({
  mockTransaction: {
    findMany:   vi.fn(),
    findFirst:  vi.fn(),
    count:      vi.fn(),
    update:     vi.fn(),
    updateMany: vi.fn(),
  },
  mockCategoryHistory: {
    create: vi.fn(),
  },
  mockMonthSummary: {
    updateMany: vi.fn(),
  },
  mockCategoryRule: {
    findFirst: vi.fn(),
    upsert:    vi.fn(),
  },
  mockComputeMonthSummary: vi.fn(),
  mockGetUser:             vi.fn(),
}))

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('@/lib/auth', () => ({ getUserFromRequest: mockGetUser }))

vi.mock('@/lib/intelligence/summaries', () => ({
  computeMonthSummary: mockComputeMonthSummary,
}))

vi.mock('@/lib/db', () => ({
  default: {
    transaction:     mockTransaction,
    categoryHistory: mockCategoryHistory,
    monthSummary:    mockMonthSummary,
    categoryRule:    mockCategoryRule,
  },
}))

// ─── Route handlers (imported after mocks) ────────────────────────────────────
import { GET as listTransactions } from '@/app/api/transactions/route'
import { PATCH as patchTransaction } from '@/app/api/transactions/[id]/route'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const txFixture = {
  id:                    'tx_1',
  accountId:             'acct_1',
  uploadId:              'up_1',
  date:                  new Date('2024-03-15'),
  description:           'Starbucks',
  amount:                -5.50,
  categoryId:            'cat_1',
  userOverrideCategoryId: null,
  isTransfer:            false,
  isDuplicate:           false,
  isExcluded:            false,
  isForeignCurrency:     false,
  foreignAmount:         null,
  foreignCurrency:       null,
  isPossibleDuplicate:   false,
  reviewedByUser:        false,
  categorizationSource:  'auto',
  confidenceScore:       0.9,
  merchantNormalized:    'Starbucks',
  ingestionStatus:       'VALID',
  dateAmbiguity:         null,
  dateInterpretationA:   null,
  dateInterpretationB:   null,
  account:               { userId: 'user_1' },
  category:              { id: 'cat_1', name: 'Coffee', color: '#a16207', icon: '☕' },
  overrideCategory:      null,
  historyEntries:        [],
}

// ─── Helper ───────────────────────────────────────────────────────────────────
function makeReq(url: string, options: { method?: string; body?: unknown } = {}): NextRequest {
  const init: RequestInit = { method: options.method ?? 'GET' }
  if (options.body !== undefined) {
    init.body    = JSON.stringify(options.body)
    init.headers = { 'content-type': 'application/json' }
  }
  return new NextRequest(url, init)
}

// ─── beforeEach: authenticated by default ─────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks()
  mockGetUser.mockReturnValue({ userId: 'user_1', email: 'test@example.com' })
  mockComputeMonthSummary.mockResolvedValue(undefined)
})

// =============================================================================
// GET /api/transactions
// =============================================================================
describe('GET /api/transactions', () => {
  it('returns paginated transactions for user → 200', async () => {
    mockTransaction.findMany.mockResolvedValue([txFixture])
    mockTransaction.count
      .mockResolvedValueOnce(1)   // total
      .mockResolvedValueOnce(0)   // flaggedCount
      .mockResolvedValueOnce(0)   // duplicateCount

    const req = makeReq('http://localhost/api/transactions')
    const res = await listTransactions(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      total:          1,
      page:           1,
      pages:          1,
      flaggedCount:   0,
      duplicateCount: 0,
    })
    expect(body.transactions).toHaveLength(1)
    expect(body.transactions[0]).toMatchObject({
      id:          'tx_1',
      description: 'Starbucks',
      amount:      -5.50,
    })
  })

  it('respects page/limit query params — uses correct skip/take and returns pages count', async () => {
    // page=2, limit=5 → skip=5, take=5; total=12 → pages=ceil(12/5)=3
    mockTransaction.findMany.mockResolvedValue([])
    mockTransaction.count
      .mockResolvedValueOnce(12)  // total
      .mockResolvedValueOnce(0)   // flaggedCount
      .mockResolvedValueOnce(0)   // duplicateCount

    const req = makeReq('http://localhost/api/transactions?page=2&limit=5')
    const res = await listTransactions(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.page).toBe(2)
    expect(body.pages).toBe(3)
    expect(mockTransaction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 }),
    )
  })

  it('unauthenticated request → 401', async () => {
    mockGetUser.mockReturnValue(null)

    const req = makeReq('http://localhost/api/transactions')
    const res = await listTransactions(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ error: 'Unauthorized' })
    expect(mockTransaction.findMany).not.toHaveBeenCalled()
  })
})

// =============================================================================
// PATCH /api/transactions/[id]
// =============================================================================
describe('PATCH /api/transactions/[id]', () => {
  const params = { params: { id: 'tx_1' } }

  it('updates categoryId (user override) → 200 with { updated: 1 }', async () => {
    mockTransaction.findFirst.mockResolvedValue(txFixture)
    mockCategoryHistory.create.mockResolvedValue({})
    mockTransaction.update.mockResolvedValue({
      ...txFixture,
      userOverrideCategoryId: 'cat_2',
      reviewedByUser:         true,
    })
    mockMonthSummary.updateMany.mockResolvedValue({ count: 1 })

    const req = makeReq('http://localhost/api/transactions/tx_1', {
      method: 'PATCH',
      body:   { categoryId: 'cat_2' },
    })
    const res = await patchTransaction(req, params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ updated: 1 })
    expect(mockTransaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx_1' },
        data:  expect.objectContaining({
          userOverrideCategoryId: 'cat_2',
          reviewedByUser:         true,
        }),
      }),
    )
  })

  it('records a CategoryHistory entry when categoryId changes', async () => {
    mockTransaction.findFirst.mockResolvedValue(txFixture)
    mockCategoryHistory.create.mockResolvedValue({})
    mockTransaction.update.mockResolvedValue({
      ...txFixture,
      userOverrideCategoryId: 'cat_2',
    })
    mockMonthSummary.updateMany.mockResolvedValue({ count: 0 })

    const req = makeReq('http://localhost/api/transactions/tx_1', {
      method: 'PATCH',
      body:   { categoryId: 'cat_2' },
    })
    await patchTransaction(req, params)

    expect(mockCategoryHistory.create).toHaveBeenCalledOnce()
    expect(mockCategoryHistory.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        transactionId: 'tx_1',
        oldCategoryId: 'cat_1',   // txFixture.categoryId (no existing override)
        newCategoryId: 'cat_2',
        changedBy:     'user',
      }),
    })
  })

  it('invalidates and recomputes month summary cache when recategorizing', async () => {
    mockTransaction.findFirst.mockResolvedValue(txFixture)
    mockCategoryHistory.create.mockResolvedValue({})
    mockTransaction.update.mockResolvedValue({
      ...txFixture,
      userOverrideCategoryId: 'cat_2',
    })
    mockMonthSummary.updateMany.mockResolvedValue({ count: 0 })

    const req = makeReq('http://localhost/api/transactions/tx_1', {
      method: 'PATCH',
      body:   { categoryId: 'cat_2' },
    })
    await patchTransaction(req, params)

    // Month from txFixture.date = 2024-03-15 → year=2024, month=3
    expect(mockMonthSummary.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_1', year: 2024, month: 3 },
        data:  { isStale: true },
      }),
    )
    expect(mockComputeMonthSummary).toHaveBeenCalledWith('user_1', 2024, 3)
  })

  it('transaction not found / wrong owner → 404', async () => {
    mockTransaction.findFirst.mockResolvedValue(null)

    const req = makeReq('http://localhost/api/transactions/tx_999', {
      method: 'PATCH',
      body:   { categoryId: 'cat_2' },
    })
    const res = await patchTransaction(req, { params: { id: 'tx_999' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ error: 'Transaction not found' })
    expect(mockCategoryHistory.create).not.toHaveBeenCalled()
    expect(mockTransaction.update).not.toHaveBeenCalled()
  })

  it('unauthenticated request → 401', async () => {
    mockGetUser.mockReturnValue(null)

    const req = makeReq('http://localhost/api/transactions/tx_1', {
      method: 'PATCH',
      body:   { categoryId: 'cat_2' },
    })
    const res = await patchTransaction(req, params)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ error: 'Unauthorized' })
    expect(mockTransaction.findFirst).not.toHaveBeenCalled()
    expect(mockCategoryHistory.create).not.toHaveBeenCalled()
  })
})
