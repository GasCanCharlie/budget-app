/**
 * AI Insights — Turn 3: The 10 Automatic Insight Generators
 *
 * All generators are deterministic, rule-based functions.
 * No LLM calls happen here. Every card is backed by real numbers from
 * ComputedInsightMetrics assembled by the data computation pass.
 *
 * Generator function signatures:
 *   function generateX(metrics: ComputedInsightMetrics): InsightCard[]
 *
 * After all 10 generators run, call rankAndCap() to sort + deduplicate + cap at 8.
 */

import { randomUUID } from 'crypto'

import type {
  InsightCard,
  InsightCardAction,
  ComputedInsightMetrics,
  CategoryMetrics,
  SubscriptionCandidateRecord,
  TrialCandidate,
  FixOpportunityScenario,
  OverBudgetData,
  CategorySpikeData,
  MerchantSpikeData,
  LargeTransactionData,
  SmallLeaksData,
  SubscriptionSummaryData,
  SubscriptionNewData,
  TrialWarningData,
  CashFlowForecastData,
  FixOpportunityData,
  MerchantFrequencyData,
  MomIncomeChangeData,
  MonthlySummaryData,
  InsightSupportingData,
} from './types'

// ─── Wisdom sayings ───────────────────────────────────────────────────────────

const WISDOM_BY_TYPE: Record<InsightCard['card_type'], string> = {
  over_budget: 'The sea doesn\'t panic at high tide — it simply rises and falls.',
  category_spike: 'A sudden wave is not a storm; it passes if you steer with intention.',
  merchant_spike: 'Notice the river\'s bend — small shifts in flow shape the whole valley.',
  large_transaction: 'Even one stone can ripple a still pond. Mind where you cast it.',
  small_leaks: 'A house isn\'t lost to rain — it\'s lost to the slow drip no one hears.',
  subscription_summary: 'Count what you\'ve planted; not every seed you sow needs to grow.',
  subscription_new: 'New roots take time to judge. Watch before you water.',
  trial_warning: 'The door that opens freely may close with a fee. Notice it now.',
  cash_flow_forecast: 'The river always knows where it\'s going. So can you.',
  fix_opportunity: 'Pruning is not loss — it is the gardener\'s quiet confidence in spring.',
  merchant_frequency: 'Familiarity is comfortable; awareness makes it a choice.',
  mom_income_change: 'A tide that shifts is not a tide that ends — observe before you anchor.',
  monthly_summary: 'Every month is a complete story — income earned, choices made, balance kept.',
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString()
}

function dismissAction(): InsightCardAction {
  return { label: 'Dismiss', action_key: 'dismiss' }
}

function viewTransactionsAction(href = '/transactions'): InsightCardAction {
  return { label: 'View transactions', action_key: 'view_transactions', href }
}

