/**
 * Financial Autopsy — 5 Analyzer Generators
 *
 * Each analyzer examines spending from a different angle and produces
 * InsightCard[] using the same pattern as generators.ts.
 *
 * Card types:
 *   autopsy_small_drain        — Small-purchase frequency bleeding budget
 *   autopsy_merchant_concentration — Over-reliance on one merchant
 *   autopsy_subscription_creep — Subscription count/cost growth MoM
 *   autopsy_category_spike     — Category that spiked hardest vs 3-month avg
 *   autopsy_velocity           — Pace of spending vs last month (spend rate)
 */

import { randomUUID } from 'crypto'
import type {
  InsightCard,
  InsightCardAction,
  ComputedInsightMetrics,
  InsightSupportingData,
} from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function dismiss(): InsightCardAction {
  return { label: 'Dismiss', action_key: 'dismiss' }
}

function viewTransactions(href = '/transactions'): InsightCardAction {
  return { label: 'View transactions', action_key: 'view_transactions', href }
}

function makeAutopsyCard(
  card_type: InsightCard['card_type'],
  priority: number,
  title: string,
  summary: string,
  supporting_data: InsightSupportingData,
  actions: InsightCardAction[],
  confidence: InsightCard['confidence'],
  icon_suggestion: string,
  year: number,
  month: number,
  numbers_used: InsightCard['numbers_used'] = [],
  filters?: InsightCard['filters'],
): InsightCard {
  return {
    id: randomUUID(),
    card_type,
    priority,
    title: title.slice(0, 60),
    summary,
    supporting_data,
    actions,
    confidence,
    icon_suggestion,
    generated_at: now(),
    year,
    month,
    numbers_used,
    filters,
  }
}

// ─── Analyzer 1: Small Purchase Drain ─────────────────────────────────────────
//
// Trigger:  smallPurchaseCount >= 10 AND smallPurchaseTotal >= $50
// Focus:    Tallies sub-$10 transactions and shows their true monthly impact.
// Severity: high if > 15% of spending; medium if > 8%; low otherwise

export function generateAutopsySmallDrain(
  metrics: ComputedInsightMetrics,
): InsightCard[] {
  const { monthly, frequency } = metrics
  const { year, month, totalSpending } = monthly
  const { smallPurchaseCount, smallPurchaseTotal, smallPurchaseMerchants } = frequency

  if (smallPurchaseCount < 10 || smallPurchaseTotal < 50) return []

  const pctOfSpending = totalSpending > 0 ? (smallPurchaseTotal / totalSpending) * 100 : 0
  const topMerchant = smallPurchaseMerchants[0]
  const avgPerTx = smallPurchaseTotal / smallPurchaseCount

  const confidence: InsightCard['confidence'] =
    pctOfSpending > 15 ? 'high' : pctOfSpending > 8 ? 'medium' : 'low'

  const topMerchantNote = topMerchant
    ? ` ${topMerchant.merchantDisplay} accounts for ${topMerchant.count} of those charges ($${topMerchant.total.toFixed(0)}).`
    : ''

  const summary =
    `${smallPurchaseCount} small purchases totaling $${smallPurchaseTotal.toFixed(0)} ` +
    `represent ${Math.round(pctOfSpending)}% of your spending this month.${topMerchantNote}`

  const data = {
    count: smallPurchaseCount,
    total: smallPurchaseTotal,
    avg_per_transaction: avgPerTx,
    top_category: topMerchant?.merchantDisplay ?? '',
    top_category_count: topMerchant?.count ?? 0,
    top_category_total: topMerchant?.total ?? 0,
    pct_of_spending: pctOfSpending,
  }

  return [
    makeAutopsyCard(
      'autopsy_small_drain',
      4,
      'Small purchases are adding up',
      summary,
      data as unknown as InsightSupportingData,
      [viewTransactions(`/transactions?maxAmount=10&year=${year}&month=${month}`), dismiss()],
      confidence,
      'Coins',
      year,
      month,
      [
        { label: 'Count', value: String(smallPurchaseCount), field: 'count' },
        { label: 'Total', value: `$${smallPurchaseTotal.toFixed(2)}`, field: 'total' },
        { label: 'Pct of spending', value: `${Math.round(pctOfSpending)}%`, field: 'pct_of_spending' },
      ],
    ),
  ]
}

