/**
 * Subscription & Free Trial Early Warning Module — Turn 4
 *
 * Detects recurring subscriptions, free trials, trial-to-paid conversions,
 * price increases, and duplicate service categories from a user's transaction history.
 *
 * Detection rules:
 *   - Recurring: same merchantNormalized + amount ±5% in 2+ consecutive months,
 *     or same day-of-month ±3 days across 2+ months.
 *   - Trial: amount = $0 or $0.99–$1.99 at a new merchant, or trial keywords in name.
 *   - Conversion: within 45 days of trial, same merchant charges >$4.99.
 *   - Price increase: recurring merchant, new amount >5% above prior average.
 *   - Duplicate services: 2+ active subscriptions in the same service category.
 *
 * Scoring (0–100):
 *   recurrenceFrequency   40%
 *   amountConsistency     30%
 *   dayOfMonthConsistency 20%
 *   merchantNameSignals   10%
 */

import prisma from '@/lib/db'
import { subMonths, startOfMonth, endOfMonth, addDays } from 'date-fns'

// ─── Public types ─────────────────────────────────────────────────────────────

export type SubscriptionConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface SubscriptionCandidate {
  merchantNormalized: string
  /** Typical monthly amount (absolute value, positive number). */
  typicalAmount: number
  /** Most recent charge amount. */
  latestAmount: number
  /** Confidence classification. */
  confidence: SubscriptionConfidence
  /** 0–100 composite score. */
  subscriptionScore: number
  /** ISO date strings of each detected occurrence. */
  occurrenceDates: string[]
  /** Month year strings when charges appeared, e.g. "2025-01". */
  activeMonths: string[]
  /** Price increased from a prior amount — only set when a price increase was detected. */
  priceIncrease?: PriceIncreaseInfo
  /** Service category for duplicate detection. */
  serviceCategory?: ServiceCategory
  /** Whether this subscription is flagged as a duplicate within its category. */
  isDuplicate: boolean
  /** Alert card data ready for rendering. */
  alert: SubscriptionAlertCard
}

export interface TrialCandidate {
  merchantNormalized: string
  /** Date of the trial/auth charge. */
  trialDate: string
  /** Amount of the trial charge (may be 0 or auth amount). */
  trialAmount: number
  /** Estimated number of days in the trial period. */
  estimatedTrialDays: number
  /** Estimated date the first full charge will occur. */
  estimatedBillingDate: string
  /** True when the alert window (≤3 days before billing) is active. */
  alertActive: boolean
  /** "converted" when a full-price charge was found within 45 days. */
  status: 'pending' | 'converted' | 'expired'
  /** Set when status = "converted". */
  conversionAmount?: number
  conversionDate?: string
  /** Alert card data ready for rendering. */
  alert: TrialAlertCard
}

export interface PriceIncreaseInfo {
  oldAmount: number
  newAmount: number
  deltaPct: number
}

export interface DuplicateServiceAlert {
  category: ServiceCategory
  subscriptions: SubscriptionCandidate[]
  totalMonthly: number
  /** Alert card data ready for rendering. */
  alert: DuplicateAlertCard
}

// Alert card union
export type AlertCard =
  | SubscriptionAlertCard
  | TrialAlertCard
  | ConversionAlertCard
  | PriceIncreaseAlertCard
  | DuplicateAlertCard

export interface SubscriptionAlertCard {
  type: 'new_subscription' | 'price_increase'
  title: string
  summary: string
  actions: UserAction[]
}

export interface TrialAlertCard {
  type: 'trial_warning'
  title: string
  summary: string
  actions: UserAction[]
}

export interface ConversionAlertCard {
  type: 'trial_converted'
  title: string
  summary: string
  actions: UserAction[]
}

export interface PriceIncreaseAlertCard {
  type: 'price_increase'
  title: string
  summary: string
  actions: UserAction[]
}

export interface DuplicateAlertCard {
  type: 'duplicate_services'
  title: string
  summary: string
  actions: UserAction[]
}

