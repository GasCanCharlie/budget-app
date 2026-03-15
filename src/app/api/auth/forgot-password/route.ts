import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import { Resend } from 'resend'
import prisma from '@/lib/db'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'

const schema = z.object({ email: z.string().email() })

export async function POST(req: NextRequest) {
  try {
    const { email } = schema.parse(await req.json())

    const ip = getClientIp(req)
    const rl = await checkRateLimit(ip, 'forgotPassword')
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many password reset requests. Please try again later.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) } }
      )
    }

    const user = await prisma.user.findUnique({ where: { email } })

    // Always return success — never reveal whether the email exists
    if (user) {
      const rawToken   = crypto.randomBytes(32).toString('hex')
      const tokenHash  = crypto.createHash('sha256').update(rawToken).digest('hex')
      const expiry     = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      await prisma.user.update({
        where: { id: user.id },
        data: { passwordResetToken: tokenHash, passwordResetExpiry: expiry },
      })

      const appUrl  = process.env.NEXT_PUBLIC_APP_URL
        ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
      const resetUrl = `${appUrl}/reset-password?token=${rawToken}`

      if (process.env.RESEND_API_KEY) {
        const resend = new Resend(process.env.RESEND_API_KEY)
        await resend.emails.send({
          from:    'BudgetLens <onboarding@resend.dev>',
          to:      email,
          subject: 'Reset your BudgetLens password',
          html: `
            <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0d1117;color:#e5e7eb;border-radius:12px">
              <h2 style="margin:0 0 16px;font-size:20px;font-weight:700">Reset your password</h2>
              <p style="margin:0 0 24px;color:#9ca3af;font-size:14px;line-height:1.6">
                We received a request to reset the password for your BudgetLens account.
                Click the button below to choose a new password. This link expires in <strong style="color:#e5e7eb">1 hour</strong>.
              </p>
              <a href="${resetUrl}"
                style="display:inline-block;padding:12px 24px;background:#6c7cff;color:#fff;font-weight:700;font-size:14px;border-radius:8px;text-decoration:none">
                Reset password
              </a>
              <p style="margin:24px 0 0;color:#8b97c3;font-size:12px;line-height:1.6">
                If you didn't request this, you can safely ignore this email.<br>
                This link will expire in 1 hour.
              </p>
            </div>
          `,
        })
      } else {
        // Dev fallback — log reset URL if no email service configured
        console.log(`[forgot-password] Reset URL for ${email}: ${resetUrl}`)
      }
    }

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    console.error('[forgot-password]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
