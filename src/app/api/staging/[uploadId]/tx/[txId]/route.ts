import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

const VALID_STATUSES = new Set([
  'uncategorized',
  'categorized',
  'needs_review',
  'excluded',
  'transfer',
])

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/staging/[uploadId]/tx/[txId]
// Update a staging transaction's category or status.
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { uploadId: string; txId: string } },
) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { uploadId, txId } = params

  try {
    // Verify ownership via staging upload
    const stagingUpload = await prisma.stagingUpload.findFirst({
      where: { id: uploadId, userId: user.userId },
    })
    if (!stagingUpload) {
      return NextResponse.json({ error: 'Staging upload not found' }, { status: 404 })
    }

    // Verify the staging transaction belongs to this upload
    const existingTx = await prisma.stagingTransaction.findFirst({
      where: { id: txId, stagingUploadId: stagingUpload.id },
    })
    if (!existingTx) {
      return NextResponse.json({ error: 'Staging transaction not found' }, { status: 404 })
    }

    const body = await req.json() as {
      categoryId?: string
      categorySource?: string
      status?: string
    }

    const { categoryId, categorySource, status } = body

    // Validate status if provided
    if (status !== undefined && !VALID_STATUSES.has(status)) {
      return NextResponse.json(
        {
          error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}`,
        },
        { status: 400 },
      )
    }

    // When status becomes categorized or needs_review, ensure categoryId is set
    const effectiveStatus = status ?? existingTx.status
    const effectiveCategoryId = categoryId ?? existingTx.categoryId ?? null

    if (
      (effectiveStatus === 'categorized' || effectiveStatus === 'needs_review') &&
      !effectiveCategoryId
    ) {
      return NextResponse.json(
        { error: 'categoryId is required when status is "categorized" or "needs_review"' },
        { status: 400 },
      )
    }

    const updateData: Record<string, unknown> = {}
    if (categoryId !== undefined)     updateData.categoryId     = categoryId
    if (categorySource !== undefined) updateData.categorySource = categorySource
    if (status !== undefined)         updateData.status         = status

    // Update the staging transaction
    const updated = await prisma.stagingTransaction.update({
      where: { id: txId },
      data: updateData,
      include: {
        category: {
          select: { id: true, name: true, color: true, icon: true },
        },
      },
    })

    // Touch the staging upload's updatedAt
    await prisma.stagingUpload.update({
      where: { id: stagingUpload.id },
      data: { updatedAt: new Date() },
    })

    return NextResponse.json({ stagingTransaction: updated })
  } catch (err) {
    console.error('PATCH /api/staging/[uploadId]/tx/[txId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