export interface UserAction {
  label: string
  actionKey: string
  /** ISO date string — present when the action is date-specific (e.g. set a reminder). */
  actionDate?: string
  /** Merchant name — present for hide/mark actions. */
  merchant?: string
}

export interface SubscriptionInsight {
  subscriptions: SubscriptionCandidate[]
  trials: TrialCandidate[]
  duplicateAlerts: DuplicateServiceAlert[]
  /** Snapshot date (ISO) used as "today" for trial window calculations. */
  asOf: string
}

// ─── Service category mapping ─────────────────────────────────────────────────

export type ServiceCategory =
  | 'Video Streaming'
  | 'Music'
  | 'Cloud Storage'
  | 'News/Magazine'
  | 'Gaming'
  | 'Fitness'
  | 'Software/Productivity'
  | 'Other'

const SERVICE_CATEGORY_KEYWORDS: Record<ServiceCategory, string[]> = {
  'Video Streaming': [
    'netflix', 'hulu', 'disney', 'hbo', 'max', 'peacock', 'paramount',
    'apple tv', 'appletv', 'amazon prime', 'amazonprime', 'youtube premium',
    'youtubepremium', 'tubi', 'fubo', 'sling', 'directv stream', 'crunchyroll',
  ],
  'Music': [
    'spotify', 'apple music', 'applemusic', 'tidal', 'deezer', 'pandora',
    'amazon music', 'amazonmusic', 'youtube music', 'youtubemusic', 'soundcloud',
    'qobuz',
  ],
  'Cloud Storage': [
    'icloud', 'dropbox', 'google one', 'googleone', 'google drive', 'googledrive',
    'onedrive', 'box.com', 'backblaze', 'carbonite', 'idrive',
  ],
  'News/Magazine': [
    'nytimes', 'new york times', 'washington post', 'wsj', 'wall street journal',
    'the atlantic', 'wired', 'medium', 'substack', 'patreon', 'economist',
    'bloomberg', 'seekingalpha', 'apple news',
  ],
  'Gaming': [
    'xbox game pass', 'xboxgamepass', 'playstation plus', 'psplus', 'nintendo',
    'ea play', 'eaplay', 'steam', 'epic games', 'epicgames', 'twitch',
    'humble bundle', 'humblebundle', 'ubisoft', 'gamepass',
  ],
  'Fitness': [
    'peloton', 'beachbody', 'noom', 'myfitnesspal', 'fitbit premium',
    'strava', 'calm', 'headspace', 'whoop', 'aaptiv', 'openfit',
  ],
  'Software/Productivity': [
    'adobe', 'microsoft 365', 'microsoft365', 'office 365', 'office365',
    'google workspace', 'googleworkspace', 'notion', 'slack', 'zoom',
    'lastpass', '1password', 'canva', 'grammarly', 'quickbooks', 'freshbooks',
    'figma', 'linear', 'github', 'gitlab',
  ],
  'Other': [],
}

const TRIAL_KEYWORDS = ['trial', 'free', '30day', '14day', '7day', 'freetrial', 'free trial']

const MERCHANT_SIGNALS = ['premium', 'pro', 'plus', 'subscription', 'monthly', 'annual']

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface RawTransaction {
  id: string
  date: Date
  description: string
  merchantNormalized: string
  amount: number
}

/** Classify a merchant name into a service category. */
function classifyServiceCategory(merchant: string): ServiceCategory | undefined {
  const lower = merchant.toLowerCase()
  for (const [cat, keywords] of Object.entries(SERVICE_CATEGORY_KEYWORDS) as [ServiceCategory, string[]][]) {
    if (cat === 'Other') continue
    if (keywords.some(kw => lower.includes(kw))) return cat
  }
  return undefined
}

/** Return true if the merchant name contains trial-related keywords. */
function hasTrialKeyword(merchant: string, description: string): boolean {
  const combined = `${merchant} ${description}`.toLowerCase()
  return TRIAL_KEYWORDS.some(kw => combined.includes(kw))
}

