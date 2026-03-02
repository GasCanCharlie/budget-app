import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/rules/[id]
// ─────────────────────────────────────────────────────────────────────────────

const patchSchema = z.object({
  mode:      z.enum(['always', 'ask']).optional(),
  isEnabled: z.boolean().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = patchSchema.parse(body)

    // Verify ownership
    const rule = await prisma.categoryRule.findFirst({
      where: { id: params.id, userId: payload.userId, isSystem: false },
    })
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const updated = await prisma.categoryRule.update({
      where: { id: params.id },
      data,
      include: { category: { select: { id: true, name: true, icon: true, color: true } } },
    })

    return NextResponse.json({ rule: updated })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/rules/[id]
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rule = await prisma.categoryRule.findFirst({
    where: { id: params.id, userId: payload.userId, isSystem: false },
  })
  if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

  // Clear appliedRuleId on transactions that reference this rule before deleting
  await prisma.transaction.updateMany({
    where: { appliedRuleId: params.id },
    data:  { appliedRuleId: null },
  })

  await prisma.categoryRule.delete({ where: { id: params.id } })

  return NextResponse.json({ deleted: true })
}
