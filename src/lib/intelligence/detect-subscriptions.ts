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

/**
 * Category names (case-insensitive) whose presence on a transaction is treated
 * as a strong "this merchant is a recurring commitment" signal.
 *
 * The categorization engine routes:
 *   Netflix/Hulu/HBO/Disney+  → "Entertainment"
 *   Spotify/Adobe/iCloud      → "Subscriptions"
 *   Xfinity/Verizon/electric  → "Utilities"
 *   Planet Fitness            → "Health"
 *   mortgage/rent             → "Housing"
 *
 * A merchant in any of these categories is eligible for the recurring panel
 * even with weak recurrence evidence. Recurrence evidence then upgrades
 * confidence from low → medium → high.
 */
const RECURRING_CATEGORY_SET = new Set([
  'subscriptions',
  'entertainment',  // Netflix, Hulu, Disney+, HBO, YouTube Premium
  'utilities',      // Xfinity, Verizon, electric, phone bills
  'health',         // Planet Fitness, gym memberships
  'insurance',      // GEICO, USAA, Allstate
  'memberships',    // costco, clubs
  'housing',        // rent, mortgage, HOA
  'loans',          // loan payments
  'internet',
  'phone',
  'cable',
  'recurring',
])

type TxEntry = { amount: number; date: Date; categoryName: string | null }

/**
 * Layered recurring-commitment detection.
 *
 * Layer 1 — Category signal
 *   If a transaction is categorized into a recurring-like category, treat that
 *   merchant as a candidate even if recurrence evidence is thin.
 *
 * Layer 2 — Recurrence signal
 *   Same normalized merchant across multiple billing cycles with consistent
 *   amounts and timing.
 *
 * Layer 3 — Confidence
 *   category signal + recurrence = high/medium
 *   category only (1 occurrence, strong category) = medium
 *   category only (1 occurrence, weaker category) = low
 *   uncategorized + monthly pattern + high amount consistency = medium/low
 *   neither signal = excluded
 *
 * Non-recurring-category merchants without a monthly/annual pattern are
 * excluded — this prevents weekly gas-station fills, daily coffee etc.
 * from polluting the panel.
 */