/** Estimate trial duration from merchant name / description (days). */
function estimateTrialDays(merchant: string, description: string): number {
  const combined = `${merchant} ${description}`.toLowerCase()
  if (combined.includes('7day') || combined.includes('7 day') || combined.includes('week')) return 7
  if (combined.includes('14day') || combined.includes('14 day') || combined.includes('two week')) return 14
  return 30
}

/** Return true if an amount qualifies as a trial / auth charge. */
function isTrialAmount(amount: number): boolean {
  const abs = Math.abs(amount)
  return abs === 0 || (abs >= 0.99 && abs <= 1.99)
}

/** Key used to group transactions by merchant across months. */
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * scoreRecurrence
 * Produces a 0–100 composite subscription score from a merchant's transaction history.
 *
 * Component weights:
 *   recurrenceFrequency   40 pts — how many months the charge appeared
 *   amountConsistency     30 pts — how stable the amounts are
 *   dayOfMonthConsistency 20 pts — how tightly clustered the day-of-month is
 *   merchantNameSignals   10 pts — subscription-flavored keywords in merchant name
 */
function scoreRecurrence(transactions: RawTransaction[]): number {
  if (transactions.length === 0) return 0

  const n = transactions.length
  const merchant = transactions[0].merchantNormalized
  const amounts = transactions.map(t => Math.abs(t.amount))
  const days = transactions.map(t => t.date.getDate())

  // ── Recurrence frequency (40 pts) ──────────────────────────────────────────
  // 1 occurrence = 0, 2 = 20, 3 = 30, 4 = 35, 5+ = 40
  const frequencyScore = n === 1 ? 0
    : n === 2 ? 20
    : n === 3 ? 30
    : n === 4 ? 35
    : 40

  // ── Amount consistency (30 pts) ────────────────────────────────────────────
  // Coefficient of variation: lower = more consistent. CV ≤ 0.02 → full 30 pts.
  const meanAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length
  let amountScore = 0
  if (meanAmount > 0) {
    const variance = amounts.reduce((sum, a) => sum + (a - meanAmount) ** 2, 0) / amounts.length
    const cv = Math.sqrt(variance) / meanAmount
    amountScore = Math.round(30 * Math.max(0, 1 - cv / 0.1))
  }

  // ── Day-of-month consistency (20 pts) ──────────────────────────────────────
  // Standard deviation of day-of-month. SD ≤ 2 → full 20 pts.
  const meanDay = days.reduce((a, b) => a + b, 0) / days.length
  const dayVariance = days.reduce((sum, d) => sum + (d - meanDay) ** 2, 0) / days.length
  const daySD = Math.sqrt(dayVariance)
  const dayScore = Math.round(20 * Math.max(0, 1 - daySD / 5))

  // ── Merchant name signals (10 pts) ─────────────────────────────────────────
  const lower = merchant.toLowerCase()
  const signalMatches = MERCHANT_SIGNALS.filter(sig => lower.includes(sig)).length
  const nameScore = Math.min(10, signalMatches * 4)

  return Math.min(100, frequencyScore + amountScore + dayScore + nameScore)
}

/** Map subscriptionScore + occurrence data → SubscriptionConfidence. */
function classifyConfidence(
  score: number,
  n: number,
  maxDaySD: number,
  hasAmountVariance: boolean,
): SubscriptionConfidence {
  if (n >= 3 && score >= 65) return 'HIGH'
  if (n >= 2 && !hasAmountVariance && maxDaySD <= 5) return 'MEDIUM'
  return 'LOW'
}

// ─── Trial detection ──────────────────────────────────────────────────────────

/**
 * detectTrials
 * Scans transactions for free trial / auth charges then checks for conversions.
 *
 * @param transactions  All transactions in the lookback window, sorted date ASC.
 * @param knownMerchants Set of merchants already seen before the lookback window.
 * @param asOf          Reference date for "today" (used to calculate alert windows).
 */
