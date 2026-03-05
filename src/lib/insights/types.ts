/**
 * AI Insights — Turn 3 Type Definitions
 *
 * Canonical TypeScript interfaces for the insight card system.
 * All 10 generator functions return InsightCard[].
 * ComputedInsightMetrics is the full bundle passed to every generator.
 */

// ─── Primitive types ──────────────────────────────────────────────────────────

export type CardType =
  | 'over_budget'
  | 'category_spike'
  | 'merchant_spike'
  | 'large_transaction'
  | 'small_leaks'
  | 'subscription_summary'
  | 'subscription_new'
  | 'trial_warning'
  | 'cash_flow_forecast'
  | 'fix_opportunity'

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export type PaceStatus = 'on_track' | 'over_pace' | 'under_pace'

export type RecurrencePattern = 'monthly' | 'weekly' | 'annual' | 'irregular'
export type ServiceCategory =
  | 'streaming'
  | 'music'
  | 'software'
  | 'fitness'
  | 'news'
  | 'cloud'
  | 'gaming'
  | 'finance'
  | 'other'
export type RecurringConfidence = 'high' | 'medium' | 'low'

// ─── Action ───────────────────────────────────────────────────────────────────

export interface InsightCardAction {
  /** Human-readable button label, e.g. "View transactions" */
  label: string
  /** Stable key used by action handlers, e.g. "view_transactions" */
  action_key: string
  /** Optional relative URL for navigation actions */
  href?: string
}

// ─── Supporting data shapes (one per CardType) ────────────────────────────────

export interface OverBudgetData {
  deficit: number
  totalIncome: number
  totalSpending: number
  top_category_1_name: string
  top_category_1_amount: number
  top_category_2_name: string | null
  top_category_2_amount: number | null
  top_category_3_name: string | null
  top_category_3_amount: number | null
  /** Category whose removal alone would restore positive net */
  single_fix_category: string | null
  single_fix_amount: number | null
  top3_combined_pct: number
}

export interface CategorySpikeData {
  category_name: string
  this_month_amount: number
  avg_prior_3_months: number
  pct_increase: number
  delta_dollars: number
  transaction_count: number
  months_of_history: number
}

export interface MerchantSpikeData {
  merchant: string
  this_month_total: number
  prior_month_total: number
  delta: number
  delta_pct: number
}

export interface LargeTransactionData {
  merchant: string
  amount: number
  date: string        // ISO date string
  pct_of_monthly_spending: number
  category_name: string
  threshold_used: number
}

export interface SmallLeaksData {
  count: number
  total: number
  avg_per_transaction: number
  top_category: string
  top_category_count: number
  top_category_total: number
  pct_of_spending: number
}

export interface SubscriptionSummaryData {
  subscription_count: number
  monthly_total: number
  annualized_cost: number
  most_expensive_merchant: string
  most_expensive_amount: number
}

export interface SubscriptionNewData {
  merchant: string
  amount_per_month: number
  months_detected: number
  annualized_cost: number
  service_category: ServiceCategory
  confidence: RecurringConfidence
}

export interface TrialWarningData {
  merchant: string
  trial_amount: number
  charge_date: string          // ISO date string
  estimated_billing_date: string | null
  estimated_monthly_amount: number | null
}

export interface CashFlowForecastData {
  daily_rate: number
  projected_spending: number
  total_income: number
  days_elapsed: number
  days_remaining: number
  days_in_month: number
  pace_status: PaceStatus
  overage_or_underage: number   // projected_spending - total_income; negative = under
}

export interface FixOpportunityScenario {
  action: string
  merchant_or_category: string
  monthly_savings: number
  annual_savings: number
}

export interface FixOpportunityData {
  scenarios: FixOpportunityScenario[]
  total_potential_monthly_savings: number
  net: number
}

// ─── Union of all supporting data shapes ─────────────────────────────────────

export type InsightSupportingData =
  | OverBudgetData
  | CategorySpikeData
  | MerchantSpikeData
  | LargeTransactionData
  | SmallLeaksData
  | SubscriptionSummaryData
  | SubscriptionNewData
  | TrialWarningData
  | CashFlowForecastData
  | FixOpportunityData

// ─── InsightCard ──────────────────────────────────────────────────────────────

