# AI Insights — Turn 2: Data Model + Required Aggregations

## 1. Existing Schema Summary

### User
Stores account credentials (`email`, `passwordHash`) and a JSON-serialized `categoryOrder` array. Soft-delete via `deletedAt`. Owns all child records.

### Account
Represents a bank/credit-card account. Fields: `name`, `institution`, `accountType` (checking/savings/credit), `currency`, `archivedAt`. One user can have many accounts.

### Transaction
The central ledger record. Key fields relevant to AI Insights:
- `date` — authoritative posting date
- `amount` — signed float: positive = credit/income, negative = debit/spending
- `merchantNormalized` — normalized vendor string (already cleaned)
- `appCategory` / `bankCategoryRaw` — free-text category labels
- `isTransfer`, `isExcluded`, `isDuplicate`, `isForeignCurrency` — exclusion flags
- `isTransfer` — critical: transfers must be excluded from all spending aggregations

### MonthSummary
Pre-computed per-user, per-month totals: `totalIncome`, `totalSpending`, `net`, `transactionCount`, `isPartialMonth`, `dateRangeStart`, `dateRangeEnd`, `isStale`. The computation engine writes this via upsert. Used by the trends API for multi-month charts.

### MonthCategoryTotal
Intended to hold per-category subtotals per month, but currently **not populated** because `categoryId` is a UUID FK and the app now uses free-text category names. This means historical category-level data is unavailable without a re-query against raw transactions. AI Insights computation must query `Transaction` directly.

### CategoryRule
Pattern-matching rules (`matchType`, `matchValue`, `vendorKey`, `amountExact`, `amountMin`, `amountMax`). Tracks `hitCount` and `lastHitAt`. The `mode` field (`always` | `ask`) and `confidence` determine auto-apply vs. review routing.

### Category
User-defined or system categories with `isIncome` and `isTransfer` flags, `color`, `icon`, `parentId` for hierarchy. `isSystem` marks built-in categories.

### AnomalyAlert
Persisted anomaly alerts per `(userId, year, month, alertType)`. Has `isDismissed` for user suppression. Currently populated by `detectAnomalies()` in the summaries engine.

### StagingUpload / StagingTransaction
Pre-commit workflow for uploaded bank files. Not relevant to AI Insights computation (staging data is not in the ledger yet).

### TransactionRaw / AuditLogEntry / IngestionIssue / RuleHit / CategoryHistory / TransactionLink
Ingestion pipeline lineage and audit records. Not used by AI Insights directly, but `CategoryHistory` could eventually support rule quality scoring.

---

## 2. New Schema Additions

