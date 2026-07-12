# Financial Autopsy — Claude Code Instructions

## Project overview
Personal finance / budget tracker SaaS. Users upload bank statements, categorize transactions, and unlock Money Personality + Financial Autopsy insights. Next.js 14 App Router, TypeScript strict. Prisma 5 + SQLite (dev) / PostgreSQL (prod). Custom JWT auth — no Clerk, no Stripe.

## Key architecture rules

**Auth:** Custom JWT via `getUserFromRequest` in `@/lib/auth`. Never add Clerk or Stripe.

**SQLite constraints (dev):**
- No native enum → use String
- No native Json → use String
- Decimal → use String (`amountRaw`) for financial precision
- `Transaction.amount` is Prisma Float — unavoidable, don't change it
- DB changes: `npx prisma db push` NOT `prisma migrate dev` (non-interactive fails)

**Unlock logic:**
- `isExcluded: false, isTransfer: false` transactions must ALL have `appCategory` to unlock insights
- Transfers excluded from categorize queue AND from unlock count
- API: `GET /api/insights/unlock-status` → `{ total, uncategorized, unlocked }`
- Hook: `useInsightsUnlock` — polls every 15s while locked, `staleTime: 0`

**Ingestion pipeline (5 stages — complete):**
Stage 0: file accept → Stage 1: CSV parse → Stage 2: normalize → Stage 3: dedup → Stage 4: reconcile
- `sourceRowHash` = SHA-256(accountId|rawLine) — content-based dedup
- `bankFingerprint` = SHA-256(date|||amount|||desc|||balance)
- Amounts stored as decimal strings in `amountRaw`

**Personality cards:**
- Images in `public/personalities/` — 1200×800 WebP, quality 87, text BAKED IN — NO HTML/CSS overlay ever
- `ILLUSTRATION_CARDS` registry in `FinancialAutopsyPanel.tsx`
- `CorePersonalityId` values: `full_send`, `wire_dancer`, `subscription_collector`, etc.

**Dark glass UI:**
- `.app-dark` class on AppShell wrapper cascades to all authenticated pages
- Token system in `src/app/globals.css` (outside `@layer` to beat Tailwind utilities)
- Inline styles preferred over Tailwind for component-level dark glass

## Common commands
- `npm run dev` — start dev server → http://localhost:3000
- `npx prisma db push` — apply schema changes (NOT migrate dev)
- `npx prisma studio` — browse DB
- `npm run build` — production build
- Deploy: `git push master` → Vercel auto-deploy

## Test conventions
- Vitest. Read the source file before writing any test.
- Tests in `tests/`