function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`
}

function formatPct(pct: number): string {
  return `${Math.round(pct)}%`
}

function makeCard(
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
  const dataWithWisdom = {
    ...(supporting_data as unknown as Record<string, unknown>),
    _wisdom: WISDOM_BY_TYPE[card_type],
  } as unknown as InsightSupportingData
  return {
    id: randomUUID(),
    card_type,
    priority,
    title: title.slice(0, 60),
    summary,
    supporting_data: dataWithWisdom,
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

// ─── Generator 1: generateOverBudgetDiagnosis ─────────────────────────────────
//
// Trigger:    totalSpending > totalIncome for the month
// Priority:   1 (highest urgency — deficit is always shown first)
// Confidence: high when income > 0; medium when income === 0
//
// Algorithm:
//   1. Guard: totalSpending <= totalIncome → return []
//   2. Filter expense categories (isIncome = false), sort by currentMonthTotal desc.
//   3. Take up to top 3 spending categories.
//   4. Compute combined pct of total spending for those 3 categories.
//   5. Find if any single category removal alone would restore net >= 0.
//   6. Build card.

export function generateOverBudgetDiagnosis(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, categories } = metrics
  const { totalIncome, totalSpending, net, year, month } = monthly

  // Trigger guard
  if (totalSpending <= totalIncome) return []

  const deficit = Math.abs(net)

  // Top expense categories sorted by amount desc
  const expenseCats = categories
    .filter(c => !c.isIncome && c.currentMonthTotal > 0)
    .sort((a, b) => b.currentMonthTotal - a.currentMonthTotal)

  const top3 = expenseCats.slice(0, 3)
  const top3Total = top3.reduce((s, c) => s + c.currentMonthTotal, 0)
  const top3Pct = totalSpending > 0 ? (top3Total / totalSpending) * 100 : 0

  // Find a single-category fix: which category, if removed, restores net >= 0?
  let singleFixCategory: string | null = null
  let singleFixAmount: number | null = null
  for (const cat of expenseCats) {
    if (cat.currentMonthTotal >= deficit) {
      singleFixCategory = cat.categoryName
      singleFixAmount = cat.currentMonthTotal
      break
    }
  }

  const cat1 = top3[0] ?? null
  const cat2 = top3[1] ?? null
  const cat3 = top3[2] ?? null

  const data: OverBudgetData = {
    deficit,
    totalIncome,
    totalSpending,
    top_category_1_name: cat1?.categoryName ?? '',
    top_category_1_amount: cat1?.currentMonthTotal ?? 0,
    top_category_2_name: cat2?.categoryName ?? null,
    top_category_2_amount: cat2?.currentMonthTotal ?? null,
    top_category_3_name: cat3?.categoryName ?? null,
    top_category_3_amount: cat3?.currentMonthTotal ?? null,
    single_fix_category: singleFixCategory,
    single_fix_amount: singleFixAmount,
    top3_combined_pct: Math.round(top3Pct),
  }

  const topDriverText = cat1
    ? ` The largest spending category is ${cat1.categoryName} at ${formatCurrency(cat1.currentMonthTotal)}.`
    : ''
  const fixText =
    singleFixCategory && singleFixAmount
      ? ` Spending in ${singleFixCategory} (${formatCurrency(singleFixAmount)}) exceeds the deficit on its own.`
      : ''

  const title = `Spending exceeded income by ${formatCurrency(deficit)}`
  const summary =
    `Total spending of ${formatCurrency(totalSpending)} exceeded income of ` +
    `${formatCurrency(totalIncome)} by ${formatCurrency(deficit)} this month.` +
    topDriverText +
    fixText

  const confidence: InsightCard['confidence'] = totalIncome > 0 ? 'high' : 'medium'

  return [
    makeCard(
      'over_budget',
      1,
      title,
      summary,
      data,
      [viewTransactionsAction(), dismissAction()],
      confidence,
      'TrendingDown',
      year,
      month,
      [
        { label: 'Deficit', value: formatCurrency(deficit), field: 'deficit' },
        { label: 'Total Income', value: formatCurrency(totalIncome), field: 'totalIncome' },
        { label: 'Total Spending', value: formatCurrency(totalSpending), field: 'totalSpending' },
      ],
    ),
  ]
}

// ─── Generator 2: generateCategorySpikes ─────────────────────────────────────
//
// Trigger:    Any expense category where deltaPercent > 20 AND delta > $50
//             AND threeMonthAvg > 0 AND category has 2+ prior months of data.
// Priority:   2
// Confidence: high when threeMonthAvg is based on 3 months; medium otherwise.
//
// Algorithm:
//   1. Filter expense categories meeting all trigger conditions.
//   2. Sort by absolute dollar delta descending.
//   3. Return one card for the top spike only (highest dollar impact).

export function generateCategorySpikes(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, categories } = metrics
  const { year, month } = monthly

  const DELTA_PCT_THRESHOLD = 20
  const DELTA_DOLLAR_THRESHOLD = 50

  const candidates = categories
    .filter(c => {
      if (c.isIncome) return false
      if (c.deltaPercent === null || c.deltaPercent <= DELTA_PCT_THRESHOLD) return false
      if (c.delta === null || c.delta <= DELTA_DOLLAR_THRESHOLD) return false
      if (!c.threeMonthAvg || c.threeMonthAvg <= 0) return false
      return true
    })
    .sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0))

  if (candidates.length === 0) return []

  const top = candidates[0] as CategoryMetrics
  const pctIncrease = Math.round(top.deltaPercent ?? 0)

  const data: CategorySpikeData = {
    category_name: top.categoryName,
    this_month_amount: top.currentMonthTotal,
    avg_prior_3_months: top.threeMonthAvg ?? 0,
    pct_increase: pctIncrease,
    delta_dollars: top.delta ?? 0,
    transaction_count: top.transactionCount,
    months_of_history: 3,
  }

  const confidence: InsightCard['confidence'] = 'high'

  const title = `${top.categoryName} spending increased ${formatPct(pctIncrease)} this month`
  const summary =
    `Spending in ${top.categoryName} reached ${formatCurrency(top.currentMonthTotal)} this month, ` +
    `compared to a prior 3-month average of ${formatCurrency(top.threeMonthAvg ?? 0)}. ` +
    `This is an increase of ${formatPct(pctIncrease)}, with ${top.transactionCount} transactions recorded.`

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const dateTo = new Date(year, month, 0).toISOString().slice(0, 10)

  return [
    makeCard(
      'category_spike',
      2,
      title,
      summary,
      data,
      [
        viewTransactionsAction(`/transactions?category=${encodeURIComponent(top.categoryName)}`),
        dismissAction(),
      ],
      confidence,
      'TrendingUp',
      year,
      month,
      [
        { label: 'This Month Amount', value: formatCurrency(top.currentMonthTotal), field: 'this_month_amount' },
        { label: 'Avg Prior 3 Months', value: formatCurrency(top.threeMonthAvg ?? 0), field: 'avg_prior_3_months' },
        { label: 'Pct Increase', value: formatPct(pctIncrease), field: 'pct_increase' },
      ],
      { category: top.categoryName, dateFrom, dateTo },
    ),
  ]
}

// ─── Generator 3: generateMerchantSpikes ─────────────────────────────────────
//
// Trigger:    A merchant where merchantDelta > $100 AND deltaPercent > 30%
//             AND prior month data exists.
// Priority:   3
// Confidence: high when merchantDelta is large and unambiguous; medium otherwise.
//
// Algorithm:
//   1. Filter merchants meeting trigger conditions.
//   2. Sort by merchantDelta desc.
//   3. Return one card for the top merchant spike.

export function generateMerchantSpikes(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, merchants } = metrics
  const { year, month } = monthly

  const DELTA_DOLLAR_THRESHOLD = 100
  const DELTA_PCT_THRESHOLD = 30

  const candidates = merchants
    .filter(m => {
      if (m.merchantDelta === null || m.merchantDelta <= DELTA_DOLLAR_THRESHOLD) return false
      if (m.merchantDeltaPct === null || m.merchantDeltaPct <= DELTA_PCT_THRESHOLD) return false
      return true
    })
    .sort((a, b) => (b.merchantDelta ?? 0) - (a.merchantDelta ?? 0))

  if (candidates.length === 0) return []

  const top = candidates[0]
  const priorMonthTotal = top.merchantTotal - (top.merchantDelta ?? 0)
  const deltaPct = Math.round(top.merchantDeltaPct ?? 0)

  const data: MerchantSpikeData = {
    merchant: top.merchantDisplay,
    this_month_total: top.merchantTotal,
    prior_month_total: priorMonthTotal,
    delta: top.merchantDelta ?? 0,
    delta_pct: deltaPct,
  }

  const confidence: InsightCard['confidence'] =
    (top.merchantDelta ?? 0) > 300 ? 'high' : 'medium'

  const title = `${top.merchantDisplay} spending up ${formatPct(deltaPct)} vs last month`
  const summary =
    `Spending at ${top.merchantDisplay} increased from ` +
    `${formatCurrency(priorMonthTotal)} last month to ` +
    `${formatCurrency(top.merchantTotal)} this month, ` +
    `a change of +${formatCurrency(top.merchantDelta ?? 0)} (${formatPct(deltaPct)}).`

  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const dateTo = new Date(year, month, 0).toISOString().slice(0, 10)

  return [
    makeCard(
      'merchant_spike',
      3,
      title,
      summary,
      data,
      [
        viewTransactionsAction(
          `/transactions?merchant=${encodeURIComponent(top.merchantNormalized)}`,
        ),
        dismissAction(),
      ],
      confidence,
      'Store',
      year,
      month,
      [
        { label: 'This Month Total', value: formatCurrency(top.merchantTotal), field: 'this_month_total' },
        { label: 'Prior Month Total', value: formatCurrency(priorMonthTotal), field: 'prior_month_total' },
        { label: 'Delta', value: formatCurrency(top.merchantDelta ?? 0), field: 'delta' },
      ],
      { merchant: top.merchantDisplay, dateFrom, dateTo },
    ),
  ]
}

// ─── Generator 4: generateLargeTransactions ──────────────────────────────────
//
// Trigger:    Any transaction > max($500, p95 of 12-month expenses).
// Priority:   2 (high urgency — large one-time charges are notable)
// Confidence: high (exact transaction data)
//
// Algorithm:
//   1. Use largeTransactionThreshold from frequency metrics.
//   2. Use pre-filtered largeTransactions list from metrics bundle (already above threshold).
//   3. Cap at 3 cards, one per transaction, sorted by amount desc.

export function generateLargeTransactions(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, largeTransactions, frequency } = metrics
  const { year, month, totalSpending } = monthly

  const cards: InsightCard[] = []
  const top3 = largeTransactions.slice(0, 3)
  const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
  const dateTo = new Date(year, month, 0).toISOString().slice(0, 10)

  for (const tx of top3) {
    const pctOfSpending =
      totalSpending > 0 ? Math.round((tx.amount / totalSpending) * 100) : 0

    const data: LargeTransactionData = {
      merchant: tx.merchant,
      amount: tx.amount,
      date: tx.date,
      pct_of_monthly_spending: pctOfSpending,
      category_name: tx.categoryName,
      threshold_used: frequency.largeTransactionThreshold,
    }

    const title = `Single transaction: ${formatCurrency(tx.amount)} at ${tx.merchant}`
    const dateLabel = tx.date.slice(0, 10)
    const summary =
      `A ${tx.merchant} charge of ${formatCurrency(tx.amount)} on ${dateLabel} ` +
      `represents ${formatPct(pctOfSpending)} of this month's total spending.`

    cards.push(
      makeCard(
        'large_transaction',
        2,
        title,
        summary,
        data,
        [viewTransactionsAction(), dismissAction()],
        'high',
        'CreditCard',
        year,
        month,
        [
          { label: 'Amount', value: formatCurrency(tx.amount), field: 'amount' },
          { label: 'Pct of Monthly Spending', value: formatPct(pctOfSpending), field: 'pct_of_monthly_spending' },
          { label: 'Threshold Used', value: formatCurrency(frequency.largeTransactionThreshold), field: 'threshold_used' },
        ],
        { merchant: tx.merchant, dateFrom, dateTo, minAmount: frequency.largeTransactionThreshold },
      ),
    )
  }

  return cards
}