function detectTrials(
  transactions: RawTransaction[],
  knownMerchants: Set<string>,
  asOf: Date,
): TrialCandidate[] {
  const candidates: TrialCandidate[] = []
  const trialBucket = new Map<string, RawTransaction>() // merchantNormalized → trial tx

  // Pass 1: collect trial charges
  for (const tx of transactions) {
    const merchant = tx.merchantNormalized
    if (!merchant) continue

    const isNewMerchant = !knownMerchants.has(merchant)
    const hasTrial = hasTrialKeyword(merchant, tx.description)
    const amountQualifies = isTrialAmount(tx.amount)

    if ((amountQualifies && isNewMerchant) || hasTrial) {
      // Only record the earliest trial charge per merchant
      if (!trialBucket.has(merchant)) {
        trialBucket.set(merchant, tx)
      }
    }
  }

  // Pass 2: for each trial, check for conversion within 45 days
  for (const [merchant, trialTx] of trialBucket.entries()) {
    const estimatedDays = estimateTrialDays(merchant, trialTx.description)
    const billingDate = addDays(trialTx.date, estimatedDays)
    const daysUntilBilling = Math.ceil((billingDate.getTime() - asOf.getTime()) / (1000 * 60 * 60 * 24))
    const alertActive = daysUntilBilling >= 0 && daysUntilBilling <= 3

    // Look for a conversion charge: same merchant, amount > $4.99, within 45 days
    const conversionWindow = addDays(trialTx.date, 45)
    const conversionTx = transactions.find(
      t =>
        t.merchantNormalized === merchant &&
        t.id !== trialTx.id &&
        t.date > trialTx.date &&
        t.date <= conversionWindow &&
        Math.abs(t.amount) > 4.99,
    )

    let status: TrialCandidate['status'] = 'pending'
    if (conversionTx) {
      status = 'converted'
    } else if (asOf > conversionWindow) {
      status = 'expired'
    }

    const trialAmount = Math.abs(trialTx.amount)
    const estimatedMonthly = conversionTx ? Math.abs(conversionTx.amount) : undefined
    const billingDateStr = billingDate.toISOString().slice(0, 10)

    let alertCard: TrialAlertCard
    if (status === 'converted' && conversionTx) {
      const convCard: ConversionAlertCard = {
        type: 'trial_converted',
        title: 'Free trial converted',
        summary: buildConversionSummary(merchant, Math.abs(conversionTx.amount), conversionTx.date),
        actions: buildConversionActions(merchant, conversionTx.date.toISOString().slice(0, 10)),
      }
      // Assign as TrialAlertCard type-compatible shape — cast through unknown
      alertCard = convCard as unknown as TrialAlertCard
    } else {
      alertCard = {
        type: 'trial_warning',
        title: 'Free trial ending soon',
        summary: buildTrialWarningSummary(merchant, estimatedMonthly, billingDateStr),
        actions: buildTrialWarningActions(merchant, billingDateStr),
      }
    }

    candidates.push({
      merchantNormalized: merchant,
      trialDate: trialTx.date.toISOString().slice(0, 10),
      trialAmount,
      estimatedTrialDays: estimatedDays,
      estimatedBillingDate: billingDateStr,
      alertActive,
      status,
      conversionAmount: conversionTx ? Math.abs(conversionTx.amount) : undefined,
      conversionDate: conversionTx ? conversionTx.date.toISOString().slice(0, 10) : undefined,
      alert: alertCard,
    })
  }

  return candidates
}

// ─── Duplicate service detection ──────────────────────────────────────────────

/**
 * detectDuplicateServices
 * Groups active subscriptions by service category and flags categories with 2+ entries.
 */
