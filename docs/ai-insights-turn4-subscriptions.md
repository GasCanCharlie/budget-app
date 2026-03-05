# Turn 4 — Subscription & Free Trial Early Warning Module

**File**: `src/lib/intelligence/subscriptions.ts`
**Turn**: 4 of 6 (AI Collab — BudgetLens Intelligence Engine)
**Date**: 2026-03-04

---

## Overview

This module detects recurring subscriptions, free trials about to convert, price
increases on existing subscriptions, and duplicate services across categories from
a user's transaction history. It operates entirely on the existing `Transaction`
table via Prisma — no schema changes required.

---

## 1. Detection Rules & Heuristics

### 1.1 Recurring Subscription Detection

Two rules must fire before a merchant is classified as a subscription candidate.
**At least one rule must pass per pair of months** before scoring begins.

| Rule | Description |
|------|-------------|
| Amount rule | Same `merchantNormalized` + amount within **±5%** appears in **2+ distinct months** |
| Day-of-month rule | Same `merchantNormalized` charges on a similar day-of-month (**±3 days** SD) across **2+ months** |

A merchant is rejected if neither rule passes across any consecutive month pair.

### 1.2 Confidence Classification

| Level | Criteria |
|-------|----------|
| **HIGH** | 3+ months, subscriptionScore ≥ 65, same amount, day SD ≤ 2 |
| **MEDIUM** | 2 months, same amount OR day SD ≤ 5 |
| **LOW** | 2 months, amount within ±5%, or any remaining passing case |

### 1.3 Free Trial Detection

A transaction is flagged as a potential trial if **either** condition holds:

1. **Amount qualifies**: `amount = $0.00` or `$0.99 – $1.99` (auth charge range) **and** the
   merchant has not appeared in the user's history before the 12-month lookback window.
2. **Keyword match**: merchant name or description contains any of:
   `trial`, `free`, `30day`, `14day`, `7day`, `freetrial`, `free trial`

#### Trial duration estimation

| Keyword found | Estimated trial days |
|---------------|---------------------|
| `7day`, `7 day`, `week` | 7 days |
| `14day`, `14 day`, `two week` | 14 days |
| (default / `30day`) | 30 days |

**Alert fires**: when `today` is within **3 days** of `trialDate + estimatedDays`.

### 1.4 Trial-to-Paid Conversion Detection

- **Rule**: within **45 days** of a trial charge, same merchant charges `> $4.99`
- **Effect**: trial `status` is set to `"converted"` and a conversion alert card is generated

### 1.5 Price Increase Detection

- **Rule**: for a confirmed recurring merchant, if the **latest month's charge** is
  more than **5% above the prior months' mean**, a `PriceIncreaseInfo` object is attached
  and the alert type switches to `price_increase`
- **Output**: shows old amount, new amount, and delta percentage

### 1.6 Duplicate Service Detection

- **Rule**: 2+ active subscriptions classified into the **same service category** flag as duplicates
- **Categories checked**: Video Streaming, Music, Cloud Storage, News/Magazine, Gaming,
  Fitness, Software/Productivity
- Category assignment uses keyword matching on `merchantNormalized` (case-insensitive substring)

---

## 2. Scoring System — `subscriptionScore` (0–100)

The composite score weights four independent signals:

| Component | Weight | Description |
|-----------|--------|-------------|
| Recurrence frequency | 40 pts | Number of months with a charge (1=0, 2=20, 3=30, 4=35, 5+=40) |
| Amount consistency | 30 pts | Coefficient of variation of monthly amounts; CV ≤ 0.02 → 30 pts, degrades linearly to CV = 0.10 → 0 pts |
| Day-of-month consistency | 20 pts | Standard deviation of day-of-month; SD ≤ 0 → 20 pts, degrades linearly to SD = 5 → 0 pts |
| Merchant name signals | 10 pts | 4 pts per keyword found in merchant name; keywords: `premium`, `pro`, `plus`, `subscription`, `monthly`, `annual`; capped at 10 |

**Score interpretation**:
- 0–39: Unlikely subscription
- 40–64: Possible subscription (LOW confidence)
- 65–84: Probable subscription (MEDIUM/HIGH confidence)
- 85–100: Strong subscription signal (HIGH confidence)