```prisma
// ─── InsightCard ──────────────────────────────────────────────────────────────
// One row per insight type per (user, year, month). Regenerated on each
// summary compute; dismissal is sticky (isDismissed survives regeneration).
model InsightCard {
  id            String   @id @default(cuid())
  userId        String
  year          Int
  month         Int

  // One of: spending_spike | budget_forecast | subscription_audit |
  //         savings_opportunity | merchant_drill | category_trend |
  //         income_stability | small_purchase_drain | duplicate_charge |
  //         unusual_weekend_spend
  cardType      String

  // Lower number = shown first in UI
  priority      Int

  title         String
  summary       String

  // Computed numbers backing this card — shape is cardType-specific
  // (see TypeScript interfaces below for each variant)
  supportingData Json

  // Array of { label: string, route: string } action objects
  actions       Json

  // high | medium | low — based on data completeness and sample size
  confidence    String

  isDismissed   Boolean  @default(false)
  generatedAt   DateTime @default(now())

  user          User     @relation(fields: [userId], references: [id])

  @@unique([userId, year, month, cardType])
  @@index([userId, year, month, isDismissed])
  @@map("insight_cards")
}

// ─── SubscriptionCandidate ────────────────────────────────────────────────────
// A merchant that appears to be a recurring charge. Written by the subscription
// detection pass and referenced by the subscription_audit InsightCard.
// Re-evaluated monthly; `isConfirmedByUser` persists across regenerations.
model SubscriptionCandidate {
  id                   String   @id @default(cuid())
  userId               String

  // Normalized vendor identifier — matches Transaction.merchantNormalized
  merchantNormalized   String

  // Human-readable display name (first seen raw description, trimmed)
  merchantDisplay      String

  // Estimated monthly amount in dollars (average of matched charges)
  estimatedMonthlyAmount Float

  // Recurrence pattern: monthly | weekly | annual | irregular
  recurrencePattern    String   @default("monthly")

  // Number of consecutive months this charge appeared
  consecutiveMonths    Int      @default(0)

  // Dates of the last three observed charges (JSON array of ISO strings)
  observedDates        Json

  // Predicted date of next charge (null if pattern is irregular)
  estimatedNextCharge  DateTime?

  // high | medium | low
  recurringConfidence  String

  // true = user has explicitly confirmed this is a subscription
  isConfirmedByUser    Boolean  @default(false)

  // true = user marked this as NOT a subscription (suppress future detection)
  isSuppressed         Boolean  @default(false)

  // Inferred service category: streaming | music | software | fitness |
  //                            news | cloud | gaming | finance | other
  serviceCategory      String   @default("other")

  firstSeenAt          DateTime @default(now())
  lastSeenAt           DateTime @default(now())
  updatedAt            DateTime @updatedAt

  user                 User     @relation(fields: [userId], references: [id])

  @@unique([userId, merchantNormalized])
  @@index([userId, recurringConfidence])
  @@index([userId, isSuppressed])
  @@map("subscription_candidates")
}
```

**Relation additions required on `User` in `schema.prisma`:**
```prisma
insightCards           InsightCard[]
subscriptionCandidates SubscriptionCandidate[]
```

---

## 3. Computed Metrics Spec

All queries filter with the standard exclusion predicate unless noted:
```
isTransfer = false, isExcluded = false, isDuplicate = false,
isForeignCurrency = false, amount != 0
```

---

### Monthly Aggregates

| Metric | Formula / Query | Data Source | Example Value |
|---|---|---|---|
| `totalIncome` | `SUM(amount) WHERE amount > 0` | `Transaction` grouped by month | `4,250.00` |
| `totalSpending` | `SUM(ABS(amount)) WHERE amount < 0` | `Transaction` grouped by month | `3,180.40` |
| `net` | `totalIncome - totalSpending` | Derived | `1,069.60` |
| `fixedSpending` | `SUM(ABS(amount))` for transactions whose `merchantNormalized` matches a `SubscriptionCandidate` with `recurringConfidence IN ('high','medium')` | `Transaction JOIN SubscriptionCandidate` | `842.00` |
| `discretionarySpending` | `totalSpending - fixedSpending` | Derived | `2,338.40` |
| `dailySpendingRate` | `totalSpending / daysElapsed` where `daysElapsed = MIN(today.getDate(), daysInMonth)` if current month else `daysInMonth` | Derived | `102.59/day` |
| `projectedMonthEnd` | `dailySpendingRate * daysInMonth` (only emitted for current partial month) | Derived | `3,183.29` |

**Notes:**
- `totalIncome` and `totalSpending` already exist in `MonthSummary` — read from there if `isStale = false`, otherwise recompute from `Transaction`.
- `fixedSpending` requires `SubscriptionCandidate` to be populated first (subscription detection pass runs before card generation).
- `projectedMonthEnd` is suppressed for complete historical months (`isPartialMonth = false`).

---

### Category Metrics (per category, for the target month and comparison month)

| Metric | Formula / Query | Data Source | Example Value |
|---|---|---|---|
| `currentMonthTotal` | `SUM(ABS(amount)) WHERE appCategory = cat AND month = M` | `Transaction` | `$420.15` |
| `previousMonthTotal` | `SUM(ABS(amount)) WHERE appCategory = cat AND month = M-1` | `Transaction` | `$310.00` |
| `delta` | `currentMonthTotal - previousMonthTotal` | Derived | `+$110.15` |
| `deltaPercent` | `(delta / previousMonthTotal) * 100` — emit `null` if `previousMonthTotal = 0` | Derived | `+35.5%` |
| `threeMonthAvg` | `AVG(monthTotal)` for the three calendar months immediately before M | `Transaction` aggregated per month | `$355.00` |