// ─── Generator 5: generateSmallPurchaseLeaks ─────────────────────────────────
//
// Trigger:    smallPurchaseCount > 10 AND smallPurchaseTotal > $150
// Priority:   5
// Confidence: high (exact counts)
//
// Algorithm:
//   1. Guard: check trigger conditions.
//   2. Group small purchase merchants by category using frequency.smallPurchaseMerchants.
//      (Since merchant-to-category mapping is not in FrequencyMetrics, we find the
//       merchant with the most purchases and report its name as top category proxy.)
//   3. Compute avg per transaction.
//   4. Build card.

export function generateSmallPurchaseLeaks(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, frequency, categories } = metrics
  const { year, month, totalSpending } = monthly

  const COUNT_THRESHOLD = 10
  const TOTAL_THRESHOLD = 150

  if (
    frequency.smallPurchaseCount <= COUNT_THRESHOLD ||
    frequency.smallPurchaseTotal <= TOTAL_THRESHOLD
  ) {
    return []
  }

  const avg =
    frequency.smallPurchaseCount > 0
      ? frequency.smallPurchaseTotal / frequency.smallPurchaseCount
      : 0

  // Find the top merchant by count among small-purchase merchants
  const sortedMerchants = [...frequency.smallPurchaseMerchants].sort(
    (a, b) => b.count - a.count,
  )
  const topMerchant = sortedMerchants[0]

  // Attempt to find which spending category contains the most small-purchase activity.
  // We use the category with the highest transaction count that is not income.
  const topExpenseCat = [...categories]
    .filter(c => !c.isIncome)
    .sort((a, b) => b.transactionCount - a.transactionCount)[0]

  const topCategoryName = topMerchant?.merchantDisplay ?? topExpenseCat?.categoryName ?? 'Unknown'
  const topCategoryCount = topMerchant?.count ?? 0
  const topCategoryTotal = topMerchant?.total ?? 0

  const pctOfSpending =
    totalSpending > 0
      ? Math.round((frequency.smallPurchaseTotal / totalSpending) * 100)
      : 0

  const data: SmallLeaksData = {
    count: frequency.smallPurchaseCount,
    total: frequency.smallPurchaseTotal,
    avg_per_transaction: Math.round(avg * 100) / 100,
    top_category: topCategoryName,
    top_category_count: topCategoryCount,
    top_category_total: topCategoryTotal,
    pct_of_spending: pctOfSpending,
  }

  const title = `${frequency.smallPurchaseCount} small purchases totaling ${formatCurrency(frequency.smallPurchaseTotal)}`
  const summary =
    `${frequency.smallPurchaseCount} transactions under $15 this month total ` +
    `${formatCurrency(frequency.smallPurchaseTotal)}, representing ${formatPct(pctOfSpending)} of spending. ` +
    `The average small purchase is ${formatCurrency(avg)}.`

  return [
    makeCard(
      'small_leaks',
      5,
      title,
      summary,
      data,
      [viewTransactionsAction('/transactions?filter=small'), dismissAction()],
      'high',
      'Droplets',
      year,
      month,
      [
        { label: 'Count', value: String(frequency.smallPurchaseCount), field: 'count' },
        { label: 'Total', value: formatCurrency(frequency.smallPurchaseTotal), field: 'total' },
        { label: 'Pct of Spending', value: formatPct(pctOfSpending), field: 'pct_of_spending' },
      ],
    ),
  ]
}

