import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { z } from 'zod'

const patchSchema = z.object({
  amountCents: z.number().int().min(0),
})

// PATCH /api/budgets/[id] — update amount
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = patchSchema.parse(body)

    const budget = await prisma.budgetTarget.updateMany({
      where: { id: params.id, userId: payload.userId },
      data: { amountCents: data.amountCents },
    })

    if (budget.count === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// DELETE /api/budgets/[id] — remove a budget target
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await prisma.budgetTarget.deleteMany({
    where: { id: params.id, userId: payload.userId },
  })

  return NextResponse.json({ ok: true })
}
