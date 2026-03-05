/**
 * GET /api/transactions/monthly?year=&month=
 * Auth: JWT required
 *
 * Returns a lightweight list of non-excluded, non-transfer, non-duplicate
 * transactions for the given month, suitable for sending to AI as context.
 *
 * Returns: { transactions: Array<{ date: string, merchant: string, amount: number, category: string | null }> }
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const yearParam  = searchParams.get('year')
  const monthParam = searchParams.get('month')

  if (!yearParam || !monthParam) {
    return NextResponse.json({ error: 'year and month are required' }, { status: 400 })
  }

  const year  = parseInt(yearParam)
  const month = parseInt(monthParam)

  if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: 'Invalid year or month' }, { status: 400 })
  }

  const start = new Date(year, month - 1, 1)
  const end   = new Date(year, month, 0, 23, 59, 59)

  try {
    const rows = await prisma.transaction.findMany({
      where: {
        account: { userId: payload.userId },
        isExcluded:   false,
        isTransfer:   false,
        isDuplicate:  false,
        date: { gte: start, lte: end },
      },
      select: {
        date:               true,
        merchantNormalized: true,
        description:        true,
        amount:             true,
        appCategory:        true,
        category:           { select: { name: true } },
        overrideCategory:   { select: { name: true } },
      },
      orderBy: { date: 'asc' },
      take: 500,
    })

    const transactions = rows.map(tx => {
      const categoryName =
        tx.overrideCategory?.name ??
        tx.category?.name ??
        tx.appCategory ??
        null

      const merchant = tx.merchantNormalized?.trim() || tx.description?.trim() || ''

      // Preserve sign: expenses are negative in DB, income is positive.
      // Return absolute value for expenses so AI sees positive spend amounts,
      // but keep income positive as-is.
      const amount = tx.amount < 0 ? Math.abs(tx.amount) : tx.amount

      return {
        date:     tx.date.toISOString().slice(0, 10), // YYYY-MM-DD
        merchant,
        amount,
        category: categoryName,
      }
    })

    return NextResponse.json({ transactions })
  } catch (e) {
    console.error('[/api/transactions/monthly] ERROR:', e)
    return NextResponse.json({ error: 'Internal server error', detail: String(e) }, { status: 500 })
  }
}
