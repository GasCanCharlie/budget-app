import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/transactions/bulk
//
// Bulk-recategorizes a set of transactions to a single category.
// Verifies ownership via account.userId join before updating.
// ─────────────────────────────────────────────────────────────────────────────

const bodySchema = z.object({
  ids:        z.array(z.string()).min(1).max(500),
  categoryId: z.string().min(1),
})

export async function PATCH(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { ids, categoryId } = bodySchema.parse(body)

    // Verify the category exists and belongs to this user (or is a system category)
    const category = await prisma.category.findFirst({
      where: {
        id: categoryId,
        OR: [{ userId: payload.userId }, { isSystem: true }],
      },
      select: { id: true },
    })
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    // Verify ownership — only update transactions that belong to this user
    const owned = await prisma.transaction.findMany({
      where: {
        id:      { in: ids },
        account: { userId: payload.userId },
      },
      select: { id: true },
    })
    const ownedIds = owned.map(t => t.id)

    if (ownedIds.length === 0) {
      return NextResponse.json({ updated: 0 })
    }

    // Perform bulk update: set userOverrideCategoryId (same pattern as single-tx PATCH)
    // categorizationSource is derived at read time from userOverrideCategoryId being set
    const result = await prisma.transaction.updateMany({
      where: { id: { in: ownedIds } },
      data: {
        userOverrideCategoryId: categoryId,
        reviewedByUser:         true,
        needsReview:            false,
      },
    })

    // Invalidate month summaries for this user so aggregates are recomputed
    await prisma.monthSummary.updateMany({
      where: { userId: payload.userId },
      data:  { isStale: true },
    })

    return NextResponse.json({ updated: result.count })
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    }
    console.error('[PATCH /api/transactions/bulk]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
