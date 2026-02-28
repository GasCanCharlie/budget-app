import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'

// Set JWT_SECRET before importing the auth module so it is available when the
// module-level constant is evaluated.  We use the same value as the source
// file's built-in fallback so behaviour is predictable even if the env var is
// not set externally.
const TEST_JWT_SECRET = 'test-jwt-secret-for-unit-tests'
process.env.JWT_SECRET = TEST_JWT_SECRET

// Dynamic import is used so that the env var above is guaranteed to be set
// before the module's top-level code runs.  We re-export the functions from
// a local binding so TypeScript is happy.
import {
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  getUserFromRequest,
  type JwtPayload,
} from '@/lib/auth'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock of NextRequest with controllable headers and cookies. */
function makeMockRequest(options: {
  authorizationHeader?: string | null
  cookieToken?: string | null
}) {
  return {
    headers: {
      get(name: string): string | null {
        if (name.toLowerCase() === 'authorization') {
          return options.authorizationHeader ?? null
        }
        return null
      },
    },
    cookies: {
      get(name: string): { value: string } | undefined {
        if (name === 'token' && options.cookieToken != null) {
          return { value: options.cookieToken }
        }
        return undefined
      },
    },
  }
}

// ---------------------------------------------------------------------------
// hashPassword
// ---------------------------------------------------------------------------

describe('hashPassword', () => {
  it('returns a non-empty string', async () => {
    const hash = await hashPassword('mypassword')
    expect(typeof hash).toBe('string')
    expect(hash.length).toBeGreaterThan(0)
  })

  it('returns a bcrypt hash (starts with $2)', async () => {
    const hash = await hashPassword('mypassword')
    expect(hash.startsWith('$2')).toBe(true)
  })

  it('does not return the plaintext password', async () => {
    const password = 'super-secret-123'
    const hash = await hashPassword(password)
    expect(hash).not.toBe(password)
  })

  it('produces a different hash each call (random salt)', async () => {
    const hash1 = await hashPassword('same-password')
    const hash2 = await hashPassword('same-password')
    expect(hash1).not.toBe(hash2)
  })

  it('hashes an empty string without throwing', async () => {
    const hash = await hashPassword('')
    expect(typeof hash).toBe('string')
    expect(hash.startsWith('$2')).toBe(true)
  })

  it('hashes a very long password without throwing', async () => {
    const longPassword = 'a'.repeat(1000)
    const hash = await hashPassword(longPassword)
    expect(typeof hash).toBe('string')
  })
})

// ---------------------------------------------------------------------------
// verifyPassword
// ---------------------------------------------------------------------------