**Query pattern for category aggregates (raw SQL for efficiency):**
```sql
SELECT
  "appCategory"                          AS category,
  SUM(ABS(amount))                       AS total,
  COUNT(*)                               AS tx_count
FROM transactions t
JOIN accounts a ON t."accountId" = a.id
WHERE a."userId" = $userId
  AND EXTRACT(YEAR  FROM t.date) = $year
  AND EXTRACT(MONTH FROM t.date) = $month
  AND t."isTransfer"        = false
  AND t."isExcluded"        = false
  AND t."isDuplicate"       = false
  AND t."isForeignCurrency" = false
  AND t.amount < 0
  AND t.amount != 0
  AND t."appCategory" IS NOT NULL
GROUP BY "appCategory"
ORDER BY total DESC
```

---

### Merchant Metrics

| Metric | Formula / Query | Data Source | Example Value |
|---|---|---|---|
| `merchantTotal` | `SUM(ABS(amount)) WHERE merchantNormalized = M AND month = target` | `Transaction` | `$89.97` |
| `merchantCount` | `COUNT(*) WHERE merchantNormalized = M AND month = target` | `Transaction` | `3` |
| `merchantDelta` | `merchantTotal(thisMonth) - merchantTotal(prevMonth)` | Derived | `+$29.99` |
| `isRecurringCandidate` | `true` if merchant appears in 2+ consecutive calendar months with `ABS(amount)` within 10% of mean | `Transaction` aggregated over rolling 6 months | `true` |
| `recurringConfidence` | `high` if 3+ consecutive months within 5%; `medium` if 2+ within 10%; `low` otherwise | Derived | `"high"` |
| `estimatedNextCharge` | Last charge date + median interval between charges (days) | Derived from `observedDates` | `2026-04-02` |

**Recurrence detection algorithm:**
1. For each `merchantNormalized`, fetch all charges over the past 6 months grouped by calendar month.
2. A merchant is a candidate if it appears in at least 2 of the last 3 months OR 3 of the last 6 months.
3. Compute mean and standard deviation of charge amounts. If `stddev / mean < 0.05` → `high`; `< 0.10` → `medium`; else `low`.
4. Compute median day-of-month across all observed charges to estimate `estimatedNextCharge`.

---

### Frequency Metrics

| Metric | Formula / Query | Data Source | Example Value |
|---|---|---|---|
| `smallPurchaseCount` | `COUNT(*) WHERE ABS(amount) < 15 AND isTransfer = false` | `Transaction` for target month | `23` |
| `smallPurchaseTotal` | `SUM(ABS(amount)) WHERE ABS(amount) < 15 AND isTransfer = false` | `Transaction` for target month | `$187.45` |
| `weekendSpendingTotal` | `SUM(ABS(amount)) WHERE EXTRACT(DOW FROM date) IN (0,6)` (Sun=0, Sat=6) | `Transaction` | `$612.80` |
| `weekdaySpendingTotal` | `SUM(ABS(amount)) WHERE EXTRACT(DOW FROM date) NOT IN (0,6)` | `Transaction` | `$2,567.60` |
| `avgTransactionAmount` | `SUM(ABS(amount)) / COUNT(*)` for expense transactions | `Transaction` | `$48.22` |
| `largeTransactionThreshold` | 95th percentile of `ABS(amount)` over the past 12 months of expense transactions | `Transaction` over rolling 12 months | `$342.00` |

**Notes:**
- `smallPurchaseCount` threshold of $15 is a tunable constant — define as `SMALL_PURCHASE_THRESHOLD = 15` in the computation module.
- Weekend/weekday split uses PostgreSQL `EXTRACT(DOW FROM date)`: 0 = Sunday, 6 = Saturday.
- `largeTransactionThreshold` is computed once per summary run (already done in `detectAnomalies`) — reuse that value rather than re-querying.