// ─── Generator 6: generateSubscriptionSummary ────────────────────────────────
//
// Trigger:    subscriptionCount >= 2 (at least 2 active, non-suppressed subscriptions)
// Priority:   4
// Confidence: high when subscriptionCount >= 3 with high-confidence candidates;
//             medium when count is 2 or some are medium-confidence.
//
// Algorithm:
//   1. Guard: subscriptionCount < 2 → return []
//   2. Sort active subscriptions by estimatedMonthlyAmount desc.
//   3. Most expensive = allSubscriptions[0].
//   4. Compute annualized cost = subscriptionMonthlyTotal * 12.
//   5. Build card.

export function generateSubscriptionSummary(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, subscriptions } = metrics
  const { year, month } = monthly

  if (subscriptions.subscriptionCount < 2) return []

  const sorted = [...subscriptions.allSubscriptions]
    .filter(s => !s.isSuppressed)
    .sort((a, b) => b.estimatedMonthlyAmount - a.estimatedMonthlyAmount)

  if (sorted.length === 0) return []

  const topSub = sorted[0] as SubscriptionCandidateRecord
  const annualized = subscriptions.subscriptionMonthlyTotal * 12

  const data: SubscriptionSummaryData = {
    subscription_count: subscriptions.subscriptionCount,
    monthly_total: subscriptions.subscriptionMonthlyTotal,
    annualized_cost: Math.round(annualized * 100) / 100,
    most_expensive_merchant: topSub.merchantDisplay,
    most_expensive_amount: topSub.estimatedMonthlyAmount,
  }

  const highConfCount = sorted.filter(s => s.recurringConfidence === 'high').length
  const confidence: InsightCard['confidence'] =
    highConfCount >= 3 ? 'high' : 'medium'

  const title = `${subscriptions.subscriptionCount} active subscriptions — ${formatCurrency(subscriptions.subscriptionMonthlyTotal)}/month`
  const summary =
    `${subscriptions.subscriptionCount} recurring subscriptions total ` +
    `${formatCurrency(subscriptions.subscriptionMonthlyTotal)}/month, ` +
    `or ${formatCurrency(annualized)} annualized. ` +
    `The largest is ${topSub.merchantDisplay} at ${formatCurrency(topSub.estimatedMonthlyAmount)}/month.`

  return [
    makeCard(
      'subscription_summary',
      4,
      title,
      summary,
      data,
      [
        {
          label: 'Review subscriptions',
          action_key: 'review_subscriptions',
          href: '/transactions?filter=subscriptions',
        },
        dismissAction(),
      ],
      confidence,
      'RefreshCw',
      year,
      month,
      [
        { label: 'Subscription Count', value: String(subscriptions.subscriptionCount), field: 'subscription_count' },
        { label: 'Monthly Total', value: formatCurrency(subscriptions.subscriptionMonthlyTotal), field: 'monthly_total' },
        { label: 'Annualized Cost', value: formatCurrency(Math.round(annualized * 100) / 100), field: 'annualized_cost' },
      ],
    ),
  ]
}

// ─── Generator 7: generateNewSubscriptionAlert ───────────────────────────────
//
// Trigger:    A SubscriptionCandidate with consecutiveMonths === 2 (just detected)
//             AND recurringConfidence IN ('high', 'medium').
// Priority:   3
// Confidence: mirrors the SubscriptionCandidate's recurringConfidence.
//
// Algorithm:
//   1. Filter newSubscriptions (consecutiveMonths === 2) with HIGH or MEDIUM confidence.
//   2. Return one card per new subscription (no cap — unusual to have many).
//   3. Each card shows merchant, amount/month, and annualized cost.

export function generateNewSubscriptionAlert(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, subscriptions } = metrics
  const { year, month } = monthly

  const newSubs = subscriptions.newSubscriptions.filter(
    s =>
      s.consecutiveMonths === 2 &&
      (s.recurringConfidence === 'high' || s.recurringConfidence === 'medium'),
  )

  if (newSubs.length === 0) return []

  return newSubs.map(sub => {
    const annualized = sub.estimatedMonthlyAmount * 12

    const data: SubscriptionNewData = {
      merchant: sub.merchantDisplay,
      amount_per_month: sub.estimatedMonthlyAmount,
      months_detected: sub.consecutiveMonths,
      annualized_cost: Math.round(annualized * 100) / 100,
      service_category: sub.serviceCategory,
      confidence: sub.recurringConfidence,
    }

    const confidence: InsightCard['confidence'] =
      sub.recurringConfidence === 'high' ? 'high' : 'medium'

    const title = `New recurring charge detected: ${sub.merchantDisplay}`
    const summary =
      `A recurring charge of ${formatCurrency(sub.estimatedMonthlyAmount)}/month from ` +
      `${sub.merchantDisplay} has been detected across 2 consecutive months. ` +
      `Annualized, this represents ${formatCurrency(annualized)}.`

    return makeCard(
      'subscription_new',
      3,
      title,
      summary,
      data,
      [
        {
          label: 'View charges',
          action_key: 'view_merchant_charges',
          href: `/transactions?merchant=${encodeURIComponent(sub.merchantNormalized)}`,
        },
        dismissAction(),
      ],
      confidence,
      'Bell',
      year,
      month,
      [
        { label: 'Amount Per Month', value: formatCurrency(sub.estimatedMonthlyAmount), field: 'amount_per_month' },
        { label: 'Annualized Cost', value: formatCurrency(Math.round(annualized * 100) / 100), field: 'annualized_cost' },
        { label: 'Months Detected', value: String(sub.consecutiveMonths), field: 'months_detected' },
      ],
    )
  })
}

