# AI Insights — Turn 3: The 10 Automatic Insight Generators

**Status:** Turn 3 of 6 — Generator Functions + Type Definitions
**Date:** 2026-03-04
**Output files:**
- `src/lib/insights/types.ts` — all TypeScript interfaces
- `src/lib/insights/generators.ts` — all 10 generator functions + `rankAndCap` + `runAllGenerators`

---

## Overview

This turn implements 10 deterministic, rule-based insight generator functions. No LLM calls occur here. Every card is computed from structured numeric data in `ComputedInsightMetrics`. The generators are pure functions: given the same metrics bundle, they always produce the same cards.

---

## Architecture

```
ComputedInsightMetrics
        │
        ▼
┌───────────────────────────────────────────────────────────┐
│  runAllGenerators(metrics)                                │
│                                                           │
│  generateOverBudgetDiagnosis  →  InsightCard[]            │
│  generateCategorySpikes       →  InsightCard[]            │
│  generateMerchantSpikes       →  InsightCard[]            │
│  generateLargeTransactions    →  InsightCard[]            │  (up to 3)
│  generateSmallPurchaseLeaks   →  InsightCard[]            │
│  generateSubscriptionSummary  →  InsightCard[]            │
│  generateNewSubscriptionAlert →  InsightCard[]            │  (1 per new sub)
│  generateTrialWarnings        →  InsightCard[]            │  (1 per trial)
│  generateCashFlowForecast     →  InsightCard[]            │
│  generateFixOpportunity       →  InsightCard[]            │
│                                                           │
│  all = flatten(above)   ← persist ALL to DB              │
│  display = rankAndCap(all, cap=8)                        │
└───────────────────────────────────────────────────────────┘
        │
        ▼
   InsightCard[] (display set, max 8)
```

---

## The 10 Generators

### Generator 1: `generateOverBudgetDiagnosis`

| Property | Value |
|---|---|
| card_type | `over_budget` |
| priority | 1 |
| icon | `TrendingDown` |

**Trigger condition:**
`totalSpending > totalIncome` for the month.

**Minimum data requirements:**
- At least one expense transaction in the month.
- `totalIncome` may be 0 (card still fires; confidence drops to `medium`).

**Inputs:**
- `monthly.totalIncome`, `monthly.totalSpending`, `monthly.net`
- `categories[]` (expense categories sorted by currentMonthTotal desc)

**Algorithm:**
1. Guard: if `totalSpending <= totalIncome`, return `[]`.
2. Compute `deficit = abs(net)`.
3. Filter `categories` to expense categories (`isIncome = false`), sort by `currentMonthTotal` desc.
4. Take top 3 categories.
5. Compute `top3_combined_pct = (sum of top3 totals / totalSpending) * 100`.
6. Iterate expense categories: find first one where `currentMonthTotal >= deficit` → this is `single_fix_category`.
7. Build card with top3 category breakdown and fix hint.

**Output JSON schema (`OverBudgetData`):**
```json
{
  "deficit": 340.22,
  "totalIncome": 3200.00,
  "totalSpending": 3540.22,
  "top_category_1_name": "Dining",
  "top_category_1_amount": 847.00,
  "top_category_2_name": "Shopping",
  "top_category_2_amount": 612.00,
  "top_category_3_name": "Transport",
  "top_category_3_amount": 280.00,
  "single_fix_category": "Dining",
  "single_fix_amount": 847.00,
  "top3_combined_pct": 49
}
```

**Safety rules:**
- Suppress if `totalSpending <= totalIncome`.
- `single_fix_category` is `null` if no single category covers the deficit alone.
- `top_category_2/3` fields are `null` if fewer than 2/3 expense categories exist.

---

### Generator 2: `generateCategorySpikes`

| Property | Value |
|---|---|
| card_type | `category_spike` |
| priority | 2 |
| icon | `TrendingUp` |

**Trigger condition:**
`deltaPercent > 20` AND `delta > $50` AND `threeMonthAvg > 0` for any expense category.

**Minimum data requirements:**
2+ prior months of data for the category (required for `threeMonthAvg` to be non-null and > 0).

**Inputs:**
- `categories[]`: `deltaPercent`, `delta`, `threeMonthAvg`, `currentMonthTotal`, `transactionCount`