---

### Subscription Metrics

| Metric | Formula / Query | Data Source | Example Value |
|---|---|---|---|
| `subscriptionCount` | `COUNT(*) FROM SubscriptionCandidate WHERE userId = U AND isSuppressed = false AND recurringConfidence IN ('high','medium')` | `SubscriptionCandidate` | `7` |
| `subscriptionMonthlyTotal` | `SUM(estimatedMonthlyAmount) WHERE isSuppressed = false AND recurringConfidence IN ('high','medium')` | `SubscriptionCandidate` | `$142.86` |
| `trialCandidates` | Transactions with `ABS(amount) <= 1.00` from a merchant that has charged more than $5 in a prior month — appears to be a free trial start | `Transaction` over past 30 days JOIN prior months | `[{merchant: "Spotify", amount: $0.99}]` |
| `duplicateServiceCategories` | Groups of 2+ `SubscriptionCandidate` rows sharing the same `serviceCategory` (e.g. two `music` candidates) | `SubscriptionCandidate` grouped by `serviceCategory` | `[{category: "music", count: 2, total: $29.98}]` |

**Trial candidate detection:**
```
For each transaction T in the last 30 days where ABS(T.amount) <= 1.00:
  If EXISTS a prior transaction P where P.merchantNormalized = T.merchantNormalized
    AND P.date < T.date - 25 days
    AND ABS(P.amount) > 5.00:
  → NOT a trial (already paying full price)
  Else:
  → Mark as trialCandidate
```

---

## 4. TypeScript Interfaces

