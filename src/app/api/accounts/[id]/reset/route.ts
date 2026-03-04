import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const account = await prisma.account.findFirst({
    where: { id: params.id, userId: payload.userId },
  })
  if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  const result = await prisma.$transaction(async tx => {
    // 1. Collect transaction IDs + affected months
    const txRows = await tx.transaction.findMany({
      where: { accountId: params.id },
      select: { id: true, date: true },
    })
    const txIds = txRows.map(t => t.id)

    // 2. Delete CategoryHistory
    if (txIds.length > 0) {
      await tx.categoryHistory.deleteMany({ where: { transactionId: { in: txIds } } })
    }

    // 3. Delete TransactionLinks (both directions)
    if (txIds.length > 0) {
      await tx.transactionLink.deleteMany({ where: { transactionAId: { in: txIds } } })
      await tx.transactionLink.deleteMany({ where: { transactionBId: { in: txIds } } })
    }

    // 4. Delete RuleHits → StagingTransactions → StagingUploads
    //    (StagingTransaction.transactionId FK blocks Transaction deletion;
    //     StagingUpload.uploadId FK blocks Upload deletion)
    const uploadIds = (await tx.upload.findMany({
      where: { accountId: params.id },
      select: { id: true },
    })).map(u => u.id)
    if (uploadIds.length > 0) {
      const stagingTxIds = (await tx.stagingTransaction.findMany({
        where: { uploadId: { in: uploadIds } },
        select: { id: true },
      })).map(s => s.id)
      if (stagingTxIds.length > 0) {
        await tx.ruleHit.deleteMany({ where: { stagingTxId: { in: stagingTxIds } } })
      }
      await tx.stagingTransaction.deleteMany({ where: { uploadId: { in: uploadIds } } })
      await tx.stagingUpload.deleteMany({ where: { uploadId: { in: uploadIds } } })
      await tx.ingestionIssue.deleteMany({ where: { uploadId: { in: uploadIds } } })
      await tx.auditLogEntry.deleteMany({ where: { uploadId: { in: uploadIds } } })
    }

    // 5. Delete Transactions
    const { count: deletedTransactions } = await tx.transaction.deleteMany({ where: { accountId: params.id } })

    // 6. Delete TransactionRaw
    await tx.transactionRaw.deleteMany({ where: { accountId: params.id } })

    // 7. Delete Uploads — file hashes are cleared so same CSV can be re-uploaded
    const { count: deletedUploads } = await tx.upload.deleteMany({ where: { accountId: params.id } })

    // 7. Clean up MonthSummary/MonthCategoryTotal for months now empty
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

    // Account row is KEPT — only data is wiped
    return { deletedTransactions, deletedUploads }
  })

  return NextResponse.json({ success: true, accountName: account.name, ...result })
}