**Algorithm:**
1. Filter expense categories (`isIncome = false`) where `deltaPercent > 20`, `delta > 50`, `threeMonthAvg > 0`.
2. Sort by absolute dollar delta descending.
3. Take the top 1 spike (highest dollar impact).
4. Build card with percentage and dollar figures.

**Output JSON schema (`CategorySpikeData`):**
```json
{
  "category_name": "Dining",
  "this_month_amount": 847.00,
  "avg_prior_3_months": 504.00,
  "pct_increase": 68,
  "delta_dollars": 343.00,
  "transaction_count": 23,
  "months_of_history": 3
}
```

**Safety rules:**
- Return at most 1 card (top dollar-impact spike only).
- Suppress if no category meets all three threshold conditions simultaneously.
- `threeMonthAvg` must be > 0; suppress if 0 or null (no meaningful baseline).

---

### Generator 3: `generateMerchantSpikes`

| Property | Value |
|---|---|
| card_type | `merchant_spike` |
| priority | 3 |
| icon | `Store` |

**Trigger condition:**
`merchantDelta > $100` AND `merchantDeltaPct > 30%` for any merchant with prior-month data.

**Minimum data requirements:**
Prior-month data for the same merchant (`merchantDelta` must not be null).

**Inputs:**
- `merchants[]`: `merchantDelta`, `merchantDeltaPct`, `merchantTotal`, `merchantDisplay`

**Algorithm:**
1. Filter merchants where `merchantDelta > 100` AND `merchantDeltaPct > 30`.
2. Sort by `merchantDelta` descending.
3. Return 1 card for the top merchant.
4. `prior_month_total = merchantTotal - merchantDelta`.

**Output JSON schema (`MerchantSpikeData`):**
```json
{
  "merchant": "Whole Foods",
  "this_month_total": 420.00,
  "prior_month_total": 280.00,
  "delta": 140.00,
  "delta_pct": 50
}
```

**Safety rules:**
- Suppress if no merchant has both `merchantDelta > 100` AND `merchantDeltaPct > 30`.
- `merchantDelta` null → merchant suppressed (prior month data required).
- Confidence is `high` when `merchantDelta > 300`, otherwise `medium`.

---

### Generator 4: `generateLargeTransactions`

| Property | Value |
|---|---|
| card_type | `large_transaction` |
| priority | 2 |
| icon | `CreditCard` |

**Trigger condition:**
Any transaction in `largeTransactions[]` (pre-filtered to `amount > max($500, p95)`).

**Minimum data requirements:**
- At least 1 transaction in `largeTransactions[]`.
- Threshold: `max($500, frequency.largeTransactionThreshold)`.

**Inputs:**
- `largeTransactions[]`: `merchant`, `amount`, `date`, `categoryName`
- `frequency.largeTransactionThreshold`
- `monthly.totalSpending`

**Algorithm:**
1. Take top 3 from `largeTransactions[]` (already sorted by amount desc).
2. For each: compute `pct_of_monthly_spending = (amount / totalSpending) * 100`.
3. Build one card per transaction (max 3 cards total).

**Output JSON schema (`LargeTransactionData`):**
```json
{
  "merchant": "Delta Airlines",
  "amount": 1240.00,
  "date": "2026-01-14",
  "pct_of_monthly_spending": 18,
  "category_name": "Travel",
  "threshold_used": 342.00
}
```

**Safety rules:**
- Only fire if `largeTransactions[]` is non-empty.
- Maximum 3 cards from this generator (the deduplication pass will retain only 1 for display).
- Confidence is always `high` (exact transaction data).

---

### Generator 5: `generateSmallPurchaseLeaks`

| Property | Value |
|---|---|
| card_type | `small_leaks` |
| priority | 5 |
| icon | `Droplets` |

**Trigger condition:**
`smallPurchaseCount > 10` AND `smallPurchaseTotal > $150`.

**Minimum data requirements:**
`frequency.smallPurchaseCount` and `frequency.smallPurchaseTotal` populated.

**Inputs:**
- `frequency.smallPurchaseCount`, `smallPurchaseTotal`, `smallPurchaseMerchants`
- `categories[]` (fallback for top category name)
- `monthly.totalSpending`

