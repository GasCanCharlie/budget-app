import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeKey } from '@/lib/intelligence/detect-subscriptions'

// appCategory values that indicate a recurring commitment
const RECURRING_CATEGORY_NAMES = [
  'subscriptions', 'utilities', 'insurance', 'memberships',
  'housing', 'loans', 'internet', 'phone', 'cable', 'recurring',
]

/**
 * GET /api/subscriptions
 *
 * Returns recurring commitments based on transactions the user has manually
 * categorized (or rules have categorized) into a recurring-type category.
 * Uses appCategory (the free-text field written by the categorize page and
 * apply-rules) as the source of truth — NOT categoryId FK.
 */
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const userId = payload.userId

  // Find all negative transactions categorized into a recurring-type category
  const transactions = await prisma.transaction.findMany({
    where: {
      account:     { userId },
      isExcluded:  false,
      amount:      { lt: 0 },
      appCategory: { in: RECURRING_CATEGORY_NAMES, mode: 'insensitive' },
    },
    select: {
      merchantNormalized: true,
      amount:             true,
      date:               true,
      appCategory:        true,
    },
    orderBy: { date: 'asc' },
  })

  // No categorized recurring transactions yet
  if (transactions.length === 0) {
    return NextResponse.json({ subscriptions: [], hasRules: false })
  }

  // Group by normalized merchant
  type Group = { amounts: number[]; dates: Date[]; categoryName: string | null }
  const byMerchant = new Map<string, Group>()

  for (const tx of transactions) {
    const key = normalizeKey(tx.merchantNormalized || '')
    if (!key || key.length < 2) continue
    if (!byMerchant.has(key)) byMerchant.set(key, { amounts: [], dates: [], categoryName: null })
    const g = byMerchant.get(key)!
    g.amounts.push(Math.abs(tx.amount))
    g.dates.push(tx.date)
    if (tx.appCategory) g.categoryName = tx.appCategory
  }

  // Build subscription items
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
    if (mean < 1) continue

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

    const confidence =
      consecutiveMonths >= 3 && cv < 10 ? 'high' :
      consecutiveMonths >= 2             ? 'high' :
      amounts.length   >= 2             ? 'medium' :
      'medium'

    const score = Math.min(100,
      20 +
      Math.min(consecutiveMonths * 10, 30) +
      Math.round(Math.max(0, 15 - cv) * 2) +
      (cv <= 15 ? 10 : 0)
    )

    subscriptions.push({
      id:                     merchant,
      merchantNormalized:     merchant,
      estimatedMonthlyAmount: mean,
      recurringConfidence:    confidence,
      subscriptionScore:      score,
      consecutiveMonths,
      serviceCategory:        categoryName,
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
