import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeKey } from '@/lib/intelligence/detect-subscriptions'

// Categories whose presence means "this merchant is a recurring commitment"
const RECURRING_CATEGORY_NAMES = [
  'subscriptions', 'entertainment', 'utilities', 'health',
  'insurance', 'memberships', 'housing', 'loans',
  'internet', 'phone', 'cable', 'recurring',
]

/**
 * GET /api/subscriptions
 *
 * Derives recurring commitments from the user's category rules + categorized
 * transactions. Rules are the primary source of truth:
 *
 *   1. Find categories that map to recurring-type names.
 *   2. Check whether any rules target those categories. If none → hasRules:false.
 *   3. Pull all transactions categorized into those categories (by rule or manually).
 *   4. Group by normalized merchant, compute average amount + recurrence evidence.
 *   5. Return sorted by estimated monthly amount.
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = payload.userId

  // ── Step 1: Find recurring-type categories (system + user-created) ──────────
  const recurringCategories = await prisma.category.findMany({
    where: {
      name: { in: RECURRING_CATEGORY_NAMES, mode: 'insensitive' },
    },
    select: { id: true, name: true },
  })
  const recurringCatIds = recurringCategories.map(c => c.id)

  if (recurringCatIds.length === 0) {
    return NextResponse.json({ subscriptions: [], hasRules: false })
  }

  // ── Step 2: Fetch rules that target those categories ────────────────────────
  // Rules are the source of intent. We need the rule IDs so we can confirm
  // each transaction was placed in a recurring category BY a rule — not by
  // accident, manual override, or a stale default assignment.
  const recurringRules = await prisma.categoryRule.findMany({
    where: {
      categoryId: { in: recurringCatIds },
      isEnabled: true,
      OR: [{ userId }, { isSystem: true }],
    },
    select: { id: true },
  })
  const recurringRuleIds = recurringRules.map(r => r.id)

  if (recurringRuleIds.length === 0) {
    return NextResponse.json({ subscriptions: [], hasRules: false })
  }

  // ── Step 3: Triple-filter transaction query ──────────────────────────────────
  // A transaction is eligible only when ALL THREE are true:
  //   1. categoryId is a recurring-type category   (current assignment is correct)
  //   2. appliedRuleId is one of the recurring rules (it got here via a rule)
  //   3. categorizationSource = 'rule'              (not manual, not default)
  //
  // This prevents Taco Bell, car washes, etc. from appearing even if they
  // happen to land in a recurring category through any other path.
  const transactions = await prisma.transaction.findMany({
    where: {
      account: { userId },
      isExcluded: false,
      amount: { lt: 0 },
      categoryId:             { in: recurringCatIds },
      appliedRuleId:          { in: recurringRuleIds },
      categorizationSource:   'rule',
    },
    select: {
      merchantNormalized: true,
      amount: true,
      date: true,
      category:         { select: { name: true } },
      overrideCategory: { select: { name: true } },
    },
    orderBy: { date: 'asc' },
  })

  // ── Step 4: Group by normalized merchant ────────────────────────────────────
  type Group = { amounts: number[]; dates: Date[]; categoryName: string | null }
  const byMerchant = new Map<string, Group>()

  for (const tx of transactions) {
    const key = normalizeKey(tx.merchantNormalized || '')
    if (!key || key.length < 2) continue
    const cat = tx.overrideCategory?.name ?? tx.category?.name ?? null
    if (!byMerchant.has(key)) byMerchant.set(key, { amounts: [], dates: [], categoryName: null })
    const g = byMerchant.get(key)!
    g.amounts.push(Math.abs(tx.amount))
    g.dates.push(tx.date)
    if (cat) g.categoryName = cat // keep most recent
  }

  // ── Step 5: Build subscription items ────────────────────────────────────────
  const subscriptions: {
    id: string
    merchantNormalized: string
    estimatedMonthlyAmount: number
    recurringConfidence: string
    subscriptionScore: number
    consecutiveMonths: number
    serviceCategory: string | null
    estimatedNextCharge: string | null
  }[] = []

  for (const [merchant, { amounts, dates, categoryName }] of byMerchant) {
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
    if (mean < 2) continue

    const stdDev = amounts.length > 1
      ? Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length)
      : 0
    const cv = mean > 0 ? (stdDev / mean) * 100 : 0

    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())

    let avgInterval = 0
    let consecutiveMonths = 1
    let estimatedNextCharge: string | null = null

    if (sorted.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < sorted.length; i++) {
        intervals.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000)
      }
      avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length

      // Consecutive calendar months
      const monthKeys = [
        ...new Set(sorted.map(d => d.getFullYear() * 12 + d.getMonth())),
      ].sort((a, b) => a - b)
      let max = 1, cur = 1
      for (let i = 1; i < monthKeys.length; i++) {
        if (monthKeys[i] === monthKeys[i - 1] + 1) { cur++; max = Math.max(max, cur) } else cur = 1
      }
      consecutiveMonths = max

      if (avgInterval > 0) {
        const last = sorted[sorted.length - 1]
        estimatedNextCharge = new Date(last.getTime() + avgInterval * 86_400_000).toISOString()
      }
    }

    // Confidence — rule-backed merchants start at "medium" even with one occurrence
    const confidence =
      consecutiveMonths >= 3 && cv < 10 ? 'high' :
      consecutiveMonths >= 2             ? 'high' :
      amounts.length   >= 2             ? 'medium' :
      'medium'  // rule-backed single occurrence = confirmed by user categorization

    const score = Math.min(100,
      20 +  // rule-backed baseline
      Math.min(consecutiveMonths * 10, 30) +
      Math.round(Math.max(0, 15 - cv) * 2) +
      (cv <= 15 ? 10 : 0)
    )

    subscriptions.push({
      id: merchant,
      merchantNormalized: merchant,
      estimatedMonthlyAmount: mean,
      recurringConfidence: confidence,
      subscriptionScore: score,
      consecutiveMonths,
      serviceCategory: categoryName,
      estimatedNextCharge,
    })
  }

  subscriptions.sort((a, b) => b.estimatedMonthlyAmount - a.estimatedMonthlyAmount)

  return NextResponse.json({ subscriptions, hasRules: true })
}

// POST /api/subscriptions — retained for background pattern detection
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { detectSubscriptions } = await import('@/lib/intelligence/detect-subscriptions')
    const detected = await detectSubscriptions(payload.userId)
    return NextResponse.json({ detected })
  } catch (err) {
    console.error('POST /api/subscriptions error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