**Algorithm:**
1. Guard: both thresholds must be exceeded.
2. Sort `smallPurchaseMerchants` by count descending. Top one = proxy for top category.
3. Compute `avg_per_transaction = smallPurchaseTotal / smallPurchaseCount`.
4. Compute `pct_of_spending = (smallPurchaseTotal / totalSpending) * 100`.

**Output JSON schema (`SmallLeaksData`):**
```json
{
  "count": 23,
  "total": 187.45,
  "avg_per_transaction": 8.15,
  "top_category": "Starbucks",
  "top_category_count": 11,
  "top_category_total": 87.00,
  "pct_of_spending": 6
}
```

**Safety rules:**
- Both `count > 10` AND `total > $150` must both be true; either alone does not trigger.
- `top_category` falls back to the highest-transaction-count expense category name if `smallPurchaseMerchants` is empty.

---

### Generator 6: `generateSubscriptionSummary`

| Property | Value |
|---|---|
| card_type | `subscription_summary` |
| priority | 4 |
| icon | `RefreshCw` |

**Trigger condition:**
`subscriptionCount >= 2`.

**Minimum data requirements:**
`SubscriptionCandidate` detection pass must have run. At least 2 non-suppressed candidates.

**Inputs:**
- `subscriptions.subscriptionCount`, `subscriptionMonthlyTotal`, `allSubscriptions`

**Algorithm:**
1. Guard: `subscriptionCount < 2` → return `[]`.
2. Sort `allSubscriptions` by `estimatedMonthlyAmount` desc.
3. Top = `most_expensive_merchant`.
4. `annualized_cost = subscriptionMonthlyTotal * 12`.
5. Confidence: `high` if 3+ candidates are `recurringConfidence = 'high'`; `medium` otherwise.

**Output JSON schema (`SubscriptionSummaryData`):**
```json
{
  "subscription_count": 7,
  "monthly_total": 142.86,
  "annualized_cost": 1714.32,
  "most_expensive_merchant": "Adobe Creative Cloud",
  "most_expensive_amount": 54.99
}
```

**Safety rules:**
- Suppress if `subscriptionCount < 2`.
- Suppressed subscriptions (`isSuppressed = true`) are excluded from all counts and totals.

---

### Generator 7: `generateNewSubscriptionAlert`

| Property | Value |
|---|---|
| card_type | `subscription_new` |
| priority | 3 |
| icon | `Bell` |

**Trigger condition:**
A `SubscriptionCandidateRecord` with `consecutiveMonths === 2` (just detected this month) AND `recurringConfidence IN ('high', 'medium')`.

**Minimum data requirements:**
`subscriptions.newSubscriptions` populated by the subscription detection pass.

**Inputs:**
- `subscriptions.newSubscriptions[]`

**Algorithm:**
1. Filter `newSubscriptions` where `consecutiveMonths === 2` and confidence is high or medium.
2. Return one card per new subscription (no cap at the generator level).
3. `annualized_cost = estimatedMonthlyAmount * 12`.
4. Confidence mirrors `recurringConfidence`.

**Output JSON schema (`SubscriptionNewData`):**
```json
{
  "merchant": "Netflix",
  "amount_per_month": 15.99,
  "months_detected": 2,
  "annualized_cost": 191.88,
  "service_category": "streaming",
  "confidence": "high"
}
```

**Safety rules:**
- Only fire for `consecutiveMonths === 2` (exactly just detected). Do not re-fire for established subscriptions.
- Low-confidence (`low`) candidates are suppressed.
- No card if `newSubscriptions` is empty.

---

### Generator 8: `generateTrialWarnings`

| Property | Value |
|---|---|
| card_type | `trial_warning` |
| priority | 2 |
| icon | `AlertCircle` |

**Trigger condition:**
A `TrialCandidate` where `alertShouldFire === true` (within 3 days of estimated billing, or no billing history).

**Minimum data requirements:**
`subscriptions.trialCandidates[]` populated. `alertShouldFire` is set by the trial detection pass.

**Inputs:**
- `subscriptions.trialCandidates[]`

**Algorithm:**
1. Filter `trialCandidates` where `alertShouldFire === true`.
2. Return one card per active trial.
3. Include `estimatedBillingDate` and `estimatedMonthlyAmount` if known (may be null).

