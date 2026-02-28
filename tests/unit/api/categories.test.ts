import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Hoist mock objects so they are available inside vi.mock() factories ──────
const {
  mockCategory,
  mockTransaction,
  mockCategoryRule,
  mockMonthCategoryTotal,
  mockMonthSummary,
  mockInvalidateCache,
  mockGetUser,
} = vi.hoisted(() => ({
  mockCategory: {
    findMany:  vi.fn(),
    findFirst: vi.fn(),
    create:    vi.fn(),
    update:    vi.fn(),
    delete:    vi.fn(),
  },
  mockTransaction: {
    updateMany: vi.fn(),
  },
  mockCategoryRule: {
    deleteMany: vi.fn(),
  },
  mockMonthCategoryTotal: {
    deleteMany: vi.fn(),
  },
  mockMonthSummary: {
    updateMany: vi.fn(),
  },
  mockInvalidateCache: vi.fn(),
  mockGetUser:         vi.fn(),
}))

// ─── Module mocks ─────────────────────────────────────────────────────────────
vi.mock('@/lib/auth', () => ({ getUserFromRequest: mockGetUser }))

vi.mock('@/lib/categorization/engine', () => ({
  invalidateCategoryCache: mockInvalidateCache,
}))

vi.mock('@/lib/db', () => ({
  default: {
    category:           mockCategory,
    transaction:        mockTransaction,
    categoryRule:       mockCategoryRule,
    monthCategoryTotal: mockMonthCategoryTotal,
    monthSummary:       mockMonthSummary,
  },
}))

// ─── Route handlers (imported after mocks) ────────────────────────────────────
import { GET as listCategories, POST as createCategory } from '@/app/api/categories/route'
import { PATCH as updateCategory, DELETE as deleteCategory } from '@/app/api/categories/[id]/route'

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const userCategory = {
  id:         'cat_1',
  userId:     'user_1',
  name:       'Food',
  color:      '#f97316',
  icon:       '🍔',
  isIncome:   false,
  isTransfer: false,
  isSystem:   false,
  sortOrder:  1,
}

const systemCategory = {
  id:         'sys_1',
  userId:     null,
  name:       'Other',
  color:      '#94a3b8',
  icon:       '📦',
  isIncome:   false,
  isTransfer: false,
  isSystem:   true,
  sortOrder:  0,
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
})

// =============================================================================
// GET /api/categories
// =============================================================================
describe('GET /api/categories', () => {
  it('returns system + user categories → 200', async () => {
    mockCategory.findMany.mockResolvedValue([systemCategory, userCategory])

    const req = makeReq('http://localhost/api/categories')
    const res = await listCategories(req)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.categories).toHaveLength(2)
    expect(body.categories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'sys_1', isSystem: true }),
        expect.objectContaining({ id: 'cat_1', isSystem: false }),
      ]),
    )
    expect(mockCategory.findMany).toHaveBeenCalledOnce()
  })

  it('unauthenticated request → 401', async () => {
    mockGetUser.mockReturnValue(null)

    const req = makeReq('http://localhost/api/categories')
    const res = await listCategories(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ error: 'Unauthorized' })
    expect(mockCategory.findMany).not.toHaveBeenCalled()
  })
})

// =============================================================================
// POST /api/categories
// =============================================================================
describe('POST /api/categories', () => {
  it('creates user category → 201', async () => {
    mockCategory.create.mockResolvedValue(userCategory)

    const req = makeReq('http://localhost/api/categories', {
      method: 'POST',
      body:   { name: 'Food', color: '#f97316', icon: '🍔', isIncome: false },
    })
    const res = await createCategory(req)
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.category).toMatchObject({ name: 'Food' })
    expect(mockCategory.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name:     'Food',
          userId:   'user_1',
          isSystem: false,
        }),
      }),
    )
    expect(mockInvalidateCache).toHaveBeenCalledOnce()
  })

  it('missing name → 400', async () => {
    const req = makeReq('http://localhost/api/categories', {
      method: 'POST',
      body:   { color: '#f97316' },   // name is required (min length 1)
    })
    const res = await createCategory(req)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
    expect(mockCategory.create).not.toHaveBeenCalled()
  })

  it('unauthenticated request → 401', async () => {
    mockGetUser.mockReturnValue(null)

    const req = makeReq('http://localhost/api/categories', {
      method: 'POST',
      body:   { name: 'Food' },
    })
    const res = await createCategory(req)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ error: 'Unauthorized' })
    expect(mockCategory.create).not.toHaveBeenCalled()
  })
})

