import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/staging/[uploadId]
// Fetch the staging upload record + all transactions ordered by date ASC.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { uploadId: string } },
) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { uploadId } = params

  try {
    const stagingUpload = await prisma.stagingUpload.findFirst({
      where: { id: uploadId, userId: user.userId },
    })
    if (!stagingUpload) {
      return NextResponse.json({ error: 'Staging upload not found' }, { status: 404 })
    }

    const transactions = await prisma.stagingTransaction.findMany({
      where: { stagingUploadId: stagingUpload.id },
      orderBy: { date: 'asc' },
      include: {
        category: {
          select: { id: true, name: true, color: true, icon: true },
        },
      },
    })

    // Compute derived counts
    const total          = transactions.length
    const uncategorized  = transactions.filter(t => t.status === 'uncategorized').length
    const categorized    = transactions.filter(t => t.status === 'categorized').length
    const auto           = transactions.filter(t => t.status === 'categorized' && t.categorySource === 'rule').length
    const needsReview    = transactions.filter(t => t.status === 'needs_review').length
    const excluded       = transactions.filter(t => t.status === 'excluded').length
    const transfer       = transactions.filter(t => t.status === 'transfer').length

    return NextResponse.json({
      stagingUpload,
      transactions,
      counts: {
        total,
        uncategorized,
        categorized,
        auto,
        needsReview,
        excluded,
        transfer,
      },
    })
  } catch (err) {
    console.error('GET /api/staging/[uploadId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/staging/[uploadId]
// Discard a staging upload: mark as 'discarded', delete uncommitted staging txs.
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: { uploadId: string } },
) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { uploadId } = params

  try {
    const stagingUpload = await prisma.stagingUpload.findFirst({
      where: { id: uploadId, userId: user.userId },
    })
    if (!stagingUpload) {
      return NextResponse.json({ error: 'Staging upload not found' }, { status: 404 })
    }

    // Delete all uncommitted staging transactions for this upload
    await prisma.stagingTransaction.deleteMany({
      where: {
        stagingUploadId: stagingUpload.id,
        committedAt: null,
      },
    })

    // Mark the staging upload as discarded
    await prisma.stagingUpload.update({
      where: { id: stagingUpload.id },
      data: { status: 'discarded' },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('DELETE /api/staging/[uploadId] error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
