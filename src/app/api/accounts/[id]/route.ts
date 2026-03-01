import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { z } from 'zod'

async function verifyOwnership(accountId: string, userId: string) {
  return prisma.account.findFirst({ where: { id: accountId, userId } })
}

// ── DELETE — hard-delete account + all its data ────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await verifyOwnership(params.id, payload.userId)
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const result = await prisma.$transaction(async tx => {
    // 1. Collect transaction IDs + upload IDs + affected months
    const txRows = await tx.transaction.findMany({
      where: { accountId: params.id },
      select: { id: true, date: true },
    })
    const txIds = txRows.map(t => t.id)

    const uploadIds = (await tx.upload.findMany({
      where: { accountId: params.id },
      select: { id: true },
    })).map(u => u.id)

    // 2. Delete CategoryHistory
    if (txIds.length > 0) {
      await tx.categoryHistory.deleteMany({ where: { transactionId: { in: txIds } } })
    }

    // 3. Delete TransactionLinks (both directions)
    if (txIds.length > 0) {
      await tx.transactionLink.deleteMany({ where: { transactionAId: { in: txIds } } })
      await tx.transactionLink.deleteMany({ where: { transactionBId: { in: txIds } } })
    }

    // 4. Delete IngestionIssues (FK to both Transaction and Upload — must precede both)
    if (uploadIds.length > 0) {
      await tx.ingestionIssue.deleteMany({ where: { uploadId: { in: uploadIds } } })
    }

    // 5. Delete AuditLogEntries (FK to Upload — must precede Upload deletion)
    if (uploadIds.length > 0) {
      await tx.auditLogEntry.deleteMany({ where: { uploadId: { in: uploadIds } } })
    }

    // 6. Delete Transactions
    const { count: deletedTransactions } = await tx.transaction.deleteMany({ where: { accountId: params.id } })

    // 7. Delete TransactionRaw
    await tx.transactionRaw.deleteMany({ where: { accountId: params.id } })

    // 8. Delete Uploads (clears file hashes)
    await tx.upload.deleteMany({ where: { accountId: params.id } })

    // 9. Clean up MonthSummary/MonthCategoryTotal for months now empty
    const months = new Set(txRows.map(t => {
      const d = new Date(t.date)
      return `${d.getFullYear()}-${d.getMonth() + 1}`
    }))
    for (const key of Array.from(months)) {
      const [y, m] = key.split('-').map(Number)
      const remaining = await tx.transaction.count({
        where: {
          account: { userId: payload.userId },
          accountId: { not: params.id },
          date: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) },
        },
      })
      if (remaining === 0) {
        await tx.monthCategoryTotal.deleteMany({ where: { userId: payload.userId, year: y, month: m } })
        await tx.monthSummary.deleteMany({ where: { userId: payload.userId, year: y, month: m } })
      }
    }

    // 10. Delete the Account itself
    await tx.account.delete({ where: { id: params.id } })

    return { deletedTransactions }
  })

  return NextResponse.json({ success: true, ...result })
}

// ── PATCH — rename account ─────────────────────────────────────────────────

const patchSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  institution: z.string().max(100).optional(),
  accountType: z.enum(['checking', 'savings', 'credit_card', 'loan', 'other']).optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await verifyOwnership(params.id, payload.userId)
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  try {
    const body = patchSchema.parse(await req.json())
    const updated = await prisma.account.update({ where: { id: params.id }, data: body })
    return NextResponse.json({ account: updated })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
