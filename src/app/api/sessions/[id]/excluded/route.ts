import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// GET /api/sessions/[id]/excluded
// Returns all isExcluded: true transactions for the session so users can review
// and un-exclude false positives. The main /api/transactions endpoint always
// filters isExcluded: false, making this the only way to see them.
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.analysisSession.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const transactions = await prisma.transaction.findMany({
    where: {
      isExcluded: true,
      upload:     { sessionId: params.id },
    },
    select: {
      id:                 true,
      date:               true,
      description:        true,
      merchantNormalized: true,
      amount:             true,
      appCategory:        true,
      isTransfer:         true,
      account: { select: { id: true, name: true, accountType: true } },
      category: { select: { name: true, color: true, icon: true } },
    },
    orderBy: { date: 'desc' },
  })

  return NextResponse.json({
    transactions: transactions.map(tx => ({
      id:                 tx.id,
      date:               tx.date.toISOString(),
      description:        tx.description,
      merchantNormalized: tx.merchantNormalized,
      amount:             tx.amount,
      appCategory:        tx.appCategory,
      isTransfer:         tx.isTransfer,
      accountId:          tx.account.id,
      accountName:        tx.account.name,
      accountType:        tx.account.accountType,
      categoryName:       tx.category?.name ?? null,
      categoryColor:      tx.category?.color ?? null,
      categoryIcon:       tx.category?.icon ?? null,
    })),
    total: transactions.length,
  })
}
