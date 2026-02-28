# BudgetLens — Home Budget Intelligence App

Built from the Claude ↔ OpenAI Architecture Summit design.

## Quick Start

```bash
cd budget-app
npm run dev
```

Open http://localhost:3000

1. **Create an account** (email + password)
2. **Upload a CSV** bank statement from any major US bank
   — OR — click **"Load Sample Data"** to see the dashboard immediately
3. **View your dashboard** — spending breakdown, charts, top expenses
4. **Tap any category badge** on a transaction to re-categorize it

## Supported Banks (auto-detected)
Chase · Bank of America · Wells Fargo · Capital One · Citibank · Discover · US Bank · TD Bank · PNC · USAA · Ally · American Express · and generic CSV formats

## Features Built
- ✅ CSV upload with 14 bank format auto-detections
- ✅ 19 spending categories with 303 auto-categorization rules
- ✅ AI fallback categorization (GPT-4o-mini) with confidence thresholds
- ✅ Monthly dashboard: income, spending, net, top expenses
- ✅ Category bar chart + donut chart
- ✅ Transaction list with search, filter, pagination
- ✅ One-tap category correction with "Apply to all" option
- ✅ Optimistic UI updates (corrections feel instant)
- ✅ Undo last recategorization (5-second toast)
- ✅ Anomaly detection (spending spikes, large transactions, duplicates)
- ✅ Partial month detection with date range display
- ✅ 3-month rolling average comparison
- ✅ Transfer detection (credit card payments excluded from spending)
- ✅ Foreign currency flagging and exclusion
- ✅ Duplicate upload prevention (file hash deduplication)
- ✅ Mobile-first responsive layout
- ✅ JWT authentication with bcrypt password hashing

## Architecture
- **Frontend**: Next.js 14, TypeScript, Tailwind CSS, Recharts, Zustand, React Query
- **Backend**: Next.js API routes, Node.js
- **Database**: SQLite via Prisma ORM (swap to PostgreSQL in production)
- **AI**: OpenAI GPT-4o-mini (provider-abstracted)
- **Auth**: JWT (7-day tokens) + bcrypt (12 rounds)

## Database Commands
```bash
npm run db:push     # Push schema changes
npm run db:studio   # Open Prisma Studio (visual DB browser)
```

## Environment Variables (.env.local)
```
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-secret-here"
OPENAI_API_KEY="sk-..."
```
