import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { Resend } from 'resend'
import prisma from '@/lib/db'
import { hashPassword, signToken } from '@/lib/auth'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const schema = z.object({
  email:    z.string().email(),
  password: z.string().min(8).max(128),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { email, password } = schema.parse(body)

    const ip = getClientIp(req)
    const rl = await checkRateLimit(ip, 'register')
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) } }
      )
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    // Constant-time response to prevent email enumeration
    if (existing) {
      await new Promise(r => setTimeout(r, 500))
      return NextResponse.json({ error: 'Registration failed' }, { status: 400 })
    }

    const passwordHash = await hashPassword(password)
    const user = await prisma.user.create({ data: { email, passwordHash } })

    const token = signToken({ userId: user.id, email: user.email })

    if (process.env.RESEND_API_KEY) {
      const resend = new Resend(process.env.RESEND_API_KEY)
      resend.emails.send({
        from:    'Financial Autopsy <support@financialautopsy.com>',
        to:      'chad.hamman@mauilegalservesolutions.com',
        subject: '🧬 New signup — Financial Autopsy',
        html:    `<p><strong>${email}</strong> just signed up.</p>`,
      }).catch(() => {}) // fire-and-forget, never block registration
    }

    const res = NextResponse.json({ user: { id: user.id, email: user.email }, token }, { status: 201 })
    res.cookies.set('token', token, { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 60 * 60 * 24 * 7 })
    return res
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    console.error('Register error:', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
