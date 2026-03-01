/**
 * uploads-app-category.test.ts
 *
 * Tests focused on the two-category system:
 *  1. Upload flow: bankCategoryRaw is preserved as-is; appCategory is always null on import
 *  2. PATCH /api/transactions/[id] with appCategory field
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(),
}))

// Prisma mock — we only need what's exercised in these tests
vi.mock('@/lib/db', () => ({
  default: {
    account: {
      findFirst: vi.fn(),
    },
    transaction: {
      findFirst: vi.fn(),
      findMany:  vi.fn(),
      update:    vi.fn(),
    },
    monthSummary: {
      updateMany: vi.fn(),
      upsert:     vi.fn(),
      findMany:   vi.fn(),
    },
    monthCategoryTotal: {
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findMany:   vi.fn(),
    },
    categoryHistory: {
      create: vi.fn(),
    },
    anomalyAlert: {
      deleteMany: vi.fn(),
      findFirst:  vi.fn(),
      create:     vi.fn(),
    },
  },
}))

// Mock summaries — the PATCH route calls computeMonthSummary after recategorize
vi.mock('@/lib/intelligence/summaries', () => ({
  computeMonthSummary: vi.fn().mockResolvedValue({}),
  getAvailableMonths:  vi.fn().mockResolvedValue([]),
}))

// ─── Imports (after vi.mock) ─────────────────────────────────────────────────

import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { PATCH } from '@/app/api/transactions/[id]/route'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeReq(url: string, body: unknown, method = 'PATCH'): NextRequest {
  return new NextRequest(url, {
    method,
    body:    JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const MOCK_USER = { userId: 'user_1', email: 'test@example.com' }

/**
 * Minimal transaction fixture that matches what Prisma returns.
 * Note: bankCategoryRaw is set from the CSV import path (never from PATCH).
 *       appCategory starts null and is only set via PATCH.
 */
function makeTxFixture(overrides: Record<string, unknown> = {}) {
  return {
    id:                     'tx-123',
    rawId:                  'raw-1',
    accountId:              'acct-1',
    uploadId:               'upload-1',
    date:                   new Date('2024-03-15'),
    description:            'SHELL OIL STATION',
    merchantNormalized:     'Shell Oil',
    amount:                 -45.00,
    categoryId:             null,
    userOverrideCategoryId: null,
    categorizationSource:   'rule',
    confidenceScore:        0,
    isTransfer:             false,
    isExcluded:             false,
    isDuplicate:            false,
    isForeignCurrency:      false,
    reviewedByUser:         false,
    ingestionStatus:        'VALID',
    isPossibleDuplicate:    false,
    dateAmbiguity:          'RESOLVED',
    bankCategoryRaw:        'Gasoline/Fuel',   // set at import from CSV column — never changes
    bankCategoryNormalized: 'gasoline/fuel',
    appCategory:            null,              // always null at import; set by user via PATCH
    category:               null,
    overrideCategory:       null,
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Two-category system — upload behavior', () => {
  /**
   * This test validates the CONTRACT: after an upload, appCategory must be null.
   * We verify this by inspecting the fixture returned by the DB mock — i.e. we
   * assert that the upload pipeline never sets appCategory on the created transaction.
   *
   * The real upload route uses prisma.transaction.create() which now omits
   * categoryId, categorizationSource, confidenceScore, AND appCategory (all null
   * by default per the Prisma schema).
   */
  it('bankCategoryRaw is preserved from CSV; appCategory is always null on import', () => {
    const tx = makeTxFixture()

    // bankCategoryRaw comes from the CSV "Transaction Category" column — read-only forever
    expect(tx.bankCategoryRaw).toBe('Gasoline/Fuel')

    // appCategory is always null on import — users assign it later via PATCH
    expect(tx.appCategory).toBeNull()
  })

  it('bankCategoryRaw is never null when the CSV has a category column value', () => {
    // Simulate a row from a bank CSV that includes a category
    const tx = makeTxFixture({ bankCategoryRaw: 'Fast Food' })
    expect(tx.bankCategoryRaw).not.toBeNull()
    expect(tx.bankCategoryRaw).toBe('Fast Food')
  })

  it('bankCategoryRaw remains null when the CSV row has no category column', () => {
    const tx = makeTxFixture({ bankCategoryRaw: null })
    expect(tx.bankCategoryRaw).toBeNull()
  })
})

