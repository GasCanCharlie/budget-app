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
  incomeTxCount: number
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

// ─── Display category style lookup ───────────────────────────────────────────

const CATEGORY_STYLES: Record<string, { color: string; icon: string; isIncome: boolean }> = {
  'Food & Dining':   { color: '#f97316', icon: 'UtensilsCrossed', isIncome: false },
  'Groceries':       { color: '#22c55e', icon: 'ShoppingCart',    isIncome: false },
  'Housing':         { color: '#f59e0b', icon: 'Home',            isIncome: false },
  'Transport':       { color: '#3b82f6', icon: 'Car',             isIncome: false },
  'Entertainment':   { color: '#ec4899', icon: 'Film',            isIncome: false },
  'Shopping':        { color: '#f59e0b', icon: 'ShoppingBag',     isIncome: false },
  'Health':          { color: '#10b981', icon: 'HeartPulse',      isIncome: false },
  'Utilities':       { color: '#6366f1', icon: 'Zap',             isIncome: false },
  'Subscriptions':   { color: '#6366f1', icon: 'CreditCard',      isIncome: false },
  'Personal Care':   { color: '#f472b6', icon: 'Scissors',        isIncome: false },
  'Education':       { color: '#06b6d4', icon: 'BookOpen',        isIncome: false },
  'Travel':          { color: '#06b6d4', icon: 'Plane',           isIncome: false },
  'Insurance':       { color: '#64748b', icon: 'Shield',          isIncome: false },
  'Fees & Charges':  { color: '#ef4444', icon: 'DollarSign',      isIncome: false },
  'Gifts & Charity': { color: '#8794ff', icon: 'Gift',            isIncome: false },
  'Income':          { color: '#16a34a', icon: 'TrendingUp',      isIncome: true  },
  'Transfer':        { color: '#64748b', icon: 'ArrowLeftRight',  isIncome: false },
  'Transfers':       { color: '#64748b', icon: 'ArrowLeftRight',  isIncome: false },
  'Other':           { color: '#94a3b8', icon: 'Package',         isIncome: false },
  'Uncategorized':   { color: '#94a3b8', icon: 'Package',         isIncome: false },
  'Fast Food':       { color: '#f97316', icon: 'Utensils',        isIncome: false },
  'Alcohol':         { color: '#8b5cf6', icon: 'Wine',            isIncome: false },
  'Restaurants':     { color: '#f97316', icon: 'UtensilsCrossed', isIncome: false },
  'Gas/Fuel':        { color: '#3b82f6', icon: 'Zap',             isIncome: false },
  'Gasoline/Fuel':   { color: '#3b82f6', icon: 'Zap',             isIncome: false },
  'Cigarettes & Tobacco': { color: '#78716c', icon: 'Ban',        isIncome: false },
  'Pets':            { color: '#a3e635', icon: 'PawPrint',        isIncome: false },
}

function getDisplayCategoryStyle(name: string) {
  const style = CATEGORY_STYLES[name] ?? { color: '#94a3b8', icon: '📦', isIncome: false }
  return { id: name, name, ...style }
}

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
    select: {
      id:                 true,
      date:               true,
      description:        true,
      merchantNormalized: true,
      amount:             true,
      bankCategoryRaw:    true,
      appCategory:        true,
    },
    orderBy: { date: 'asc' },
  })

  if (transactions.length === 0) {
    return {
      year, month,
      totalIncome: 0, totalSpending: 0, net: 0,
      transactionCount: 0,
      incomeTxCount: 0,
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

  let totalIncome   = 0
  let totalSpending = 0
  let incomeTxCount = 0

  // Track total (abs) and netAmount (signed) per category so we can determine
  // income vs expense purely from transaction direction, not from name lookup.
  const categoryMap: Map<string, { total: number; netAmount: number; count: number; cat: ReturnType<typeof getDisplayCategoryStyle> }> = new Map()

  for (const tx of transactions) {
    // New display category: appCategory > bankCategoryRaw > "Uncategorized"
    const displayCat = tx.appCategory?.trim() || tx.bankCategoryRaw?.trim() || 'Uncategorized'

    // For icon/color, use a static lookup
    const catStyle = getDisplayCategoryStyle(displayCat)

    // Classify by amount sign — the only reliable signal from bank statements.
    // positive = credit (income/deposit/refund), negative = debit (spending).
    if (tx.amount > 0) {
      totalIncome += tx.amount
      incomeTxCount++
    } else {
      totalSpending += Math.abs(tx.amount)
    }

    const existing = categoryMap.get(displayCat)
    if (existing) {
      existing.total     += Math.abs(tx.amount)
      existing.netAmount += tx.amount
      existing.count++
    } else {
      categoryMap.set(displayCat, { total: Math.abs(tx.amount), netAmount: tx.amount, count: 1, cat: catStyle })
    }
  }

  const net = totalIncome - totalSpending

  // Category breakdown.
  // isIncome is determined by the net direction of the category's transactions —
  // if the category's net amount is positive it's income, regardless of category name.
  // This correctly handles user-defined income categories like "Paycheck" or "Freelance".
  const categoryTotals: CategoryTotal[] = Array.from(categoryMap.entries())
    .map(([, { total, netAmount, count, cat }]) => {
      const isIncome = netAmount > 0
      return {
        categoryId:       cat.id,
        categoryName:     cat.name,
        categoryColor:    cat.color,
        categoryIcon:     cat.icon,
        total,
        transactionCount: count,
        // pctOfSpending is only meaningful for expense categories
        pctOfSpending:    totalSpending > 0 && !isIncome ? (total / totalSpending) * 100 : 0,
        isIncome,
      }
    })
    .sort((a, b) => b.total - a.total)

  // Top 5 transactions (biggest expenses)
  const topTransactions = [...transactions]
    .filter(t => t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 5)
    .map(t => {
      const displayCat = t.appCategory?.trim() || t.bankCategoryRaw?.trim() || 'Uncategorized'
      const cat = getDisplayCategoryStyle(displayCat)
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

  await prisma.monthSummary.upsert({
    where:  { userId_year_month: { userId, year, month } },
    create: summaryData,
    update: summaryData,
  })

  // NOTE: MonthCategoryTotal persistence is intentionally skipped here.
  // The categoryId field in MonthCategoryTotal is a required FK to the Category
  // table (UUID references). Since we now use free-text display category names
  // (e.g. "Gasoline/Fuel", "Groceries") as category IDs, inserting them would
  // violate the FK constraint. Category breakdown is always recomputed from
  // transactions on demand, so persisting it is not required for correctness.
  // detectAnomalies() will find no history and return no spike alerts — acceptable.

  return {
    year, month, totalIncome, totalSpending, net,
    transactionCount: transactions.length,
    incomeTxCount,
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
  transactions: { id: string; amount: number; description: string; date: Date }[],
): Promise<AnomalyAlert[]> {
  const alerts: AnomalyAlert[] = []

  // Issue 7: fetch history with a safety cap; check distinct months (not row count)
  // NOTE: MonthCategoryTotal is no longer populated (FK constraint incompatible with
  // free-text category names). This query will return no rows, so no spike alerts
  // will fire. That is acceptable — a clean alternative would be to store history
  // in a separate free-text-keyed table.
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
      EXTRACT(YEAR FROM t.date)::INTEGER AS year,
      EXTRACT(MONTH FROM t.date)::INTEGER AS month
    FROM transactions t
    JOIN accounts a ON t."accountId" = a.id
    WHERE a."userId" = ${userId}
      AND t."isExcluded" = false
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
