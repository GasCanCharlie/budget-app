# BudgetLens AI Insights — Turn 1 Product Spec + UX

**Status:** Turn 1 of 6 — Product Spec + UX
**Date:** 2026-03-04
**Scope:** Full product, UX, and component spec for the AI Insights feature

---

## Table of Contents

1. [Feature Overview](#1-feature-overview)
2. [When AI Runs](#2-when-ai-runs)
3. [Where It Appears](#3-where-it-appears)
4. [Insight Card Schema](#4-insight-card-schema)
5. [The 10 Card Types](#5-the-10-card-types)
6. [Tone Guidelines](#6-tone-guidelines)
7. [Example Card Text Patterns](#7-example-card-text-patterns)
8. [InsightCard React Component Spec](#8-insightcard-react-component-spec)
9. [AiInsightsPanel React Component Spec](#9-aiinsightspanel-react-component-spec)
10. [AskAI Chat Drawer Spec](#10-askai-chat-drawer-spec)
11. [API Contract](#11-api-contract)
12. [Data Privacy Rules](#12-data-privacy-rules)
13. [Structured Data Sources (no raw text to AI)](#13-structured-data-sources-no-raw-text-to-ai)

---

## 1. Feature Overview

AI Insights replaces the existing `InsightPanel` (a simple bullet-list component) with a structured card system. Each card represents a single, specific financial observation backed by real numbers drawn from the current month's committed transaction data.

The system operates in two modes:

- **Auto-run**: Triggered automatically when the user commits a staging upload (i.e., after categorization is complete and transactions are written to the ledger).
- **On-demand**: The user can click "Refresh Insights" on the Dashboard to regenerate cards for the selected month.

The AI never receives raw transaction descriptions. It receives only structured numeric summaries and category names. All insight generation logic runs server-side.

---

## 2. When AI Runs

### 2.1 Automatic Trigger

The AI Insights pipeline runs automatically when a `StagingUpload` is committed. This is the moment `StagingUpload.status` transitions from `ready` to `committed`. The trigger happens server-side, inside the commit API handler (`POST /api/staging/[id]/commit` or equivalent), after the DB write succeeds.

Steps:
1. User completes categorization on `/categorize`.
2. User clicks "Commit to Ledger" (or equivalent confirm action).
3. Server commits the staging transactions to the `transactions` table.
4. Server enqueues an insights generation job for `(userId, year, month)` derived from the committed transactions.
5. Insights job runs asynchronously — the commit response does not block on it.
6. Dashboard polls or receives a signal when insights are ready.

### 2.2 On-Demand Trigger

A "Refresh Insights" button appears in the `AiInsightsPanel` header on the Dashboard. Clicking it:
1. Fires `POST /api/insights/generate` with `{ year, month }`.
2. Invalidates the `['insights', year, month]` React Query cache key.
3. The panel shows a loading skeleton while the request is in-flight.

### 2.3 Scope: Per Selected Month

Insights are always scoped to the month currently selected in the Dashboard month navigator (`year` + `month` state in `DashboardPage`). Switching months refetches from cache or generates fresh insights.

### 2.4 Prerequisite: Categorization Complete

Insights are only generated when `dashboardState === 'analysis_unlocked'` for the selected month. If any transactions are uncategorized, the insights panel renders a soft prompt: "Finish categorizing this month to generate AI insights."

---

## 3. Where It Appears

### 3.1 Dashboard Placement

The `AiInsightsPanel` is inserted in `DashboardPage` between the existing `InsightPanel` (Section 2) and `CategoryRanking` (Section 3). The existing `InsightPanel` component is replaced by `AiInsightsPanel` — it is not kept alongside.

Dashboard section order after this feature:
1. `FinancialSummaryHeader`
2. Anomaly Alerts (existing)
3. **`AiInsightsPanel`** (new — replaces old `InsightPanel`)
4. `CategoryRanking`
5. `FinancialControlPanel`
6. `TrendChart`
7. `TopTransactions`

### 3.2 AiInsightsPanel Layout

```
┌─────────────────────────────────────────────────────────┐
│  [Sparkles icon]  AI Insights       [Refresh] [Collapse]│
│  Powered by structured financial data · Jan 2026        │
├─────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  Card 1      │  │  Card 2      │  │  Card 3      │  │
│  │  (priority 1)│  │  (priority 2)│  │  (priority 3)│  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│  ┌──────────────┐  ┌──────────────┐                     │
│  │  Card 4      │  │  Card 5      │   [Show more v]     │
│  └──────────────┘  └──────────────┘                     │
└─────────────────────────────────────────────────────────┘
```

- Cards are displayed in a responsive grid: 1 column on mobile, 2 columns on tablet, 3 columns on desktop.
- Default view shows the top 3 cards (highest priority).
- "Show more" expands to show all cards (up to 8 max).
- The panel is collapsible — clicking the collapse chevron hides all cards but keeps the header visible. Collapsed state is persisted in `localStorage`.
- A loading skeleton replaces the grid while insights are being generated.

### 3.3 Ask AI Floating Button

A floating action button (FAB) appears in the bottom-right corner of the Dashboard page when `dashboardState === 'analysis_unlocked'`. It is positioned above the mobile bottom nav bar (z-index above nav, below modals).

```
                              ┌──────────────┐
                              │ 💬 Ask AI    │
                              └──────────────┘
```

Clicking the FAB opens the `AskAiDrawer` (a right-side slide-in panel on desktop, full-screen bottom sheet on mobile).

---

## 4. Insight Card Schema

Every insight card is a typed object. This schema is the canonical contract between the server-side insight generator and the client-side `InsightCard` component.

```typescript
type CardType =
  | 'category_spike'
  | 'large_transaction'
  | 'subscription_detected'
  | 'trial_warning'
  | 'fix_opportunity'
  | 'savings_rate'
  | 'income_change'
  | 'category_concentration'
  | 'merchant_frequency'
  | 'month_over_month'

type ConfidenceLevel = 'high' | 'medium' | 'low'

interface InsightCardAction {
  label: string           // e.g. "View transactions", "Set reminder", "Dismiss"
  action_key: string      // e.g. "view_transactions", "set_reminder", "dismiss"
  href?: string           // optional navigation target (relative URL)
}

interface InsightCard {
  id: string                         // uuid, stable for this generation run
  card_type: CardType
  priority: number                   // 1 (highest) to 10 (lowest), used for ranking
  title: string                      // max 60 characters
  summary: string                    // 1–2 sentences, neutral language, cites numbers
  supporting_data: Record<string, number | string | null>
  actions: InsightCardAction[]       // 1–3 actions per card
  confidence: ConfidenceLevel
  icon_suggestion: string            // lucide-react icon name, e.g. "TrendingUp"
  generated_at: string               // ISO 8601 timestamp
  month: number                      // 1–12
  year: number
}
```

### 4.1 Field Rules

| Field | Rule |
|---|---|
| `id` | Server-generated UUID. Stable within a generation run; changes on regeneration. |
| `card_type` | Must be one of the 10 defined types. No ad-hoc types. |
| `priority` | Lower number = shown first. Two cards may share the same priority; tie-break by `card_type` alphabetically. |
| `title` | Max 60 characters. No punctuation at end except `?`. No emoji in title. |
| `summary` | 1–2 sentences. Must cite at least one number. Must not use prohibited words (see section 6). |
| `supporting_data` | All numbers cited in `summary` must also appear here. Keys are snake_case strings. Values are raw numbers (not formatted strings) or ISO date strings. |
| `actions` | At minimum always include a "Dismiss" action. Max 3 actions total. |
| `confidence` | `high` = derived from 3+ months of data or exact match. `medium` = 1–2 months of data. `low` = single data point or inferred pattern. |
| `icon_suggestion` | Must be a valid lucide-react v0.263+ icon name. |

---

## 5. The 10 Card Types

### 5.1 `category_spike`
A category's spending this month is notably higher than the prior 3-month average.
**Minimum data required:** At least 2 prior months with data for the same category.
**Priority range:** 1–3 (high urgency, actionable).
**`supporting_data` keys:** `category_name`, `this_month_amount`, `avg_prior_3_months`, `pct_increase`, `transaction_count`.

### 5.2 `large_transaction`
A single transaction is notably large — either by absolute amount or relative to typical single transactions.
**Minimum data required:** At least 5 categorized transactions in the month.
**Priority range:** 2–4.
**`supporting_data` keys:** `merchant`, `amount`, `category_name`, `date`, `pct_of_monthly_spending`.

### 5.3 `subscription_detected`
A vendor appears to charge a recurring fixed amount monthly (detected from 2+ identical or near-identical charges across months).
**Minimum data required:** Same vendor + amount appearing in at least 2 consecutive or recent months.
**Priority range:** 3–5.
**`supporting_data` keys:** `merchant`, `amount_per_month`, `months_detected`, `annualized_cost`.

### 5.4 `trial_warning`
A subscription-like charge appears for the first time with no history — potential trial period that may convert to full price.
**Minimum data required:** Vendor appears in current month but not in any prior 3 months.
**Priority range:** 2–4.
**`supporting_data` keys:** `merchant`, `amount`, `category_name`, `first_seen_date`.

### 5.5 `fix_opportunity`
A transaction pattern suggests a potential data fix: a transfer that may be miscategorized, a possible duplicate, or an excluded transaction that looks like regular spending.
**Minimum data required:** At least one transaction matching the fix pattern.
**Priority range:** 1–3.
**`supporting_data` keys:** `issue_type`, `transaction_count`, `total_amount`, `category_name`.

### 5.6 `savings_rate`
Summary observation about spending-to-income ratio for the month, compared to prior months.
**Minimum data required:** Income > 0 for the month.
**Priority range:** 4–6.
**`supporting_data` keys:** `total_income`, `total_spending`, `net`, `savings_rate_pct`, `prior_avg_savings_rate_pct`.

### 5.7 `income_change`
Income this month is notably different from the prior 3-month average.
**Minimum data required:** Income data in at least 2 months.
**Priority range:** 2–4.
**`supporting_data` keys:** `this_month_income`, `avg_prior_3_months_income`, `pct_change`.

### 5.8 `category_concentration`
The top 1–3 categories represent an unusually high share of total spending.
**Minimum data required:** At least 3 spending categories with totals.
**Priority range:** 5–7.
**`supporting_data` keys:** `top_category_name`, `top_category_pct`, `top_3_pct`, `category_count`.

### 5.9 `merchant_frequency`
A single merchant appears many times in the month, representing a notable share of total transactions.
**Minimum data required:** At least 1 merchant appearing 3+ times.
**Priority range:** 6–8.
**`supporting_data` keys:** `merchant`, `transaction_count`, `total_amount`, `pct_of_spending`.

### 5.10 `month_over_month`
Total spending or net changed notably from the prior month.
**Minimum data required:** Prior month data exists.
**Priority range:** 4–6.
**`supporting_data` keys:** `this_month_spending`, `prior_month_spending`, `pct_change`, `direction` (`'increase'` or `'decrease'`).

---

## 6. Tone Guidelines

### 6.1 Core Principles

- **Neutral financial language only.** Describe what the data shows, not what the user should feel about it.
- **No moral judgment.** The app does not evaluate the quality of the user's choices.
- **Always cite the actual number.** Every observation must be grounded in a specific figure.
- **If data is insufficient:** State it explicitly. Do not extrapolate or guess. Use the phrase "Insufficient data to generate this insight."
- **Passive or descriptive voice preferred over imperative.** "Spending in Dining increased" rather than "You overspent on dining."

### 6.2 Prohibited Words and Substitutions

| Prohibited | Use instead |
|---|---|
| "too much" | "notably higher", "increased" |
| "wasteful" | (remove entirely; describe the amount only) |
| "bad" | (remove entirely; describe the change only) |
| "problem" | "pattern worth reviewing", "notable item" |
| "excessive" | "higher than usual", "notably higher than average" |
| "overspent" | "spending exceeded income", "spending increased" |
| "you should" | "one option is", "this month's data shows" |
| "alarming" | "notable", "higher than the prior 3-month average" |

### 6.3 Required Language Patterns

- Category spike: "Spending in [category] increased [X]% compared to the prior 3-month average."
- Large transaction: "A [merchant] transaction of [amount] on [date] represents [X]% of this month's total spending."
- Subscription: "A recurring charge of [amount]/month from [merchant] has been detected across [N] months."
- Trial warning: "[merchant] appears for the first time this month at [amount]. This may be a trial or introductory charge."
- MoM change: "Total spending [increased/decreased] [X]% from [prior month] to [this month]."

### 6.4 Confidence Language

Cards with `confidence: 'low'` must include a qualifier in the summary:
- "Based on limited data, ..."
- "With [N] month(s) of history, ..."
- "This pattern is based on a single data point."

Cards with `confidence: 'high'` may omit qualifiers.

---

## 7. Example Card Text Patterns

### 7.1 Category Spike

```json
{
  "card_type": "category_spike",
  "priority": 2,
  "title": "Dining spending increased 68% this month",
  "summary": "Spending in Dining reached $847 this month, compared to a prior 3-month average of $504. This is an increase of 68%, with 23 transactions recorded.",
  "supporting_data": {
    "category_name": "Dining",
    "this_month_amount": 847,
    "avg_prior_3_months": 504,
    "pct_increase": 68,
    "transaction_count": 23
  },
  "confidence": "high",
  "icon_suggestion": "TrendingUp"
}
```

### 7.2 Large Transaction

```json
{
  "card_type": "large_transaction",
  "priority": 3,
  "title": "Single transaction: $1,240 at Delta Airlines",
  "summary": "A Delta Airlines charge of $1,240 on Jan 14 represents 18% of this month's total spending. It is the largest single transaction for January.",
  "supporting_data": {
    "merchant": "Delta Airlines",
    "amount": 1240,
    "category_name": "Travel",
    "date": "2026-01-14",
    "pct_of_monthly_spending": 18
  },
  "confidence": "high",
  "icon_suggestion": "Plane"
}
```

### 7.3 Subscription Detected

```json
{
  "card_type": "subscription_detected",
  "priority": 4,
  "title": "Recurring charge: $14.99/month from Netflix",
  "summary": "A charge of $14.99 from Netflix has appeared in 6 consecutive months, totaling $89.94 over that period. Annualized, this represents $179.88.",
  "supporting_data": {
    "merchant": "Netflix",
    "amount_per_month": 14.99,
    "months_detected": 6,
    "annualized_cost": 179.88
  },
  "confidence": "high",
  "icon_suggestion": "RefreshCw"
}
```

### 7.4 Trial Warning

```json
{
  "card_type": "trial_warning",
  "priority": 2,
  "title": "New charge: Adobe Creative Cloud — first appearance",
  "summary": "Adobe Creative Cloud appears for the first time this month at $54.99, categorized under Software. This vendor has no prior history in the last 3 months. This may be a trial or introductory charge.",
  "supporting_data": {
    "merchant": "Adobe Creative Cloud",
    "amount": 54.99,
    "category_name": "Software",
    "first_seen_date": "2026-01-03"
  },
  "confidence": "medium",
  "icon_suggestion": "AlertCircle"
}
```

### 7.5 Fix Opportunity

```json
{
  "card_type": "fix_opportunity",
  "priority": 1,
  "title": "2 possible transfer transactions in Groceries",
  "summary": "2 transactions totaling $640 in the Groceries category match the pattern of bank transfers or inter-account payments. Reviewing these may improve category accuracy.",
  "supporting_data": {
    "issue_type": "possible_transfer_miscategorized",
    "transaction_count": 2,
    "total_amount": 640,
    "category_name": "Groceries"
  },
  "confidence": "medium",
  "icon_suggestion": "Wrench"
}
```

---

## 8. InsightCard React Component Spec

### 8.1 Props Interface

```typescript
// File: src/components/dashboard/InsightCard.tsx

import type { InsightCard as InsightCardData } from '@/lib/insights/types'

interface InsightCardProps {
  card: InsightCardData
  onAction: (cardId: string, actionKey: string) => void
  isLoading?: boolean   // shows skeleton state
}
```

### 8.2 Visual Design

The card matches the existing dark glass aesthetic established in the redesign. It does not use `bg-white` or light backgrounds.

**Container:**
```
background: rgba(255, 255, 255, 0.04)
border: 1px solid rgba(255, 255, 255, 0.08)
border-radius: 16px (rounded-2xl)
padding: 16px (p-4)
box-shadow: 0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)
```

**Header row:** Icon (left) + Title (flex-1) + Confidence badge (right)

**Icon container:**
```
w-8 h-8, rounded-lg
background: rgba(110, 168, 255, 0.12)   // blue-tinted glass
border: 1px solid rgba(110, 168, 255, 0.20)
icon color: #6ea8ff
```

**Title:**
```
font-size: 13px (text-[13px])
font-weight: 600 (font-semibold)
color: #eaf0ff
line-height: 1.3
max lines: 2 (line-clamp-2)
```

**Confidence badge:**
```
high:   bg rgba(46, 229, 157, 0.12), text #2ee59d, border rgba(46,229,157,0.20)
medium: bg rgba(251, 191, 36, 0.12), text #fbbf24, border rgba(251,191,36,0.20)
low:    bg rgba(148, 163, 184, 0.10), text #8b97c3, border rgba(148,163,184,0.15)
font-size: 10px, font-weight: 600, border-radius: 9999px, padding: 2px 8px
```

**Summary text:**
```
font-size: 12px (text-xs)
color: #a8b3d6
line-height: 1.5 (leading-relaxed)
margin-top: 8px
```

**Supporting data row (optional, shown for numeric cards):**

Up to 2 key metrics displayed as pill-style stat chips below the summary:
```
background: rgba(0, 0, 0, 0.25)
border: 1px solid rgba(255, 255, 255, 0.06)
border-radius: 8px
padding: 4px 10px
label: 9px, color: #8b97c3
value: 12px, font-weight: 600, color: #eaf0ff
```

**Actions row:**
```
margin-top: 12px
display: flex, gap: 6px, flex-wrap: wrap
```

Action button styles:
```
primary action (first non-dismiss):
  background: rgba(110, 168, 255, 0.12)
  border: 1px solid rgba(110, 168, 255, 0.25)
  color: #6ea8ff
  font-size: 11px, font-weight: 500
  border-radius: 8px, padding: 5px 10px
  hover: background rgba(110, 168, 255, 0.20)

dismiss action:
  background: transparent
  color: #8b97c3
  font-size: 11px
  border-radius: 8px, padding: 5px 10px
  hover: color #c8d4f5
```

### 8.3 Skeleton State

When `isLoading={true}`, render animated shimmer placeholders matching the card layout:
- Header row: icon placeholder (w-8 h-8 rounded-lg) + title bar (w-3/4 h-3 rounded)
- Two summary lines (w-full h-2.5 rounded, w-2/3 h-2.5 rounded)
- Two action pill placeholders (w-24 h-6 rounded-lg)

Shimmer animation: `animate-pulse` with `background: rgba(255,255,255,0.06)`.

### 8.4 Full Component Anatomy (annotated)

```
┌──────────────────────────────────────┐
│ [Icon] Title text (2-line max)  [hi] │  ← header row
│                                      │
│ Summary sentence. Second sentence    │  ← summary text
│ citing $amount or X%.                │
│                                      │
│ ┌──────────────┐ ┌────────────────┐  │
│ │ label  $847  │ │ label  +68%    │  │  ← stat chips (0–2)
│ └──────────────┘ └────────────────┘  │
│                                      │
│ [View transactions] [Dismiss]        │  ← actions row
└──────────────────────────────────────┘
```

---

## 9. AiInsightsPanel React Component Spec

### 9.1 Props Interface

```typescript
// File: src/components/dashboard/AiInsightsPanel.tsx

interface AiInsightsPanelProps {
  year: number
  month: number
  // The same category/transaction data already on the Dashboard
  categories: CategoryTotal[]
  topTransactions: TopTx[]
  totalIncome: number
  totalSpending: number
  prevMonthSpending: number | null
}
```

The panel fetches its own insight data via React Query (`['insights', year, month]`). It does not receive pre-fetched card data as a prop, so the Dashboard page does not need to change its data fetching.

### 9.2 Panel Layout

**Panel container:**
```
background: rgba(255, 255, 255, 0.025)
border: 1px solid rgba(255, 255, 255, 0.07)
border-radius: 20px (rounded-[20px])
padding: 20px (p-5)
```

**Panel header:**
```
display: flex, align-items: center, justify-content: space-between
margin-bottom: 16px
```

Left side:
- Sparkles icon (16px, color #6ea8ff) in a glass icon container (w-8 h-8)
- "AI Insights" label (14px, font-semibold, color #eaf0ff)
- Subtitle: "Jan 2026 · structured data only" (11px, color #8b97c3)

Right side (button group):
- "Refresh" button: `RefreshCw` icon (14px) + "Refresh" text, ghost style
- Collapse chevron: `ChevronDown` / `ChevronUp` icon, toggles collapsed state

**Card grid:**
```
display: grid
grid-template-columns: repeat(1, 1fr)           // mobile
@md: grid-template-columns: repeat(2, 1fr)      // tablet
@lg: grid-template-columns: repeat(3, 1fr)      // desktop
gap: 12px (gap-3)
```

**Show more / Show less toggle:**
Appears only when total card count > 3. Shows remaining count: "Show 3 more".

**Empty state** (no cards generated):
```
text-center, py-8
icon: Lightbulb (24px, color #8b97c3)
text: "No insights available for this month."
subtext: "Add more transactions or complete categorization to generate insights."
```

**Not-ready state** (categorization incomplete):
```
text-center, py-6
icon: Lock (18px, color #8b97c3)
text: "Finish categorizing this month to generate AI insights."
link to /categorize
```

---

## 10. AskAI Chat Drawer Spec

### 10.1 Trigger

Floating action button (FAB) in the Dashboard page, rendered outside `<AppShell>` as a portal:

```
position: fixed
bottom: 80px   // above mobile nav bar (which is h-[64px])
right: 20px
z-index: 50
```

FAB appearance:
```
background: linear-gradient(135deg, #3b5bdb, #1e40af)
border: 1px solid rgba(110, 168, 255, 0.30)
border-radius: 28px
padding: 12px 18px
display: flex, gap: 8px, align-items: center
box-shadow: 0 4px 20px rgba(59, 91, 219, 0.40)
icon: MessageCircle (18px, color white)
label: "Ask AI" (13px, font-weight 600, color white)
```

### 10.2 Drawer Layout

Opens as a right-side drawer on desktop (400px wide), full-screen bottom sheet on mobile.

Drawer sections (top to bottom):
1. **Header bar:** "Ask AI" title + month label + X close button
2. **Context summary strip:** One-line read-only summary of the current month's key numbers (income, spending, net). Non-editable. Communicates to the user what data the AI has access to.
3. **Chat message list:** Scrollable, newest at bottom.
4. **Input row:** Text input + Send button.

### 10.3 Privacy: Structured Data Only

The AI chat function receives a structured context object, never raw text from the database. This is enforced server-side.

The context object passed to the AI for each chat turn:

```typescript
interface AiChatContext {
  month: number
  year: number
  totalIncome: number
  totalSpending: number
  net: number
  savingsRatePct: number
  categoryTotals: Array<{
    name: string
    total: number
    pctOfSpending: number
    transactionCount: number
  }>
  topMerchants: Array<{
    merchantNormalized: string    // normalized vendor name only, never raw description
    totalAmount: number
    transactionCount: number
  }>
  // Month-over-month deltas only — no prior month detail
  momSpendingPctChange: number | null
  momIncomePctChange: number | null
}
```

The raw `description` field from the `transactions` table is never included. `merchantNormalized` (already cleaned) is acceptable.

### 10.4 Chat Behavior

- User messages are plain text questions about their finances.
- Server constructs the prompt from `AiChatContext` + user question. Context is injected as a system prompt prefix.
- AI response is streamed to the client.
- Maximum conversation length: 10 turns. After 10 turns, a "Start a new conversation" prompt replaces the input.
- "Insufficient data" responses are shown inline as assistant messages, not as error toasts.

---

## 11. API Contract

### 11.1 Generate Insights

```
POST /api/insights/generate
Body: { year: number, month: number }
Auth: required (session cookie)
Response 200: { cards: InsightCard[], generatedAt: string }
Response 202: { status: 'queued' }   // if async via job queue
Response 400: { error: 'categorization_incomplete' }
```

### 11.2 Get Insights (cached)

```
GET /api/insights?year=2026&month=1
Auth: required
Response 200: { cards: InsightCard[], generatedAt: string, isStale: boolean }
Response 404: { error: 'not_found' }   // no insights yet for this month
```

### 11.3 Dismiss a Card

```
PATCH /api/insights/[cardId]/dismiss
Auth: required
Response 200: { ok: true }
```

Dismissed cards are stored in the `ai_insights` table (new, see below) with `isDismissed: true`. They are excluded from `GET /api/insights` responses.

### 11.4 AI Chat

```
POST /api/insights/chat
Body: {
  year: number,
  month: number,
  messages: Array<{ role: 'user' | 'assistant', content: string }>
}
Auth: required
Response: streaming text/event-stream
```

---

## 12. Data Privacy Rules

These rules are non-negotiable and must be enforced server-side in the insight generator and chat handler:

1. **No raw transaction descriptions to AI.** Only `merchantNormalized` (pre-cleaned string) and aggregated totals are permitted.
2. **No transaction IDs in AI context.** The AI never sees database IDs.
3. **No user PII in prompts.** No email, no name, no account names.
4. **Category names are safe.** They are user-defined labels, not sensitive data.
5. **Merchant names are safe in context.** `merchantNormalized` is already stripped of bank-specific prefixes.
6. **AI responses must not be stored in the database verbatim** unless the user explicitly saves them. Chat history lives in client state only (React state) within a session.

---

## 13. Structured Data Sources (no raw text to AI)

The following fields from the Prisma schema are permitted for use in insight generation and AI chat context. All other fields are excluded.

**From `MonthSummary`:**
- `totalIncome`, `totalSpending`, `net`, `transactionCount`, `isPartialMonth`

**From `MonthCategoryTotal`:**
- `total`, `transactionCount`, `pctOfSpending`
- `Category.name`, `Category.isIncome`, `Category.isTransfer`

**From `Transaction` (aggregated only, never individual rows to AI):**
- `amount` (aggregated: sum, max, min, count — not individual rows)
- `merchantNormalized` (for merchant frequency analysis — aggregated by merchant)
- `date` (for monthly bucketing only)
- `categoryId` (for category grouping)

**From `Transaction` (for fix_opportunity cards only, no AI — rule-based detection):**
- `isTransfer`, `isDuplicate`, `isExcluded`, `ingestionStatus`, `categorizationSource`

**Never permitted in AI context:**
- `description`, `descriptionRaw`, `descriptionNormalized`
- `rawAmount`, `amountRaw`
- `bankTransactionId`, `bankFingerprint`
- `id` (any database ID)
- `userId`, `accountId`, `uploadId`
- Any field from `TransactionRaw`

---

## Summary of New Files This Feature Requires

| File | Purpose |
|---|---|
| `src/lib/insights/types.ts` | `InsightCard`, `InsightCardAction`, `AiChatContext` type definitions |
| `src/lib/insights/generator.ts` | Server-side insight generation logic (rule-based, no AI for card gen) |
| `src/lib/insights/chat-context.ts` | Builds `AiChatContext` from DB query results |
| `src/app/api/insights/generate/route.ts` | POST endpoint to trigger generation |
| `src/app/api/insights/route.ts` | GET endpoint to fetch cached cards |
| `src/app/api/insights/[cardId]/dismiss/route.ts` | PATCH dismiss |
| `src/app/api/insights/chat/route.ts` | POST streaming chat |
| `src/components/dashboard/InsightCard.tsx` | Single card component |
| `src/components/dashboard/AiInsightsPanel.tsx` | Panel with grid, collapse, refresh |
| `src/components/dashboard/AskAiDrawer.tsx` | Chat drawer + FAB |
| `prisma/migrations/YYYYMMDD_ai_insights/migration.sql` | New `ai_insights` table |

The existing `src/components/dashboard/InsightPanel.tsx` is replaced by `AiInsightsPanel.tsx`. The old file can be deleted after the new panel is wired into `DashboardPage`.