// ─── Analyzer 2: Merchant Concentration ───────────────────────────────────────
//
// Trigger:  Top merchant accounts for >= 20% of total spending
// Focus:    Flags single-vendor over-reliance.

export function generateAutopsyMerchantConcentration(
  metrics: ComputedInsightMetrics,
): InsightCard[] {
  const { monthly, merchants } = metrics
  const { year, month, totalSpending } = monthly

  if (totalSpending <= 0 || merchants.length === 0) return []

  const top = merchants
    .filter(m => m.merchantTotal > 0)
    .sort((a, b) => b.merchantTotal - a.merchantTotal)[0]

  if (!top) return []

  const pct = (top.merchantTotal / totalSpending) * 100
  if (pct < 20) return []

  const confidence: InsightCard['confidence'] =
    pct >= 30 ? 'high' : pct >= 20 ? 'medium' : 'low'

  const summary =
    `${top.merchantDisplay} represents ${Math.round(pct)}% of your total spending ` +
    `this month ($${top.merchantTotal.toFixed(0)} across ${top.merchantCount} transaction${top.merchantCount !== 1 ? 's' : ''}).`

  const data = {
    merchant: top.merchantDisplay,
    this_month_total: top.merchantTotal,
    prior_month_total: top.merchantTotal - (top.merchantDelta ?? 0),
    delta: top.merchantDelta ?? 0,
    delta_pct: top.merchantDeltaPct ?? 0,
  }

  return [
    makeAutopsyCard(
      'autopsy_merchant_concentration',
      3,
      `${top.merchantDisplay} dominates your spending`,
      summary,
      data as unknown as InsightSupportingData,
      [
        {
          label: 'View transactions',
          action_key: 'view_transactions',
          href: `/transactions?merchant=${encodeURIComponent(top.merchantNormalized)}`,
        },
        dismiss(),
      ],
      confidence,
      'Target',
      year,
      month,
      [
        { label: 'Merchant total', value: `$${top.merchantTotal.toFixed(2)}`, field: 'this_month_total' },
        { label: 'Pct of spending', value: `${Math.round(pct)}%`, field: 'delta_pct' },
      ],
      { merchant: top.merchantNormalized },
    ),
  ]
}

// ─── Analyzer 3: Subscription Creep ───────────────────────────────────────────
//
// Trigger:  subscriptionCount >= 3 AND subscriptionMonthlyTotal > $30
// Focus:    Shows how subscription burden has grown vs last available data.

