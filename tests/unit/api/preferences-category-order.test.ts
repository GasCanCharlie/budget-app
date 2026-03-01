import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockUser = vi.hoisted(() => ({ id: 'user1', categoryOrder: '["cat1","cat2"]' }))
const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('@/lib/db', () => ({ default: mockPrisma }))
vi.mock('@/lib/auth', () => ({
  getUserFromRequest: vi.fn(() => ({ userId: 'user1' })),
}))

import { GET, PUT } from '@/app/api/preferences/category-order/route'

function makeReq(method: string, body?: unknown) {
  return new NextRequest('http://localhost/api/preferences/category-order', {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

describe('GET /api/preferences/category-order', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns parsed order from DB', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(mockUser)
    const res = await GET(makeReq('GET'))
    const body = await res.json()
    expect(body.order).toEqual(['cat1', 'cat2'])
  })

  it('returns empty array when user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null)
    const res = await GET(makeReq('GET'))
    const body = await res.json()
    expect(body.order).toEqual([])
  })

  it('returns empty array when categoryOrder is malformed JSON', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, categoryOrder: 'NOT_JSON' })
    const res = await GET(makeReq('GET'))
    const body = await res.json()
    expect(body.order).toEqual([])
  })
})

describe('PUT /api/preferences/category-order', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('saves order to DB', async () => {
    mockPrisma.user.update.mockResolvedValue({})
    const res = await PUT(makeReq('PUT', { order: ['a', 'b', 'c'] }))
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user1' },
      data: { categoryOrder: JSON.stringify(['a', 'b', 'c']) },
    })
  })

  it('filters out non-string values', async () => {
    mockPrisma.user.update.mockResolvedValue({})
    await PUT(makeReq('PUT', { order: ['a', 1, null, 'b'] }))
    const call = mockPrisma.user.update.mock.calls[0][0]
    expect(JSON.parse(call.data.categoryOrder)).toEqual(['a', 'b'])
  })

  it('saves empty array when order missing', async () => {
    mockPrisma.user.update.mockResolvedValue({})
    await PUT(makeReq('PUT', {}))
    const call = mockPrisma.user.update.mock.calls[0][0]
    expect(JSON.parse(call.data.categoryOrder)).toEqual([])
  })
})
