import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// GET /api/subscriptions — return detected subscription candidates
export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const subs = await prisma.subscriptionCandidate.findMany({
    where: { userId: payload.userId, isSuppressed: false },
    orderBy: { estimatedMonthlyAmount: 'desc' },
  })

  return NextResponse.json({ subscriptions: subs })
}

// POST /api/subscriptions/detect — scan transactions and upsert candidates
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = payload

  try {
    // Fetch all non-excluded expense transactions for this user
    const transactions = await prisma.transaction.findMany({
      where: { account: { userId }, isExcluded: false, amount: { lt: 0 } },
      select: { merchantNormalized: true, amount: true, date: true, appCategory: true },
      orderBy: { date: 'asc' },
    })

    // Group by normalized merchant
    const byMerchant = new Map<string, { amount: number; date: Date; category: string | null }[]>()
    for (const tx of transactions) {
      const key = (tx.merchantNormalized || '').toLowerCase().trim()
      if (!key || key.length < 2) continue
      if (!byMerchant.has(key)) byMerchant.set(key, [])
      byMerchant.get(key)!.push({ amount: Math.abs(tx.amount), date: tx.date, category: tx.appCategory })
    }

    let detected = 0

    for (const [merchant, txs] of byMerchant) {
      if (txs.length < 2) continue

      // Get unique months (year-month combos)
      const months = new Set(txs.map(t => `${t.date.getFullYear()}-${t.date.getMonth()}`))
      if (months.size < 2) continue

      // Check amount consistency (std dev < 15% of mean)
      const amounts = txs.map(t => t.amount)
      const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
      if (mean < 2) continue // skip tiny amounts (ATM fees etc)
      const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length)
      const cvPercent = (stdDev / mean) * 100

      // Only flag if amounts are consistent (CV < 15%) or exact same amount
      if (cvPercent > 15) continue

      // Check intervals are monthly-ish (20–45 days between charges)
      const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime())
      const intervals: number[] = []
      for (let i = 1; i < sorted.length; i++) {
        const days = (sorted[i].date.getTime() - sorted[i-1].date.getTime()) / (1000 * 60 * 60 * 24)
        intervals.push(days)
      }
      const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length
      if (avgInterval < 20 || avgInterval > 400) continue // not monthly-ish

      // Determine confidence
      const consecutiveMonths = months.size
      const confidence: string =
        consecutiveMonths >= 3 && cvPercent < 5 ? 'high' :
        consecutiveMonths >= 2 && cvPercent < 10 ? 'medium' : 'low'
      const score = Math.min(100, consecutiveMonths * 20 + Math.round((15 - cvPercent) * 2))

      // Estimate next charge (last charge + avg interval)
      const lastDate = sorted[sorted.length - 1].date
      const estimatedNext = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000)

      // Use the most recent appCategory as serviceCategory
      const serviceCategory = sorted[sorted.length - 1].category ?? null

      await prisma.subscriptionCandidate.upsert({
        where: { userId_merchantNormalized: { userId, merchantNormalized: merchant } },
        update: {
          estimatedMonthlyAmount: mean,
          recurringConfidence: confidence,
          subscriptionScore: score,
          consecutiveMonths,
          serviceCategory,
          estimatedNextCharge: estimatedNext,
          lastSeenAt: new Date(),
        },
        create: {
          userId,
          merchantNormalized: merchant,
          estimatedMonthlyAmount: mean,
          recurringConfidence: confidence,
          subscriptionScore: score,
          consecutiveMonths,
          serviceCategory,
          estimatedNextCharge: estimatedNext,
        },
      })
      detected++
    }

    return NextResponse.json({ detected })
  } catch (err) {
    console.error('POST /api/subscriptions error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
