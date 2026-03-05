/**
 * Month-over-month comparison.
 */
import { computeMonthSummary } from './summaries'

export interface CategoryDelta {
  categoryName: string
  amountA: number
  amountB: number
  delta: number        // B - A
  deltaPct: number | null
}

export interface MerchantDelta {
  merchant: string
  totalA: number
  totalB: number
  delta: number
}

export interface MonthComparison {
  labelA: string   // e.g. "Nov 2025"
  labelB: string   // e.g. "Dec 2025"
  spendingA: number
  spendingB: number
  spendingDelta: number
  spendingDeltaPct: number | null
  incomeA: number
  incomeB: number
  incomeDelta: number
  netA: number
  netB: number
  netDelta: number
  categoryDeltas: CategoryDelta[]   // sorted by |delta| desc, top 8
  transactionCountA: number
  transactionCountB: number
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export async function compareMonths(
  userId: string,
  yearA: number,
  monthA: number,
  yearB: number,
  monthB: number,
): Promise<MonthComparison> {
  const [summaryA, summaryB] = await Promise.all([
    computeMonthSummary(userId, yearA, monthA),
    computeMonthSummary(userId, yearB, monthB),
  ])

  const labelA = `${MONTH_NAMES[monthA - 1]} ${yearA}`
  const labelB = `${MONTH_NAMES[monthB - 1]} ${yearB}`

  const spendingDelta = summaryB.totalSpending - summaryA.totalSpending
  const spendingDeltaPct = summaryA.totalSpending > 0
    ? (spendingDelta / summaryA.totalSpending) * 100
    : null

  // Build category delta map
  const catMapA = new Map(summaryA.categoryTotals.map(c => [c.categoryName, c.total]))
  const catMapB = new Map(summaryB.categoryTotals.map(c => [c.categoryName, c.total]))
  const allCats = new Set([...catMapA.keys(), ...catMapB.keys()])

  const categoryDeltas: CategoryDelta[] = Array.from(allCats)
    .map(name => {
      const a = catMapA.get(name) ?? 0
      const b = catMapB.get(name) ?? 0
      const delta = b - a
      const deltaPct = a > 0 ? (delta / a) * 100 : null
      return { categoryName: name, amountA: a, amountB: b, delta, deltaPct }
    })
    .filter(c => Math.abs(c.delta) > 1)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 8)

  return {
    labelA,
    labelB,
    spendingA: summaryA.totalSpending,
    spendingB: summaryB.totalSpending,
    spendingDelta,
    spendingDeltaPct,
    incomeA: summaryA.totalIncome,
    incomeB: summaryB.totalIncome,
    incomeDelta: summaryB.totalIncome - summaryA.totalIncome,
    netA: summaryA.net,
    netB: summaryB.net,
    netDelta: summaryB.net - summaryA.net,
    categoryDeltas,
    transactionCountA: summaryA.transactionCount ?? 0,
    transactionCountB: summaryB.transactionCount ?? 0,
  }
}
