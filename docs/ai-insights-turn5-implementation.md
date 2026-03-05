# AI Insights — Turn 5: Implementation Plan + Acceptance Tests

**Turn**: 5 of 6 (AI Collab — BudgetLens Intelligence Engine)
**Date**: 2026-03-04
**Scope**: Concrete implementation plan, exact Prisma schema additions, build order, computation locations, caching strategy, hallucination-prevention rules, and acceptance tests

---

## Table of Contents

1. [Migration Plan — Prisma Schema Additions](#1-migration-plan--prisma-schema-additions)
2. [Build Order (Step-by-Step)](#2-build-order-step-by-step)
3. [Where Computations Happen](#3-where-computations-happen)
4. [Caching Strategy](#4-caching-strategy)
5. [Hallucination Prevention](#5-hallucination-prevention)
6. [Acceptance Tests](#6-acceptance-tests)
7. [Error Handling Rules](#7-error-handling-rules)

---

## 1. Migration Plan — Prisma Schema Additions

Add the following two model blocks to `prisma/schema.prisma`, and add the two relation fields to the existing `User` model.

### 1.1 InsightCard model

```prisma
// ─── InsightCard ───────────────────────────────────────────────────────────────
// One row per insight type per (user, year, month). Regenerated on each compute
// pass; isDismissed is sticky and survives regeneration via upsert.
//
// cardType values (from Turn 1 canonical spec):
//   category_spike | large_transaction | subscription_detected | trial_warning |
//   fix_opportunity | savings_rate | income_change | category_concentration |
//   merchant_frequency | month_over_month
//
// confidence values: high | medium | low
model InsightCard {
  id            String   @id @default(cuid())
  userId        String
  year          Int
  month         Int

  // One of the 10 canonical cardType values defined in src/lib/insights/types.ts
  cardType      String

  // Lower number = shown first in UI (1 = highest urgency)
  priority      Int

  title         String   // max 60 characters
  summary       String   // 1-2 sentences, must cite at least one number

  // Computed numbers backing this card — shape is cardType-specific.
  // See InsightSupportingData union type in src/lib/insights/types.ts.
  supportingData Json

  // Array of { label: string, action_key: string, href?: string } objects
  actions       Json

  // high | medium | low
  confidence    String

  // lucide-react icon name suggestion, e.g. "TrendingUp"
  iconSuggestion String   @default("Lightbulb")

  isDismissed   Boolean  @default(false)
  generatedAt   DateTime @default(now())

  user          User     @relation(fields: [userId], references: [id])

  // One card per type per month. Upsert on regeneration preserves isDismissed.
  @@unique([userId, year, month, cardType])
  @@index([userId, year, month, isDismissed])
  @@map("insight_cards")
}
```

### 1.2 SubscriptionCandidate model

```prisma
// ─── SubscriptionCandidate ────────────────────────────────────────────────────
// A merchant that appears to be a recurring charge. Written by the subscription
// detection pass (src/lib/intelligence/subscriptions.ts) and referenced by
// subscription_detected and trial_warning InsightCards.
//
// Re-evaluated monthly. isConfirmedByUser and isSuppressed persist across
// regenerations and survive upsert.
//
// recurrencePattern values: monthly | weekly | annual | irregular
// recurringConfidence values: high | medium | low
// serviceCategory values: streaming | music | software | fitness |
//                          news | cloud | gaming | finance | other
model SubscriptionCandidate {
  id                     String   @id @default(cuid())
  userId                 String

  // Normalized vendor identifier — matches Transaction.merchantNormalized
  merchantNormalized     String

  // Human-readable display name (derived from first seen raw description, trimmed)
  merchantDisplay        String

  // Estimated monthly amount in dollars (mean of matched charges)
  estimatedMonthlyAmount Float

  // Recurrence pattern: monthly | weekly | annual | irregular
  recurrencePattern      String   @default("monthly")

  // Number of consecutive months this charge appeared
  consecutiveMonths      Int      @default(0)

  // Dates of observed charges — JSON array of ISO date strings
  observedDates          Json

  // Predicted date of next charge (null if pattern is irregular)
  estimatedNextCharge    DateTime?

  // Composite subscription score 0–100 (from Turn 4 scoring system)
  subscriptionScore      Int      @default(0)

  // high | medium | low
  recurringConfidence    String

  // true = user has explicitly confirmed this is a subscription
  isConfirmedByUser      Boolean  @default(false)

  // true = user marked this as NOT a subscription (suppress future detection)
  isSuppressed           Boolean  @default(false)

  // Inferred service category
  serviceCategory        String   @default("other")

  firstSeenAt            DateTime @default(now())
  lastSeenAt             DateTime @default(now())
  updatedAt              DateTime @updatedAt

  user                   User     @relation(fields: [userId], references: [id])

  // One candidate row per (user, merchant) — upserted on each detection pass
  @@unique([userId, merchantNormalized])
  @@index([userId, recurringConfidence])
  @@index([userId, isSuppressed])
  @@map("subscription_candidates")
}
```

### 1.3 User model relation additions

Add these two fields inside the existing `model User { ... }` block, alongside the other relation arrays:

```prisma
insightCards           InsightCard[]
subscriptionCandidates SubscriptionCandidate[]
```

The complete updated `User` relation list becomes:

```prisma
model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  createdAt    DateTime  @default(now())
  deletedAt        DateTime?
  categoryOrder    String    @default("[]")

  accounts               Account[]
  categories             Category[]
  categoryRules          CategoryRule[]
  monthSummaries         MonthSummary[]
  monthCatTotals         MonthCategoryTotal[]
  uploads                Upload[]
  stagingUploads         StagingUpload[]
  stagingTxs             StagingTransaction[]
  insightCards           InsightCard[]
  subscriptionCandidates SubscriptionCandidate[]

  @@map("users")
}
```

### 1.4 Migration file

After updating `schema.prisma`, generate the migration with:

```bash
npx prisma migrate dev --name add_insight_cards_and_subscription_candidates
```

This produces a new file under `prisma/migrations/` that creates the `insight_cards` and `subscription_candidates` tables.

---

## 2. Build Order (Step-by-Step)

Files are listed in strict dependency order. Each phase depends on the one before it being complete.

---

### Phase 1 — Core Types and Computation (No UI Yet)

These four files establish all types, logic, and the computation orchestrator. No routes or components depend on anything in Phase 2+ being present.

---

#### File 1: `src/lib/insights/types.ts`

**What it does**: Canonical TypeScript type definitions for the AI Insights feature. Single source of truth shared by generators, API routes, and UI components.

**Exports**:
- `CardType` — union of the 10 card type strings
- `ConfidenceLevel` — `'high' | 'medium' | 'low'`
- `InsightCardAction` — `{ label, action_key, href? }`
- `InsightCard` — full card object (mirrors DB row + parsed JSON fields)
- `AiChatContext` — the structured context object passed to the AI chat endpoint (from Turn 1 section 10.3)
- Per-card `supporting_data` shapes: `CategorySpikeData`, `LargeTransactionData`, `SubscriptionDetectedData`, `TrialWarningData`, `FixOpportunityData`, `SavingsRateData`, `IncomeChangeData`, `CategoryConcentrationData`, `MerchantFrequencyData`, `MonthOverMonthData`

**Notes**:
- These types are distinct from (but informed by) the `src/lib/intelligence/types.ts` types written in Turn 2. The Turn 2 types cover internal computation intermediates (`ComputedInsightMetrics`, `MonthlyAggregates`, etc.). The Turn 5 types cover the user-facing card contract.
- Import from `@/lib/insights/types` in all downstream files.

---

#### File 2: `src/lib/insights/generators.ts`

**What it does**: Ten pure generator functions, one per card type. Each function receives the `ComputedInsightMetrics` bundle (from Turn 2 `src/lib/intelligence/types.ts`) and returns an `InsightCard | null`. Returning `null` means insufficient data or threshold not met — no card is emitted.

**Function signatures**:

```typescript
import type { ComputedInsightMetrics } from '@/lib/intelligence/types'
import type { InsightCard } from '@/lib/insights/types'

export function generateCategorySpike(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateLargeTransaction(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateSubscriptionDetected(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateTrialWarning(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateFixOpportunity(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateSavingsRate(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateIncomeChange(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateCategoryConcentration(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateMerchantFrequency(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null

export function generateMonthOverMonth(
  metrics: ComputedInsightMetrics,
  year: number,
  month: number,
): InsightCard | null
```

**Key thresholds** (define as exported constants at top of file):

```typescript
export const CATEGORY_SPIKE_MIN_DELTA_DOLLARS = 50      // minimum absolute delta to fire
export const CATEGORY_SPIKE_MIN_PCT_INCREASE  = 20      // minimum % increase to fire
export const LARGE_TX_MIN_PCT_OF_MONTHLY      = 10      // minimum % of monthly spending
export const LARGE_TX_MIN_TRANSACTIONS        = 5       // minimum tx count in month
export const SUBSCRIPTION_MIN_CONSECUTIVE_MONTHS = 2    // minimum months for card
export const INCOME_CHANGE_MIN_PCT            = 15      // minimum % change to fire
export const MOM_SPENDING_MIN_PCT_CHANGE      = 10      // minimum % change to fire
export const CATEGORY_CONCENTRATION_TOP3_PCT  = 70      // top-3 must exceed this
export const MERCHANT_FREQUENCY_MIN_COUNT     = 3       // minimum tx count per merchant
```

**No LLM calls in this file.** All generation is deterministic rule-based logic. Titles and summaries are constructed from templates using the computed numbers, following the tone guidelines in Turn 1 section 6.

---

#### File 3: `src/lib/intelligence/subscriptions.ts` (already written by Turn 4)

**Status**: Already specified in `docs/ai-insights-turn4-subscriptions.md`. **Do not rewrite.** Turn 6 will implement this file from the Turn 4 spec. The orchestrator in File 4 calls `detectSubscriptions(userId, year, month)`.

**Interface consumed by File 4**:

```typescript
import { detectSubscriptions } from '@/lib/intelligence/subscriptions'
// Returns: Promise<SubscriptionInsight>
// where SubscriptionInsight = { subscriptions, trials, duplicateAlerts, asOf }
```

---

#### File 4: `src/lib/insights/compute.ts`

**What it does**: The insight generation orchestrator. Assembles the full `ComputedInsightMetrics` bundle from DB queries, runs all generators, collects results, and returns a sorted array of `InsightCard` objects.

**Exported function**:

```typescript
export async function computeInsights(
  userId: string,
  year: number,
  month: number,
): Promise<InsightCard[]>
```

**Execution order within `computeInsights`**:

1. Fetch or recompute `MonthlyAggregates`:
   - Read `MonthSummary` from DB for `(userId, year, month)`. If `isStale = true` or row not found, call `computeMonthSummary(userId, year, month)` from `src/lib/intelligence/summaries.ts` to refresh.

2. Fetch category metrics for the target month and the prior 3 months:
   - Raw SQL query against `transactions` table, grouped by `appCategory`, as specified in Turn 2 section 3 (category aggregates query). Run for months M, M-1, M-2, M-3.
   - Build `CategoryMetrics[]` array.

3. Fetch merchant metrics for the target month:
   - Query `transactions` for the target month, group by `merchantNormalized`, compute counts and totals.
   - Build `MerchantMetrics[]` array.

4. Fetch frequency metrics:
   - Small purchase count/total, weekend/weekday split, p95 threshold (reuse from `detectAnomalies` logic in `summaries.ts` if available, otherwise re-query).
   - Build `FrequencyMetrics` object.

5. Run subscription detection:
   - Call `detectSubscriptions(userId, year, month)` from `src/lib/intelligence/subscriptions.ts`.
   - Upsert `SubscriptionCandidate` rows to DB from results.
   - Build `SubscriptionMetrics` from the returned `SubscriptionInsight`.

6. Assemble `ComputedInsightMetrics` bundle from steps 1–5.

7. Run all 10 generators (wrapped in individual try/catch):
   - Call each `generate*` function from `src/lib/insights/generators.ts`.
   - If a generator throws, log the error and continue (never abort the full run).
   - Collect non-null results.

8. Sort results by `priority` ascending, then `card_type` alphabetically for tie-breaking.

9. Return sorted array (max 8 cards, slice if more generated).

**Important**: `computeInsights` does NOT write to the `insight_cards` DB table. That is the responsibility of the API route in Phase 2. This keeps the compute function pure and testable.

---

### Phase 2 — API Routes

These four routes implement the full API contract defined in Turn 1 section 11. They depend on Phase 1 being complete.

---

#### File 5: `src/app/api/insights/generate/route.ts`

**Method**: POST
**Auth**: Required — call `getUserFromRequest(req)` from `@/lib/auth`
**Body**: `{ year: number, month: number }`

**What it does**:
1. Validate auth and body.
2. Verify `dashboardState === 'analysis_unlocked'` for the requested month by checking that no uncategorized transactions exist for the user+month. If categorization is incomplete, return `{ error: 'categorization_incomplete' }` with status 400.
3. Call `computeInsights(userId, year, month)`.
4. Upsert each card into `insight_cards` using `prisma.insightCard.upsert`:
   - `where: { userId_year_month_cardType: { userId, year, month, cardType: card.card_type } }`
   - `update`: all fields EXCEPT `isDismissed` (preserve dismissal state)
   - `create`: all fields including `isDismissed: false`
5. Return `{ cards: InsightCard[], generatedAt: string }` with status 200.
6. If DB write fails, log the error but still return the computed cards (best-effort persistence).

**Response on success**: `{ cards: InsightCard[], generatedAt: string }`
**Response on incomplete categorization**: `{ error: 'categorization_incomplete' }` (400)
**Response on auth failure**: `{ error: 'Unauthorized' }` (401)

---

#### File 6: `src/app/api/insights/route.ts`

**Method**: GET
**Auth**: Required
**Query params**: `year`, `month` (both required integers)

**What it does**:
1. Validate auth and query params.
2. Query `insight_cards` table for `(userId, year, month, isDismissed: false)`, ordered by `priority ASC`.
3. If no rows found, return `{ error: 'not_found' }` with status 404.
4. Compute `isStale`: true if the most recent `generatedAt` is older than 1 hour.
5. Return `{ cards: InsightCard[], generatedAt: string, isStale: boolean }` with status 200.

**Caching note**: The 1-hour stale threshold is checked here but the route does NOT auto-regenerate. The client (React Query) uses `isStale: true` in the response to decide whether to call `POST /api/insights/generate` in the background.

---

#### File 7: `src/app/api/insights/[cardId]/dismiss/route.ts`

**Method**: PATCH
**Auth**: Required
**Route param**: `cardId`

**What it does**:
1. Validate auth.
2. Verify the card exists and belongs to the authenticated user.
3. Update `insight_cards` row: set `isDismissed = true`.
4. Return `{ ok: true }` with status 200.
5. Return `{ error: 'not_found' }` (404) if card not found or belongs to another user.

---

#### File 8: `src/app/api/insights/chat/route.ts`

**Method**: POST
**Auth**: Required
**Body**: `{ year: number, month: number, messages: Array<{ role: 'user' | 'assistant', content: string }> }`

**What it does**:
1. Validate auth and body.
2. Enforce turn limit: if `messages.length > 20` (10 turns × 2 messages), return `{ error: 'conversation_limit_reached' }` (400).
3. Build `AiChatContext` from DB:
   - Read `MonthSummary` for `(userId, year, month)`.
   - Query `transactions` for category totals and merchant aggregates (same exclusion predicate as compute.ts).
   - Compute `momSpendingPctChange` and `momIncomePctChange` from prior month's `MonthSummary`.
   - **Never include**: raw transaction descriptions, database IDs, user PII.
4. Construct system prompt (see section 5 of this document for exact text).
5. Stream response from Anthropic Claude API (`claude-haiku-4-5` model for cost efficiency).
6. Return as `text/event-stream` (Server-Sent Events format).
7. If Anthropic API is unavailable (network error, 5xx, rate limit), return a non-streaming `{ error: 'ai_unavailable', message: 'AI chat is temporarily unavailable. Please try again in a few minutes.' }` (503).

**Privacy enforcement**:
- `AiChatContext` is the ONLY data injected into the AI prompt. No raw rows, no IDs.
- Responses are NOT stored in the database. Chat history lives in client React state only.

---

### Phase 3 — Hook Insights Generation into Staging Commit

#### File 9: `src/app/api/staging/[uploadId]/commit/route.ts` (modify existing)

**What to add**: After the block that sets `status: 'committed'` (line 143 in the current file), add an asynchronous insights generation trigger. The commit response must NOT block on insights generation.

**Insertion point** — after `remainingCount === 0` sets `status: 'committed'`, add:

```typescript
// Fire-and-forget: generate insights for the committed month(s).
// Derive year/month from the committed staging transactions.
// Do NOT await — the commit response must not block on insights computation.
if (remainingCount === 0) {
  // Determine the year/month of the committed data from the staging transactions.
  // Use the date of the first committed staging transaction as the reference month.
  const firstCommitted = toCommit.find(stx => stx.date != null)
  if (firstCommitted?.date) {
    const txDate = new Date(firstCommitted.date)
    const txYear  = txDate.getFullYear()
    const txMonth = txDate.getMonth() + 1

    // Fire-and-forget: computeInsights + upsert insight_cards
    // Errors are caught and logged; they must not affect the commit response.
    computeInsights(user.userId, txYear, txMonth)
      .then(async (cards) => {
        for (const card of cards) {
          await prisma.insightCard.upsert({
            where: {
              userId_year_month_cardType: {
                userId: user.userId,
                year: txYear,
                month: txMonth,
                cardType: card.card_type,
              },
            },
            update: {
              priority:      card.priority,
              title:         card.title,
              summary:       card.summary,
              supportingData: card.supporting_data as object,
              actions:       card.actions as object,
              confidence:    card.confidence,
              iconSuggestion: card.icon_suggestion,
              generatedAt:   new Date(card.generated_at),
            },
            create: {
              userId:        user.userId,
              year:          txYear,
              month:         txMonth,
              cardType:      card.card_type,
              priority:      card.priority,
              title:         card.title,
              summary:       card.summary,
              supportingData: card.supporting_data as object,
              actions:       card.actions as object,
              confidence:    card.confidence,
              iconSuggestion: card.icon_suggestion,
              isDismissed:   false,
              generatedAt:   new Date(card.generated_at),
            },
          })
        }
      })
      .catch((err: unknown) => {
        console.error('[commit] background insights generation failed:', err)
      })
  }
}
```

**Add import at top of the file**:

```typescript
import { computeInsights } from '@/lib/insights/compute'
```

**Rationale**: The commit API returns `{ committed, remaining }` immediately. Insight generation runs in the background. The Dashboard client already polls via React Query — when the user navigates to the Dashboard after committing, the `GET /api/insights` route will have fresh cards (or return 404 if generation hasn't finished yet, in which case the panel shows a "refresh" prompt).

---

### Phase 4 — UI Components

These four files implement the Dashboard UI. They depend on Phases 1–3 being complete and deployable.

---

#### File 10: `src/components/dashboard/InsightCard.tsx`

**What it does**: Single insight card component. Renders the card header (icon + title + confidence badge), summary text, up to 2 stat chips from `supporting_data`, and the actions row.

**Props interface** (from Turn 1 section 8.1):

```typescript
import type { InsightCard as InsightCardData } from '@/lib/insights/types'

interface InsightCardProps {
  card: InsightCardData
  onAction: (cardId: string, actionKey: string) => void
  isLoading?: boolean   // shows skeleton shimmer state
}
```

**Visual design**: Follows the dark glass aesthetic spec in Turn 1 section 8.2 exactly. Uses `rgba` backgrounds, no `bg-white` or Tailwind light-mode classes.

**Stat chip selection logic**: Display the two most numerically meaningful `supporting_data` keys. Prefer percentage values and dollar amounts. Skip string-type values (e.g., `category_name`, `direction`, `merchant`) in the chip row — those are already conveyed in the title/summary.

**Skeleton state**: Renders `animate-pulse` shimmer blocks when `isLoading={true}`, matching the layout described in Turn 1 section 8.3.

---

#### File 11: `src/components/dashboard/AiInsightsPanel.tsx`

**What it does**: The insight panel container. Fetches its own data via React Query (`['insights', year, month]`). Renders the card grid, collapse toggle, refresh button, loading skeletons, empty state, and not-ready state.

**Props interface** (from Turn 1 section 9.1):

```typescript
interface AiInsightsPanelProps {
  year: number
  month: number
  categories: CategoryTotal[]
  topTransactions: TopTx[]
  totalIncome: number
  totalSpending: number
  prevMonthSpending: number | null
}
```

**Data fetching**:

```typescript
const { data, isLoading, isError } = useQuery({
  queryKey: ['insights', year, month],
  queryFn:  () => apiFetch(`/api/insights?year=${year}&month=${month}`),
  staleTime: 5 * 60 * 1000,   // 5 minutes
  refetchOnMount: true,
  enabled: !!year && !!month,
})
```

**Refresh button behavior**:
1. Click "Refresh" → call `POST /api/insights/generate` with `{ year, month }`.
2. On success, invalidate `['insights', year, month]` React Query key.
3. Show spinner on the Refresh button while the generate request is in-flight.

**Collapse state**: Persist collapsed/expanded state in `localStorage` under key `ai_insights_panel_collapsed`. Default: expanded.

**Show more/less**: Show top 3 cards by default. "Show X more" button reveals remaining cards up to 8.

**Card action handler**: Pass `onAction` callback to each `InsightCard`. Handle `action_key === 'dismiss'` by calling `PATCH /api/insights/[cardId]/dismiss`, then invalidate the insights query.

**Stale indicator**: If `data.isStale === true`, show a subtle "Data may be outdated — Refresh for latest insights" text below the panel header.

---

#### File 12: `src/components/dashboard/AskAiDrawer.tsx`

**What it does**: The AI chat drawer. Includes the floating action button (FAB), the drawer/bottom-sheet container, context summary strip, scrollable chat message list, and the text input row.

**State**: Managed entirely in React component state (no persistent storage for chat history — see Turn 1 section 12 privacy rule 6).

**FAB placement**: `position: fixed`, `bottom: 80px`, `right: 20px`, `z-index: 50`. Rendered via React Portal so it sits above the AppShell layout.

**Chat behavior**:
- User sends message → `POST /api/insights/chat` with `{ year, month, messages }`.
- Stream response using `ReadableStream` / `EventSource` on the client.
- Append streamed tokens to the current assistant message in real time.
- After 10 turns (20 messages): disable input, show "Start a new conversation" prompt. Clear messages and re-enable to reset.

**Context summary strip** (read-only, always visible at top of drawer):
- Shows: Income `$X,XXX` | Spending `$X,XXX` | Net `+/-$X,XXX`
- Subtitle: "AI has access to category totals and merchant summaries — no transaction descriptions."
- This communicates to the user exactly what the AI can and cannot see.

---

#### File 13: `src/app/dashboard/page.tsx` (modify existing)

**What to change**:

1. **Replace import**: Remove `InsightPanel` import, add `AiInsightsPanel` and `AskAiDrawer`:

```typescript
// Remove:
import { InsightPanel } from '@/components/dashboard/InsightPanel'

// Add:
import { AiInsightsPanel } from '@/components/dashboard/AiInsightsPanel'
import { AskAiDrawer } from '@/components/dashboard/AskAiDrawer'
```

2. **Replace InsightPanel JSX** (currently Section 2, line 297–303) with `AiInsightsPanel`:

```tsx
{/* ── Section 2: AI Insights ───────────────────────────────────────── */}
{data.dashboardState === 'analysis_unlocked' && (
  <AiInsightsPanel
    year={year}
    month={month}
    categories={spendingCategories}
    topTransactions={topTransactions}
    totalIncome={summary.totalIncome as number}
    totalSpending={summary.totalSpending as number}
    prevMonthSpending={prevMonthSpending}
  />
)}
```

3. **Add AskAiDrawer** at the bottom of the return statement (after `</AppShell>`), as a sibling element wrapped in a fragment:

```tsx
return (
  <>
    <AppShell ...>
      {/* ... all existing sections ... */}
    </AppShell>

    {/* FAB + Drawer rendered outside AppShell to escape layout z-index */}
    {data?.dashboardState === 'analysis_unlocked' && summary && (
      <AskAiDrawer
        year={year}
        month={month}
        totalIncome={summary.totalIncome as number}
        totalSpending={summary.totalSpending as number}
        net={summary.net as number}
        categories={spendingCategories}
      />
    )}
  </>
)
```

4. **Do not delete** `src/components/dashboard/InsightPanel.tsx` until `AiInsightsPanel` is confirmed working in production. Keep the old file in place but unused.

---

## 3. Where Computations Happen

| Computation | Location | Notes |
|---|---|---|
| Insight card generation (all 10 generators) | Server-side only — `src/lib/insights/compute.ts` | Called from API routes and commit hook. Never runs in the browser. |
| Subscription detection | Server-side only — `src/lib/intelligence/subscriptions.ts` | Called by `computeInsights()` as a sub-step. |
| Category aggregates (historical SQL queries) | Server-side only — inside `computeInsights()` | Raw SQL via `prisma.$queryRaw`. |
| Merchant aggregates | Server-side only — inside `computeInsights()` | Prisma query grouped by `merchantNormalized`. |
| Monthly aggregate (income/spending/net) | Server-side only — reads `MonthSummary` or calls `computeMonthSummary()` | `computeMonthSummary()` is in `src/lib/intelligence/summaries.ts`. |
| AI chat context construction (`AiChatContext`) | Server-side only — inside `POST /api/insights/chat` route | Never sent raw data to the client before AI processes it. |
| AI chat streaming (Claude API call) | Server-side only — `POST /api/insights/chat` streams to client | `claude-haiku-4-5` model for cost efficiency. |
| InsightCard rendering | Client-side — `InsightCard.tsx`, `AiInsightsPanel.tsx` | Receives pre-computed card data via API. No computation. |
| Chat message display | Client-side — `AskAiDrawer.tsx` | Streams tokens from server. No financial computation. |
| React Query cache invalidation | Client-side — after mutations (dismiss, refresh, commit) | Standard React Query `queryClient.invalidateQueries()`. |

**Rule**: The client never computes financial metrics. It only fetches, displays, and triggers server-side recomputation.

---

## 4. Caching Strategy

### 4.1 Server-side: InsightCard persistence

- `InsightCard` rows are stored in the `insight_cards` table with a `generatedAt` timestamp.
- The `GET /api/insights` route returns cached cards if they exist, along with `isStale: true/false` (stale = `generatedAt` older than 1 hour).
- The `POST /api/insights/generate` route always recomputes (ignores cache age). Use this for the Refresh button.
- The commit hook (Phase 3) fires generate automatically — so after a new commit, fresh cards are ready within seconds.
- `isDismissed = true` on a card row persists across regenerations via upsert semantics.

### 4.2 Client-side: React Query

```typescript
// In AiInsightsPanel.tsx
const { data } = useQuery({
  queryKey: ['insights', year, month],
  queryFn:  () => apiFetch(`/api/insights?year=${year}&month=${month}`),
  staleTime: 5 * 60 * 1000,   // 5 minutes: don't refetch if data is fresh
  refetchOnMount: true,        // always refetch on tab return
})
```

- `staleTime: 5 minutes` — prevents redundant fetches when the user switches tabs and comes back.
- `refetchOnMount: true` — ensures fresh data when the Dashboard component mounts.
- Switching months triggers a new query key `['insights', newYear, newMonth]` — no manual invalidation needed for month changes.

### 4.3 Cache invalidation triggers

| Event | Invalidation |
|---|---|
| User clicks "Refresh" button | `POST /api/insights/generate` → `queryClient.invalidateQueries(['insights', year, month])` |
| User dismisses a card | `PATCH /api/insights/[cardId]/dismiss` → `queryClient.invalidateQueries(['insights', year, month])` |
| Staging commit completes | Background compute fires server-side; client's next `refetchOnMount` or manual refresh picks it up |
| Month navigator change | React Query auto-fetches new key `['insights', newYear, newMonth]` |

---

## 5. Hallucination Prevention

### 5.1 Insight Card Generation: Zero Hallucination Risk

All 10 card generators are 100% rule-based, deterministic, and contain no LLM calls. Every number in every card's `title`, `summary`, and `supporting_data` is derived directly from the `ComputedInsightMetrics` bundle. There is no mechanism by which fabricated data can enter a card.

### 5.2 AI Chat: System Prompt

The exact system prompt injected before every AI chat request:

```
You are a financial assistant for BudgetLens. You help users understand their spending patterns based on their own transaction data.

STRICT DATA RULES — you must follow these without exception:
1. You may ONLY reference data provided in the structured context below. You must NEVER invent merchants, amounts, categories, or dates.
2. If the data provided is insufficient to answer the question, you MUST say: "I don't have enough data to answer that — here's what I do know: [cite specific numbers from the context]."
3. You must NEVER speculate about what the user "probably" spends on something if that category is not in the context.
4. Keep your response to 3 paragraphs maximum.
5. End every response with a "Data sources used:" footer that lists which fields from the context you referenced (e.g., "totalSpending, categoryTotals.Food & Dining, momSpendingPctChange").

TONE RULES:
- Use neutral financial language. Describe what the data shows, not what the user should feel.
- Do not use the words: "too much", "wasteful", "bad", "problem", "excessive", "overspent", "alarming", "you should".
- Passive or descriptive voice is preferred. "Spending in Dining increased" rather than "You overspent on dining."

STRUCTURED CONTEXT FOR [MONTH YEAR]:
[AiChatContext JSON injected here]
```

### 5.3 `AiChatContext` Fields Injected into the Prompt

The prompt receives a JSON-serialized `AiChatContext` object. This is the ONLY financial data the AI sees. Fields are exactly as defined in Turn 1 section 10.3:

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
  momSpendingPctChange: number | null
  momIncomePctChange:   number | null
}
```

### 5.4 Fields Never Sent to the AI

The following fields are explicitly excluded from `AiChatContext` and must never appear in any AI prompt:

- `description`, `descriptionRaw`, `descriptionNormalized` — raw transaction text
- `rawAmount`, `amountRaw` — original unparsed amount strings
- `bankTransactionId`, `bankFingerprint` — bank-generated IDs
- Any database `id` field (`transaction.id`, `account.id`, `upload.id`, `user.id`)
- `userId`, `accountId`, `uploadId`
- Any field from `TransactionRaw`
- User email, name, or any PII

### 5.5 Chat History Storage

AI chat responses are **never stored in the database**. Chat history lives in `React.useState` within the `AskAiDrawer` component. When the drawer is closed and reopened, the conversation starts fresh. This is intentional — it prevents AI-generated text from being confused with factual ledger data.

---

## 6. Acceptance Tests

These tests validate the complete end-to-end behavior of the insight generation system. Tests should be written as Vitest unit tests in `tests/unit/insights/generators.test.ts`, using mock `ComputedInsightMetrics` objects as input.

| # | Test | Setup | Expected Output | Pass Condition |
|---|---|---|---|---|
| 1 | **Spending spike fires above threshold** | `CategoryMetrics` for "Dining": `currentMonthTotal = 800`, `threeMonthAvg = 400`, `delta = 400` | `generateCategorySpike()` returns a `category_spike` card | `card !== null`, `card.title` contains `"100%"` and `"Dining"`, `card.supporting_data.pct_increase === 100`, `card.supporting_data.this_month_amount === 800`, `card.supporting_data.avg_prior_3_months === 400` |
| 2 | **No spike below absolute dollar threshold** | `CategoryMetrics` for "Coffee": `currentMonthTotal = 42`, `threeMonthAvg = 38`, `delta = 4` | `generateCategorySpike()` returns `null` | `card === null` — delta is $4, below `CATEGORY_SPIKE_MIN_DELTA_DOLLARS = 50`; no card generated even though % increase is non-trivial |
| 3 | **Large transaction card** | Month total spending = `2400`. Single transaction: `amount = -1200`, `merchantNormalized = "DELTA AIR"`, `date = "2026-03-05"`. Five or more total transactions in month. | `generateLargeTransaction()` returns a `large_transaction` card | `card !== null`, `card.supporting_data.amount === 1200`, `card.supporting_data.pct_of_monthly_spending === 50`, `card.supporting_data.merchant` contains `"DELTA AIR"` |
| 4 | **Subscription detected on 2nd consecutive month** | `SubscriptionCandidate` for "Netflix": `consecutiveMonths = 2`, `estimatedMonthlyAmount = 14.99`, `recurringConfidence = 'medium'` | `generateSubscriptionDetected()` returns a `subscription_detected` card | `card !== null`, `card.supporting_data.amount_per_month === 14.99`, `card.supporting_data.months_detected === 2`, `card.confidence === 'medium'` |
| 5 | **Trial warning alert fires within window** | `TrialCandidate` for "Adobe": `trialDate = "2026-03-01"`, `estimatedTrialDays = 30`, `alertActive = true` (today = 2026-03-28, within 3 days of billing date 2026-03-31) | `generateTrialWarning()` returns a `trial_warning` card | `card !== null`, `card.supporting_data.merchant` contains `"Adobe"`, `card.supporting_data.first_seen_date === "2026-03-01"`, `card.priority <= 4` |
| 6 | **Cash flow forecast card (partial month)** | `MonthlyAggregates`: `daysElapsed = 10`, `totalSpending = 800`, `daysInMonth = 31`, `isPartialMonth = true`. Projected = `(800/10) * 31 = 2480`. `totalIncome = 2000`. | `generateSavingsRate()` returns a card where `supporting_data.projected === 2480` | `card !== null`, `card.supporting_data.projected_month_end === 2480`, `card.supporting_data.daily_spending_rate === 80`, `card.summary` cites `"$2,480"` |
| 7 | **Fix opportunity: duplicate service categories** | `SubscriptionMetrics.duplicateServiceCategories = [{ serviceCategory: 'streaming', candidates: [{merchantDisplay: 'Netflix', ...}, {merchantDisplay: 'Hulu', ...}], groupTotal: 29.98 }]`. `MonthlyAggregates.net < 0`. | `generateFixOpportunity()` returns a `fix_opportunity` card | `card !== null`, `card.supporting_data.issue_type === 'duplicate_subscriptions'`, `card.supporting_data.transaction_count === 2`, `card.supporting_data.total_amount === 29.98`, `card.summary` mentions `"streaming"` |
| 8 | **Dismiss persists across regeneration** | Card with `cardType = 'category_spike'` for `(userId, 2026, 3)` exists in DB with `isDismissed = true`. Regenerate insights for `(userId, 2026, 3)` via `POST /api/insights/generate`. Then call `GET /api/insights?year=2026&month=3`. | Card does not appear in GET response | DB upsert preserves `isDismissed = true` for the existing row. Response `cards` array does not contain any card with `cardType === 'category_spike'` for that month. Verify with: `expect(cards.find(c => c.card_type === 'category_spike')).toBeUndefined()` |

### 6.1 Additional Boundary Tests (recommended for Turn 6)

- Generator returns `null` when `threeMonthAvg` is `null` (insufficient history for category spike)
- Generator returns `null` when `totalIncome === 0` (no savings rate card)
- `computeInsights` returns empty array when all generators throw (error resilience)
- `GET /api/insights` returns 404 when no rows exist for that month
- `PATCH /api/insights/[cardId]/dismiss` returns 404 for a card belonging to a different user

---

## 7. Error Handling Rules

These rules apply across all Phase 1 and Phase 2 files.

### 7.1 Generator-level errors

- Each of the 10 `generate*` calls in `computeInsights` is wrapped in an individual `try/catch`.
- If one generator throws, log the error with `console.error('[insights] generator failed:', cardType, err)` and continue.
- The other 9 generators are unaffected.
- Pattern:

```typescript
for (const [cardType, generatorFn] of generatorMap) {
  try {
    const card = generatorFn(metrics, year, month)
    if (card) cards.push(card)
  } catch (err) {
    console.error(`[insights] ${cardType} generator failed:`, err)
    // continue to next generator
  }
}
```

### 7.2 All generators fail

- If every generator either throws or returns `null`, `computeInsights` returns an empty array `[]`.
- The calling API route returns `{ cards: [], generatedAt: new Date().toISOString() }` with status 200.
- The Dashboard's `AiInsightsPanel` renders the "No insights available" empty state.
- **The Dashboard never crashes** because of an insight failure.

### 7.3 DB write fails (POST /api/insights/generate)

- If `prisma.insightCard.upsert` throws for one card, log the error and continue to the next card.
- If all DB writes fail, return the computed cards in the response anyway (the cards are returned from in-memory computation — the DB write is best-effort).
- The client receives valid cards and can display them. On the next page load, the cards will be re-fetched from the DB (which may be empty — the panel will show stale/empty state and prompt for a refresh).

### 7.4 Subscription detection fails

- If `detectSubscriptions()` throws inside `computeInsights`, catch the error, log it, and set `subscriptions = { subscriptionCount: 0, subscriptionMonthlyTotal: 0, trialCandidates: [], duplicateServiceCategories: [] }`.
- The insight run continues. Cards that depend on subscription data (`subscription_detected`, `trial_warning`, `fix_opportunity`) will return `null` (no card) due to empty subscription metrics.

### 7.5 AI chat API unavailable

- If the Anthropic API call fails (network error, 5xx, rate limit exceeded), return a non-streaming JSON response:

```typescript
return NextResponse.json(
  { error: 'ai_unavailable', message: 'AI chat is temporarily unavailable. Please try again in a few minutes.' },
  { status: 503 }
)
```

- The client (`AskAiDrawer`) handles this by displaying the message inline as an assistant chat bubble with an error style, not as a toast notification.
- Do NOT bubble the Anthropic error message to the client (it may contain API key info or internal details). Use only the generic message above.

### 7.6 Compute in staging commit hook fails

- The fire-and-forget `.catch()` handler in the commit route logs the error with `console.error('[commit] background insights generation failed:', err)`.
- The commit API response is already sent by this point — it is unaffected.
- The user sees no error. On the Dashboard, they will see the "Not ready" state or an "isStale" indicator and can click "Refresh" to retry manually.

---

## Summary

### New files to create

| File | Phase | Purpose |
|---|---|---|
| `src/lib/insights/types.ts` | 1 | Canonical type definitions for all insight card types, actions, and AI chat context |
| `src/lib/insights/generators.ts` | 1 | 10 rule-based generator functions, one per card type |
| `src/lib/insights/compute.ts` | 1 | Orchestrator: assembles metrics, runs generators, returns sorted card array |
| `src/app/api/insights/generate/route.ts` | 2 | POST — runs compute, upserts cards to DB |
| `src/app/api/insights/route.ts` | 2 | GET — returns cached cards with stale flag |
| `src/app/api/insights/[cardId]/dismiss/route.ts` | 2 | PATCH — sets isDismissed=true |
| `src/app/api/insights/chat/route.ts` | 2 | POST — streams AI chat using AiChatContext only |
| `src/components/dashboard/InsightCard.tsx` | 4 | Single card component with dark glass styling |
| `src/components/dashboard/AiInsightsPanel.tsx` | 4 | Panel container: grid, collapse, refresh, empty/loading states |
| `src/components/dashboard/AskAiDrawer.tsx` | 4 | FAB + chat drawer with streaming UI |

### Files to modify

| File | Phase | Change |
|---|---|---|
| `prisma/schema.prisma` | 1 (pre) | Add InsightCard model, SubscriptionCandidate model, two User relations |
| `src/app/api/staging/[uploadId]/commit/route.ts` | 3 | Add fire-and-forget insights generation after status='committed' |
| `src/app/dashboard/page.tsx` | 4 | Replace InsightPanel with AiInsightsPanel; add AskAiDrawer |

### File NOT changed until confirmed working

| File | Note |
|---|---|
| `src/components/dashboard/InsightPanel.tsx` | Keep in place until AiInsightsPanel is confirmed in production. Remove in a separate cleanup commit. |

---

*Generated by AI Collab Turn 5. Part of the BudgetLens Intelligence Engine.*