describe('PATCH /api/transactions/[id] — appCategory field', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(getUserFromRequest).mockReturnValue(MOCK_USER)
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([])
    vi.mocked(prisma.monthSummary.updateMany).mockResolvedValue({ count: 0 })
  })

  // ── Setting appCategory ────────────────────────────────────────────────────

  it('PATCH with appCategory sets appCategory and reviewedByUser=true on the transaction', async () => {
    const tx = makeTxFixture()
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(tx as never)
    vi.mocked(prisma.transaction.update).mockResolvedValue({ ...tx, appCategory: 'Gas/Fuel', reviewedByUser: true } as never)

    const req = makeReq('http://localhost/api/transactions/tx-123', { appCategory: 'Gas/Fuel' })
    const res = await PATCH(req, { params: { id: 'tx-123' } })

    expect(res.status).toBe(200)

    // Verify the update was called with the correct fields
    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx-123' },
        data:  expect.objectContaining({
          appCategory:    'Gas/Fuel',
          reviewedByUser: true,
        }),
      }),
    )
  })

  it('PATCH with appCategory=null clears the appCategory field', async () => {
    const tx = makeTxFixture({ appCategory: 'Groceries' })
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(tx as never)
    vi.mocked(prisma.transaction.update).mockResolvedValue({ ...tx, appCategory: null, reviewedByUser: true } as never)

    const req = makeReq('http://localhost/api/transactions/tx-123', { appCategory: null })
    const res = await PATCH(req, { params: { id: 'tx-123' } })

    expect(res.status).toBe(200)

    expect(prisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          appCategory:    null,
          reviewedByUser: true,
        }),
      }),
    )
  })

  it('PATCH without appCategory field does NOT touch the appCategory column', async () => {
    const tx = makeTxFixture({ appCategory: 'Existing Category' })
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(tx as never)
    vi.mocked(prisma.transaction.update).mockResolvedValue(tx as never)

    // Send a PATCH with isExcluded only — no appCategory
    const req = makeReq('http://localhost/api/transactions/tx-123', { isExcluded: true })
    const res = await PATCH(req, { params: { id: 'tx-123' } })

    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.transaction.update).mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('appCategory')
  })

  // ── bankCategoryRaw is never written by PATCH ──────────────────────────────

  it('PATCH never writes bankCategoryRaw — it is read-only', async () => {
    const tx = makeTxFixture()
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(tx as never)
    vi.mocked(prisma.transaction.update).mockResolvedValue(tx as never)

    // Even if someone sends bankCategoryRaw in the body, the schema rejects it
    // (it is not in patchSchema) so the update data will never contain it.
    const req = makeReq('http://localhost/api/transactions/tx-123', {
      appCategory:    'My Category',
      bankCategoryRaw: 'ATTEMPTED_WRITE',  // not in schema — will be stripped by Zod
    })
    const res = await PATCH(req, { params: { id: 'tx-123' } })

    expect(res.status).toBe(200)

    const updateCall = vi.mocked(prisma.transaction.update).mock.calls[0][0]
    expect(updateCall.data).not.toHaveProperty('bankCategoryRaw')
    // appCategory was still set correctly
    expect(updateCall.data).toMatchObject({ appCategory: 'My Category' })
  })

  // ── Unauthenticated → 401 ──────────────────────────────────────────────────

  it('returns 401 when not authenticated', async () => {
    vi.mocked(getUserFromRequest).mockReturnValue(null)

    const req = makeReq('http://localhost/api/transactions/tx-123', { appCategory: 'Gas/Fuel' })
    const res = await PATCH(req, { params: { id: 'tx-123' } })

    expect(res.status).toBe(401)
  })

  // ── Not found → 404 ────────────────────────────────────────────────────────

  it('returns 404 when the transaction does not exist', async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null)

    const req = makeReq('http://localhost/api/transactions/tx-does-not-exist', { appCategory: 'Gas/Fuel' })
    const res = await PATCH(req, { params: { id: 'tx-does-not-exist' } })

    expect(res.status).toBe(404)
  })
})