function detectDuplicateServices(subscriptions: SubscriptionCandidate[]): DuplicateServiceAlert[] {
  const byCategory = new Map<ServiceCategory, SubscriptionCandidate[]>()

  for (const sub of subscriptions) {
    const cat = sub.serviceCategory
    if (!cat) continue
    const list = byCategory.get(cat) ?? []
    list.push(sub)
    byCategory.set(cat, list)
  }

  const alerts: DuplicateServiceAlert[] = []
  for (const [category, subs] of byCategory.entries()) {
    if (subs.length < 2) continue
    const total = subs.reduce((sum, s) => sum + s.typicalAmount, 0)
    const merchantList = subs.map(s => s.merchantNormalized).join(', ')

    alerts.push({
      category,
      subscriptions: subs,
      totalMonthly: total,
      alert: {
        type: 'duplicate_services',
        title: `Duplicate ${category} subscriptions`,
        summary: buildDuplicateSummary(subs.length, category, merchantList, total),
        actions: buildDuplicateActions(subs),
      },
    })

    // Mark each subscription as duplicate
    for (const sub of subs) {
      sub.isDuplicate = true
    }
  }

  return alerts
}

// ─── Alert text builders ──────────────────────────────────────────────────────

function fmt(amount: number): string {
  return amount.toFixed(2)
}

