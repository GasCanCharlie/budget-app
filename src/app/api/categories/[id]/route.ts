import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { invalidateCategoryCache } from '@/lib/categorization/engine'

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Find the category — allow system or user-owned
  const category = await prisma.category.findFirst({
    where: {
      id: params.id,
      OR: [
        { userId: payload.userId, isSystem: false },
        { isSystem: true, userId: null },
      ],
    },
  })
  if (!category) {
    return NextResponse.json({ error: 'Category not found' }, { status: 404 })
  }

  // System categories: hide for this user instead of deleting globally
  if (category.isSystem) {
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { hiddenCategories: true },
    })
    let hidden: string[] = []
    try { hidden = JSON.parse(user?.hiddenCategories || '[]') } catch { /* ignore */ }
    if (!hidden.includes(params.id)) hidden.push(params.id)
    await prisma.user.update({
      where: { id: payload.userId },
      data: { hiddenCategories: JSON.stringify(hidden) },
    })
    return NextResponse.json({ deleted: true, hidden: true })
  }

  // Find the "Other" fallback category to reassign transactions
  const fallback = await prisma.category.findFirst({
    where: { name: 'Other', isSystem: true, userId: null },
  })

  // Reassign transactions that use this category as their auto-category
  if (fallback) {
    await prisma.transaction.updateMany({
      where: { account: { userId: payload.userId }, categoryId: params.id },
      data: { categoryId: fallback.id },
    })
    // Clear user overrides pointing to this category (revert to auto-categorization)
    await prisma.transaction.updateMany({
      where: { account: { userId: payload.userId }, userOverrideCategoryId: params.id },
      data: { userOverrideCategoryId: null, reviewedByUser: false },
    })
  }

  // Delete user's categorization rules for this category
  await prisma.categoryRule.deleteMany({
    where: { categoryId: params.id, userId: payload.userId },
  })

  // Delete month totals referencing this category for this user
  await prisma.monthCategoryTotal.deleteMany({
    where: { categoryId: params.id, userId: payload.userId },
  })

  // Delete the category itself
  await prisma.category.delete({ where: { id: params.id } })

  // Mark all month summaries stale so they recompute
  await prisma.monthSummary.updateMany({
    where: { userId: payload.userId },
    data: { isStale: true },
  })

  invalidateCategoryCache()
  return NextResponse.json({ deleted: true })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Only allow editing user-created categories
  const category = await prisma.category.findFirst({
    where: { id: params.id, userId: payload.userId, isSystem: false },
  })
  if (!category) {
    return NextResponse.json({ error: 'Category not found or cannot be edited' }, { status: 404 })
  }

  const body = await req.json()
  const updated = await prisma.category.update({
    where: { id: params.id },
    data: {
      ...(body.name  !== undefined && { name: String(body.name).slice(0, 50) }),
      ...(body.icon  !== undefined && { icon: String(body.icon).slice(0, 10) }),
      ...(body.color !== undefined && { color: String(body.color) }),
    },
  })

  invalidateCategoryCache()
  return NextResponse.json({ category: updated })
}