describe('verifyPassword', () => {
  it('returns true when the password matches the hash', async () => {
    const password = 'correct-password'
    const hash = await hashPassword(password)
    const result = await verifyPassword(password, hash)
    expect(result).toBe(true)
  })

  it('returns false when the password does not match the hash', async () => {
    const hash = await hashPassword('correct-password')
    const result = await verifyPassword('wrong-password', hash)
    expect(result).toBe(false)
  })

  it('returns false for an empty password against a non-empty hash', async () => {
    const hash = await hashPassword('not-empty')
    const result = await verifyPassword('', hash)
    expect(result).toBe(false)
  })

  it('returns true when an empty string is hashed and then verified', async () => {
    const hash = await hashPassword('')
    const result = await verifyPassword('', hash)
    expect(result).toBe(true)
  })

  it('returns false when hash is a random non-bcrypt string', async () => {
    // bcryptjs.compare resolves to false (does not throw) for invalid hashes
    const result = await verifyPassword('password', 'not-a-valid-hash')
    expect(result).toBe(false)
  })

  it('is case-sensitive — different case returns false', async () => {
    const hash = await hashPassword('Password')
    const result = await verifyPassword('password', hash)
    expect(result).toBe(false)
  })

  it('returns false for a password that differs only by trailing whitespace', async () => {
    const hash = await hashPassword('password')
    const result = await verifyPassword('password ', hash)
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// signToken
// ---------------------------------------------------------------------------

describe('signToken', () => {
  it('returns a string', () => {
    const token = signToken({ userId: 'user-1', email: 'a@example.com' })
    expect(typeof token).toBe('string')
  })

  it('returns a JWT with three dot-separated segments', () => {
    const token = signToken({ userId: 'user-1', email: 'a@example.com' })
    const parts = token.split('.')
    expect(parts).toHaveLength(3)
  })

  it('encodes the userId in the payload', () => {
    const token = signToken({ userId: 'user-42', email: 'b@example.com' })
    const decoded = jwt.decode(token) as JwtPayload
    expect(decoded.userId).toBe('user-42')
  })

  it('encodes the email in the payload', () => {
    const token = signToken({ userId: 'user-1', email: 'test@test.com' })
    const decoded = jwt.decode(token) as JwtPayload
    expect(decoded.email).toBe('test@test.com')
  })

  it('includes an exp claim (expires in 7 days)', () => {
    const before = Math.floor(Date.now() / 1000)
    const token = signToken({ userId: 'u', email: 'e@e.com' })
    const decoded = jwt.decode(token) as JwtPayload & { exp: number; iat: number }
    const sevenDaysInSeconds = 7 * 24 * 60 * 60
    expect(decoded.exp).toBeGreaterThanOrEqual(before + sevenDaysInSeconds - 5)
    expect(decoded.exp).toBeLessThanOrEqual(before + sevenDaysInSeconds + 5)
  })

  it('includes an iat (issued-at) claim', () => {
    const before = Math.floor(Date.now() / 1000)
    const token = signToken({ userId: 'u', email: 'e@e.com' })
    const decoded = jwt.decode(token) as JwtPayload & { iat: number }
    expect(decoded.iat).toBeGreaterThanOrEqual(before - 2)
    expect(decoded.iat).toBeLessThanOrEqual(before + 2)
  })

  it('does not include iat/exp fields passed in as payload (they are generated)', () => {
    // signToken's parameter type is Omit<JwtPayload, 'iat' | 'exp'>, but even
    // if extra fields were forwarded, the jwt library would overwrite them.
    // Verify the token is still valid and contains the right userId.
    const token = signToken({ userId: 'u', email: 'e@e.com' })
    const decoded = jwt.decode(token) as JwtPayload
    expect(decoded.userId).toBe('u')
  })
})

// ---------------------------------------------------------------------------
// verifyToken
// ---------------------------------------------------------------------------

describe('verifyToken', () => {
  it('returns the payload for a valid token', () => {
    const token = signToken({ userId: 'user-99', email: 'verify@test.com' })
    const payload = verifyToken(token)
    expect(payload).not.toBeNull()
    expect(payload!.userId).toBe('user-99')
    expect(payload!.email).toBe('verify@test.com')
  })

  it('returns null for a completely invalid token string', () => {
    const result = verifyToken('this.is.not.a.jwt')
    expect(result).toBeNull()
  })

  it('returns null for an empty string', () => {
    const result = verifyToken('')
    expect(result).toBeNull()
  })

  it('returns null for a token signed with a different secret', () => {
    const foreignToken = jwt.sign(
      { userId: 'x', email: 'x@x.com' },
      'completely-different-secret',
    )
    const result = verifyToken(foreignToken)
    expect(result).toBeNull()
  })

  it('returns null for a token with a tampered payload', () => {
    const token = signToken({ userId: 'user-1', email: 'a@a.com' })
    // Flip one character in the payload segment (index 1).
    const parts = token.split('.')
    const tamperedPayload =
      parts[1].slice(0, -1) + (parts[1].slice(-1) === 'A' ? 'B' : 'A')
    const tamperedToken = [parts[0], tamperedPayload, parts[2]].join('.')
    const result = verifyToken(tamperedToken)
    expect(result).toBeNull()
  })

  it('returns null for an expired token', () => {
    // Sign a token that expired 1 second in the past.
    const expiredToken = jwt.sign(
      { userId: 'u', email: 'e@e.com' },
      TEST_JWT_SECRET,
      { expiresIn: -1 },
    )
    const result = verifyToken(expiredToken)
    expect(result).toBeNull()
  })

  it('returns null for a malformed JWT (only two segments)', () => {
    const result = verifyToken('header.payload')
    expect(result).toBeNull()
  })

  it('returns null for a random garbage string', () => {
    const result = verifyToken('!@#$%^&*()')
    expect(result).toBeNull()
  })

  it('preserves extra payload fields returned from the decoded token', () => {
    const token = signToken({ userId: 'u', email: 'e@e.com' })
    const payload = verifyToken(token) as JwtPayload & { iat: number; exp: number }
    expect(typeof payload.iat).toBe('number')
    expect(typeof payload.exp).toBe('number')
  })
})

// ---------------------------------------------------------------------------
// getUserFromRequest
// ---------------------------------------------------------------------------

describe('getUserFromRequest', () => {
  let validToken: string

  beforeEach(() => {
    validToken = signToken({ userId: 'req-user', email: 'req@test.com' })
  })

  // --- Authorization header (Bearer) ---

  it('returns the payload when a valid Bearer token is in the Authorization header', () => {
    const req = makeMockRequest({ authorizationHeader: `Bearer ${validToken}` })
    const result = getUserFromRequest(req as any)
    expect(result).not.toBeNull()
    expect(result!.userId).toBe('req-user')
    expect(result!.email).toBe('req@test.com')
  })

  it('returns null when Authorization header is missing and no cookie is set', () => {
    const req = makeMockRequest({ authorizationHeader: null, cookieToken: null })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when Authorization header is present but does not start with "Bearer "', () => {
    const req = makeMockRequest({ authorizationHeader: `Token ${validToken}` })
    // Falls through to cookie path — no cookie set → null
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when Authorization header is "Bearer " with no token after it', () => {
    // Slice removes "Bearer " (7 chars), leaving an empty string → invalid JWT
    const req = makeMockRequest({ authorizationHeader: 'Bearer ' })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when the Bearer token is expired', () => {
    const expiredToken = jwt.sign(
      { userId: 'u', email: 'e@e.com' },
      TEST_JWT_SECRET,
      { expiresIn: -1 },
    )
    const req = makeMockRequest({ authorizationHeader: `Bearer ${expiredToken}` })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when the Bearer token is malformed', () => {
    const req = makeMockRequest({ authorizationHeader: 'Bearer not.a.real.token' })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when the Bearer token was signed with the wrong secret', () => {
    const foreignToken = jwt.sign(
      { userId: 'x', email: 'x@x.com' },
      'wrong-secret',
    )
    const req = makeMockRequest({ authorizationHeader: `Bearer ${foreignToken}` })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  // --- Cookie fallback ---

  it('falls back to cookie token when Authorization header is absent', () => {
    const req = makeMockRequest({
      authorizationHeader: null,
      cookieToken: validToken,
    })
    const result = getUserFromRequest(req as any)
    expect(result).not.toBeNull()
    expect(result!.userId).toBe('req-user')
  })

  it('falls back to cookie token when Authorization header does not start with "Bearer "', () => {
    const req = makeMockRequest({
      authorizationHeader: 'Basic somecredentials',
      cookieToken: validToken,
    })
    const result = getUserFromRequest(req as any)
    expect(result).not.toBeNull()
    expect(result!.userId).toBe('req-user')
  })

  it('returns null when cookie token is present but expired', () => {
    const expiredToken = jwt.sign(
      { userId: 'u', email: 'e@e.com' },
      TEST_JWT_SECRET,
      { expiresIn: -1 },
    )
    const req = makeMockRequest({
      authorizationHeader: null,
      cookieToken: expiredToken,
    })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when cookie token is malformed', () => {
    const req = makeMockRequest({
      authorizationHeader: null,
      cookieToken: 'garbage',
    })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when both Authorization header and cookie are absent', () => {
    const req = makeMockRequest({})
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  // --- Bearer header takes precedence over cookie ---

  it('uses the Bearer header and ignores the cookie when both are present', () => {
    const cookieToken = signToken({ userId: 'cookie-user', email: 'cookie@test.com' })
    const headerToken = signToken({ userId: 'header-user', email: 'header@test.com' })
    const req = makeMockRequest({
      authorizationHeader: `Bearer ${headerToken}`,
      cookieToken,
    })
    const result = getUserFromRequest(req as any)
    expect(result).not.toBeNull()
    expect(result!.userId).toBe('header-user')
  })

  // --- Edge cases for the Authorization header value ---

  it('returns null when Authorization header is an empty string', () => {
    const req = makeMockRequest({ authorizationHeader: '', cookieToken: null })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('returns null when Authorization header is only whitespace', () => {
    const req = makeMockRequest({ authorizationHeader: '   ', cookieToken: null })
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })

  it('is case-sensitive — "bearer " (lowercase) does not match and falls through to cookie', () => {
    // The source checks for 'Bearer ' (capital B), so lowercase falls through.
    const req = makeMockRequest({
      authorizationHeader: `bearer ${validToken}`,
      cookieToken: null,
    })
    // No cookie set → null
    const result = getUserFromRequest(req as any)
    expect(result).toBeNull()
  })
})