```typescript
// ─── src/lib/intelligence/types.ts ───────────────────────────────────────────

// ─── Monthly Aggregates ───────────────────────────────────────────────────────

export interface MonthlyAggregates {
  year:                   number
  month:                  number
  totalIncome:            number
  totalSpending:          number
  net:                    number
  fixedSpending:          number
  discretionarySpending:  number
  dailySpendingRate:      number
  /** Null for complete historical months; set only for current partial month */
  projectedMonthEnd:      number | null
  daysElapsed:            number
  daysInMonth:            number
  isPartialMonth:         boolean
}

// ─── Category Metrics ─────────────────────────────────────────────────────────

export interface CategoryMetrics {
  categoryName:         string
  currentMonthTotal:    number
  previousMonthTotal:   number | null
  delta:                number | null
  /** Null when previousMonthTotal is zero or null */
  deltaPercent:         number | null
  threeMonthAvg:        number | null
  transactionCount:     number
  pctOfSpending:        number
  isIncome:             boolean
}

// ─── Merchant Metrics ─────────────────────────────────────────────────────────

export interface MerchantMetrics {
  merchantNormalized:       string
  merchantDisplay:          string
  merchantTotal:            number
  merchantCount:            number
  /** Null if no previous-month data for this merchant */
  merchantDelta:            number | null
  isRecurringCandidate:     boolean
  recurringConfidence:      'high' | 'medium' | 'low'
  /** ISO date string; null if pattern is irregular */
  estimatedNextCharge:      string | null
  consecutiveMonths:        number
  observedAmounts:          number[]
}

// ─── Frequency Metrics ────────────────────────────────────────────────────────

export const SMALL_PURCHASE_THRESHOLD = 15 // dollars

export interface FrequencyMetrics {
  smallPurchaseCount:         number
  smallPurchaseTotal:         number
  weekendSpendingTotal:       number
  weekdaySpendingTotal:       number
  avgTransactionAmount:       number
  /** 95th percentile of expense amounts over the past 12 months */
  largeTransactionThreshold:  number
}

// ─── Subscription Metrics ─────────────────────────────────────────────────────

export interface TrialCandidate {
  merchantNormalized: string
  merchantDisplay:    string
  chargeAmount:       number
  chargeDate:         string  // ISO date string
}

export interface DuplicateServiceGroup {
  serviceCategory:   string
  candidates:        Array<{
    merchantNormalized:    string
    merchantDisplay:       string
    estimatedMonthlyAmount: number
    recurringConfidence:   'high' | 'medium' | 'low'
  }>
  groupTotal:        number
}

export interface SubscriptionMetrics {
  subscriptionCount:          number
  subscriptionMonthlyTotal:   number
  trialCandidates:            TrialCandidate[]
  duplicateServiceCategories: DuplicateServiceGroup[]
}

// ─── Subscription Candidate (mirrors Prisma model) ───────────────────────────

export type RecurrencePattern = 'monthly' | 'weekly' | 'annual' | 'irregular'
export type ServiceCategory   = 'streaming' | 'music' | 'software' | 'fitness' |
                                'news' | 'cloud' | 'gaming' | 'finance' | 'other'
export type RecurringConfidence = 'high' | 'medium' | 'low'

export interface SubscriptionCandidateRecord {
  id:                      string
  userId:                  string
  merchantNormalized:      string
  merchantDisplay:         string
  estimatedMonthlyAmount:  number
  recurrencePattern:       RecurrencePattern
  consecutiveMonths:       number
  observedDates:           string[]  // ISO date strings
  estimatedNextCharge:     string | null
  recurringConfidence:     RecurringConfidence
  isConfirmedByUser:       boolean
  isSuppressed:            boolean
  serviceCategory:         ServiceCategory
  firstSeenAt:             string
  lastSeenAt:              string
}

// ─── Insight Card Types ───────────────────────────────────────────────────────

export type InsightCardType =
  | 'spending_spike'
  | 'budget_forecast'
  | 'subscription_audit'
  | 'savings_opportunity'
  | 'merchant_drill'
  | 'category_trend'
  | 'income_stability'
  | 'small_purchase_drain'
  | 'duplicate_charge'
  | 'unusual_weekend_spend'

export type InsightConfidence = 'high' | 'medium' | 'low'

export interface InsightAction {
  label: string
  /** Next.js route path, e.g. "/categorize" or "/transactions?filter=subscriptions" */
  route: string
}

// ── Supporting data shapes — one per cardType ─────────────────────────────────

export interface SpendingSpikeData {
  categoryName:      string
  currentTotal:      number
  historicalAvg:     number
  historicalMedian:  number
  multiplier:        number  // currentTotal / historicalAvg
  modifiedZScore:    number
}

export interface BudgetForecastData {
  totalSpending:       number
  dailySpendingRate:   number
  projectedMonthEnd:   number
  daysElapsed:         number
  daysInMonth:         number
  previousMonthTotal:  number | null
  threeMonthAvg:       number | null
}

export interface SubscriptionAuditData {
  subscriptionCount:          number
  subscriptionMonthlyTotal:   number
  subscriptionAnnualTotal:    number
  topSubscriptions:           Array<{
    merchantDisplay:       string
    estimatedMonthlyAmount: number
    recurringConfidence:   RecurringConfidence
    serviceCategory:       ServiceCategory
  }>
  duplicateServiceCategories: DuplicateServiceGroup[]
  trialCandidates:            TrialCandidate[]
}

export interface SavingsOpportunityData {
  discretionarySpending:    number
  topDiscretionaryCategory: string
  topDiscretionaryTotal:    number
  smallPurchaseTotal:       number
  smallPurchaseCount:       number
  potentialMonthlySavings:  number  // rough estimate
}

export interface MerchantDrillData {
  merchantDisplay:   string
  currentTotal:      number
  previousTotal:     number | null
  delta:             number | null
  deltaPercent:      number | null
  transactionCount:  number
  transactions:      Array<{
    date:   string
    amount: number
    description: string
  }>
}

export interface CategoryTrendData {
  categoryName:       string
  currentTotal:       number
  previousTotal:      number | null
  threeMonthAvg:      number | null
  delta:              number | null
  deltaPercent:       number | null
  trendDirection:     'up' | 'down' | 'stable'
}

export interface IncomeStabilityData {
  currentIncome:     number
  previousIncome:    number | null
  threeMonthAvgIncome: number | null
  delta:             number | null
  deltaPercent:      number | null
  incomeTxCount:     number
  isMultipleSourcesDetected: boolean
}

export interface SmallPurchaseDrainData {
  smallPurchaseCount:  number
  smallPurchaseTotal:  number
  threshold:           number  // SMALL_PURCHASE_THRESHOLD constant
  pctOfSpending:       number
  topSmallMerchants:   Array<{
    merchantDisplay: string
    count:           number
    total:           number
  }>
}

export interface DuplicateChargeData {
  merchantDisplay:  string
  amount:           number
  occurrences:      number
  dates:            string[]  // ISO date strings
  totalOvercharge:  number
}

export interface UnusualWeekendSpendData {
  weekendTotal:     number
  weekdayTotal:     number
  weekendPct:       number  // weekendTotal / totalSpending * 100
  historicalWeekendPct: number | null
  topWeekendMerchants: Array<{
    merchantDisplay: string
    total:           number
  }>
}

// ── Union of all supportingData shapes ───────────────────────────────────────

export type InsightSupportingData =
  | SpendingSpikeData
  | BudgetForecastData
  | SubscriptionAuditData
  | SavingsOpportunityData
  | MerchantDrillData
  | CategoryTrendData
  | IncomeStabilityData
  | SmallPurchaseDrainData
  | DuplicateChargeData
  | UnusualWeekendSpendData

// ── Full InsightCard record (mirrors Prisma model + parsed JSON fields) ──────

export interface InsightCardRecord {
  id:             string
  userId:         string
  year:           number
  month:          number
  cardType:       InsightCardType
  priority:       number
  title:          string
  summary:        string
  supportingData: InsightSupportingData
  actions:        InsightAction[]
  confidence:     InsightConfidence
  isDismissed:    boolean
  generatedAt:    string  // ISO datetime string
}

// ─── Full Computed Metrics Bundle ─────────────────────────────────────────────
// This is the complete object assembled by the computation pass before
// insight cards are generated. All card generators receive this bundle.

export interface ComputedInsightMetrics {
  monthly:       MonthlyAggregates
  categories:    CategoryMetrics[]
  merchants:     MerchantMetrics[]
  frequency:     FrequencyMetrics
  subscriptions: SubscriptionMetrics
}
```

