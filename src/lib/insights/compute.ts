/**
 * AI Insights Orchestrator — Turn 6
 *
 * Assembles ComputedInsightMetrics from DB, runs all generators,
 * upserts InsightCard rows (preserving isDismissed), and returns the
 * ranked display set (max 8).
 *
 * Call order within a single pass:
 *   1. computeMonthSummary()           — current month totals
 *   2. Prev month summary + queries    — deltas
 *   3. Merchant aggregates (raw SQL)   — this + prev month
 *   4. p95 large-transaction threshold — trailing 12 months
 *   5. detectSubscriptions()           — subscription detection + upsert candidates
 *   6. Build ComputedInsightMetrics
 *   7. runAllGenerators(metrics)       — produce cards
 *   8. Upsert InsightCard rows          — preserve isDismissed
 *   9. Return display cards (max 8)
 */

import { randomUUID } from 'crypto'
import { startOfMonth, endOfMonth, subMonths, getDaysInMonth } from 'date-fns'
import prisma from '@/lib/db'
import { computeMonthSummary } from '@/lib/intelligence/summaries'
import { detectSubscriptions } from '@/lib/intelligence/subscriptions'
import { runAllGenerators } from '@/lib/insights/generators'
import type {
  InsightCard,
  ComputedInsightMetrics,
  MonthlyAggregates,
  CategoryMetrics,
  MerchantMetrics,
  FrequencyMetrics,
  SubscriptionMetrics,
  SubscriptionCandidateRecord,
  TrialCandidate,
  DuplicateServiceGroup,
  LargeTransaction,
  SmallPurchaseMerchant,
} from '@/lib/insights/types'

// ─── Small-purchase threshold ─────────────────────────────────────────────────
const SMALL_PURCHASE_THRESHOLD = 15 // dollars

// ─── Merchant aggregate row (raw SQL result) ──────────────────────────────────
interface MerchantRow {
  merchantnormalized: string
  total: number
  count: bigint | number
}

// ─── Helper: get prev month ───────────────────────────────────────────────────
function getPrevMonth(year: number, month: number): { year: number; month: number } {
  const d = subMonths(new Date(year, month - 1, 1), 1)
  return { year: d.getFullYear(), month: d.getMonth() + 1 }
}

// ─── Helper: get trailing months list ────────────────────────────────────────
function trailingMonths(
  year: number,
  month: number,
  count: number,
): Array<{ year: number; month: number }> {
  const result: Array<{ year: number; month: number }> = []
  let y = year
  let m = month
  for (let i = 0; i < count; i++) {
    m--
    if (m === 0) {
      m = 12
      y--
    }
    result.push({ year: y, month: m })
  }
  return result
}

// ─── Query merchant aggregates for a given month ─────────────────────────────
async function queryMerchantAggregates(
  userId: string,
  year: number,
  month: number,
): Promise<MerchantRow[]> {
  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd = endOfMonth(new Date(year, month - 1))

  const rows = await prisma.$queryRaw<MerchantRow[]>`
    SELECT
      t."merchantNormalized" AS merchantnormalized,
      SUM(ABS(t.amount))     AS total,
      COUNT(*)               AS count
    FROM transactions t
    JOIN accounts a ON t."accountId" = a.id
    WHERE a."userId"         = ${userId}
      AND t.date             >= ${monthStart}
      AND t.date             <  ${monthEnd}
      AND t."isTransfer"     = false
      AND t."isExcluded"     = false
      AND t."isDuplicate"    = false
      AND t."isForeignCurrency" = false
      AND t.amount           < 0
      AND t."merchantNormalized" <> ''
    GROUP BY t."merchantNormalized"
    ORDER BY total DESC
  `
  return rows
}

// ─── Query p95 large-transaction threshold ────────────────────────────────────
async function queryP95Threshold(userId: string): Promise<number> {
  const twelveMonthsAgo = subMonths(new Date(), 12)
  const rows = await prisma.transaction.findMany({
    where: {
      account: { userId },
      amount: { lt: 0 },
      isTransfer: false,
      isExcluded: false,
      isDuplicate: false,
      date: { gte: twelveMonthsAgo },
    },
    select: { amount: true },
    orderBy: { amount: 'asc' },
  })
  if (rows.length === 0) return 500
  const absAmounts = rows.map(r => Math.abs(r.amount)).sort((a, b) => a - b)
  const p95idx = Math.floor(absAmounts.length * 0.95)
  return Math.max(absAmounts[p95idx] ?? 500, 500)
}

