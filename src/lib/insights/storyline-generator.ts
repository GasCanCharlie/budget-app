/**
 * Monthly Storyline Generator
 *
 * Produces a single InsightCard that narrates the user's month in plain English,
 * structured like a financial analyst reviewing the statement:
 *
 *   1. Total spend + income context
 *   2. Month-over-month direction (if prior data available)
 *   3. Top 2 spending drivers by category share
 *   4. One behaviour signal (new sub / sub load / small purchases / concentration)
 *   5. Forward-looking projection (partial months only)
 *   6. One clear recommended action
 *
 * Uses ComputedInsightMetrics only — no extra DB queries.
 */

import { randomUUID } from 'crypto'
import type {
  InsightCard,
  InsightCardAction,
  ComputedInsightMetrics,
  InsightSupportingData,
  MonthlySummaryData,
} from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): string { return new Date().toISOString() }

function dismiss(): InsightCardAction {
  return { label: 'Dismiss', action_key: 'dismiss' }
}

function fmt(n: number): string {
  return `$${Math.round(Math.abs(n)).toLocaleString()}`
}

// ─── Narrative builder ────────────────────────────────────────────────────────

function buildNarrative(metrics: ComputedInsightMetrics): {
  summary: string
  numbers_used: InsightCard['numbers_used']
  action_label: string
} {
  const { monthly, categories, frequency, subscriptions } = metrics
  const {
    totalIncome, totalSpending, net,
    dailySpendingRate, projectedMonthEnd,
    daysElapsed, daysInMonth, isPartialMonth,
  } = monthly

  const parts: string[] = []
  const numbers: InsightCard['numbers_used'] = []

  // ── 1. Spending total + income context ──────────────────────────────────────
  numbers.push({ label: 'Total spending', value: fmt(totalSpending), field: 'total_spending' })

  if (totalIncome > 0) {
    const pct = Math.round((totalSpending / totalIncome) * 100)
    const netAbs = fmt(net)
    const netSign = net >= 0 ? `+${netAbs}` : `-${netAbs}`
    numbers.push({ label: 'Net', value: netSign, field: 'net' })
    if (net >= 0) {
      parts.push(
        `You spent ${fmt(totalSpending)} this month — ${pct}% of income — leaving ${fmt(net)} unspent.`
      )
    } else {
      parts.push(
        `You spent ${fmt(totalSpending)} this month, ${pct}% of income, with a ${fmt(net)} shortfall.`
      )
    }
  } else {
    parts.push(`You spent ${fmt(totalSpending)} this month.`)
  }

  // ── 2. Month-over-month direction ───────────────────────────────────────────
  // Derive prior-month total from categories that have previousMonthTotal
  const catsWithPrior = categories.filter(c => !c.isIncome && c.previousMonthTotal !== null)
  if (catsWithPrior.length >= 2) {
    const prevTotal = catsWithPrior.reduce((s, c) => s + (c.previousMonthTotal ?? 0), 0)
    const thisTotal = catsWithPrior.reduce((s, c) => s + c.currentMonthTotal, 0)
    if (prevTotal > 0) {
      const momPct = Math.round(((thisTotal - prevTotal) / prevTotal) * 100)
      if (momPct >= 5) {
        parts.push(`That's up ${momPct}% from last month across tracked categories.`)
      } else if (momPct <= -5) {
        parts.push(`That's down ${Math.abs(momPct)}% from last month across tracked categories.`)
      }
    }
  }

  // ── 3. Top 2 spending drivers ───────────────────────────────────────────────
  const expCats = categories
    .filter(c => !c.isIncome && c.currentMonthTotal > 0)
    .sort((a, b) => b.currentMonthTotal - a.currentMonthTotal)

  if (expCats.length >= 2) {
    const [t1, t2] = expCats
    const p1 = Math.round(t1.pctOfSpending)
    const p2 = Math.round(t2.pctOfSpending)
    numbers.push({ label: t1.categoryName, value: `${p1}%`, field: 'top_cat_1_pct' })
    numbers.push({ label: t2.categoryName, value: `${p2}%`, field: 'top_cat_2_pct' })
    parts.push(
      `The biggest drivers are ${t1.categoryName} (${p1}%) and ${t2.categoryName} (${p2}%).`
    )
  } else if (expCats.length === 1) {
    const p1 = Math.round(expCats[0].pctOfSpending)
    parts.push(`${expCats[0].categoryName} makes up ${p1}% of spending.`)
    numbers.push({ label: expCats[0].categoryName, value: `${p1}%`, field: 'top_cat_1_pct' })
  }

  // ── 4. Behaviour signal — pick the strongest one ────────────────────────────
  const { subscriptionCount, subscriptionMonthlyTotal, newSubscriptions } = subscriptions
  const { smallPurchaseCount, smallPurchaseTotal } = frequency
  const smallPct = totalSpending > 0 ? (smallPurchaseTotal / totalSpending) * 100 : 0

  // Priority: new sub detected > high sub load > small purchase drain > merchant concentration
  if (newSubscriptions.length > 0) {
    const ns = newSubscriptions[0]
    numbers.push({
      label: `New: ${ns.merchantDisplay}`,
      value: `${fmt(ns.estimatedMonthlyAmount)}/mo`,
      field: 'new_sub',
    })
    const extra = newSubscriptions.length > 1 ? ` (and ${newSubscriptions.length - 1} more)` : ''
    parts.push(
      `A new recurring charge appeared: ${ns.merchantDisplay} at ${fmt(ns.estimatedMonthlyAmount)}/month${extra}.`
    )
  } else if (subscriptionCount >= 4) {
    numbers.push({ label: 'Subscriptions/mo', value: fmt(subscriptionMonthlyTotal), field: 'sub_total' })
    parts.push(
      `${subscriptionCount} active subscriptions are running in the background at ${fmt(subscriptionMonthlyTotal)}/month.`
    )
  } else if (smallPurchaseCount >= 10 && smallPct >= 8) {
    numbers.push({ label: 'Small purchases', value: fmt(smallPurchaseTotal), field: 'small_total' })
    parts.push(
      `${smallPurchaseCount} small purchases quietly added up to ${fmt(smallPurchaseTotal)} — worth a look.`
    )
  }

  // ── 5. Forward-looking (partial months only) ────────────────────────────────
  if (isPartialMonth && projectedMonthEnd !== null && daysElapsed >= 5) {
    const daysLeft = daysInMonth - daysElapsed
    numbers.push({ label: 'Projected total', value: fmt(projectedMonthEnd), field: 'projected' })
    if (totalIncome > 0 && projectedMonthEnd > totalIncome) {
      const over = fmt(projectedMonthEnd - totalIncome)
      parts.push(
        `At ${fmt(dailySpendingRate)}/day you're on pace for ${fmt(projectedMonthEnd)} — ${over} over income with ${daysLeft} days left.`
      )
    } else {
      parts.push(
        `At this pace, projected month-end spend is ${fmt(projectedMonthEnd)} with ${daysLeft} days remaining.`
      )
    }
  }

  // ── 6. Recommended action ───────────────────────────────────────────────────
  let action_label = 'View transactions'
  let actionSentence = ''

  const STORYLINE_NON_ACTIONABLE = ['Housing', 'Rent', 'Mortgage', 'Insurance']
  if (net < 0) {
    const bigCat = expCats.find(c => !STORYLINE_NON_ACTIONABLE.includes(c.categoryName))
    if (bigCat) {
      actionSentence = `To get back to positive, start with ${bigCat.categoryName} — it's your biggest lever.`
      action_label = `Review ${bigCat.categoryName}`
    } else {
      actionSentence = 'Review your variable expense categories to find the easiest reductions.'
    }
  } else if (newSubscriptions.length > 0) {
    actionSentence = 'Confirm whether the new recurring charge is expected and set to continue.'
    action_label = 'Review subscriptions'
  } else if (subscriptionCount >= 5) {
    actionSentence = 'Auditing even one unused subscription could free up meaningful annual savings.'
    action_label = 'Review subscriptions'
  } else if (smallPurchaseCount >= 15 && smallPct >= 10) {
    actionSentence = 'Cutting back on small daily purchases is the quickest win with the least sacrifice.'
    action_label = 'View transactions'
  } else if (net >= 0 && totalIncome > 0) {
    const surplusPct = Math.round((net / totalIncome) * 100)
    if (surplusPct >= 20) {
      actionSentence = `You saved ${surplusPct}% this month — consider putting the surplus toward a specific goal.`
    } else {
      actionSentence = 'Your finances look stable this month.'
    }
    action_label = 'View details'
  }

  if (actionSentence) parts.push(actionSentence)

  return {
    summary: parts.join(' '),
    numbers_used: numbers,
    action_label,
  }
}

