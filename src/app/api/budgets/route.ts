import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { z } from 'zod'

// GET /api/budgets — return all budget targets for the authenticated user
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const budgets = await prisma.budgetTarget.findMany({
    where: { userId: payload.userId },
    select: { id: true, categoryId: true, amountCents: true, period: true },
  })

  return NextResponse.json({ budgets })
}

const upsertSchema = z.object({
  categoryId:  z.string().min(1),
  amountCents: z.number().int().min(0),
  period:      z.string().default('monthly'),
})

// POST /api/budgets — upsert a budget target (create or replace)
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = upsertSchema.parse(body)

    const budget = await prisma.budgetTarget.upsert({
      where: {
        userId_categoryId_period: {
          userId:     payload.userId,
          categoryId: data.categoryId,
          period:     data.period,
        },
      },
      update: { amountCents: data.amountCents },
      create: { userId: payload.userId, ...data },
    })

    return NextResponse.json({ budget }, { status: 200 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
