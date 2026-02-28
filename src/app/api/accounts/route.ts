import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

const createSchema = z.object({
  name:        z.string().min(1).max(100),
  institution: z.string().max(100).default(''),
  accountType: z.enum(['checking', 'savings', 'credit_card', 'loan', 'other']).default('checking'),
})

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const accounts = await prisma.account.findMany({
    where: { userId: payload.userId, archivedAt: null },
    include: {
      _count: { select: { transactions: true } },
    },
    orderBy: { createdAt: 'asc' },
  })

  return NextResponse.json({ accounts })
}

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    const account = await prisma.account.create({
      data: { ...data, userId: payload.userId }
    })
    return NextResponse.json({ account }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