**Output JSON schema (`TrialWarningData`):**
```json
{
  "merchant": "Adobe Creative Cloud",
  "trial_amount": 0.99,
  "charge_date": "2026-01-03",
  "estimated_billing_date": "2026-02-03",
  "estimated_monthly_amount": 54.99
}
```

**Safety rules:**
- Confidence is always `medium` (single data point; pattern is inferred).
- `estimated_billing_date` and `estimated_monthly_amount` may be `null`.
- Only fire when `alertShouldFire === true`. Do not fire for all trial candidates.

---

### Generator 9: `generateCashFlowForecast`

| Property | Value |
|---|---|
| card_type | `cash_flow_forecast` |
| priority | 4 |
| icon | `TrendingUp` or `TrendingDown` |

**Trigger condition:**
`daysElapsed >= 7` AND `isPartialMonth = true` AND `projectedMonthEnd !== null` AND `totalIncome > 0` AND `paceStatus !== 'on_track'` (projection differs from income by > 10%).

**Minimum data requirements:**
At least 1 week of transactions in the current (partial) month. `projectedMonthEnd` from monthly aggregates.

**Inputs:**
- `monthly.daysElapsed`, `daysInMonth`, `isPartialMonth`, `dailySpendingRate`, `projectedMonthEnd`, `totalIncome`

**Algorithm:**
1. Guard: `daysElapsed < 7` → suppress.
2. Guard: `!isPartialMonth` → suppress (historical months have no forecast value).
3. Guard: `projectedMonthEnd === null` → suppress.
4. Guard: `totalIncome <= 0` → suppress.
5. Determine `pace_status`:
   - `projected > income * 1.10` → `over_pace`
   - `projected < income * 0.90` → `under_pace`
   - Otherwise → `on_track`
6. Guard: `pace_status === 'on_track'` → suppress.
7. `overage_or_underage = projected - income` (negative = under-budget).

**Output JSON schema (`CashFlowForecastData`):**
```json
{
  "daily_rate": 102.59,
  "projected_spending": 3180.29,
  "total_income": 4250.00,
  "days_elapsed": 11,
  "days_remaining": 20,
  "days_in_month": 31,
  "pace_status": "under_pace",
  "overage_or_underage": -1069.71
}
```

**Safety rules:**
- Suppress for historical (complete) months. Only valid for the current partial month.
- Suppress if `daysElapsed < 7` (too little data to project reliably).
- Suppress if `paceStatus === 'on_track'` (±10% band — no actionable observation).
- Confidence is `high` if `daysElapsed >= 15`, otherwise `medium`.

---

### Generator 10: `generateFixOpportunity`

| Property | Value |
|---|---|
| card_type | `fix_opportunity` |
| priority | 1 |
| icon | `Wrench` |

**Trigger condition:**
`net < 0` AND at least one of:
- Duplicate service categories detected (`duplicateServiceCategories.length > 0`)
- Any subscription `estimatedMonthlyAmount > $50`
- Any expense category `pctOfSpending > 40%`

**Minimum data requirements:**
Net must be negative. At least one of the above sources must have data.

**Inputs:**
- `monthly.net`, `monthly.totalSpending`
- `subscriptions.duplicateServiceCategories`, `subscriptions.allSubscriptions`
- `categories[]`

**Algorithm:**
1. Guard: `net >= 0` → return `[]`.
2. Collect scenarios from 3 sources (ranked by `monthly_savings` desc), capped at 3 total:
   - **A. Duplicate services:** For each `duplicateServiceGroup`, suggest cancelling the cheapest duplicate. `monthly_savings = cheapest.estimatedMonthlyAmount`.
   - **B. Expensive subscriptions > $50:** For each non-suppressed sub > $50, suggest cancellation. `monthly_savings = estimatedMonthlyAmount`.
   - **C. Dominant category > 40%:** Suggest reducing by 25%. `monthly_savings = currentMonthTotal * 0.25`.
