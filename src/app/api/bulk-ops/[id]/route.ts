import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export const runtime = 'nodejs'

// POST /api/bulk-ops/[id]/undo
// Reverses a BulkCategoryOperation by restoring the snapshot of prior values.

interface SnapshotEntry {
  txId:           string
  prevAppCategory: string | null
  prevAssignedBy:  string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const op = await prisma.bulkCategoryOperation.findFirst({
    where: { id: params.id, userId: payload.userId },
  })
  if (!op)     return NextResponse.json({ error: 'Operation not found' }, { status: 404 })
  if (op.undone) return NextResponse.json({ error: 'Already undone' }, { status: 409 })

  let snapshot: SnapshotEntry[] = []
  try { snapshot = JSON.parse(op.snapshot) } catch {
    return NextResponse.json({ error: 'Snapshot corrupted' }, { status: 500 })
  }

  let restored = 0
  for (const entry of snapshot) {
    try {
      await prisma.transaction.updateMany({
        where: { id: entry.txId, account: { userId: payload.userId } },
        data: {
          appCategory: entry.prevAppCategory,
          assignedBy:  entry.prevAssignedBy,
        },
      })
      restored++
    } catch {
      console.warn('[bulk-ops/undo] failed to restore txId=%s', entry.txId)
    }
  }

  await prisma.bulkCategoryOperation.update({
    where: { id: op.id },
    data:  { undone: true, undoneAt: new Date() },
  })

  return NextResponse.json({ restored, operationId: op.id })
}