// ─── Query category history (3-month avg) ────────────────────────────────────
async function queryCategoryHistory(
  userId: string,
  year: number,
  month: number,
): Promise<Map<string, number[]>> {
  // Get trailing 3 months
  const trailingList = trailingMonths(year, month, 3)

  // For each trailing month, query category totals from transactions directly
  // (MonthCategoryTotal is not populated due to FK constraint issues)
  const map = new Map<string, number[]>()

  for (const { year: y, month: m } of trailingList) {
    const monthStart = startOfMonth(new Date(y, m - 1))
    const monthEnd = endOfMonth(new Date(y, m - 1))

    const rows = await prisma.$queryRaw<{ appcat: string | null; total: number }[]>`
      SELECT
        t."appCategory"    AS appcat,
        SUM(ABS(t.amount)) AS total
      FROM transactions t
      JOIN accounts a ON t."accountId" = a.id
      WHERE a."userId"      = ${userId}
        AND t.date          >= ${monthStart}
        AND t.date          <  ${monthEnd}
        AND t."isTransfer"  = false
        AND t."isExcluded"  = false
        AND t."isDuplicate" = false
        AND t."isForeignCurrency" = false
        AND t.amount        < 0
        AND t."appCategory" IS NOT NULL
      GROUP BY t."appCategory"
    `
    for (const row of rows) {
      if (!row.appcat) continue
      const list = map.get(row.appcat) ?? []
      list.push(Number(row.total))
      map.set(row.appcat, list)
    }
  }

  return map
}

// ─── Query large transactions for the month ───────────────────────────────────
async function queryLargeTransactions(
  userId: string,
  year: number,
  month: number,
  threshold: number,
): Promise<LargeTransaction[]> {
  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd = endOfMonth(new Date(year, month - 1))

  const rows = await prisma.transaction.findMany({
    where: {
      account: { userId },
      date: { gte: monthStart, lte: monthEnd },
      isTransfer: false,
      isExcluded: false,
      isDuplicate: false,
      isForeignCurrency: false,
      amount: { lt: -threshold }, // amount is negative for expenses
    },
    select: {
      merchantNormalized: true,
      description: true,
      amount: true,
      date: true,
      appCategory: true,
      bankCategoryRaw: true,
    },
    orderBy: { amount: 'asc' }, // most negative = largest expense first
    take: 10,
  })

  return rows.map(r => ({
    merchant: r.merchantNormalized || r.description.slice(0, 40),
    merchantNormalized: r.merchantNormalized,
    amount: Math.abs(r.amount),
    date: r.date.toISOString(),
    categoryName: r.appCategory ?? r.bankCategoryRaw ?? 'Uncategorized',
  }))
}

