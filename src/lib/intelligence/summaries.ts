/**
 * Monthly Intelligence Engine — Phase 4
 * Computation pipeline: income, spending, category breakdown, rolling averages
 * Phase 4 rules: no double-counting, null not zero for missing months
 */

import prisma from '@/lib/db'
import { startOfMonth, endOfMonth, subMonths } from 'date-fns'

export interface CategoryTotal {
  categoryId: string
  categoryName: string
  categoryColor: string
  categoryIcon: string
  total: number
  transactionCount: number
  pctOfSpending: number
  isIncome: boolean
}

export interface MonthlySummary {
  year: number
  month: number
  totalIncome: number
  totalSpending: number
  net: number
  transactionCount: number
  isPartialMonth: boolean
  dateRangeStart: Date | null
  dateRangeEnd:   Date | null
  categoryTotals: CategoryTotal[]
  topTransactions: {
    id: string
    date: Date
    description: string
    merchantNormalized: string
    amount: number
    categoryName: string
    categoryColor: string
    categoryIcon: string
  }[]
  alerts: AnomalyAlert[]
}

export interface AnomalyAlert {
  /** DB id — present when loaded from AnomalyAlert table */
  id?: string
  type: 'spending_spike' | 'new_merchant' | 'potential_duplicate' | 'large_transaction'
  categoryName?: string
  message: string
  amount?: number
}

// ─── MAD-based anomaly scoring ────────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function modifiedZScore(value: number, values: number[]): number {
  if (values.length < 3) return 0
  const med = median(values)
  const mad = median(values.map(v => Math.abs(v - med)))
  if (mad === 0) return 0
  return 0.6745 * Math.abs(value - med) / mad
}

// ─── Shared fallback category ─────────────────────────────────────────────────

const FALLBACK_CAT = { id: 'other', name: 'Other', color: '#94a3b8', icon: '📦', isIncome: false }

// ─── Compute monthly summary ──────────────────────────────────────────────────