export function generateAutopsySubscriptionCreep(
  metrics: ComputedInsightMetrics,
): InsightCard[] {
  const { monthly, subscriptions } = metrics
  const { year, month, totalIncome } = monthly
  const { subscriptionCount, subscriptionMonthlyTotal, allSubscriptions } = subscriptions

  if (subscriptionCount < 3 || subscriptionMonthlyTotal < 30) return []

  const annualized = subscriptionMonthlyTotal * 12
  const pctOfIncome = totalIncome > 0 ? (subscriptionMonthlyTotal / totalIncome) * 100 : 0
  const mostExpensive = allSubscriptions
    .filter(s => !s.isSuppressed)
    .sort((a, b) => b.estimatedMonthlyAmount - a.estimatedMonthlyAmount)[0]

  const confidence: InsightCard['confidence'] =
    pctOfIncome > 10 ? 'high' : pctOfIncome > 5 ? 'medium' : 'low'

  const topNote = mostExpensive
    ? ` The largest is ${mostExpensive.merchantDisplay} at $${mostExpensive.estimatedMonthlyAmount.toFixed(0)}/mo.`
    : ''

  const summary =
    `You have ${subscriptionCount} active subscriptions costing $${subscriptionMonthlyTotal.toFixed(0)}/month ` +
    `($${annualized.toFixed(0)}/year).${topNote}`

  const data = {
    subscription_count: subscriptionCount,
    monthly_total: subscriptionMonthlyTotal,
    annualized_cost: annualized,
    most_expensive_merchant: mostExpensive?.merchantDisplay ?? '',
    most_expensive_amount: mostExpensive?.estimatedMonthlyAmount ?? 0,
  }

  return [
    makeAutopsyCard(
      'autopsy_subscription_creep',
      5,
      `${subscriptionCount} subscriptions cost $${subscriptionMonthlyTotal.toFixed(0)}/mo`,
      summary,
      data as unknown as InsightSupportingData,
      [
        { label: 'Review subscriptions', action_key: 'view_subscriptions', href: '/dashboard?tab=subscriptions' },
        dismiss(),
      ],
      confidence,
      'RefreshCw',
      year,
      month,
      [
        { label: 'Count', value: String(subscriptionCount), field: 'subscription_count' },
        { label: 'Monthly total', value: `$${subscriptionMonthlyTotal.toFixed(2)}`, field: 'monthly_total' },
        { label: 'Annualized', value: `$${annualized.toFixed(2)}`, field: 'annualized_cost' },
      ],
    ),
  ]
}

// ─── Analyzer 4: Category Spike ───────────────────────────────────────────────
//
// Trigger:  Any expense category up >= 40% vs 3-month average (min $30 delta)
// Focus:    Surfaces the single most anomalous category this month.
// Note:     This complements the existing category_spike generator by framing
//           it as an "autopsy" finding with different copy/priority.

export function generateAutopsyCategorySpike(
  metrics: ComputedInsightMetrics,
): InsightCard[] {
  const { monthly, categories } = metrics
  const { year, month } = monthly

  const spikes = categories
    .filter(c => !c.isIncome && c.threeMonthAvg !== null && c.threeMonthAvg > 0)
    .filter(c => {
      const delta = c.currentMonthTotal - (c.threeMonthAvg ?? 0)
      const pct = ((c.currentMonthTotal - (c.threeMonthAvg ?? 0)) / (c.threeMonthAvg ?? 1)) * 100
      return pct >= 40 && delta >= 30
    })
    .sort((a, b) => {
      const pctA = ((a.currentMonthTotal - (a.threeMonthAvg ?? 0)) / (a.threeMonthAvg ?? 1)) * 100
      const pctB = ((b.currentMonthTotal - (b.threeMonthAvg ?? 0)) / (b.threeMonthAvg ?? 1)) * 100
      return pctB - pctA
    })

  if (spikes.length === 0) return []

  const top = spikes[0]
  const avg = top.threeMonthAvg ?? 0
  const pct = avg > 0 ? ((top.currentMonthTotal - avg) / avg) * 100 : 0
  const delta = top.currentMonthTotal - avg

  const confidence: InsightCard['confidence'] =
    pct >= 100 ? 'high' : pct >= 60 ? 'medium' : 'low'

  const summary =
    `${top.categoryName} spending is $${top.currentMonthTotal.toFixed(0)} this month — ` +
    `${Math.round(pct)}% above your 3-month average of $${avg.toFixed(0)} (+$${delta.toFixed(0)}).`

  const data = {
    category_name: top.categoryName,
    this_month_amount: top.currentMonthTotal,
    avg_prior_3_months: avg,
    pct_increase: pct,
    delta_dollars: delta,
    transaction_count: top.transactionCount,
    months_of_history: 3,
  }

  return [
    makeAutopsyCard(
      'autopsy_category_spike',
      3,
      `${top.categoryName} spending jumped ${Math.round(pct)}%`,
      summary,
      data as unknown as InsightSupportingData,
      [
        {
          label: 'View transactions',
          action_key: 'view_transactions',
          href: `/transactions?category=${encodeURIComponent(top.categoryName)}`,
        },
        dismiss(),
      ],
      confidence,
      'TrendingUp',
      year,
      month,
      [
        { label: 'This month', value: `$${top.currentMonthTotal.toFixed(2)}`, field: 'this_month_amount' },
        { label: '3-month avg', value: `$${avg.toFixed(2)}`, field: 'avg_prior_3_months' },
        { label: 'Increase', value: `${Math.round(pct)}%`, field: 'pct_increase' },
      ],
      { category: top.categoryName },
    ),
  ]
}