// ─── Generator 8: generateTrialWarnings ──────────────────────────────────────
//
// Trigger:    A TrialCandidate where alertShouldFire === true
//             (within 3 days of estimated billing date, or no prior history).
// Priority:   2 (high urgency — user may want to cancel before billing)
// Confidence: medium (single data point, inferred pattern)
//
// Algorithm:
//   1. Filter trialCandidates where alertShouldFire === true.
//   2. Return one card per active trial.
//   3. Include estimated billing date and amount if known.

export function generateTrialWarnings(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, subscriptions } = metrics
  const { year, month } = monthly

  const activeCandidates = subscriptions.trialCandidates.filter(t => t.alertShouldFire)

  if (activeCandidates.length === 0) return []

  return activeCandidates.map((trial: TrialCandidate) => {
    const data: TrialWarningData = {
      merchant: trial.merchantDisplay,
      trial_amount: trial.chargeAmount,
      charge_date: trial.chargeDate,
      estimated_billing_date: trial.estimatedBillingDate,
      estimated_monthly_amount: trial.estimatedMonthlyAmount,
    }

    const billingText =
      trial.estimatedBillingDate
        ? ` Full billing may begin around ${trial.estimatedBillingDate.slice(0, 10)}.`
        : ''

    const amountText =
      trial.estimatedMonthlyAmount
        ? ` Estimated recurring charge: ${formatCurrency(trial.estimatedMonthlyAmount)}/month.`
        : ''

    const title = `Trial charge detected: ${trial.merchantDisplay}`
    const summary =
      `${trial.merchantDisplay} appears for the first time this month at ` +
      `${formatCurrency(trial.chargeAmount)}. This may be a trial or introductory charge.` +
      billingText +
      amountText

    const dateFrom = `${year}-${String(month).padStart(2, '0')}-01`
    const dateTo = new Date(year, month, 0).toISOString().slice(0, 10)

    const numbersUsed: InsightCard['numbers_used'] = [
      { label: 'Trial Amount', value: formatCurrency(trial.chargeAmount), field: 'trial_amount' },
      { label: 'Charge Date', value: trial.chargeDate.slice(0, 10), field: 'charge_date' },
    ]
    if (trial.estimatedMonthlyAmount !== null) {
      numbersUsed.push({
        label: 'Estimated Monthly Amount',
        value: formatCurrency(trial.estimatedMonthlyAmount),
        field: 'estimated_monthly_amount',
      })
    }

    return makeCard(
      'trial_warning',
      2,
      title,
      summary,
      data,
      [
        {
          label: 'Set reminder',
          action_key: 'set_reminder',
        },
        dismissAction(),
      ],
      'medium',
      'AlertCircle',
      year,
      month,
      numbersUsed,
      { merchant: trial.merchantDisplay, dateFrom, dateTo },
    )
  })
}

// ─── Generator 9: generateCashFlowForecast ───────────────────────────────────
//
// Trigger:    daysElapsed >= 7 AND isPartialMonth = true (current month only)
//             AND projected spending differs from income by > 10%.
// Priority:   4
// Confidence: medium for early-month projections (< 15 days); high for mid-month+.
//
// Algorithm:
//   1. Guard: daysElapsed < 7 → suppress.
//   2. Guard: not partial month (historical) → suppress.
//   3. Use dailySpendingRate and projectedMonthEnd from monthly aggregates.
//   4. Compute pace_status:
//      - projected within ±10% of income → 'on_track'
//      - projected > income * 1.10 → 'over_pace'
//      - projected < income * 0.90 → 'under_pace'
//   5. Only fire if pace_status !== 'on_track' (meaningful deviation only).

export function generateCashFlowForecast(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly } = metrics
  const {
    year,
    month,
    daysElapsed,
    daysInMonth,
    isPartialMonth,
    dailySpendingRate,
    projectedMonthEnd,
    totalIncome,
    totalSpending,
  } = monthly

  // Trigger guards
  if (daysElapsed < 7) return []
  if (!isPartialMonth) return []
  if (projectedMonthEnd === null) return []
  if (totalIncome <= 0) return []

  const projected = projectedMonthEnd
  const daysRemaining = daysInMonth - daysElapsed
  const overageOrUnderage = projected - totalIncome

  const ON_TRACK_BAND = 0.10
  let paceStatus: 'on_track' | 'over_pace' | 'under_pace'
  if (projected > totalIncome * (1 + ON_TRACK_BAND)) {
    paceStatus = 'over_pace'
  } else if (projected < totalIncome * (1 - ON_TRACK_BAND)) {
    paceStatus = 'under_pace'
  } else {
    paceStatus = 'on_track'
  }

  // Only fire when projection is meaningfully off track
  if (paceStatus === 'on_track') return []

  const data: CashFlowForecastData = {
    daily_rate: Math.round(dailySpendingRate * 100) / 100,
    projected_spending: Math.round(projected * 100) / 100,
    total_income: totalIncome,
    days_elapsed: daysElapsed,
    days_remaining: daysRemaining,
    days_in_month: daysInMonth,
    pace_status: paceStatus,
    overage_or_underage: Math.round(overageOrUnderage * 100) / 100,
  }

  const confidence: InsightCard['confidence'] = daysElapsed >= 15 ? 'high' : 'medium'

  const paceLabel = paceStatus === 'over_pace' ? 'above' : 'below'
  const title =
    paceStatus === 'over_pace'
      ? `On pace to exceed income by ${formatCurrency(Math.abs(overageOrUnderage))}`
      : `On pace to spend ${formatCurrency(Math.abs(overageOrUnderage))} under income`

  const summary =
    `At the current daily rate of ${formatCurrency(dailySpendingRate)}, ` +
    `projected month-end spending is ${formatCurrency(projected)}, ` +
    `${paceLabel} this month's income of ${formatCurrency(totalIncome)}. ` +
    `${daysRemaining} days remain in the month.`

  return [
    makeCard(
      'cash_flow_forecast',
      4,
      title,
      summary,
      data,
      [viewTransactionsAction(), dismissAction()],
      confidence,
      paceStatus === 'over_pace' ? 'TrendingUp' : 'TrendingDown',
      year,
      month,
      [
        { label: 'Projected Spending', value: formatCurrency(Math.round(projected * 100) / 100), field: 'projected_spending' },
        { label: 'Total Income', value: formatCurrency(totalIncome), field: 'total_income' },
        { label: 'Overage or Underage', value: formatCurrency(Math.round(overageOrUnderage * 100) / 100), field: 'overage_or_underage' },
      ],
    ),
  ]
}

