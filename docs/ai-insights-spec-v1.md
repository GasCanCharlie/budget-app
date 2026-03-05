# AI Insights — Spec v1 (Executive Summary)

**Project:** BudgetLens
**Feature:** AI Insights — Deterministic Financial Intelligence Engine
**Completed:** 2026-03-04
**Turns:** 6 of 6 (AI Collab)

---

## 1. Feature Overview

AI Insights replaces the existing `InsightPanel` bullet-list component with a structured,
card-based financial intelligence system. Each card represents a single, specific
financial observation backed by real numbers from committed transaction data.

Key properties:
- Entirely deterministic and rule-based — no LLM used for card generation.
- AI is only used in the opt-in "Ask AI" chat drawer (Claude claude-haiku-4-5-20251001).
- All card data is pre-computed from structured aggregates. Raw transaction descriptions
  never reach the AI.
- Insights auto-generate when a staging upload is committed. Users can also refresh on-demand.
- Dismissed cards are preserved across regenerations (isDismissed survives upsert).

---

## 2. Architecture Diagram (ASCII)

```
Upload Commit
      │
      │ fire-and-forget
      ▼
computeInsights(userId, year, month)
      │
      ├── computeMonthSummary()      → MonthlySummary (income, spending, net, categories)
      ├── Prev month summary         → deltas
      ├── Raw SQL: merchant aggregates (this + prev month)
      ├── Raw SQL: p95 threshold (12-month)
      ├── Raw SQL: category 3-month history
      ├── Raw SQL: large transactions (> p95)
      ├── Raw SQL: small purchases (< $15)
      └── detectSubscriptions()     → SubscriptionInsight
            │
            └── upserts SubscriptionCandidate rows in DB
      │
      ▼
ComputedInsightMetrics bundle
      │
      ▼
runAllGenerators(metrics)
      │
      ├── generateOverBudgetDiagnosis   → InsightCard[]
      ├── generateCategorySpikes        → InsightCard[]
      ├── generateMerchantSpikes        → InsightCard[]
      ├── generateLargeTransactions     → InsightCard[] (max 3)
      ├── generateSmallPurchaseLeaks    → InsightCard[]
      ├── generateSubscriptionSummary   → InsightCard[]
      ├── generateNewSubscriptionAlert  → InsightCard[] (1 per new sub)
      ├── generateTrialWarnings         → InsightCard[] (1 per trial)
      ├── generateCashFlowForecast      → InsightCard[]
      └── generateFixOpportunity        → InsightCard[]
      │
      ▼
rankAndCap(all, cap=8)   ← sort by priority + confidence, dedup by card_type
      │
      ├── upsertInsightCards()     → DB (preserves isDismissed)
      └── return display[]        → API response (max 8 cards)
```

---

## 3. File Inventory (New Files)

| File | Purpose |
|------|---------|
| `src/lib/insights/types.ts` | Canonical TypeScript interfaces: `InsightCard`, `CardType`, `ComputedInsightMetrics`, 10 supporting data shapes |
| `src/lib/insights/generators.ts` | 10 deterministic generator functions, `rankAndCap`, `runAllGenerators` |
| `src/lib/insights/compute.ts` | Orchestrator: queries DB, assembles metrics, runs generators, upserts cards |
| `src/lib/intelligence/subscriptions.ts` | Subscription + trial detection module (12-month lookback) |
| `src/lib/intelligence/summaries.ts` | Monthly summary computation (pre-existing, used by compute.ts) |
| `src/app/api/insights/generate/route.ts` | POST — trigger on-demand insight generation |
| `src/app/api/insights/route.ts` | GET — fetch cached cards for a month |
| `src/app/api/insights/[cardId]/dismiss/route.ts` | PATCH — dismiss a card |
| `src/app/api/insights/chat/route.ts` | POST — streaming AI chat (Claude) |
| `src/components/dashboard/InsightCard.tsx` | Single card component (dark glass design) |
| `src/components/dashboard/AiInsightsPanel.tsx` | Panel with grid, collapse, refresh |
| `src/components/dashboard/AskAiDrawer.tsx` | Chat drawer + FAB |
| `docs/ai-insights-turn1-ux.md` | Turn 1: Product spec + UX |
| `docs/ai-insights-turn2-data.md` | Turn 2: Data model + aggregations |
| `docs/ai-insights-turn3-generators.md` | Turn 3: Generator functions spec |
| `docs/ai-insights-turn4-subscriptions.md` | Turn 4: Subscription detection spec |
| `docs/ai-insights-turn5-implementation.md` | Turn 5: Implementation plan + acceptance tests |
| `docs/ai-insights-spec-v1.md` | This document |

### Schema additions (prisma/schema.prisma)

```prisma
model InsightCard {
  id             String   @id @default(cuid())
  userId         String
  year           Int
  month          Int
  cardType       String
  priority       Int
  title          String
  summary        String
  supportingData Json
  actions        Json
  confidence     String
  iconSuggestion String
  isDismissed    Boolean  @default(false)
  generatedAt    DateTime @default(now())
  user           User     @relation(fields: [userId], references: [id])
  @@unique([userId, year, month, cardType])
  @@map("insight_cards")
}

model SubscriptionCandidate {
  id                     String    @id @default(cuid())
  userId                 String
  merchantNormalized     String
  estimatedMonthlyAmount Float
  recurringConfidence    String
  subscriptionScore      Int
  consecutiveMonths      Int
  serviceCategory        String?
  estimatedNextCharge    DateTime?
  isConfirmedByUser      Boolean   @default(false)
  isSuppressed           Boolean   @default(false)
  firstSeenAt            DateTime  @default(now())
  lastSeenAt             DateTime  @default(now())
  user                   User      @relation(fields: [userId], references: [id])
  @@unique([userId, merchantNormalized])
  @@map("subscription_candidates")
}
```

