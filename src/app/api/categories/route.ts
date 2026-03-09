import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { invalidateCategoryCache } from '@/lib/categorization/engine'
import { z } from 'zod'

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { hiddenCategories: true },
  })

  let hiddenIds: string[] = []
  try { hiddenIds = JSON.parse(user?.hiddenCategories || '[]') } catch { /* ignore */ }

  const categories = await prisma.category.findMany({
    where: {
      AND: [
        {
          OR: [
            { isSystem: true, userId: null },
            { userId: payload.userId },
          ]
        },
        { id: { notIn: hiddenIds.length > 0 ? hiddenIds : ['__none__'] } },
      ]
    },
    orderBy: [{ isSystem: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  })

  return NextResponse.json({ categories })
}

const createSchema = z.object({
  name:      z.string().min(1).max(50),
  color:     z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#6366f1'),
  icon:      z.string().max(10).default('📦'),
  isIncome:  z.boolean().default(false),
})

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = createSchema.parse(body)

    const category = await prisma.category.create({
      data: { ...data, userId: payload.userId, isSystem: false },
    })
    invalidateCategoryCache()
    return NextResponse.json({ category }, { status: 201 })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