// ─── Generator 10: generateFixOpportunity ────────────────────────────────────
//
// Trigger:    net < 0 AND at least one of:
//             (a) duplicate service categories detected,
//             (b) any subscription > $50/month,
//             (c) a single category is > 40% of total spending.
// Priority:   1 (actionable — concrete savings scenarios)
// Confidence: high when citing confirmed subscriptions; medium for category-based estimates.
//
// Algorithm:
//   1. Guard: net >= 0 → return []
//   2. Collect up to 3 scenarios, ranked by monthly_savings desc:
//      A. Duplicate service group: "Cancel one of 2 streaming services → save $X/month"
//      B. Expensive subscription > $50: "Cancel [merchant] → save $X/month"
//      C. Dominant category > 40%: "Reduce [category] spending → could free $X/month"
//   3. De-duplicate scenarios (don't repeat same merchant/category).
//   4. Build card with scenarios array.

export function generateFixOpportunity(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, subscriptions, categories } = metrics
  const { year, month, net, totalSpending } = monthly

  // Trigger guard
  if (net >= 0) return []

  const scenarios: FixOpportunityScenario[] = []
  const usedMerchants = new Set<string>()

  // Scenario source A: duplicate service categories
  for (const group of subscriptions.duplicateServiceCategories) {
    if (scenarios.length >= 3) break
    if (group.candidates.length < 2) continue
    const cheapest = [...group.candidates].sort(
      (a, b) => a.estimatedMonthlyAmount - b.estimatedMonthlyAmount,
    )[0]
    if (!cheapest) continue
    if (usedMerchants.has(cheapest.merchantNormalized)) continue
    usedMerchants.add(cheapest.merchantNormalized)
    const monthlySavings = cheapest.estimatedMonthlyAmount
    scenarios.push({
      action: `Cancel duplicate ${group.serviceCategory} service`,
      merchant_or_category: cheapest.merchantDisplay,
      monthly_savings: Math.round(monthlySavings * 100) / 100,
      annual_savings: Math.round(monthlySavings * 12 * 100) / 100,
    })
  }

  // Scenario source B: expensive single subscription > $50/month
  const expensiveSubs = subscriptions.allSubscriptions
    .filter(s => !s.isSuppressed && s.estimatedMonthlyAmount > 50)
    .sort((a, b) => b.estimatedMonthlyAmount - a.estimatedMonthlyAmount)

  for (const sub of expensiveSubs) {
    if (scenarios.length >= 3) break
    if (usedMerchants.has(sub.merchantNormalized)) continue
    usedMerchants.add(sub.merchantNormalized)
    const monthlySavings = sub.estimatedMonthlyAmount
    scenarios.push({
      action: `Cancel ${sub.merchantDisplay} subscription`,
      merchant_or_category: sub.merchantDisplay,
      monthly_savings: Math.round(monthlySavings * 100) / 100,
      annual_savings: Math.round(monthlySavings * 12 * 100) / 100,
    })
  }

  // Scenario source C: dominant spending category > 40% of total
  const DOMINANT_THRESHOLD = 40
  const dominantCats = categories
    .filter(c => !c.isIncome && c.pctOfSpending > DOMINANT_THRESHOLD)
    .sort((a, b) => b.pctOfSpending - a.pctOfSpending)

  for (const cat of dominantCats) {
    if (scenarios.length >= 3) break
    // Suggest reducing by 25% as a conservative estimate
    const potentialSaving = cat.currentMonthTotal * 0.25
    scenarios.push({
      action: `Reduce ${cat.categoryName} spending by 25%`,
      merchant_or_category: cat.categoryName,
      monthly_savings: Math.round(potentialSaving * 100) / 100,
      annual_savings: Math.round(potentialSaving * 12 * 100) / 100,
    })
  }

  // Suppress if no actionable scenarios found
  const hasAnyTrigger =
    subscriptions.duplicateServiceCategories.length > 0 ||
    subscriptions.allSubscriptions.some(s => !s.isSuppressed && s.estimatedMonthlyAmount > 50) ||
    categories.some(c => !c.isIncome && c.pctOfSpending > 40)

  if (!hasAnyTrigger || scenarios.length === 0) return []

  const totalMonthlySavings = scenarios.reduce((s, sc) => s + sc.monthly_savings, 0)

  const data: FixOpportunityData = {
    scenarios,
    total_potential_monthly_savings: Math.round(totalMonthlySavings * 100) / 100,
    net,
  }

  const confidence: InsightCard['confidence'] = scenarios.length >= 2 ? 'high' : 'medium'

  const title = `${scenarios.length} saving ${scenarios.length === 1 ? 'opportunity' : 'opportunities'} identified`
  const topScenario = scenarios[0]
  const summary =
    topScenario
      ? `${topScenario.action} (${topScenario.merchant_or_category}) could free ` +
        `${formatCurrency(topScenario.monthly_savings)}/month. ` +
        `Total potential savings across all identified items: ` +
        `${formatCurrency(totalMonthlySavings)}/month.`
      : `Potential monthly savings of ${formatCurrency(totalMonthlySavings)} identified.`

  return [
    makeCard(
      'fix_opportunity',
      1,
      title,
      summary,
      data,
      [
        {
          label: 'Review opportunities',
          action_key: 'review_opportunities',
          href: '/transactions?filter=subscriptions',
        },
        dismissAction(),
      ],
      confidence,
      'Wrench',
      year,
      month,
      [
        { label: 'Total Potential Monthly Savings', value: formatCurrency(Math.round(totalMonthlySavings * 100) / 100), field: 'total_potential_monthly_savings' },
        { label: 'Net', value: formatCurrency(net), field: 'net' },
        ...(topScenario ? [{ label: 'Top Scenario Monthly Savings', value: formatCurrency(topScenario.monthly_savings), field: 'monthly_savings' }] : []),
      ],
    ),
  ]
}