---

## Design Decisions and Rationale

### Why `InsightCard` has a `@@unique` on `[userId, year, month, cardType]`
Each card type produces at most one card per month. If a user has, say, two spending spikes in different categories, the computation layer picks the highest-priority category and emits a single `spending_spike` card. This keeps the UI digestible. A future `cardSubType` or array field can expand this if needed.

### Why `isDismissed` survives regeneration
The computation engine regenerates cards on every summary recompute (e.g., after uploading new transactions). Rather than wiping and recreating dismissed cards, the engine does an upsert that preserves `isDismissed`. This means a dismissed card stays gone even after a data refresh.

### Why `MonthCategoryTotal` is not used for category history
As noted in `summaries.ts` (line 260–264), `MonthCategoryTotal` cannot be populated because `categoryId` is a UUID FK and the app now uses free-text category names (e.g. "Gasoline/Fuel"). AI Insights aggregates category history by querying `Transaction` directly with raw SQL, grouping by `appCategory`. This is slightly slower but correct.

### Why `SubscriptionCandidate` is a separate persistent model
Subscription detection is computationally expensive (multi-month join and amount-variance analysis). Persisting candidates avoids re-detecting them on every summary compute. The `isSuppressed` flag lets users permanently dismiss false positives. The `isConfirmedByUser` flag enables future "manage subscriptions" UI.

### `fixedSpending` depends on `SubscriptionCandidate` being populated first
The computation order within a single insight generation pass must be:
1. Recompute `MonthlyAggregates` (reads `MonthSummary`)
2. Run subscription detection → upsert `SubscriptionCandidate` rows
3. Compute `fixedSpending` = sum of `estimatedMonthlyAmount` for confirmed/high-confidence candidates
4. Derive `discretionarySpending` = `totalSpending - fixedSpending`
5. Compute remaining metrics
6. Generate and upsert `InsightCard` rows