// ─── Generator ────────────────────────────────────────────────────────────────

export function generateMonthlyStoryline(
  metrics: ComputedInsightMetrics,
): InsightCard[] {
  const { monthly, categories } = metrics
  const { year, month, totalIncome, totalSpending, net } = monthly

  if (totalSpending <= 0) return []

  const { summary, numbers_used } = buildNarrative(metrics)

  const expCats = categories.filter(c => !c.isIncome && c.currentMonthTotal > 0)
  const topCat = expCats[0] ?? null

  const supporting_data: MonthlySummaryData = {
    total_income: totalIncome,
    total_spending: totalSpending,
    net,
    transaction_count: metrics.frequency.smallPurchaseCount + (expCats.length > 0 ? 1 : 0),
    top_category_name: topCat?.categoryName ?? null,
    top_category_amount: topCat?.currentMonthTotal ?? null,
    savings_rate: totalIncome > 0 ? Math.max(0, (net / totalIncome) * 100) : 0,
  }

  const confidence: InsightCard['confidence'] =
    totalIncome > 0 ? 'high' : 'medium'

  // Priority 1 — this is the lead narrative card.
  // over_budget (priority 1) may also fire; the display ranker will deduplicate/order.
  const priority = net < 0 ? 2 : 1

  const actions: InsightCardAction[] = [
    { label: 'Dismiss', action_key: 'dismiss' },
  ]

  return [
    {
      id: randomUUID(),
      card_type: 'monthly_storyline',
      priority,
      title: 'Your month in plain English',
      summary,
      supporting_data: supporting_data as unknown as typeof supporting_data,
      actions,
      confidence,
      icon_suggestion: 'BookOpen',
      generated_at: now(),
      year,
      month,
      numbers_used,
    },
  ]
}