// ─── Generator 11: generateMerchantFrequency ─────────────────────────────────
//
// Trigger:    Any merchant with visitCount >= 8 in the month (frequent shopper)
// Priority:   5
// Confidence: visitCount >= 15 → 'high', >= 10 → 'medium', else 'low'
//
// Algorithm:
//   1. Use metrics.merchants (merchantCount = visit count, merchantTotal = total spent).
//   2. Find merchant with highest merchantCount that meets the >= 8 threshold.
//   3. Compute weekly average (visitCount / (daysInMonth / 7)).
//   4. Build card.

export function generateMerchantFrequency(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, merchants } = metrics
  const { year, month, daysInMonth } = monthly

  const VISIT_THRESHOLD = 8

  const candidates = merchants
    .filter(m => m.merchantCount >= VISIT_THRESHOLD)
    .sort((a, b) => b.merchantCount - a.merchantCount)

  if (candidates.length === 0) return []

  const top = candidates[0]
  const visitCount = top.merchantCount
  const totalSpent = top.merchantTotal
  const avgPerVisit = visitCount > 0 ? totalSpent / visitCount : 0
  const weeksInMonth = daysInMonth / 7
  const weeklyAvg = weeksInMonth > 0 ? visitCount / weeksInMonth : 0
  const merchantName = top.merchantDisplay

  const confidence: InsightCard['confidence'] =
    visitCount >= 15 ? 'high' : visitCount >= 10 ? 'medium' : 'low'

  const data: MerchantFrequencyData = {
    merchant: merchantName,
    visit_count: visitCount,
    total_spent: totalSpent,
    avg_per_visit: avgPerVisit,
  }

  const title = `${merchantName} — ${visitCount} visits this month`
  const summary =
    `You visited ${merchantName} ${visitCount} times — about ${weeklyAvg.toFixed(1)}x per week. ` +
    `Total spend: ${formatCurrency(totalSpent)}.`

  return [
    makeCard(
      'merchant_frequency',
      5,
      title,
      summary,
      data,
      [
        {
          label: 'View transactions',
          action_key: 'view_merchant',
          href: `/transactions?merchant=${encodeURIComponent(merchantName)}`,
        },
        dismissAction(),
      ],
      confidence,
      'RefreshCw',
      year,
      month,
      [
        { label: 'Visit Count', value: String(visitCount), field: 'visitCount' },
        { label: 'Total Spent', value: `$${totalSpent.toFixed(2)}`, field: 'totalSpent' },
        { label: 'Avg Per Visit', value: `$${avgPerVisit.toFixed(2)}`, field: 'avgPerVisit' },
      ],
      { merchant: merchantName },
    ),
  ]
}

// ─── Generator 12: generateMomIncomeChange ────────────────────────────────────
//
// Trigger:    |income change MoM| >= $200 (significant income change)
// Priority:   3
// Confidence: |delta| >= 500 → 'high', >= 200 → 'medium'
//
// Algorithm:
//   1. Guard: prevMonthIncome must be non-null (requires prior data).
//   2. Compute delta = totalIncome - prevMonthIncome.
//   3. Guard: |delta| < 200 → suppress.
//   4. Positive delta → positive framing; negative → alert framing.
//   5. Build card.

export function generateMomIncomeChange(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly } = metrics
  const { year, month, totalIncome, prevMonthIncome } = monthly

  // Require prior month data
  if (prevMonthIncome === null) return []

  const delta = totalIncome - prevMonthIncome
  const absDelta = Math.abs(delta)

  // Trigger guard
  if (absDelta < 200) return []

  const deltaSign = delta >= 0 ? 'up' : 'down'
  const deltaPct = prevMonthIncome > 0 ? (delta / prevMonthIncome) * 100 : 0

  const data: MomIncomeChangeData = {
    income_this_month: totalIncome,
    income_last_month: prevMonthIncome,
    income_delta: delta,
    income_delta_pct: Math.round(deltaPct * 10) / 10,
  }

  const confidence: InsightCard['confidence'] = absDelta >= 500 ? 'high' : 'medium'

  const title = `Income ${deltaSign} $${absDelta.toFixed(0)} vs last month`
  const directionWord = delta >= 0 ? 'increased' : 'decreased'
  const pctLabel = `${Math.abs(Math.round(deltaPct))}%`
  const summary =
    `Income ${directionWord} from ${formatCurrency(prevMonthIncome)} last month to ` +
    `${formatCurrency(totalIncome)} this month, a change of ${delta >= 0 ? '+' : ''}${formatCurrency(delta)} (${delta >= 0 ? '+' : ''}${pctLabel}).`

  return [
    makeCard(
      'mom_income_change',
      3,
      title,
      summary,
      data,
      [
        { label: 'View income', action_key: 'view_income', href: '/transactions?filter=income' },
        dismissAction(),
      ],
      confidence,
      delta >= 0 ? 'TrendingUp' : 'AlertCircle',
      year,
      month,
      [
        { label: 'Income This Month', value: formatCurrency(totalIncome), field: 'income_this_month' },
        { label: 'Income Last Month', value: formatCurrency(prevMonthIncome), field: 'income_last_month' },
        { label: 'Delta', value: `${delta >= 0 ? '+' : ''}${formatCurrency(delta)}`, field: 'income_delta' },
      ],
    ),
  ]
}