export async function computeMonthSummary(
  userId: string,
  year: number,
  month: number,
): Promise<MonthlySummary> {
  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd   = endOfMonth(new Date(year, month - 1))

  // Fetch all non-excluded, non-transfer, non-duplicate transactions for the month.
  // Issue 3: exclude zero-amount transactions — they inflate counts without contributing.
  const transactions = await prisma.transaction.findMany({
    where: {
      account: { userId },
      date:    { gte: monthStart, lte: monthEnd },
      isTransfer:       false,
      isExcluded:       false,
      isDuplicate:      false,
      isForeignCurrency: false,
      amount:           { not: 0 },
    },
    include: {
      // Issue 1: include the override category so metadata is always correct
      category:         { select: { id: true, name: true, color: true, icon: true, isIncome: true } },
      overrideCategory: { select: { id: true, name: true, color: true, icon: true, isIncome: true } },
    },
    orderBy: { date: 'asc' },
  })

  if (transactions.length === 0) {
    return {
      year, month,
      totalIncome: 0, totalSpending: 0, net: 0,
      transactionCount: 0,
      isPartialMonth: false,
      dateRangeStart: null, dateRangeEnd: null,
      categoryTotals: [], topTransactions: [], alerts: [],
    }
  }

  // Partial month detection
  const txDates        = transactions.map(t => t.date)
  const dateRangeStart = txDates.reduce((a, b) => a < b ? a : b)
  const dateRangeEnd   = txDates.reduce((a, b) => a > b ? a : b)
  const daysInMonth    = monthEnd.getDate()
  const daysCovered    = Math.ceil((dateRangeEnd.getTime() - dateRangeStart.getTime()) / (1000 * 60 * 60 * 24)) + 1
  const isPartialMonth = daysCovered < daysInMonth * 0.9

  // Issue 2: classify income vs spending via category.isIncome, not tx sign
  let totalIncome   = 0
  let totalSpending = 0

  const categoryMap: Map<string, { total: number; count: number; cat: typeof FALLBACK_CAT }> = new Map()

  for (const tx of transactions) {
    // Issue 1: prefer override category metadata
    const cat   = tx.overrideCategory ?? tx.category ?? FALLBACK_CAT
    const catId = tx.userOverrideCategoryId ?? tx.categoryId ?? 'other'

    if (cat.isIncome) {
      totalIncome += Math.abs(tx.amount)
    } else {
      totalSpending += Math.abs(tx.amount)
    }

    // Issue 4: use fallback object instead of skipping uncategorized transactions
    const existing = categoryMap.get(catId)
    if (existing) {
      existing.total += Math.abs(tx.amount)
      existing.count++
    } else {
      categoryMap.set(catId, { total: Math.abs(tx.amount), count: 1, cat })
    }
  }

  const net = totalIncome - totalSpending

  // Category breakdown
  const categoryTotals: CategoryTotal[] = Array.from(categoryMap.entries())
    .map(([catId, { total, count, cat }]) => ({
      categoryId:       catId,
      categoryName:     cat.name,
      categoryColor:    cat.color,
      categoryIcon:     cat.icon,
      total,
      transactionCount: count,
      pctOfSpending:    totalSpending > 0 && !cat.isIncome ? (total / totalSpending) * 100 : 0,
      isIncome:         cat.isIncome,
    }))
    .sort((a, b) => b.total - a.total)

  // Top 5 transactions (biggest expenses)
  const topTransactions = [...transactions]
    .filter(t => t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 5)
    .map(t => {
      const cat = t.overrideCategory ?? t.category ?? FALLBACK_CAT
      return {
        id:                 t.id,
        date:               t.date,
        description:        t.description,
        merchantNormalized: t.merchantNormalized,
        amount:             t.amount,
        categoryName:       cat.name,
        categoryColor:      cat.color,
        categoryIcon:       cat.icon,
      }
    })

  // Anomaly detection (requires history)
  const alerts: AnomalyAlert[] = await detectAnomalies(userId, year, month, categoryTotals, transactions)

  // Persist summary
  const summaryData = {
    userId, year, month,
    totalIncome, totalSpending, net,
    transactionCount: transactions.length,
    isPartialMonth,
    dateRangeStart, dateRangeEnd,
    computedAt: new Date(),
    isStale: false,
  }

  const summary = await prisma.monthSummary.upsert({
    where:  { userId_year_month: { userId, year, month } },
    create: summaryData,
    update: summaryData,
  })

  // Issues 5 & 10: delete stale totals first, then batch-insert fresh ones.
  // deleteMany + createMany avoids N+1 upserts and removes stale category rows.
  await prisma.monthCategoryTotal.deleteMany({ where: { userId, year, month } })
  if (categoryTotals.length > 0) {
    await prisma.monthCategoryTotal.createMany({
      data: categoryTotals.map(ct => ({
        userId, year, month,
        categoryId:       ct.categoryId,
        total:            ct.total,
        transactionCount: ct.transactionCount,
        pctOfSpending:    ct.pctOfSpending,
        summaryId:        summary.id,
      })),
    })
  }

  return {
    year, month, totalIncome, totalSpending, net,
    transactionCount: transactions.length,
    isPartialMonth, dateRangeStart, dateRangeEnd,
    categoryTotals, topTransactions, alerts,
  }
}

// ─── Anomaly detection ────────────────────────────────────────────────────────

