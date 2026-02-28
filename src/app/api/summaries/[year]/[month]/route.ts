import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { startOfMonth, endOfMonth } from 'date-fns'
import { computeMonthSummary, getAvailableMonths, getRollingAverages } from '@/lib/intelligence/summaries'

export async function GET(
  req: NextRequest,
  { params }: { params: { year: string; month: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const year  = parseInt(params.year)
  const month = parseInt(params.month)

  // Issue 14: guard NaN and reject obviously out-of-range values
  if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year/month' }, { status: 400 })
  }

  // Issue 16: use date-fns helpers for consistent month boundaries
  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd   = endOfMonth(new Date(year, month - 1))

  const existing = await prisma.monthSummary.findUnique({
    where: { userId_year_month: { userId: payload.userId, year, month } },
  })

  let summary
  // Issue 17: wrap computation in try/catch so errors surface as clean 500s
  try {
    if (!existing || existing.isStale) {
      // Issue 18: optimistic lock — mark not-stale before computing so concurrent
      // requests don't both trigger a full recompute
      if (existing?.isStale) {
        await prisma.monthSummary.update({
          where: { id: existing.id },
          data:  { isStale: false },
        })
      }
      summary = await computeMonthSummary(payload.userId, year, month)
    } else {
      // Load from DB (cached path)
      const catTotals = await prisma.monthCategoryTotal.findMany({
        where: { userId: payload.userId, year, month },
        include: { category: { select: { id: true, name: true, color: true, icon: true, isIncome: true } } },
        orderBy: { total: 'desc' },
      })

      // Issue 15: match the same filters used in computeMonthSummary
      const topTxs = await prisma.transaction.findMany({
        where: {
          account: { userId: payload.userId },
          date:    { gte: monthStart, lte: monthEnd },
          amount:           { lt: 0 },
          isTransfer:       false,
          isExcluded:       false,
          isDuplicate:      false,
          isForeignCurrency: false,
        },
        include: { category: { select: { name: true, color: true, icon: true } } },
        orderBy: { amount: 'asc' },
        take: 5,
      })

      summary = {
        year, month,
        totalIncome:      existing.totalIncome,
        totalSpending:    existing.totalSpending,
        net:              existing.net,
        transactionCount: existing.transactionCount,
        isPartialMonth:   existing.isPartialMonth,
        dateRangeStart:   existing.dateRangeStart,
        dateRangeEnd:     existing.dateRangeEnd,
        categoryTotals: catTotals.map(ct => ({
          categoryId:       ct.categoryId,
          categoryName:     ct.category?.name  ?? 'Other',
          categoryColor:    ct.category?.color ?? '#94a3b8',
          categoryIcon:     ct.category?.icon  ?? '📦',
          total:            ct.total,
          transactionCount: ct.transactionCount,
          pctOfSpending:    ct.pctOfSpending,
          isIncome:         ct.category?.isIncome ?? false,
        })),
        topTransactions: topTxs.map(tx => ({
          id:                 tx.id,
          date:               tx.date,
          description:        tx.description,
          merchantNormalized: tx.merchantNormalized,
          amount:             tx.amount,
          categoryName:       tx.category?.name  ?? 'Other',
          categoryColor:      tx.category?.color ?? '#94a3b8',
          categoryIcon:       tx.category?.icon  ?? '📦',
        })),
        alerts: (await prisma.anomalyAlert.findMany({
          where:   { userId: payload.userId, year, month, isDismissed: false },
          orderBy: { createdAt: 'asc' },
        })).map(a => ({
          id:      a.id,
          type:    a.alertType as 'spending_spike' | 'new_merchant' | 'potential_duplicate' | 'large_transaction',
          message: a.message,
          amount:  a.amount ?? undefined,
        })),
      }
    }
  } catch (error) {
    console.error(`Failed to compute summary for ${year}-${month}:`, error)
    // Re-mark as stale so the next request retries
    if (existing?.isStale === false) {
      await prisma.monthSummary.update({
        where: { id: existing.id },
        data:  { isStale: true },
      }).catch(() => {/* best-effort */})
    }
    return NextResponse.json({ error: 'Failed to compute monthly summary' }, { status: 500 })
  }

  const [availableMonths, rolling] = await Promise.all([
    getAvailableMonths(payload.userId),
    getRollingAverages(payload.userId, year, month, 3),
  ])

  return NextResponse.json({ summary, availableMonths, rolling })
}