---

## 4. API Contract Table

| Method | Path | Auth | Body / Params | Response |
|--------|------|------|---------------|----------|
| POST | `/api/insights/generate` | JWT | `{ year, month }` | `{ cards: InsightCard[], generatedAt: string }` |
| GET | `/api/insights` | JWT | `?year=&month=` | `{ cards: InsightCard[], isStale: boolean }` |
| PATCH | `/api/insights/[cardId]/dismiss` | JWT | — | `{ success: true }` |
| POST | `/api/insights/chat` | JWT | `{ message, context: AiChatContext }` | Streaming `text/plain` |

### isStale logic
`isStale = true` when:
- No cards exist for that month, OR
- The newest card's `generatedAt` is more than 1 hour ago.

### Chat route fallback
If `ANTHROPIC_API_KEY` is not set, the chat route returns `503` with a clear error message.

---

## 5. Card Type Reference

| CardType | Generator | Priority | Trigger |
|----------|-----------|----------|---------|
| `over_budget` | `generateOverBudgetDiagnosis` | 1 | totalSpending > totalIncome |
| `category_spike` | `generateCategorySpikes` | 2 | deltaPercent > 20% AND delta > $50 |
| `merchant_spike` | `generateMerchantSpikes` | 3 | merchantDelta > $100 AND deltaPct > 30% |
| `large_transaction` | `generateLargeTransactions` | 2 | amount > max($500, p95) |
| `small_leaks` | `generateSmallPurchaseLeaks` | 5 | count > 10 AND total > $150 |
| `subscription_summary` | `generateSubscriptionSummary` | 4 | subscriptionCount >= 2 |
| `subscription_new` | `generateNewSubscriptionAlert` | 3 | consecutiveMonths === 2 |
| `trial_warning` | `generateTrialWarnings` | 2 | alertShouldFire === true |
| `cash_flow_forecast` | `generateCashFlowForecast` | 4 | partial month + pace off by > 10% |
| `fix_opportunity` | `generateFixOpportunity` | 1 | net < 0 + actionable scenarios |

### Ranking rules
1. Sort by `priority` ascending (1 = highest).
2. Tie-break by `confidence` (high > medium > low).
3. Deduplicate by `card_type` (keep highest-priority card of each type).
4. Cap at 8 display cards. All cards are persisted to DB.

---

## 6. Subscription Detection Summary

`detectSubscriptions(userId, year, month)` — 12-month lookback:

- **Recurring detection**: same merchant + amount ±5% in 2+ months, OR same day-of-month ±3 days.
- **Scoring (0–100)**: recurrence frequency (40pt) + amount consistency (30pt) + day-of-month consistency (20pt) + merchant name signals (10pt).
- **Confidence**: HIGH = 3+ months + score ≥ 65; MEDIUM = 2 months same amount or daySD ≤ 5; LOW = otherwise.
- **Trial detection**: amount $0 or $0.99–$1.99 at new merchant, or trial keywords. Alert fires within 3 days of estimated billing.
- **Duplicate services**: 2+ subscriptions in the same service category (Video Streaming, Music, Cloud Storage, News/Magazine, Gaming, Fitness, Software/Productivity).

---

## 7. Privacy Rules (Enforced Server-Side)

1. Raw transaction `description` / `descriptionRaw` fields are NEVER sent to any AI.
2. Only `merchantNormalized` (pre-cleaned) and aggregated numeric totals are permitted in AI context.
3. No transaction IDs, user IDs, or account names in AI prompts.
4. Chat responses are NOT stored in the database — they live in client React state only.
5. The insight card generator is fully deterministic (no LLM calls during card generation).

---

## 8. Build Checklist

- [x] `prisma/schema.prisma` — InsightCard + SubscriptionCandidate models added
- [x] `npx prisma generate` — client regenerated
- [x] `src/lib/insights/types.ts` — canonical type system (Turn 3)
- [x] `src/lib/insights/generators.ts` — 10 generators (Turn 3)
- [x] `src/lib/insights/compute.ts` — orchestrator (Turn 6)
- [x] `src/lib/intelligence/subscriptions.ts` — subscription detection (Turn 4)
- [x] `src/app/api/insights/generate/route.ts` — POST generate
- [x] `src/app/api/insights/route.ts` — GET fetch
- [x] `src/app/api/insights/[cardId]/dismiss/route.ts` — PATCH dismiss
- [x] `src/app/api/insights/chat/route.ts` — POST streaming chat
- [x] `src/app/api/staging/[uploadId]/commit/route.ts` — fire-and-forget hook added
- [x] `src/components/dashboard/InsightCard.tsx` — card component (dark glass)
- [x] `src/components/dashboard/AiInsightsPanel.tsx` — panel component
- [x] `src/components/dashboard/AskAiDrawer.tsx` — chat drawer + FAB
- [x] `npx tsc --noEmit` — zero errors
- [ ] `npx prisma migrate dev` — run on production DB to create insight_cards + subscription_candidates tables
- [ ] Set `ANTHROPIC_API_KEY` in Vercel environment variables to enable AI chat

---

*Generated by AI Collab Turn 6 — BudgetLens Intelligence Engine v1.*