export async function detectSubscriptions(userId: string): Promise<number> {
  // Fetch ALL negative, non-excluded transactions.
  // Category is a SIGNAL here, not a hard filter — we need to see all merchants
  // so uncategorized ones with strong monthly patterns are still caught.
  const transactions = await prisma.transaction.findMany({
    where: { account: { userId }, isExcluded: false, amount: { lt: 0 } },
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

  // Group by normalized merchant key
  const byMerchant = new Map<string, TxEntry[]>()
  for (const tx of transactions) {
    const key = normalizeKey(tx.merchantNormalized || '')
    if (!key || key.length < 2) continue
    // User's manual override takes precedence over the auto-assigned category
    const effectiveCategory = tx.overrideCategory?.name ?? tx.category?.name ?? null
    if (!byMerchant.has(key)) byMerchant.set(key, [])
    byMerchant.get(key)!.push({ amount: Math.abs(tx.amount), date: tx.date, categoryName: effectiveCategory })
  }

  let detected = 0

  for (const [merchant, txs] of byMerchant) {
    // ── Amount stats ──────────────────────────────────────────────────────────
    const amounts = txs.map(t => t.amount)
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
    if (mean < 2) continue
    const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length)
    const cvPercent = amounts.length > 1 ? (stdDev / mean) * 100 : 0 // single tx → CV=0
    const isHighConsistency  = cvPercent <= 15
    const isVariableConsistency = cvPercent <= 40

    // ── Layer 1: Category signal ──────────────────────────────────────────────
    // Determine the primary (most common) category for this merchant.
    const catCounts = new Map<string, number>()
    for (const tx of txs) {
      if (tx.categoryName) {
        const c = tx.categoryName.toLowerCase()
        catCounts.set(c, (catCounts.get(c) ?? 0) + 1)
      }
    }
    const primaryCategory = [...catCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const hasCategorySignal = primaryCategory !== null && RECURRING_CATEGORY_SET.has(primaryCategory)

    // ── Layer 2: Recurrence signal ────────────────────────────────────────────
    const sorted = [...txs].sort((a, b) => a.date.getTime() - b.date.getTime())

    let pattern: RecurrencePattern | null = null
    let avgInterval = 0
    let intervalCv = 100
    let consecutiveMonths = 1
    let hasRecurrenceSignal = false

    if (txs.length >= 2) {
      const intervals: number[] = []
      for (let i = 1; i < sorted.length; i++) {
        intervals.push((sorted[i].date.getTime() - sorted[i - 1].date.getTime()) / 86_400_000)
      }
      avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length
      pattern = detectPattern(avgInterval)

      const intervalStdDev = Math.sqrt(
        intervals.reduce((s, d) => s + (d - avgInterval) ** 2, 0) / intervals.length
      )
      intervalCv = avgInterval > 0 ? (intervalStdDev / avgInterval) * 100 : 100

      if (pattern && isVariableConsistency) {
        // Variable-amount merchants need tighter timing to avoid false positives
        if (isHighConsistency || intervalCv <= 25) {
          hasRecurrenceSignal = true
        }
      }

      // Consecutive calendar months (for monthly patterns)
      if (pattern === 'monthly') {
        const monthKeys = [...new Set(sorted.map(t => t.date.getFullYear() * 12 + t.date.getMonth()))].sort((a, b) => a - b)
        let max = 1, cur = 1
        for (let i = 1; i < monthKeys.length; i++) {
          if (monthKeys[i] === monthKeys[i - 1] + 1) { cur++; max = Math.max(max, cur) } else cur = 1
        }
        consecutiveMonths = max
      } else {
        consecutiveMonths = txs.length
      }
    }

    // ── Layer 3: Eligibility gate ─────────────────────────────────────────────
    //
    // Include if:
    //   (a) category signal — merchant is in a known recurring category, OR
    //   (b) no category signal, but strong monthly/annual pattern + high amount
    //       consistency — catches uncategorized bills like loan payments
    //
    // Explicitly exclude:
    //   - weekly merchants without a category signal (gas stations, coffee shops)
    //   - biweekly merchants without a category signal
    //   - merchants with neither signal at all

    const isMonthlyOrAnnual = pattern === 'monthly' || pattern === 'annual'

    if (!hasCategorySignal) {
      // Uncategorized merchant: require monthly/annual + high amount consistency
      // This blocks weekly gas fills, daily coffee, biweekly payday patterns
      if (!isMonthlyOrAnnual || !isHighConsistency) continue
      if (!hasRecurrenceSignal) continue
      if (!isVariableConsistency) continue
    }

    // Category-backed merchants still need a reasonable amount (already checked mean >= 2)
    // but are allowed even with a single occurrence or variable amounts
    if (hasCategorySignal && !isVariableConsistency && txs.length > 1) continue

    // ── Confidence: category + recurrence combined ────────────────────────────
    const confidence: string =
      // Strongest: category + confirmed monthly recurrence
      hasCategorySignal && hasRecurrenceSignal && consecutiveMonths >= 3 && cvPercent < 10 ? 'high' :
      hasCategorySignal && hasRecurrenceSignal && consecutiveMonths >= 2                   ? 'high' :
      hasCategorySignal && hasRecurrenceSignal                                             ? 'medium' :
      // Category present + consistent amount (even single occurrence = trusted)
      hasCategorySignal && isHighConsistency                                               ? 'medium' :
      hasCategorySignal && txs.length >= 2                                                ? 'low' :
      hasCategorySignal                                                                    ? 'low' :
      // No category: only here if passed the monthly+high-consistency gate above
      consecutiveMonths >= 3 && cvPercent < 10 ? 'medium' :
      'low'

    // ── Score ─────────────────────────────────────────────────────────────────
    const score = Math.min(100,
      (hasCategorySignal   ? 20 : 0) +
      (hasRecurrenceSignal ? 15 : 0) +
      Math.min(consecutiveMonths * 10, 30) +
      Math.round(Math.max(0, 15 - cvPercent) * 2) +
      (isHighConsistency   ? 10 : 0) +
      (intervalCv < 10     ? 10 : 0)
    )

    // ── Next charge estimate ──────────────────────────────────────────────────
    const lastDate = sorted[sorted.length - 1].date
    const estimatedNext = avgInterval > 0
      ? new Date(lastDate.getTime() + avgInterval * 86_400_000)
      : null

    // Use the most recent effective category for display
    const serviceCategory = sorted[sorted.length - 1].categoryName ?? null

    await prisma.subscriptionCandidate.create({
      data: {
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

  return detected
}