// =============================================================================
// PATCH /api/categories/[id]
// =============================================================================
describe('PATCH /api/categories/[id]', () => {
  const params = { params: { id: 'cat_1' } }

  it('updates category owned by user → 200', async () => {
    const updatedCategory = { ...userCategory, name: 'Groceries' }
    mockCategory.findFirst.mockResolvedValue(userCategory)
    mockCategory.update.mockResolvedValue(updatedCategory)

    const req = makeReq('http://localhost/api/categories/cat_1', {
      method: 'PATCH',
      body:   { name: 'Groceries' },
    })
    const res = await updateCategory(req, params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.category).toMatchObject({ name: 'Groceries' })
    expect(mockCategory.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'cat_1' } }),
    )
    expect(mockInvalidateCache).toHaveBeenCalledOnce()
  })

  it('system category update → 404 (route excludes isSystem:true in ownership query)', async () => {
    // Route: findFirst({ where: { id, userId: payload.userId, isSystem: false } })
    // A system category has userId: null — it will never match → returns null → 404
    mockCategory.findFirst.mockResolvedValue(null)

    const req = makeReq('http://localhost/api/categories/sys_1', {
      method: 'PATCH',
      body:   { name: 'Hacked' },
    })
    const res = await updateCategory(req, { params: { id: 'sys_1' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ error: 'Category not found or cannot be edited' })
    expect(mockCategory.update).not.toHaveBeenCalled()
  })

  it('not found → 404', async () => {
    mockCategory.findFirst.mockResolvedValue(null)

    const req = makeReq('http://localhost/api/categories/nonexistent', {
      method: 'PATCH',
      body:   { name: 'Ghost' },
    })
    const res = await updateCategory(req, { params: { id: 'nonexistent' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ error: 'Category not found or cannot be edited' })
  })

  it('unauthenticated request → 401', async () => {
    mockGetUser.mockReturnValue(null)

    const req = makeReq('http://localhost/api/categories/cat_1', {
      method: 'PATCH',
      body:   { name: 'Food' },
    })
    const res = await updateCategory(req, params)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ error: 'Unauthorized' })
    expect(mockCategory.findFirst).not.toHaveBeenCalled()
  })
})

// =============================================================================
// DELETE /api/categories/[id]
// =============================================================================
describe('DELETE /api/categories/[id]', () => {
  const params = { params: { id: 'cat_1' } }

  beforeEach(() => {
    // Default happy path: ownership check passes, fallback "Other" found, writes succeed
    mockCategory.findFirst
      .mockResolvedValueOnce(userCategory)     // ownership check
      .mockResolvedValueOnce(systemCategory)   // fallback "Other" category lookup
    mockTransaction.updateMany.mockResolvedValue({ count: 0 })
    mockCategoryRule.deleteMany.mockResolvedValue({ count: 0 })
    mockMonthCategoryTotal.deleteMany.mockResolvedValue({ count: 0 })
    mockCategory.delete.mockResolvedValue(userCategory)
    mockMonthSummary.updateMany.mockResolvedValue({ count: 0 })
  })

  it('deletes user category → 200 with { deleted: true }', async () => {
    const req = makeReq('http://localhost/api/categories/cat_1', { method: 'DELETE' })
    const res = await deleteCategory(req, params)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ deleted: true })
    expect(mockCategory.delete).toHaveBeenCalledWith({ where: { id: 'cat_1' } })
    expect(mockInvalidateCache).toHaveBeenCalledOnce()
  })

  it('marks month summaries as stale on delete', async () => {
    const req = makeReq('http://localhost/api/categories/cat_1', { method: 'DELETE' })
    await deleteCategory(req, params)

    expect(mockMonthSummary.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: 'user_1' },
        data:  { isStale: true },
      }),
    )
  })

  it('system category → 404 (route excludes isSystem:true in ownership query)', async () => {
    // Reset mocks to override the beforeEach defaults for this case
    mockCategory.findFirst.mockReset()
    mockCategory.findFirst.mockResolvedValue(null)

    const req = makeReq('http://localhost/api/categories/sys_1', { method: 'DELETE' })
    const res = await deleteCategory(req, { params: { id: 'sys_1' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ error: 'Category not found or cannot be deleted' })
    expect(mockCategory.delete).not.toHaveBeenCalled()
  })

  it('not found → 404', async () => {
    mockCategory.findFirst.mockReset()
    mockCategory.findFirst.mockResolvedValue(null)

    const req = makeReq('http://localhost/api/categories/nonexistent', { method: 'DELETE' })
    const res = await deleteCategory(req, { params: { id: 'nonexistent' } })
    const body = await res.json()

    expect(res.status).toBe(404)
    expect(body).toMatchObject({ error: 'Category not found or cannot be deleted' })
    expect(mockCategory.delete).not.toHaveBeenCalled()
  })

  it('unauthenticated request → 401', async () => {
    mockGetUser.mockReturnValue(null)

    const req = makeReq('http://localhost/api/categories/cat_1', { method: 'DELETE' })
    const res = await deleteCategory(req, params)
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toMatchObject({ error: 'Unauthorized' })
    expect(mockCategory.findFirst).not.toHaveBeenCalled()
  })
})