---

## 3. TypeScript API

### Main function

```typescript
export async function detectSubscriptions(
  userId: string,
  year: number,
  month: number,
): Promise<SubscriptionInsight>
```

Fetches 12 months of expense transactions for the user (ending at `year/month`),
then runs subscription detection, trial detection, and duplicate detection.
Returns a `SubscriptionInsight` object containing all results.

### Key interfaces

```typescript
interface SubscriptionInsight {
  subscriptions:   SubscriptionCandidate[]
  trials:          TrialCandidate[]
  duplicateAlerts: DuplicateServiceAlert[]
  asOf:            string  // ISO date — the "today" reference used for trial windows
}

interface SubscriptionCandidate {
  merchantNormalized: string
  typicalAmount:      number          // mean monthly amount
  latestAmount:       number          // most recent charge
  confidence:         'HIGH' | 'MEDIUM' | 'LOW'
  subscriptionScore:  number          // 0–100
  occurrenceDates:    string[]        // ISO date per occurrence
  activeMonths:       string[]        // e.g. ["2025-01", "2025-02"]
  priceIncrease?:     PriceIncreaseInfo
  serviceCategory?:   ServiceCategory
  isDuplicate:        boolean
  alert:              SubscriptionAlertCard
}

interface TrialCandidate {
  merchantNormalized:    string
  trialDate:             string   // ISO date of the trial charge
  trialAmount:           number
  estimatedTrialDays:    number
  estimatedBillingDate:  string   // ISO date
  alertActive:           boolean  // true when ≤ 3 days until billing
  status:                'pending' | 'converted' | 'expired'
  conversionAmount?:     number
  conversionDate?:       string
  alert:                 TrialAlertCard | ConversionAlertCard
}
```

### Helper functions (exported for testing)

```typescript
// Produces a 0–100 score from an array of transactions for a single merchant
function scoreRecurrence(transactions: RawTransaction[]): number

// Scans transactions for trial signals and conversion events
function detectTrials(
  transactions: RawTransaction[],
  knownMerchants: Set<string>,
  asOf: Date,
): TrialCandidate[]

// Groups subscriptions by service category and flags duplicates
function detectDuplicateServices(
  subscriptions: SubscriptionCandidate[],
): DuplicateServiceAlert[]
```

---

## 4. Alert Card Templates

### 4.1 New Subscription Detected

```
title:   "New subscription detected"
summary: "New recurring charge from {merchant} (${amount}/mo) detected starting {month}."
```

**Example**: `"New recurring charge from Spotify ($9.99/mo) detected starting Jan 2025."`

### 4.2 Trial Warning (≤ 3 days before billing)

```
title:   "Free trial ending soon"
summary: "Free trial from {merchant} likely converts to ${estimated_amount}/mo around {date}. Review before then."
```

**Example**: `"Free trial from Netflix likely converts to $15.49/mo around Mar 15, 2025. Review before then."`

When the estimated amount is unknown (no prior full charge found):

```
summary: "Free trial from {merchant} likely converts to a recurring charge around {date}. Review before then."
```

### 4.3 Trial Converted

```
title:   "Free trial converted"
summary: "{merchant} free trial converted to paid subscription (${amount}/mo) on {date}."
```

**Example**: `"Hulu free trial converted to paid subscription ($7.99/mo) on Feb 3, 2025."`

### 4.4 Price Increase

```
title:   "Subscription price increase"
summary: "{merchant} subscription increased from ${old} to ${new}/mo (+{pct}%)."
```

**Example**: `"YouTube Premium subscription increased from $13.99 to $17.99/mo (+28.6%)."`

### 4.5 Duplicate Services

```
title:   "Duplicate {category} subscriptions"
summary: "You have {count} active {category} subscriptions ({list}) totaling ${total}/mo."
```

**Example**: `"You have 3 active Video Streaming subscriptions (Netflix, Hulu, Disney+) totaling $38.47/mo."`

---

## 5. User Actions per Alert Type

### New Subscription Detected
| Action label | actionKey |
|-------------|-----------|
| View transactions | `view_transactions` |
| Mark as not a subscription | `dismiss_subscription` |
| Hide merchant | `hide_merchant` |

