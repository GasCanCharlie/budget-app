/**
 * Financial Health Score
 *
 * Returns a 0–100 score based on five weighted factors.
 * Higher = healthier finances.
 */

export interface HealthInput {
  totalIncome:    number   // dollars
  totalSpending:  number   // dollars (positive)
  net:            number   // income - spending
  trendMonths:    { net: number | null; hasData: boolean }[]
  categories:     { categoryName: string; total: number; pctOfSpending: number }[]
  monthlySubscriptions: number  // estimated total from subscription detection
}

export interface HealthScore {
  score:    number        // 0–100
  color:    string        // CSS color
  label:    string        // 'Excellent' | 'Good' | 'Fair' | 'Needs Work'
  factors:  HealthFactor[]
}

export interface HealthFactor {
  name:    string
  points:  number   // 0–100 for this factor
  weight:  number   // 0–1
  note:    string
}

/** Clamp x between lo and hi */
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x))
}

/** Count consecutive positive-net months from the end */
function positiveStreak(months: { net: number | null; hasData: boolean }[]): number {
  const withData = months.filter(m => m.hasData && m.net !== null)
  let streak = 0
  for (let i = withData.length - 1; i >= 0; i--) {
    if ((withData[i].net ?? 0) >= 0) streak++
    else break
  }
  return streak
}

export function computeHealthScore(input: HealthInput): HealthScore {
  const { totalIncome, totalSpending, net, trendMonths, categories, monthlySubscriptions } = input

  const factors: HealthFactor[] = []

  // ── 1. Spending Ratio (35%) ────────────────────────────────────────────────
  // 100pts if spending < 60% income; 0pts at 100%+
  let spendingPts = 0
  let spendingNote = 'No income data'
  if (totalIncome > 0) {
    const ratio = totalSpending / totalIncome
    spendingPts = clamp(Math.round((1 - (ratio - 0.6) / 0.4) * 100), 0, 100)
    if (ratio <= 0.6)       { spendingPts = 100; spendingNote = `Spending only ${Math.round(ratio * 100)}% of income` }
    else if (ratio <= 0.75) { spendingNote = `Spending ${Math.round(ratio * 100)}% of income — reasonable` }
    else if (ratio <= 0.90) { spendingNote = `Spending ${Math.round(ratio * 100)}% of income — a bit high` }
    else                    { spendingNote = `Spending ${Math.round(ratio * 100)}% of income — critical` }
  }
  factors.push({ name: 'Spending ratio', points: spendingPts, weight: 0.35, note: spendingNote })

  // ── 2. Savings Rate (30%) ─────────────────────────────────────────────────
  // 100pts at 20%+ savings; 0pts at negative net
  let savingsPts = 0
  let savingsNote = 'No income data'
  if (totalIncome > 0) {
    const rate = net / totalIncome
    if (rate >= 0.20)       { savingsPts = 100; savingsNote = `Saving ${Math.round(rate * 100)}% of income` }
    else if (rate >= 0.10)  { savingsPts = Math.round(((rate - 0.10) / 0.10) * 50 + 50); savingsNote = `Saving ${Math.round(rate * 100)}% of income` }
    else if (rate >= 0)     { savingsPts = Math.round((rate / 0.10) * 50); savingsNote = `Saving ${Math.round(rate * 100)}% of income — room to improve` }
    else                    { savingsPts = 0; savingsNote = `Spending more than earned this month` }
  }
  factors.push({ name: 'Savings rate', points: savingsPts, weight: 0.30, note: savingsNote })

  // ── 3. Cash Flow Streak (15%) ─────────────────────────────────────────────
  // 100pts at 3+ positive months; 0pts at 0
  const streak = positiveStreak(trendMonths)
  const streakPts = clamp(Math.round((streak / 3) * 100), 0, 100)
  const streakNote = streak === 0
    ? 'No positive cash flow streak'
    : `${streak} consecutive month${streak !== 1 ? 's' : ''} positive`
  factors.push({ name: 'Cash flow streak', points: streakPts, weight: 0.15, note: streakNote })

  // ── 4. Subscription Burden (10%) ─────────────────────────────────────────
  // 100pts if subscriptions < 5% income; 0pts at 20%+
  let subPts = 80  // default if no income data (assume neutral)
  let subNote = 'No subscription data'
  if (monthlySubscriptions > 0 && totalIncome > 0) {
    const subRatio = monthlySubscriptions / totalIncome
    subPts = clamp(Math.round((1 - (subRatio - 0.05) / 0.15) * 100), 0, 100)
    if (subRatio <= 0.05)       { subPts = 100; subNote = `Subscriptions are ${Math.round(subRatio * 100)}% of income — low` }
    else if (subRatio <= 0.10)  { subNote = `Subscriptions are ${Math.round(subRatio * 100)}% of income` }
    else                        { subNote = `Subscriptions are ${Math.round(subRatio * 100)}% of income — high` }
  } else if (monthlySubscriptions === 0) {
    subPts = 90
    subNote = 'No subscriptions detected'
  }
  factors.push({ name: 'Subscription burden', points: subPts, weight: 0.10, note: subNote })

  // ── 5. Spending Diversity (10%) ───────────────────────────────────────────
  // 100pts if top category < 30% of spending; 0pts at 80%+
  let divPts = 80
  let divNote = 'No category data'
  if (categories.length > 0) {
    const topPct = categories[0].pctOfSpending
    divPts = clamp(Math.round((1 - (topPct - 30) / 50) * 100), 0, 100)
    if (topPct <= 30) { divPts = 100; divNote = `Well-diversified spending` }
    else if (topPct <= 50) { divNote = `${categories[0].categoryName} is ${Math.round(topPct)}% of spending` }
    else { divNote = `${categories[0].categoryName} dominates at ${Math.round(topPct)}%` }
  }
  factors.push({ name: 'Spending diversity', points: divPts, weight: 0.10, note: divNote })

  // ── Final score ───────────────────────────────────────────────────────────
  const score = Math.round(
    factors.reduce((sum, f) => sum + f.points * f.weight, 0)
  )

  const color =
    score >= 80 ? '#22C55E' :
    score >= 50 ? '#F59E0B' : '#EF4444'

  const label =
    score >= 80 ? 'Excellent' :
    score >= 60 ? 'Good' :
    score >= 40 ? 'Fair' : 'Needs Work'

  return { score, color, label, factors }
}