function fmtDate(iso: string): string {
  // e.g. "2025-03-15" → "Mar 15, 2025"
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMonth(monthKey: string): string {
  // e.g. "2025-03" → "Mar 2025"
  const [y, m] = monthKey.split('-')
  const d = new Date(Number(y), Number(m) - 1, 1)
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// 1. New subscription detected
function buildNewSubscriptionSummary(merchant: string, amount: number, firstMonth: string): string {
  return `New recurring charge from ${merchant} ($${fmt(amount)}/mo) detected starting ${fmtMonth(firstMonth)}.`
}

// 2. Trial warning (3 days before billing)
function buildTrialWarningSummary(merchant: string, estimatedAmount: number | undefined, billingDate: string): string {
  const amountStr = estimatedAmount !== undefined ? `$${fmt(estimatedAmount)}/mo` : 'a recurring charge'
  return `Free trial from ${merchant} likely converts to ${amountStr} around ${fmtDate(billingDate)}. Review before then.`
}

// 3. Trial converted
function buildConversionSummary(merchant: string, amount: number, date: Date): string {
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${merchant} free trial converted to paid subscription ($${fmt(amount)}/mo) on ${dateStr}.`
}

// 4. Price increase
function buildPriceIncreaseSummary(merchant: string, oldAmount: number, newAmount: number, pct: number): string {
  return `${merchant} subscription increased from $${fmt(oldAmount)} to $${fmt(newAmount)}/mo (+${pct.toFixed(0)}%).`
}

// 5. Duplicate services
function buildDuplicateSummary(count: number, category: ServiceCategory, list: string, total: number): string {
  return `You have ${count} active ${category} subscriptions (${list}) totaling $${fmt(total)}/mo.`
}

// ─── User action builders ─────────────────────────────────────────────────────

function buildNewSubscriptionActions(merchant: string): UserAction[] {
  return [
    { label: 'View transactions', actionKey: 'view_transactions', merchant },
    { label: 'Mark as not a subscription', actionKey: 'dismiss_subscription', merchant },
    { label: 'Hide merchant', actionKey: 'hide_merchant', merchant },
  ]
}

function buildTrialWarningActions(merchant: string, billingDate: string): UserAction[] {
  return [
    { label: `Set reminder for ${fmtDate(billingDate)}`, actionKey: 'set_reminder', merchant, actionDate: billingDate },
    { label: 'View transactions', actionKey: 'view_transactions', merchant },
    { label: 'Mark as not a trial', actionKey: 'dismiss_trial', merchant },
  ]
}

function buildConversionActions(merchant: string, conversionDate: string): UserAction[] {
  return [
    { label: 'View transactions', actionKey: 'view_transactions', merchant },
    { label: 'Mark as not a subscription', actionKey: 'dismiss_subscription', merchant },
    { label: 'Hide merchant', actionKey: 'hide_merchant', merchant },
  ]
}

function buildPriceIncreaseActions(merchant: string): UserAction[] {
  return [
    { label: 'View transactions', actionKey: 'view_transactions', merchant },
    { label: 'Mark as expected', actionKey: 'acknowledge_price_change', merchant },
    { label: 'Hide merchant', actionKey: 'hide_merchant', merchant },
  ]
}

function buildDuplicateActions(subs: SubscriptionCandidate[]): UserAction[] {
  return [
    { label: 'View transactions', actionKey: 'view_transactions' },
    ...subs.map(s => ({
      label: `Cancel ${s.merchantNormalized}`,
      actionKey: 'cancel_subscription',
      merchant: s.merchantNormalized,
    })),
  ]
}

// ─── Main detection function ──────────────────────────────────────────────────

/**
 * detectSubscriptions
 *
 * Analyses the trailing 12 months of transactions for the given user and
 * returns detected subscriptions, free trials, and duplicate service alerts.
 *
 * The `year` and `month` parameters define the "current" month for the analysis
 * (i.e. the reference point for what is "this month" vs history).
 */
export async function detectSubscriptions(
  userId: string,
  year: number,
  month: number,
): Promise<SubscriptionInsight> {
  const asOf = endOfMonth(new Date(year, month - 1))

  // Fetch 12 months of transactions (lookback window)
  const windowStart = startOfMonth(subMonths(new Date(year, month - 1), 11))
  const windowEnd   = endOfMonth(new Date(year, month - 1))

  const transactions = await prisma.transaction.findMany({
    where: {
      account: { userId },
      date: { gte: windowStart, lte: windowEnd },
      isExcluded:       false,
      isTransfer:       false,
      isDuplicate:      false,
      isForeignCurrency: false,
      // Only consider expenses (negative amounts)
      amount: { lt: 0 },
    },
    select: {
      id:                 true,
      date:               true,
      description:        true,
      merchantNormalized: true,
      amount:             true,
    },
    orderBy: { date: 'asc' },
  })

  // Fetch all merchants the user has ever seen BEFORE the lookback window
  // (used to detect "new merchant" trial signals)
  const historicalMerchants = await prisma.transaction.findMany({
    where: {
      account: { userId },
      date:       { lt: windowStart },
      isExcluded: false,
      amount:     { lt: 0 },
      merchantNormalized: { not: '' },
    },
    select: { merchantNormalized: true },
    distinct: ['merchantNormalized'],
  })
  const knownMerchants = new Set(historicalMerchants.map(t => t.merchantNormalized))

  // ── Group transactions by merchantNormalized ──────────────────────────────
  const byMerchant = new Map<string, RawTransaction[]>()
  for (const tx of transactions) {
    const merchant = tx.merchantNormalized
    if (!merchant) continue
    const list = byMerchant.get(merchant) ?? []
    list.push(tx as RawTransaction)
    byMerchant.set(merchant, list)
  }

  // ── Detect subscriptions ──────────────────────────────────────────────────
  const subscriptions: SubscriptionCandidate[] = []

  for (const [merchant, txs] of byMerchant.entries()) {
    // Need at least 2 transactions to establish recurrence
    if (txs.length < 2) continue

    // Group by month
    const monthGroups = new Map<string, RawTransaction[]>()
    for (const tx of txs) {
      const mk = monthKey(tx.date)
      const group = monthGroups.get(mk) ?? []
      group.push(tx)
      monthGroups.set(mk, group)
    }

    const activeMonths = Array.from(monthGroups.keys()).sort()
    const monthCount = activeMonths.length

    // Need charges in at least 2 distinct months
    if (monthCount < 2) continue

    // ── Amount consistency check ────────────────────────────────────────────
    // Use the median charge per month (handle months with multiple charges)
    const monthlyAmounts = activeMonths.map(mk => {
      const group = monthGroups.get(mk)!
      const sorted = group.map(t => Math.abs(t.amount)).sort((a, b) => a - b)
      return sorted[Math.floor(sorted.length / 2)]
    })

    const baseAmount = monthlyAmounts[0]
    const allWithin5Pct = monthlyAmounts.every(a => Math.abs(a - baseAmount) / baseAmount <= 0.05)
    const meanAmount = monthlyAmounts.reduce((s, a) => s + a, 0) / monthlyAmounts.length

    // Rule: amounts must be within ±5% of the base amount across the months
    if (!allWithin5Pct) {
      // Check if any consecutive pair is within ±5% (looser rule for 2-month pairs)
      const anyConsecutiveMatch = monthlyAmounts.some((a, i) =>
        i > 0 && Math.abs(a - monthlyAmounts[i - 1]) / monthlyAmounts[i - 1] <= 0.05,
      )
      if (!anyConsecutiveMatch) continue
    }

    // ── Day-of-month consistency ────────────────────────────────────────────
    const dayOfMonths = activeMonths.map(mk => {
      const group = monthGroups.get(mk)!
      return group[0].date.getDate()
    })
    const meanDay = dayOfMonths.reduce((s, d) => s + d, 0) / dayOfMonths.length
    const dayVariance = dayOfMonths.reduce((sum, d) => sum + (d - meanDay) ** 2, 0) / dayOfMonths.length
    const daySD = Math.sqrt(dayVariance)
    const dayConsistent = daySD <= 3

    // Must have either amount consistency OR day-of-month consistency
    if (!allWithin5Pct && !dayConsistent) continue

    // ── Scoring ────────────────────────────────────────────────────────────
    const score = scoreRecurrence(txs)
    const hasAmountVariance = !allWithin5Pct
    const confidence = classifyConfidence(score, monthCount, daySD, hasAmountVariance)

    // ── Price increase detection ───────────────────────────────────────────
    let priceIncrease: PriceIncreaseInfo | undefined
    if (monthlyAmounts.length >= 2) {
      const latestAmount = monthlyAmounts[monthlyAmounts.length - 1]
      const priorAmounts = monthlyAmounts.slice(0, -1)
      const priorMean = priorAmounts.reduce((s, a) => s + a, 0) / priorAmounts.length
      const deltaPct = ((latestAmount - priorMean) / priorMean) * 100
      if (deltaPct > 5) {
        priceIncrease = {
          oldAmount: Math.round(priorMean * 100) / 100,
          newAmount: latestAmount,
          deltaPct: Math.round(deltaPct * 10) / 10,
        }
      }
    }

    // ── Latest amount ──────────────────────────────────────────────────────
    const latestTx = txs[txs.length - 1]
    const latestAmount = Math.abs(latestTx.amount)

    // ── Occurrence dates ───────────────────────────────────────────────────
    const occurrenceDates = txs.map(t => t.date.toISOString().slice(0, 10))

    // ── Service category ───────────────────────────────────────────────────
    const serviceCategory = classifyServiceCategory(merchant)

    // ── Build alert card ───────────────────────────────────────────────────
    let alertCard: SubscriptionAlertCard
    if (priceIncrease) {
      alertCard = {
        type: 'price_increase',
        title: 'Subscription price increase',
        summary: buildPriceIncreaseSummary(merchant, priceIncrease.oldAmount, priceIncrease.newAmount, priceIncrease.deltaPct),
        actions: buildPriceIncreaseActions(merchant),
      }
    } else {
      alertCard = {
        type: 'new_subscription',
        title: 'New subscription detected',
        summary: buildNewSubscriptionSummary(merchant, meanAmount, activeMonths[0]),
        actions: buildNewSubscriptionActions(merchant),
      }
    }

    subscriptions.push({
      merchantNormalized: merchant,
      typicalAmount:      Math.round(meanAmount * 100) / 100,
      latestAmount,
      confidence,
      subscriptionScore:  score,
      occurrenceDates,
      activeMonths,
      priceIncrease,
      serviceCategory,
      isDuplicate:        false, // updated by detectDuplicateServices
      alert:              alertCard,
    })
  }

  // ── Detect trials ─────────────────────────────────────────────────────────
  const trials = detectTrials(transactions as RawTransaction[], knownMerchants, asOf)

  // ── Detect duplicate services ─────────────────────────────────────────────
  const duplicateAlerts = detectDuplicateServices(subscriptions)

  return {
    subscriptions,
    trials,
    duplicateAlerts,
    asOf: asOf.toISOString(),
  }
}