### Trial Warning
| Action label | actionKey | Notes |
|-------------|-----------|-------|
| Set reminder for {date} | `set_reminder` | `actionDate` set to ISO billing date |
| View transactions | `view_transactions` | |
| Mark as not a trial | `dismiss_trial` | |

### Trial Converted
| Action label | actionKey |
|-------------|-----------|
| View transactions | `view_transactions` |
| Mark as not a subscription | `dismiss_subscription` |
| Hide merchant | `hide_merchant` |

### Price Increase
| Action label | actionKey |
|-------------|-----------|
| View transactions | `view_transactions` |
| Mark as expected | `acknowledge_price_change` |
| Hide merchant | `hide_merchant` |

### Duplicate Services
| Action label | actionKey | Notes |
|-------------|-----------|-------|
| View transactions | `view_transactions` | |
| Cancel {merchant} | `cancel_subscription` | One entry per subscription in the group |

---

## 6. Service Category Keyword Map

Merchant names are matched case-insensitively using substring search.

| Category | Sample keywords |
|----------|----------------|
| Video Streaming | netflix, hulu, disney, hbo, max, peacock, paramount, apple tv, amazon prime, youtube premium, crunchyroll, fubo, sling |
| Music | spotify, apple music, tidal, deezer, pandora, amazon music, youtube music, soundcloud |
| Cloud Storage | icloud, dropbox, google one, onedrive, backblaze, carbonite |
| News/Magazine | nytimes, washington post, wsj, bloomberg, the atlantic, wired, medium, substack, patreon |
| Gaming | xbox game pass, playstation plus, nintendo, ea play, steam, epic games, twitch, humble bundle, ubisoft |
| Fitness | peloton, noom, myfitnesspal, strava, calm, headspace, whoop, beachbody |
| Software/Productivity | adobe, microsoft 365, office 365, google workspace, notion, slack, zoom, lastpass, 1password, canva, grammarly, figma, github |

---

## 7. Prisma Query Patterns Used

Consistent with `summaries.ts`:

```typescript
// Main expense transaction fetch
await prisma.transaction.findMany({
  where: {
    account: { userId },
    date:    { gte: windowStart, lte: windowEnd },
    isExcluded:       false,
    isTransfer:       false,
    isDuplicate:      false,
    isForeignCurrency: false,
    amount:           { lt: 0 },
  },
  select: { id, date, description, merchantNormalized, amount },
  orderBy: { date: 'asc' },
})

// Historical merchant lookup (for "new merchant" trial detection)
await prisma.transaction.findMany({
  where: {
    account:            { userId },
    date:               { lt: windowStart },
    isExcluded:         false,
    amount:             { lt: 0 },
    merchantNormalized: { not: '' },
  },
  select:   { merchantNormalized: true },
  distinct: ['merchantNormalized'],
})
```

---

## 8. Design Decisions

| Decision | Rationale |
|----------|-----------|
| 12-month lookback window | Captures annual subscriptions (e.g., yearly plans charged once a year) while keeping the dataset manageable |
| Median per-month amount | Handles months where a merchant charged multiple times (e.g., overage + base) without inflating the typical amount |
| Expense-only (`amount < 0`) | Income credits and refunds are excluded from subscription analysis |
| `knownMerchants` set from pre-window history | Allows reliable "first time we've ever seen this merchant" detection for trial flagging, independent of the current window |
| `isDuplicate` mutated in-place | `detectDuplicateServices` marks each `SubscriptionCandidate` as a duplicate after grouping — callers can render the flag without re-running logic |
| Alert cards embedded in each candidate | Enables the frontend to render alerts directly from the insight result without a separate templating pass |

---

## 9. Integration Example

```typescript
import { detectSubscriptions } from '@/lib/intelligence/subscriptions'

// In a Next.js API route or Server Component:
const insight = await detectSubscriptions(userId, 2025, 3)

// High-confidence subscriptions only
const highConfidence = insight.subscriptions.filter(s => s.confidence === 'HIGH')

// Active trial warnings (alert window firing)
const activeWarnings = insight.trials.filter(t => t.alertActive)

// Duplicate service alerts
const duplicates = insight.duplicateAlerts
```

---

*Generated by AI Collab Turn 4. Part of the BudgetLens Intelligence Engine.*