async function detectAnomalies(
  userId: string,
  year: number,
  month: number,
  currentCatTotals: CategoryTotal[],
  transactions: { id: string; amount: number; description: string; date: Date; category: { name: string } | null }[],
): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = []

  // Issue 7: fetch history with a safety cap; check distinct months (not row count)
  const historyRows = await prisma.monthCategoryTotal.findMany({
    where: {
      userId,
      OR: [
        { year: { lt: year } },
        { year, month: { lt: month } },
      ],
    },
    include: { category: { select: { name: true, isIncome: true } } },
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 200,
  })

  const distinctMonths = new Set(historyRows.map(h => `${h.year}-${h.month}`))
  if (distinctMonths.size < 3) return alerts

  // Group history by category
  const historyByCategory: Map<string, number[]> = new Map()
  for (const h of historyRows) {
    if (h.category?.isIncome) continue
    const arr = historyByCategory.get(h.categoryId) ?? []
    arr.push(h.total)
    historyByCategory.set(h.categoryId, arr)
  }

  // Type A: spending spike — Issue 11: only fire when spending is ABOVE the median
  for (const ct of currentCatTotals) {
    if (ct.isIncome) continue
    const history = historyByCategory.get(ct.categoryId)
    if (!history || history.length < 3) continue

    const z   = modifiedZScore(ct.total, history)
    const med = median(history)
    if (z > 3.5 && ct.total > med) {
      const avg = history.reduce((a, b) => a + b, 0) / history.length
      alerts.push({
        type: 'spending_spike',
        categoryName: ct.categoryName,
        message: `${ct.categoryName} spending ($${ct.total.toFixed(0)}) is ${(ct.total / avg).toFixed(1)}x your usual average ($${avg.toFixed(0)})`,
        amount: ct.total,
      })
    }
  }

  // Type D: large single transaction (above 95th percentile)
  // Issue 6: limit p95 calculation to the last 12 months to avoid unbounded queries
  const twelveMonthsAgo = subMonths(new Date(), 12)
  const allAmounts = await prisma.transaction.findMany({
    where: {
      account: { userId },
      amount:  { lt: 0 },
      isTransfer: false,
      isExcluded: false,
      date:       { gte: twelveMonthsAgo },
    },
    select: { amount: true },
  })
  const absAmounts = allAmounts.map(t => Math.abs(t.amount)).sort((a, b) => a - b)
  const p95idx     = Math.floor(absAmounts.length * 0.95)
  const p95        = absAmounts[p95idx] ?? 500

  for (const tx of transactions) {
    if (tx.amount < 0 && Math.abs(tx.amount) > Math.max(p95, 500)) {
      alerts.push({
        type:    'large_transaction',
        message: `Unusually large expense: ${tx.description} ($${Math.abs(tx.amount).toFixed(2)})`,
        amount:  Math.abs(tx.amount),
      })
      break // only flag the first one to avoid alert spam
    }
  }

  // Type C: potential duplicate — Issue 12: track all prior dates per key (handles 3+ occurrences)
  const seen = new Map<string, Date[]>()
  for (const tx of transactions) { // already sorted by date asc
    const key       = `${tx.description}|${tx.amount}`
    const prevDates = seen.get(key) ?? []

    for (const prev of prevDates) {
      const hoursDiff = Math.abs(tx.date.getTime() - prev.getTime()) / (1000 * 60 * 60)
      if (hoursDiff <= 48) {
        alerts.push({
          type:    'potential_duplicate',
          message: `Possible duplicate: "${tx.description}" ($${Math.abs(tx.amount).toFixed(2)}) appears multiple times within 48 hours`,
          amount:  Math.abs(tx.amount),
        })
        break // one alert per transaction is enough
      }
    }

    prevDates.push(tx.date)
    seen.set(key, prevDates)
  }

  // ── Persist alerts ────────────────────────────────────────────────────────
  await prisma.anomalyAlert.deleteMany({
    where: { userId, year, month, isDismissed: false },
  })

  for (const alert of alerts) {
    // Issue 8: don't recreate an alert the user has already dismissed
    const alreadyDismissed = await prisma.anomalyAlert.findFirst({
      where: { userId, year, month, alertType: alert.type, message: alert.message, isDismissed: true },
    })
    if (alreadyDismissed) continue

    const row = await prisma.anomalyAlert.create({
      data: {
        userId, year, month,
        alertType: alert.type,
        message:   alert.message,
        amount:    alert.amount ?? null,
      },
    })
    alert.id = row.id
  }

  return alerts
}

// ─── Get available months ─────────────────────────────────────────────────────

// Issue 9: use raw SQL to extract distinct year/month pairs efficiently
// instead of fetching all transaction dates and grouping in JS.
export async function getAvailableMonths(userId: string): Promise<{ year: number; month: number }[]> {
  const months = await prisma.$queryRaw<{ year: number; month: number }[]>`
    SELECT DISTINCT
      CAST(strftime('%Y', t.date) AS INTEGER) AS year,
      CAST(strftime('%m', t.date) AS INTEGER) AS month
    FROM transactions t
    JOIN accounts a ON t.accountId = a.id
    WHERE a.userId = ${userId}
      AND t.isExcluded = 0
    ORDER BY year DESC, month DESC
  `
  return months
}

// ─── Rolling averages ─────────────────────────────────────────────────────────

export async function getRollingAverages(
  userId: string,
  year: number,
  month: number,
  lookback = 3,
): Promise<{ spending: number; income: number }> {
  const months: { year: number; month: number }[] = []
  let y = year, m = month
  for (let i = 0; i < lookback; i++) {
    m--
    if (m === 0) { m = 12; y-- }
    months.push({ year: y, month: m })
  }

  const summaries = await prisma.monthSummary.findMany({
    where: {
      userId,
      OR: months.map(({ year, month }) => ({ year, month })),
    },
  })

  if (summaries.length === 0) return { spending: 0, income: 0 }

  const avgSpending = summaries.reduce((s, m) => s + m.totalSpending, 0) / summaries.length
  const avgIncome   = summaries.reduce((s, m) => s + m.totalIncome,   0) / summaries.length

  return { spending: avgSpending, income: avgIncome }
}