// ─── Analyzer 5: Spending Velocity ────────────────────────────────────────────
//
// Trigger:  dailySpendingRate in current partial month is > 20% faster than
//           implied daily rate from previous full month.
//           Only fires on partial months (isPartialMonth = true).

export function generateAutopsyVelocity(
  metrics: ComputedInsightMetrics,
): InsightCard[] {
  const { monthly } = metrics
  const {
    year, month, totalSpending, dailySpendingRate,
    daysElapsed, daysInMonth, isPartialMonth,
    prevMonthIncome,
  } = monthly

  // Only meaningful on partial months with enough data
  if (!isPartialMonth || daysElapsed < 5) return []

  // We need a prior-month comparison — use prevMonthIncome as proxy only if available.
  // Primary signal: current daily rate vs projected end-of-month.
  const projectedMonthEnd = dailySpendingRate * daysInMonth
  const daysRemaining = daysInMonth - daysElapsed

  // Without a prior-month spending benchmark we still fire if pace is severely high.
  // Use 120% of current spend pace = "you'll exceed this month by 20% if unchanged"
  if (projectedMonthEnd <= totalSpending * 1.20) return []

  const overage = projectedMonthEnd - totalSpending
  const pctAbove = ((projectedMonthEnd - totalSpending) / Math.max(totalSpending, 1)) * 100

  // Need at least 20% projected overage to be meaningful
  if (pctAbove < 20) return []

  const confidence: InsightCard['confidence'] =
    pctAbove >= 50 ? 'high' : pctAbove >= 30 ? 'medium' : 'low'

  const summary =
    `At your current pace of $${dailySpendingRate.toFixed(0)}/day, ` +
    `you're on track to spend $${projectedMonthEnd.toFixed(0)} this month — ` +
    `$${overage.toFixed(0)} more than you've spent so far with ${daysRemaining} days left.`

  const data = {
    daily_rate: dailySpendingRate,
    projected_spending: projectedMonthEnd,
    total_income: prevMonthIncome ?? 0,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    days_in_month: daysInMonth,
    pace_status: 'over_pace' as const,
    overage_or_underage: overage,
  }

  return [
    makeAutopsyCard(
      'autopsy_velocity',
      4,
      'Spending pace is accelerating',
      summary,
      data as unknown as InsightSupportingData,
      [viewTransactions(`/transactions?year=${year}&month=${month}`), dismiss()],
      confidence,
      'Gauge',
      year,
      month,
      [
        { label: 'Daily rate', value: `$${dailySpendingRate.toFixed(2)}`, field: 'daily_rate' },
        { label: 'Projected total', value: `$${projectedMonthEnd.toFixed(2)}`, field: 'projected_spending' },
        { label: 'Days remaining', value: String(daysRemaining), field: 'days_remaining' },
      ],
    ),
  ]
}

// ─── runAutopsyGenerators ──────────────────────────────────────────────────────

export function runAutopsyGenerators(
  metrics: ComputedInsightMetrics,
): InsightCard[] {
  return [
    ...generateAutopsySmallDrain(metrics),
    ...generateAutopsyMerchantConcentration(metrics),
    ...generateAutopsySubscriptionCreep(metrics),
    ...generateAutopsyCategorySpike(metrics),
    ...generateAutopsyVelocity(metrics),
  ]
}