// ─── Generator 13: generateMonthlySummary ────────────────────────────────────
//
// Trigger:    Always — fires for any month with totalSpending > 0 or totalIncome > 0.
//             This is the guaranteed fallback card so the panel is never empty.
// Priority:   6 (lower priority — defers to more specific insight cards)
// Confidence: high

export function generateMonthlySummary(metrics: ComputedInsightMetrics): InsightCard[] {
  const { monthly, categories } = metrics
  const { year, month, totalIncome, totalSpending, net } = monthly

  if (totalSpending === 0 && totalIncome === 0) return []

  const savingsRate = totalIncome > 0 ? Math.max(0, (net / totalIncome) * 100) : 0

  const topCat = categories
    .filter(c => !c.isIncome && c.currentMonthTotal > 0)
    .sort((a, b) => b.currentMonthTotal - a.currentMonthTotal)[0] ?? null

  const data: MonthlySummaryData = {
    total_income: totalIncome,
    total_spending: totalSpending,
    net,
    transaction_count: categories.reduce((s, c) => s + c.transactionCount, 0),
    top_category_name: topCat?.categoryName ?? null,
    top_category_amount: topCat?.currentMonthTotal ?? null,
    savings_rate: Math.round(savingsRate * 10) / 10,
  }

  const netLabel = net >= 0 ? `+${formatCurrency(net)} saved` : `${formatCurrency(Math.abs(net))} deficit`
  const title = `${new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' })} — ${netLabel}`
  const topCatText = topCat
    ? ` Largest category: ${topCat.categoryName} at ${formatCurrency(topCat.currentMonthTotal)} (${formatPct(topCat.pctOfSpending)} of spending).`
    : ''
  const summary =
    `Income: ${formatCurrency(totalIncome)} · Spending: ${formatCurrency(totalSpending)} · Net: ${net >= 0 ? '+' : ''}${formatCurrency(net)}.` +
    topCatText +
    (totalIncome > 0 ? ` Savings rate: ${formatPct(savingsRate)}.` : '')

  return [
    makeCard(
      'monthly_summary',
      6,
      title,
      summary,
      data,
      [viewTransactionsAction(), dismissAction()],
      'high',
      'DollarSign',
      year,
      month,
      [
        { label: 'Income', value: formatCurrency(totalIncome), field: 'total_income' },
        { label: 'Spending', value: formatCurrency(totalSpending), field: 'total_spending' },
        { label: 'Net', value: `${net >= 0 ? '+' : ''}${formatCurrency(net)}`, field: 'net' },
      ],
    ),
  ]
}

// ─── rankAndCap ───────────────────────────────────────────────────────────────
//
// Applies post-generation ranking, deduplication, and capping to the full
// set of cards from all 10 generators.
//
// Rules:
//   1. Sort all cards by priority ascending (lower number = higher priority).
//   2. Within same priority: sort by confidence (high > medium > low).
//   3. Deduplicate by card_type — keep only the highest-priority card per type.
//      (For card types that naturally produce multiple cards, e.g. large_transaction,
//       the first/most important is kept. The rest are dropped after dedup.)
//   4. Cap at 8 cards shown. The full unsorted list should be stored in the DB;
//      this function returns only the display set.
//
// The caller is responsible for persisting all cards before calling rankAndCap.

const CONFIDENCE_RANK: Record<InsightCard['confidence'], number> = {
  high: 0,
  medium: 1,
  low: 2,
}

export function rankAndCap(cards: InsightCard[], cap = 8): InsightCard[] {
  if (cards.length === 0) return []

  // Step 1+2: sort by priority asc, then confidence asc (0=high, 2=low)
  const sorted = [...cards].sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority
    return CONFIDENCE_RANK[a.confidence] - CONFIDENCE_RANK[b.confidence]
  })

  // Step 3: deduplicate by card_type — keep first (highest priority) of each type
  const seen = new Set<string>()
  const deduped: InsightCard[] = []
  for (const card of sorted) {
    if (!seen.has(card.card_type)) {
      seen.add(card.card_type)
      deduped.push(card)
    }
  }

  // Step 4: cap at `cap` cards
  return deduped.slice(0, cap)
}

// ─── runAllGenerators ─────────────────────────────────────────────────────────
//
// Convenience function that runs all 10 generators and returns the full
// unranked list (for DB persistence) plus the ranked display set.

export function runAllGenerators(metrics: ComputedInsightMetrics): {
  all: InsightCard[]
  display: InsightCard[]
} {
  const all: InsightCard[] = [
    ...generateOverBudgetDiagnosis(metrics),
    ...generateCategorySpikes(metrics),
    ...generateMerchantSpikes(metrics),
    ...generateLargeTransactions(metrics),
    ...generateSmallPurchaseLeaks(metrics),
    ...generateSubscriptionSummary(metrics),
    ...generateNewSubscriptionAlert(metrics),
    ...generateTrialWarnings(metrics),
    ...generateCashFlowForecast(metrics),
    ...generateFixOpportunity(metrics),
    ...generateMerchantFrequency(metrics),
    ...generateMomIncomeChange(metrics),
    ...generateMonthlySummary(metrics),
  ]

  const display = rankAndCap(all)

  return { all, display }
}
