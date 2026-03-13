import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/db'
import { verifyPassword, signToken } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const schema = z.object({
  email:    z.string().email(),
  password: z.string(),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = schema.parse(body)

    const ip = getClientIp(req)
    const rl = await checkRateLimit(ip, 'login')
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) } }
      )
    }

    const user = await prisma.user.findUnique({ where: { email } })
    // Always hash-compare to prevent timing attacks
    const hash = user?.passwordHash || '$2b$12$invalidsaltinvalidsaltinvalid00'
    const valid = await verifyPassword(password, hash)

    if (!user || !valid) {
      return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
    }

    const token = signToken({ userId: user.id, email: user.email })
    const res = NextResponse.json({ user: { id: user.id, email: user.email }, token })
    res.cookies.set('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 7 })
    return res
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
