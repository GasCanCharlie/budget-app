/**
 * API route tests for:
 *   POST /api/auth/register  (src/app/api/auth/register/route.ts)
 *   POST /api/auth/login     (src/app/api/auth/login/route.ts)
 *   GET  /api/auth/me        (src/app/api/auth/me/route.ts)
 *
 * Design notes
 * ------------
 * - '@/lib/db'   is fully mocked — no real DB calls.
 * - '@/lib/auth' is partially mocked: hashPassword / verifyPassword / signToken /
 *   verifyToken are kept real (real bcrypt + jsonwebtoken); only
 *   getUserFromRequest is replaced per-test so the /me route can be controlled
 *   without going through JWT Bearer parsing.
 * - register/route.ts guards duplicate email with findUnique, not a DB
 *   unique-constraint throw, so duplicates return 400 (not 409).
 * - login/route.ts always calls verifyPassword (timing-safe) even when the
 *   user is not found — the real bcrypt compare handles that correctly.
 * - vi.hoisted() is required for any variable referenced inside a vi.mock()
 *   factory, because vi.mock() calls are hoisted to the top of the file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mock references
// vi.hoisted() runs before vi.mock() factories so the variables are available
// when the factory closures are evaluated.
// ---------------------------------------------------------------------------

const { mockFindUnique, mockCreate, mockUpdate, mockGetUserFromRequest } = vi.hoisted(() => ({
  mockFindUnique:          vi.fn(),
  mockCreate:              vi.fn(),
  mockUpdate:              vi.fn(),
  mockGetUserFromRequest:  vi.fn(),
}))

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

vi.mock('@/lib/db', () => ({
  default: {
    user: {
      findUnique: mockFindUnique,
      create:     mockCreate,
      update:     mockUpdate,
    },
  },
}))

// ---------------------------------------------------------------------------
// Auth mock — keep real crypto helpers, only replace getUserFromRequest
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...real,
    getUserFromRequest: mockGetUserFromRequest,
  }
})

// ---------------------------------------------------------------------------
// Import routes AFTER mocks are declared
// ---------------------------------------------------------------------------

import { POST as register } from '@/app/api/auth/register/route'
import { POST as login }    from '@/app/api/auth/login/route'
import { GET  as me }       from '@/app/api/auth/me/route'
import { signToken, hashPassword } from '@/lib/auth'

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

const BASE_USER = {
  id:           'user_1',
  email:        'test@example.com',
  passwordHash: '$2b$12$placeholderHashValue0000000000000',
  createdAt:    new Date('2025-01-01T00:00:00.000Z'),
  deletedAt:    null as Date | null,
}

// ---------------------------------------------------------------------------
// Request factory
// ---------------------------------------------------------------------------

function makeReq(body: object, headers: Record<string, string> = {}) {
  return {
    json:    async () => body,
    headers: { get: (k: string) => headers[k] ?? null },
    cookies: { get: () => undefined },
  } as any
}

// ---------------------------------------------------------------------------
// Helper — extract parsed JSON body from a NextResponse
// ---------------------------------------------------------------------------

async function bodyOf(res: Response) {
  return res.json()
}

// ---------------------------------------------------------------------------
// POST /api/auth/register
// ---------------------------------------------------------------------------

describe('POST /api/auth/register', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 201 with token and user (no passwordHash) for valid input', async () => {
    mockFindUnique.mockResolvedValueOnce(null)           // no existing user
    mockCreate.mockResolvedValueOnce({ ...BASE_USER })   // newly created user

    const req  = makeReq({ email: 'test@example.com', password: 'securepassword1' })
    const res  = await register(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(201)

    // Token must be a proper JWT (three dot-separated segments)
    expect(body).toHaveProperty('token')
    expect(typeof body.token).toBe('string')
    expect(body.token.split('.')).toHaveLength(3)

    // User object must contain id + email only
    expect(body).toHaveProperty('user')
    expect(body.user).toEqual({ id: BASE_USER.id, email: BASE_USER.email })

    // Sensitive fields must never leak
    expect(body.user).not.toHaveProperty('passwordHash')
    expect(body).not.toHaveProperty('passwordHash')
  })

  it('returns 400 when email is missing', async () => {
    const req  = makeReq({ password: 'securepassword1' })
    const res  = await register(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when password is missing', async () => {
    const req  = makeReq({ email: 'test@example.com' })
    const res  = await register(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
  })

  it('returns 400 for a duplicate email (anti-enumeration — not 409)', async () => {
    // register/route.ts uses findUnique then returns 400 "Registration failed"
    // to avoid leaking whether an email is already registered.
    mockFindUnique.mockResolvedValueOnce({ ...BASE_USER })

    const req  = makeReq({ email: 'test@example.com', password: 'securepassword1' })
    const res  = await register(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body.error).toBe('Registration failed')
  })

  it('returns 400 when password is shorter than 8 characters', async () => {
    const req  = makeReq({ email: 'test@example.com', password: 'short' })
    const res  = await register(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when email format is invalid', async () => {
    const req  = makeReq({ email: 'not-an-email', password: 'securepassword1' })
    const res  = await register(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with token and user for valid credentials', async () => {
    // Hash a real password so real bcrypt verifyPassword resolves to true.
    const plainPassword = 'correctpassword1'
    const realHash      = await hashPassword(plainPassword)
    mockFindUnique.mockResolvedValueOnce({ ...BASE_USER, passwordHash: realHash })

    const req  = makeReq({ email: 'test@example.com', password: plainPassword })
    const res  = await login(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(200)

    expect(body).toHaveProperty('token')
    expect(typeof body.token).toBe('string')
    expect(body.token.split('.')).toHaveLength(3)

    expect(body).toHaveProperty('user')
    expect(body.user).toEqual({ id: BASE_USER.id, email: BASE_USER.email })
    expect(body.user).not.toHaveProperty('passwordHash')
  })

  it('returns 401 when the user is not found', async () => {
    // Route still calls verifyPassword with a dummy hash for timing safety;
    // real bcrypt returns false so the route correctly yields 401.
    mockFindUnique.mockResolvedValueOnce(null)

    const req  = makeReq({ email: 'ghost@example.com', password: 'anypassword1' })
    const res  = await login(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(401)
    expect(body.error).toBe('Invalid credentials')
  })

  it('returns 401 when the password is wrong', async () => {
    const correctHash = await hashPassword('correctpassword1')
    mockFindUnique.mockResolvedValueOnce({ ...BASE_USER, passwordHash: correctHash })

    const req  = makeReq({ email: 'test@example.com', password: 'wrongpassword1' })
    const res  = await login(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(401)
    expect(body.error).toBe('Invalid credentials')
  })

  it('returns 400 when email is missing', async () => {
    const req  = makeReq({ password: 'somepassword1' })
    const res  = await login(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when password is missing', async () => {
    const req  = makeReq({ email: 'test@example.com' })
    const res  = await login(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
  })

  it('returns 400 when email format is invalid', async () => {
    const req  = makeReq({ email: 'bad-email', password: 'somepassword1' })
    const res  = await login(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(400)
    expect(body).toHaveProperty('error')
  })
})

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 200 with the user object for a valid Bearer token', async () => {
    mockGetUserFromRequest.mockReturnValueOnce({ userId: BASE_USER.id, email: BASE_USER.email })
    mockFindUnique.mockResolvedValueOnce({
      id:        BASE_USER.id,
      email:     BASE_USER.email,
      createdAt: BASE_USER.createdAt,
    })

    const token = signToken({ userId: BASE_USER.id, email: BASE_USER.email })
    const req   = makeReq({}, { authorization: `Bearer ${token}` })
    const res   = await me(req)
    const body  = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(body).toHaveProperty('user')
    expect(body.user.id).toBe(BASE_USER.id)
    expect(body.user.email).toBe(BASE_USER.email)
    expect(body.user).toHaveProperty('createdAt')
    // Sensitive fields must not be present
    expect(body.user).not.toHaveProperty('passwordHash')
    expect(body.user).not.toHaveProperty('deletedAt')
  })

  it('returns 401 when no token is present', async () => {
    mockGetUserFromRequest.mockReturnValueOnce(null)

    const req  = makeReq({})
    const res  = await me(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when the token is invalid or expired', async () => {
    mockGetUserFromRequest.mockReturnValueOnce(null)

    const req  = makeReq({}, { authorization: 'Bearer totally.invalid.token' })
    const res  = await me(req)
    const body = await bodyOf(res)

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 404 when the user is not found in the DB (hard-deleted)', async () => {
    // Token decodes successfully but findUnique returns null — user was removed.
    mockGetUserFromRequest.mockReturnValueOnce({ userId: BASE_USER.id, email: BASE_USER.email })
    mockFindUnique.mockResolvedValueOnce(null)

    const token = signToken({ userId: BASE_USER.id, email: BASE_USER.email })
    const req   = makeReq({}, { authorization: `Bearer ${token}` })
    const res   = await me(req)
    const body  = await bodyOf(res)

    expect(res.status).toBe(404)
    expect(body.error).toBe('Not found')
  })

  it('returns 200 for a soft-deleted user because the route does not filter on deletedAt', async () => {
    // me/route.ts selects only { id, email, createdAt } — there is no where
    // clause on deletedAt, so a soft-deleted user whose row still exists is
    // returned as-is (the select projection excludes deletedAt entirely).
    mockGetUserFromRequest.mockReturnValueOnce({ userId: BASE_USER.id, email: BASE_USER.email })
    mockFindUnique.mockResolvedValueOnce({
      id:        BASE_USER.id,
      email:     BASE_USER.email,
      createdAt: BASE_USER.createdAt,
      // Prisma does not return deletedAt because it is not in the select list
    })

    const token = signToken({ userId: BASE_USER.id, email: BASE_USER.email })
    const req   = makeReq({}, { authorization: `Bearer ${token}` })
    const res   = await me(req)
    const body  = await bodyOf(res)

    expect(res.status).toBe(200)
    expect(body.user.id).toBe(BASE_USER.id)
  })

  it('queries prisma with the userId extracted from the token payload', async () => {
    mockGetUserFromRequest.mockReturnValueOnce({ userId: BASE_USER.id, email: BASE_USER.email })
    mockFindUnique.mockResolvedValueOnce({
      id:        BASE_USER.id,
      email:     BASE_USER.email,
      createdAt: BASE_USER.createdAt,
    })

    const req = makeReq({})
    await me(req)

    expect(mockFindUnique).toHaveBeenCalledOnce()
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: BASE_USER.id } }),
    )
  })
})