export interface InsightCard {
  /** UUID, stable within a generation run; changes on regeneration */
  id: string
  card_type: CardType
  /** 1 (highest priority) to 10 (lowest). Lower = shown first. */
  priority: number
  /** Max 60 characters. No emoji. No trailing punctuation except "?". */
  title: string
  /** 1–2 sentences. Must cite at least one number. Neutral language. */
  summary: string
  /** All numbers cited in summary must appear here as raw numbers or ISO date strings. */
  supporting_data: InsightSupportingData
  /** 1–3 actions. Must always include a "Dismiss" action. */
  actions: InsightCardAction[]
  confidence: ConfidenceLevel
  /** Valid lucide-react icon name, e.g. "TrendingUp" */
  icon_suggestion: string
  /** ISO 8601 timestamp */
  generated_at: string
  month: number
  year: number
  numbers_used: Array<{ label: string; value: string; field: string }>
  filters?: {
    merchant?: string
    category?: string
    dateFrom?: string   // YYYY-MM-DD
    dateTo?: string     // YYYY-MM-DD
    minAmount?: number
  }
}

// ─── Input bundle: ComputedInsightMetrics ─────────────────────────────────────
// This mirrors the Turn 2 data model exactly and is assembled by the
// computation pass before any generators run.

export interface MonthlyAggregates {
  year: number
  month: number
  totalIncome: number
  totalSpending: number
  net: number
  fixedSpending: number
  discretionarySpending: number
  dailySpendingRate: number
  /** Null for complete historical months; populated for current partial month only */
  projectedMonthEnd: number | null
  daysElapsed: number
  daysInMonth: number
  isPartialMonth: boolean
}

export interface CategoryMetrics {
  categoryName: string
  currentMonthTotal: number
  previousMonthTotal: number | null
  delta: number | null
  /** Null when previousMonthTotal is zero or null */
  deltaPercent: number | null
  threeMonthAvg: number | null
  transactionCount: number
  pctOfSpending: number
  isIncome: boolean
}

export interface MerchantMetrics {
  merchantNormalized: string
  merchantDisplay: string
  merchantTotal: number
  merchantCount: number
  /** Null if no previous-month data for this merchant */
  merchantDelta: number | null
  /** Percentage delta vs prior month; null if no prior data */
  merchantDeltaPct: number | null
  isRecurringCandidate: boolean
  recurringConfidence: RecurringConfidence
  /** ISO date string; null if pattern is irregular */
  estimatedNextCharge: string | null
  consecutiveMonths: number
  observedAmounts: number[]
}

export interface SmallPurchaseMerchant {
  merchantDisplay: string
  count: number
  total: number
}

export interface FrequencyMetrics {
  smallPurchaseCount: number
  smallPurchaseTotal: number
  smallPurchaseMerchants: SmallPurchaseMerchant[]
  weekendSpendingTotal: number
  weekdaySpendingTotal: number
  avgTransactionAmount: number
  /** 95th percentile of expense amounts over the past 12 months */
  largeTransactionThreshold: number
}

export interface LargeTransaction {
  merchant: string
  merchantNormalized: string
  amount: number
  date: string          // ISO date string
  categoryName: string
}

export interface TrialCandidate {
  merchantNormalized: string
  merchantDisplay: string
  chargeAmount: number
  chargeDate: string    // ISO date string
  /** Estimated date when full-price billing will start; null if unknown */
  estimatedBillingDate: string | null
  /** Estimated recurring amount; null if unknown */
  estimatedMonthlyAmount: number | null
  /** True when we are within 3 days of estimatedBillingDate */
  alertShouldFire: boolean
}

export interface DuplicateServiceGroup {
  serviceCategory: ServiceCategory
  candidates: Array<{
    merchantNormalized: string
    merchantDisplay: string
    estimatedMonthlyAmount: number
    recurringConfidence: RecurringConfidence
  }>
  groupTotal: number
}

export interface SubscriptionCandidateRecord {
  id: string
  merchantNormalized: string
  merchantDisplay: string
  estimatedMonthlyAmount: number
  recurrencePattern: RecurrencePattern
  consecutiveMonths: number
  observedDates: string[]
  estimatedNextCharge: string | null
  recurringConfidence: RecurringConfidence
  isConfirmedByUser: boolean
  isSuppressed: boolean
  serviceCategory: ServiceCategory
}

export interface SubscriptionMetrics {
  subscriptionCount: number
  subscriptionMonthlyTotal: number
  allSubscriptions: SubscriptionCandidateRecord[]
  /** Newly detected subscriptions (consecutiveMonths === 2) */
  newSubscriptions: SubscriptionCandidateRecord[]
  trialCandidates: TrialCandidate[]
  duplicateServiceCategories: DuplicateServiceGroup[]
}

export interface ComputedInsightMetrics {
  monthly: MonthlyAggregates
  categories: CategoryMetrics[]
  merchants: MerchantMetrics[]
  /** Top large transactions for the month, sorted by amount desc */
  largeTransactions: LargeTransaction[]
  frequency: FrequencyMetrics
  subscriptions: SubscriptionMetrics
}