// ─── Query small purchases ────────────────────────────────────────────────────
async function querySmallPurchases(
  userId: string,
  year: number,
  month: number,
): Promise<{ count: number; total: number; merchants: SmallPurchaseMerchant[] }> {
  const monthStart = startOfMonth(new Date(year, month - 1))
  const monthEnd = endOfMonth(new Date(year, month - 1))

  const rows = await prisma.transaction.findMany({
    where: {
      account: { userId },
      date: { gte: monthStart, lte: monthEnd },
      isTransfer: false,
      isExcluded: false,
      isDuplicate: false,
      isForeignCurrency: false,
      amount: { lt: 0, gt: -SMALL_PURCHASE_THRESHOLD },
    },
    select: {
      amount: true,
      merchantNormalized: true,
      description: true,
    },
  })

  const total = rows.reduce((s, r) => s + Math.abs(r.amount), 0)
  const count = rows.length

  // Group by merchant
  const byMerchant = new Map<string, { count: number; total: number }>()
  for (const r of rows) {
    const key = r.merchantNormalized || r.description.slice(0, 40)
    const existing = byMerchant.get(key) ?? { count: 0, total: 0 }
    existing.count++
    existing.total += Math.abs(r.amount)
    byMerchant.set(key, existing)
  }

  const merchants: SmallPurchaseMerchant[] = Array.from(byMerchant.entries())
    .map(([merchantDisplay, data]) => ({ merchantDisplay, ...data }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return { count, total, merchants }
}

// ─── Upsert InsightCard rows (preserve isDismissed) ──────────────────────────
async function upsertInsightCards(
  userId: string,
  year: number,
  month: number,
  cards: InsightCard[],
): Promise<void> {
  for (const card of cards) {
    // Fetch existing isDismissed value so we don't overwrite user's dismissal
    const existing = await prisma.insightCard.findUnique({
      where: { userId_year_month_cardType: { userId, year, month, cardType: card.card_type } },
      select: { isDismissed: true },
    })

    await prisma.insightCard.upsert({
      where: { userId_year_month_cardType: { userId, year, month, cardType: card.card_type } },
      create: {
        id: randomUUID(),
        userId,
        year,
        month,
        cardType: card.card_type,
        priority: card.priority,
        title: card.title,
        summary: card.summary,
        supportingData: card.supporting_data as object,
        actions: card.actions as unknown as object,
        confidence: card.confidence,
        iconSuggestion: card.icon_suggestion,
        isDismissed: false,
        generatedAt: new Date(card.generated_at),
        numbersUsed: card.numbers_used as unknown as object,
        filters: card.filters ? (card.filters as unknown as object) : undefined,
      },
      update: {
        priority: card.priority,
        title: card.title,
        summary: card.summary,
        supportingData: card.supporting_data as object,
        actions: card.actions as unknown as object,
        confidence: card.confidence,
        iconSuggestion: card.icon_suggestion,
        // Preserve isDismissed — only update if no existing row
        isDismissed: existing?.isDismissed ?? false,
        generatedAt: new Date(card.generated_at),
        numbersUsed: card.numbers_used as unknown as object,
        filters: card.filters ? (card.filters as unknown as object) : undefined,
      },
    })
  }
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function computeInsights(
  userId: string,
  year: number,
  month: number,
): Promise<InsightCard[]> {
  // ── Step 1: Current month summary ─────────────────────────────────────────
  const summary = await computeMonthSummary(userId, year, month)

  // ── Step 2: Previous month summary ───────────────────────────────────────
  const { year: prevYear, month: prevMonth } = getPrevMonth(year, month)
  const prevSummary = await computeMonthSummary(userId, prevYear, prevMonth)

  // ── Step 3: Merchant aggregates (this month + prev month) ─────────────────
  const [thisMerchants, prevMerchants] = await Promise.all([
    queryMerchantAggregates(userId, year, month),
    queryMerchantAggregates(userId, prevYear, prevMonth),
  ])

  const prevMerchantMap = new Map<string, number>()
  for (const row of prevMerchants) {
    prevMerchantMap.set(row.merchantnormalized, Number(row.total))
  }

  // ── Step 4: p95 large-transaction threshold ───────────────────────────────
  const [p95Threshold, categoryHistory] = await Promise.all([
    queryP95Threshold(userId),
    queryCategoryHistory(userId, year, month),
  ])

  // ── Step 5: Large transactions ────────────────────────────────────────────
  const largeTransactions = await queryLargeTransactions(userId, year, month, p95Threshold)

  // ── Step 6: Small purchases ───────────────────────────────────────────────
  const smallPurchases = await querySmallPurchases(userId, year, month)

  // ── Step 7: Subscription detection ───────────────────────────────────────
  const subInsight = await detectSubscriptions(userId, year, month)

  // Upsert SubscriptionCandidate rows
  for (const sub of subInsight.subscriptions) {
    const confidence = sub.confidence.toLowerCase() as 'high' | 'medium' | 'low'
    const consecutiveMonths = sub.activeMonths.length
    await prisma.subscriptionCandidate.upsert({
      where: { userId_merchantNormalized: { userId, merchantNormalized: sub.merchantNormalized } },
      create: {
        userId,
        merchantNormalized: sub.merchantNormalized,
        estimatedMonthlyAmount: sub.typicalAmount,
        recurringConfidence: confidence,
        subscriptionScore: sub.subscriptionScore,
        consecutiveMonths,
        serviceCategory: sub.serviceCategory ?? null,
        estimatedNextCharge: null,
        isConfirmedByUser: false,
        isSuppressed: false,
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
      },
      update: {
        estimatedMonthlyAmount: sub.typicalAmount,
        recurringConfidence: confidence,
        subscriptionScore: sub.subscriptionScore,
        consecutiveMonths,
        serviceCategory: sub.serviceCategory ?? null,
        lastSeenAt: new Date(),
      },
    })
  }

  // Fetch DB subscription candidates (includes isSuppressed / isConfirmedByUser from DB)
  const dbCandidates = await prisma.subscriptionCandidate.findMany({
    where: { userId, isSuppressed: false },
  })

  // Map to SubscriptionCandidateRecord
  const allSubscriptions: SubscriptionCandidateRecord[] = dbCandidates.map(c => ({
    id: c.id,
    merchantNormalized: c.merchantNormalized,
    merchantDisplay: c.merchantNormalized,
    estimatedMonthlyAmount: c.estimatedMonthlyAmount,
    recurrencePattern: 'monthly' as const,
    consecutiveMonths: c.consecutiveMonths,
    observedDates: [],
    estimatedNextCharge: c.estimatedNextCharge ? c.estimatedNextCharge.toISOString().slice(0, 10) : null,
    recurringConfidence: c.recurringConfidence as 'high' | 'medium' | 'low',
    isConfirmedByUser: c.isConfirmedByUser,
    isSuppressed: c.isSuppressed,
    serviceCategory: (c.serviceCategory ?? 'other') as import('./types').ServiceCategory,
  }))

  // Map trial candidates from subscriptions module to types.ts TrialCandidate shape
  const trialCandidates: TrialCandidate[] = subInsight.trials
    .filter(t => t.status === 'pending' || t.alertActive)
    .map(t => ({
      merchantNormalized: t.merchantNormalized,
      merchantDisplay: t.merchantNormalized,
      chargeAmount: t.trialAmount,
      chargeDate: t.trialDate,
      estimatedBillingDate: t.estimatedBillingDate,
      estimatedMonthlyAmount: t.conversionAmount ?? null,
      alertShouldFire: t.alertActive,
    }))

  // Map duplicate alerts to DuplicateServiceGroup
  const duplicateServiceCategories: DuplicateServiceGroup[] = subInsight.duplicateAlerts.map(alert => ({
    serviceCategory: (alert.category.toLowerCase().replace(/[/ ]/g, '_')) as import('./types').ServiceCategory,
    candidates: alert.subscriptions.map(s => ({
      merchantNormalized: s.merchantNormalized,
      merchantDisplay: s.merchantNormalized,
      estimatedMonthlyAmount: s.typicalAmount,
      recurringConfidence: s.confidence.toLowerCase() as 'high' | 'medium' | 'low',
    })),
    groupTotal: alert.totalMonthly,
  }))

  const newSubscriptions = allSubscriptions.filter(s => s.consecutiveMonths === 2)
  const subscriptionMonthlyTotal = allSubscriptions
    .filter(s => !s.isSuppressed && (s.recurringConfidence === 'high' || s.recurringConfidence === 'medium'))
    .reduce((sum, s) => sum + s.estimatedMonthlyAmount, 0)

  // ── Step 8: Assemble MonthlyAggregates ───────────────────────────────────
  const now = new Date()
  const monthDate = new Date(year, month - 1, 1)
  const isCurrentMonth = now.getFullYear() === year && now.getMonth() + 1 === month
  const daysInMonthVal = getDaysInMonth(monthDate)
  const daysElapsed = isCurrentMonth
    ? now.getDate()
    : daysInMonthVal

  const dailySpendingRate = daysElapsed > 0 ? summary.totalSpending / daysElapsed : 0
  const projectedMonthEnd = isCurrentMonth && summary.isPartialMonth
    ? dailySpendingRate * daysInMonthVal
    : null

  // Fixed spending = sum of high/medium confidence subscription amounts
  const fixedSpending = allSubscriptions
    .filter(s => !s.isSuppressed && (s.recurringConfidence === 'high' || s.recurringConfidence === 'medium'))
    .reduce((sum, s) => sum + s.estimatedMonthlyAmount, 0)

  const monthly: MonthlyAggregates = {
    year,
    month,
    totalIncome: summary.totalIncome,
    totalSpending: summary.totalSpending,
    net: summary.net,
    fixedSpending,
    discretionarySpending: Math.max(0, summary.totalSpending - fixedSpending),
    dailySpendingRate,
    projectedMonthEnd,
    daysElapsed,
    daysInMonth: daysInMonthVal,
    isPartialMonth: summary.isPartialMonth,
  }

  // ── Step 9: Assemble CategoryMetrics ────────────────────────────────────
  const prevCatMap = new Map<string, number>()
  for (const ct of prevSummary.categoryTotals) {
    prevCatMap.set(ct.categoryName, ct.total)
  }

  const categories: CategoryMetrics[] = summary.categoryTotals.map(ct => {
    const prevTotal = prevCatMap.get(ct.categoryName) ?? null
    const delta = prevTotal !== null ? ct.total - prevTotal : null
    const deltaPercent = prevTotal !== null && prevTotal > 0 ? (delta! / prevTotal) * 100 : null
    const historyArr = categoryHistory.get(ct.categoryName) ?? null
    const threeMonthAvg =
      historyArr && historyArr.length > 0
        ? historyArr.reduce((s, v) => s + v, 0) / historyArr.length
        : null

    return {
      categoryName: ct.categoryName,
      currentMonthTotal: ct.total,
      previousMonthTotal: prevTotal,
      delta,
      deltaPercent,
      threeMonthAvg,
      transactionCount: ct.transactionCount,
      pctOfSpending: ct.pctOfSpending,
      isIncome: ct.isIncome,
    }
  })

  // ── Step 10: Assemble MerchantMetrics ────────────────────────────────────
  const merchants: MerchantMetrics[] = thisMerchants.map(row => {
    const prevTotal = prevMerchantMap.get(row.merchantnormalized) ?? null
    const thisTotal = Number(row.total)
    const merchantDelta = prevTotal !== null ? thisTotal - prevTotal : null
    const merchantDeltaPct =
      merchantDelta !== null && prevTotal !== null && prevTotal > 0
        ? (merchantDelta / prevTotal) * 100
        : null

    // Check if this merchant is in subscription candidates
    const subRecord = allSubscriptions.find(s => s.merchantNormalized === row.merchantnormalized)

    return {
      merchantNormalized: row.merchantnormalized,
      merchantDisplay: row.merchantnormalized,
      merchantTotal: thisTotal,
      merchantCount: Number(row.count),
      merchantDelta,
      merchantDeltaPct,
      isRecurringCandidate: !!subRecord,
      recurringConfidence: subRecord?.recurringConfidence ?? 'low',
      estimatedNextCharge: subRecord?.estimatedNextCharge ?? null,
      consecutiveMonths: subRecord?.consecutiveMonths ?? 0,
      observedAmounts: subRecord ? [subRecord.estimatedMonthlyAmount] : [],
    }
  })

  // ── Step 11: Assemble FrequencyMetrics ───────────────────────────────────
  const frequency: FrequencyMetrics = {
    smallPurchaseCount: smallPurchases.count,
    smallPurchaseTotal: smallPurchases.total,
    smallPurchaseMerchants: smallPurchases.merchants,
    weekendSpendingTotal: 0, // not queried separately — generators that need this can add it
    weekdaySpendingTotal: 0,
    avgTransactionAmount:
      summary.transactionCount > 0 ? summary.totalSpending / summary.transactionCount : 0,
    largeTransactionThreshold: p95Threshold,
  }

  // ── Step 12: Assemble SubscriptionMetrics ────────────────────────────────
  const subscriptions: SubscriptionMetrics = {
    subscriptionCount: allSubscriptions.filter(
      s => !s.isSuppressed && (s.recurringConfidence === 'high' || s.recurringConfidence === 'medium'),
    ).length,
    subscriptionMonthlyTotal,
    allSubscriptions,
    newSubscriptions,
    trialCandidates,
    duplicateServiceCategories,
  }

  // ── Step 13: Build full metrics bundle ───────────────────────────────────
  const metrics: ComputedInsightMetrics = {
    monthly,
    categories,
    merchants,
    largeTransactions,
    frequency,
    subscriptions,
  }

  // ── Step 14: Run all generators ──────────────────────────────────────────
  const { all, display } = runAllGenerators(metrics)

  // ── Step 15: Upsert all cards (preserving isDismissed) ───────────────────
  await upsertInsightCards(userId, year, month, all)

  // ── Step 16: Return display cards ────────────────────────────────────────
  return display
}
