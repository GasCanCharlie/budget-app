import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeForRule } from '@/lib/ingestion/vendor-normalize'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/rules
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rules = await prisma.categoryRule.findMany({
    where: { userId: payload.userId, isSystem: false },
    include: { category: { select: { id: true, name: true, icon: true, color: true } } },
    orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
  })

  return NextResponse.json({ rules })
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rules
// ─────────────────────────────────────────────────────────────────────────────

const createSchema = z.object({
  matchType:      z.enum(['vendor_exact', 'contains', 'vendor_exact_amount']),
  matchValue:     z.string().min(1).max(200),
  amountExact:    z.number().int().optional(),
  categoryId:     z.string().min(1),
  mode:           z.enum(['always', 'ask']).default('always'),
  confidence:     z.enum(['high', 'low']).default('high'),
  scopeAccountId: z.string().nullable().optional(),
})

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    // Normalize matchValue the same way the auto-apply engine does
    const normalizedValue = normalizeForRule(data.matchValue)

    // Verify category belongs to user or is a system category
    const category = await prisma.category.findFirst({
      where: {
        id: data.categoryId,
        OR: [{ userId: payload.userId }, { isSystem: true }],
      },
    })
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

    const isAmountRule = data.matchType === 'vendor_exact_amount'

    // Upsert: find existing rule by vendor+amount (for price rules) or matchType+matchValue
    const existing = await prisma.categoryRule.findFirst({
      where: isAmountRule
        ? { userId: payload.userId, vendorKey: normalizedValue, amountExact: data.amountExact ?? null, isSystem: false }
        : { userId: payload.userId, matchType: data.matchType, matchValue: normalizedValue, isSystem: false },
    })

    let rule
    if (existing) {
      rule = await prisma.categoryRule.update({
        where: { id: existing.id },
        data: {
          categoryId:     data.categoryId,
          mode:           data.mode,
          confidence:     data.confidence,
          isEnabled:      true,
          scopeAccountId: data.scopeAccountId ?? null,
        },
        include: { category: { select: { id: true, name: true, icon: true, color: true } } },
      })
    } else {
      rule = await prisma.categoryRule.create({
        data: {
          userId:         payload.userId,
          categoryId:     data.categoryId,
          matchType:      data.matchType,
          matchValue:     normalizedValue,
          vendorKey:      (isAmountRule || data.matchType === 'vendor_exact') ? normalizedValue : '',
          amountExact:    isAmountRule ? (data.amountExact ?? null) : null,
          mode:           data.mode,
          confidence:     data.confidence,
          isEnabled:      true,
          isSystem:       false,
          priority:       isAmountRule ? 30 : 20,
          scopeAccountId: data.scopeAccountId ?? null,
        },
        include: { category: { select: { id: true, name: true, icon: true, color: true } } },
      })
    }

    return NextResponse.json({ rule }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
