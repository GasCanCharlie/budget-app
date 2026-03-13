import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import crypto from 'crypto'
import prisma from '@/lib/db'
import { hashPassword } from '@/lib/auth'

const schema = z.object({
  token:    z.string().min(1),
  password: z.string().min(8).max(128),
})

export async function POST(req: NextRequest) {
  try {
    const { token, password } = schema.parse(await req.json())

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const user = await prisma.user.findFirst({
      where: {
        passwordResetToken:  tokenHash,
        passwordResetExpiry: { gt: new Date() },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'Invalid or expired reset link' }, { status: 400 })
    }

    const newHash = await hashPassword(password)

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash:        newHash,
        passwordResetToken:  null,
        passwordResetExpiry: null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    console.error('[reset-password]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