3. De-duplicate merchants (don't repeat a merchant across sources A and B).
4. Suppress if no scenarios collected.

**Output JSON schema (`FixOpportunityData`):**
```json
{
  "scenarios": [
    {
      "action": "Cancel duplicate streaming service",
      "merchant_or_category": "Hulu",
      "monthly_savings": 17.99,
      "annual_savings": 215.88
    },
    {
      "action": "Cancel Adobe Creative Cloud subscription",
      "merchant_or_category": "Adobe Creative Cloud",
      "monthly_savings": 54.99,
      "annual_savings": 659.88
    }
  ],
  "total_potential_monthly_savings": 72.98,
  "net": -340.22
}
```

**Safety rules:**
- Only fires when `net < 0` (not a surplus optimization card).
- Category scenario savings are estimates (flagged with "25% reduction"); not treated as certain.
- Confidence is `high` if 2+ scenarios present; `medium` if only 1.

---

## Ranking + Capping Logic (`rankAndCap`)

After all 10 generators run, `rankAndCap(cards, cap=8)` is applied:

1. **Sort** all cards by `priority` ascending (1 = highest priority → shown first).
2. **Tie-break** within same priority: sort by `confidence` (high=0, medium=1, low=2).
3. **Deduplicate** by `card_type` — keep the first (highest priority) card of each type. When a generator produces multiple cards of the same type (e.g. `large_transaction`, `subscription_new`, `trial_warning`), only one makes it to the display set.
4. **Cap** at 8 cards for display. All cards (including those beyond the cap) should be persisted to the DB before calling `rankAndCap`.

The full set is available via `runAllGenerators(metrics)`:
```typescript
const { all, display } = runAllGenerators(metrics)
// all   — persist to DB
// display — send to client (max 8, ranked, deduped)
```

---

## Type System (`src/lib/insights/types.ts`)

### `ComputedInsightMetrics` (input bundle)

The single object passed to all generator functions, assembled by the data computation pass (separate module):

```typescript
interface ComputedInsightMetrics {
  monthly:       MonthlyAggregates
  categories:    CategoryMetrics[]
  merchants:     MerchantMetrics[]
  largeTransactions: LargeTransaction[]
  frequency:     FrequencyMetrics
  subscriptions: SubscriptionMetrics
}
```

### `InsightCard` (output)

```typescript
interface InsightCard {
  id: string                        // randomUUID()
  card_type: CardType               // one of 10 literal types
  priority: number                  // 1–10
  title: string                     // max 60 chars
  summary: string                   // 1–2 sentences with numbers
  supporting_data: InsightSupportingData  // typed per card_type
  actions: InsightCardAction[]      // 1–3 actions, always includes Dismiss
  confidence: ConfidenceLevel       // 'high' | 'medium' | 'low'
  icon_suggestion: string           // lucide-react icon name
  generated_at: string              // ISO 8601
  month: number
  year: number
}
```

### Supporting data shapes

One interface per `CardType`:

| CardType | Interface |
|---|---|
| `over_budget` | `OverBudgetData` |
| `category_spike` | `CategorySpikeData` |
| `merchant_spike` | `MerchantSpikeData` |
| `large_transaction` | `LargeTransactionData` |
| `small_leaks` | `SmallLeaksData` |
| `subscription_summary` | `SubscriptionSummaryData` |
| `subscription_new` | `SubscriptionNewData` |
| `trial_warning` | `TrialWarningData` |
| `cash_flow_forecast` | `CashFlowForecastData` |
| `fix_opportunity` | `FixOpportunityData` |

---

## Files Created This Turn

| File | Purpose |
|---|---|
| `src/lib/insights/types.ts` | All TypeScript interfaces: `InsightCard`, `CardType`, `ComputedInsightMetrics`, 10 supporting data shapes, all sub-interfaces |
| `src/lib/insights/generators.ts` | All 10 generator functions, `rankAndCap`, `runAllGenerators` |
| `docs/ai-insights-turn3-generators.md` | This specification document |

## TypeScript Status

`npx tsc --noEmit` — zero errors on first run.

---

## Notes for Turn 4

Turn 4 should implement the subscription detection pass that populates `subscriptions.allSubscriptions`, `subscriptions.newSubscriptions`, and `subscriptions.trialCandidates`. These are required inputs for Generators 6, 7, 8, and 10.

The `largeTransactions[]` field in `ComputedInsightMetrics` must also be assembled by the computation pass (a pre-filtered, sorted list of transactions above the `largeTransactionThreshold`).
