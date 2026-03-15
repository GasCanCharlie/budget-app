import prisma from '@/lib/db'

type RecurrencePattern = 'weekly' | 'biweekly' | 'monthly' | 'annual'

/** Returns true if dates contain at least `minCount` consecutive calendar months */
function hasConsecutiveMonths(dates: Date[], minCount: number): boolean {
  const keys = [...new Set(dates.map(d => d.getFullYear() * 12 + d.getMonth()))].sort((a, b) => a - b)
  if (keys.length < minCount) return false
  let streak = 1
  for (let i = 1; i < keys.length; i++) {
    if (keys[i] === keys[i - 1] + 1) {
      streak++
      if (streak >= minCount) return true
    } else {
      streak = 1
    }
  }
  return streak >= minCount
}

/** Maps an average day interval to a recurrence pattern */
function detectPattern(avgDays: number): RecurrencePattern | null {
  if (avgDays >= 5   && avgDays <= 9)   return 'weekly'
  if (avgDays >= 12  && avgDays <= 16)  return 'biweekly'
  if (avgDays >= 20  && avgDays <= 40)  return 'monthly'
  if (avgDays >= 340 && avgDays <= 400) return 'annual'
  return null
}

/**
 * Aggressively normalizes a merchant string into a stable deduplication key.
 *
 * Banks often decorate the same merchant with varying prefixes ("Payment To",
 * "ACH Payment", "Online PMT") and capitalization differences. Without this,
 * "Payment To Verizon Wireless" and "verizon wireless" become separate groups
 * and show as duplicates in the UI.
 */
export function normalizeKey(raw: string): string {
  let s = (raw || '').toLowerCase().trim()

  // Strip leading bill-pay boilerplate that banks prepend
  s = s.replace(
    /^(payment to|payments to|transfer to|ach payment to?|ach pmt|online pmt|online payment|pymt to|pmt to|bill pmt|bill payment|web pmnt|autopay|recurring pmt|scheduled pmt|checkcard|pos purchase|pos debit)\s+/,
    ''
  )

  // Strip trailing payment noise
  s = s.replace(/\s+(payment|pymt|pmt|autopay|billpay)$/, '')

  // Remove punctuation that varies across bank description styles
  // (colons, periods, asterisks, slashes — but keep hyphens between words)
  s = s.replace(/[^\w\s-]/g, ' ')

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim()

  return s
}

// Category names (case-insensitive) that indicate recurring charges.
// Only transactions in these categories are considered for subscription detection.
// Note: the categorization engine sends Netflix/Hulu/HBO to "Entertainment" and
// Spotify/Adobe/iCloud to "Subscriptions" — both must be included here.
const RECURRING_CATEGORY_NAMES = [
  'subscriptions',
  'entertainment',  // Netflix, Hulu, Disney+, HBO, YouTube Premium, etc.
  'utilities',      // Xfinity, Verizon, electric, phone bills
  'health',         // Planet Fitness, gym memberships
  'insurance',
  'memberships',
]

export async function detectSubscriptions(userId: string): Promise<number> {
  const transactions = await prisma.transaction.findMany({
    where: {
      account: { userId },
      isExcluded: false,
      amount: { lt: 0 },
      OR: [
        { category:         { name: { in: RECURRING_CATEGORY_NAMES, mode: 'insensitive' } } },
        { overrideCategory: { name: { in: RECURRING_CATEGORY_NAMES, mode: 'insensitive' } } },
      ],
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

  await prisma.subscriptionCandidate.deleteMany({ where: { userId } })

  // Group by normalized key — strips bill-pay prefixes so "Payment To Verizon"
  // and "Verizon Wireless" both collapse into "verizon wireless"
  const byMerchant = new Map<string, { amount: number; date: Date; category: string | null }[]>()
  for (const tx of transactions) {
    const key = normalizeKey(tx.merchantNormalized || '')
    if (!key || key.length < 2) continue
    // Prefer the user's manual override category; fall back to the auto-assigned one
    const effectiveCategory = tx.overrideCategory?.name ?? tx.category?.name ?? null
    if (!byMerchant.has(key)) byMerchant.set(key, [])
    byMerchant.get(key)!.push({ amount: Math.abs(tx.amount), date: tx.date, category: effectiveCategory })
  }

  let detected = 0

  for (const [merchant, txs] of byMerchant) {
    if (txs.length < 2) continue

    // Check amount consistency
    const amounts = txs.map(t => t.amount)
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
    if (mean < 2) continue
    const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length)
    const cvPercent = (stdDev / mean) * 100

    // Tier 1: high consistency (CV < 15%) — fixed-amount recurring (loans, subscriptions)
    // Tier 2: variable recurring (CV < 40%) — utilities, usage-based SaaS
    const isHighConsistency = cvPercent <= 15
    const isVariableConsistency = cvPercent <= 40
    if (!isVariableConsistency) continue

    // Compute intervals between sorted charges
    const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime())
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const days = (sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86_400_000
      intervals.push(days)
    }
    const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length

    const pattern = detectPattern(avgInterval)
    if (!pattern) continue

    // Interval consistency — std dev of intervals relative to avg
    const intervalStdDev = Math.sqrt(
      intervals.reduce((s, d) => s + (d - avgInterval) ** 2, 0) / intervals.length
    )
    const intervalCv = avgInterval > 0 ? (intervalStdDev / avgInterval) * 100 : 100

    // Variable-amount patterns require tighter interval consistency
    if (!isHighConsistency && intervalCv > 25) continue

    // Monthly patterns require at least 2 consecutive calendar months
    if (pattern === 'monthly') {
      const dates = sorted.map(t => t.date)
      if (!hasConsecutiveMonths(dates, 2)) continue
    }

    // Weekly/biweekly require at least 3 occurrences
    if ((pattern === 'weekly' || pattern === 'biweekly') && txs.length < 3) continue

    // Determine confidence
    const consecutiveMonths = pattern === 'monthly'
      ? (() => {
          const keys = [...new Set(sorted.map(t => t.date.getFullYear() * 12 + t.date.getMonth()))].sort((a, b) => a - b)
          let max = 1, cur = 1
          for (let i = 1; i < keys.length; i++) {
            if (keys[i] === keys[i - 1] + 1) { cur++; max = Math.max(max, cur) } else cur = 1
          }
          return max
        })()
      : txs.length

    const confidence: string =
      consecutiveMonths >= 3 && cvPercent < 5  ? 'high' :
      consecutiveMonths >= 2 && cvPercent < 10 ? 'medium' :
      consecutiveMonths >= 2 && isHighConsistency ? 'medium' : 'low'

    const score = Math.min(100,
      consecutiveMonths * 15 +
      Math.round(Math.max(0, 15 - cvPercent) * 2) +
      (isHighConsistency ? 10 : 0) +
      (intervalCv < 10 ? 10 : 0)
    )

    const lastDate = sorted[sorted.length - 1].date
    const estimatedNext = new Date(lastDate.getTime() + avgInterval * 86_400_000)
    const serviceCategory = sorted[sorted.length - 1].category ?? null

    // Store the normalized key (not raw merchant) so the UI gets clean names
    await prisma.subscriptionCandidate.create({
      data: {
        userId,
        merchantNormalized: merchant,      // normalized key — no bill-pay prefixes
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

  return detected
}
