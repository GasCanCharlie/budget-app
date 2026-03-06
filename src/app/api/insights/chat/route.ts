/**
 * POST /api/insights/chat
 * Auth: JWT required
 *
 * Body: { message: string, year: number, month: number, history?: Array<{role: string, content: string}> }
 *
 * Server fetches all context from DB using the authenticated userId.
 * Returns: { message: string, numbersUsed: Array<{label:string,value:string}>, filters?: {merchant?:string, category?:string, dateFrom?:string, dateTo?:string} }
 *
 * If OPENAI_API_KEY is not set, returns 503.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { computeMonthSummary } from '@/lib/intelligence/summaries'
import { compareMonths } from '@/lib/intelligence/compare'
import { detectSubscriptions } from '@/lib/intelligence/subscriptions'
import { getMerchantStats } from '@/lib/intelligence/merchants'

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful financial assistant for BudgetLens. The user's real transaction data is provided below. Answer their questions naturally and conversationally — you have full access to their spending, income, merchants, categories, and history for the month.

When relevant, include specific numbers from the data. If you genuinely don't have the data to answer something, say so briefly and move on.

If WEB SEARCH RESULTS are provided, use them to give current pricing and alternatives. Treat them as informational context — always note if a price you found is an estimate or may have changed. Never reveal the raw URLs or source titles verbatim.

At the end of your response, if you referenced specific numbers, include:

Numbers used:
• [label]: [value]

FILTERS: merchant=[X] | category=[Y] | dateFrom=[YYYY-MM-DD] | dateTo=[YYYY-MM-DD]
(only include the FILTERS line when your answer is specifically about a merchant, category, or date range)`

// ─── Web search intent + helpers ──────────────────────────────────────────────

const SEARCH_INTENT_RE = /cheap(er|est)|better (price|deal|rate|plan|option)|find.*(price|deal|store|place|cheapest|cheapest place|where)|where (can i|to) (buy|get|find)|best.*(deal|price|place|option|store)|search|look.?up|look for|lowest price|good deal|great deal|on sale|discount|coupon|promo|compare (plan|price|cost)|how much (does|is|do) .+ cost|current (price|rate)|going rate|lower.*(bill|cost|rate|price)|too expensive|worth it|save.*on|switch.*from|alternative to|alternatives? for|nearby|near me|in (maui|hawaii|[a-z]+ area)|local (store|price)|grocery store|what store|which store|where.*sell|(check|scan).*(around|near)|around (maui|hawaii|here|town|the area|my area|kahului|kihei|lahaina|oahu|honolulu)|(deal|deals|bargain).*(around|near|in\s+maui|in\s+hawaii)/i

function needsWebSearch(msg: string): boolean {
  return SEARCH_INTENT_RE.test(msg)
}

const LOCATION_RE = /\b(maui|hawaii|kahului|kihei|lahaina|paia|wailea|wailuku|haiku|hana|lanai|oahu|honolulu|kona|hilo|kauai|lihue)\b/i

function mentionsLocation(msg: string): boolean {
  return LOCATION_RE.test(msg)
}

/** Build a smart search query using conversation history for context */
function buildSearchQuery(message: string, history: Array<{ role: string; content: string }>): string {
  const priorUserMessages = history
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content)
    .join(' ')

  const fullContext = `${priorUserMessages} ${message}`

  // Extract product/brand/quantity keywords from full conversation context
  const productMatches = fullContext.match(
    /\b(beer|alcohol|wine|liquor|spirits|budweiser|coors|corona|modelo|heineken|bud\s*light|miller|white\s*claw|seltzer|vodka|whiskey|rum|tequila|hard\s*seltzer|\d+[\s-]?pack|six[\s-]?pack|twelve[\s-]?pack|thirty[\s-]?pack|case\s+of|bottles?)\b/gi,
  ) ?? []
  const uniqueProducts = [...new Set(productMatches.map(p => p.toLowerCase().replace(/\s+/g, ' ')))]

  // Minimal strip — remove only pronouns/articles/conjunctions; keep intent words, places, products
  const cleaned = fullContext
    .replace(/\$[\d,.]+/g, '')
    .replace(/\b(my|i|me|we|our|please|just|really|very|actually|so|and|or|but|to|of|for|by|this|that|it|its|was|were|been|has|had|have|will|would|could|should|an|a|the)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()

  // Append any extracted products not already in the cleaned string
  const extraProducts = uniqueProducts.filter(p => !cleaned.toLowerCase().includes(p)).join(' ')
  const withProducts = extraProducts ? `${cleaned} ${extraProducts}`.trim() : cleaned

  const base = withProducts.length > 10 ? withProducts : `${withProducts} best price where to buy`
  return `${base} 2025`.slice(0, 200)
}

interface TavilyResult {
  title: string
  content: string
  url: string
}

interface TavilyResponse {
  results: TavilyResult[]
}

async function tavilySearch(query: string, apiKey: string): Promise<string> {
  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: 4,
        include_answer: false,
        include_images: false,
      }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return ''
    const data = await res.json() as TavilyResponse
    if (!data.results?.length) return ''

    const lines = data.results
      .slice(0, 4)
      .map(r => `• ${r.title}: ${r.content.slice(0, 220).replace(/\n+/g, ' ')}`)
      .join('\n')
    return `\nWEB SEARCH RESULTS (for: "${query}"):\n${lines}\n(Results may not be current — verify before acting)`
  } catch {
    return ''
  }
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Auth is now REQUIRED — server fetches context from DB
    const user = getUserFromRequest(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const userId = user.userId

    const apiKey = (process.env.OPENAI_API_KEY ?? '').replace(/\s+/g, '')
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI chat is not configured. OPENAI_API_KEY is not set.' },
        { status: 503 },
      )
    }

    // Parse body
    let message: string
    let year: number
    let month: number
    let history: Array<{ role: string; content: string }> = []
    try {
      const body = (await req.json()) as { message?: unknown; year?: unknown; month?: unknown; history?: unknown }
      if (typeof body.message !== 'string' || !body.message.trim()) {
        return NextResponse.json({ error: 'message is required' }, { status: 400 })
      }
      message = body.message.trim()
      year  = typeof body.year === 'number' ? body.year : parseInt(String(body.year ?? ''))
      month = typeof body.month === 'number' ? body.month : parseInt(String(body.month ?? ''))
      if (isNaN(year) || isNaN(month) || month < 1 || month > 12 || year < 2000 || year > 2100) {
        return NextResponse.json({ error: 'Valid year and month are required' }, { status: 400 })
      }
      if (Array.isArray(body.history)) {
        history = (body.history as Array<unknown>)
          .filter((m): m is { role: string; content: string } =>
            typeof (m as { role?: unknown }).role === 'string' &&
            typeof (m as { content?: unknown }).content === 'string'
          )
          .slice(-6)
      }
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    // ── Intent routing ──────────────────────────────────────────────────────
    const msg = message.toLowerCase()
    const needsMerchant = /how many|how often|times|visits|frequency|costco|starbucks|amazon|walmart|safeway|target/.test(msg)
    const needsComparison = /compare|vs |versus|last month|changed|difference|previous/.test(msg)
    const needsSubscriptions = /subscription|trial|recurring|charging|new charge|cancel/.test(msg)
    const tavilyKey = (process.env.TAVILY_API_KEY ?? '').trim()
    const doWebSearch = (needsWebSearch(message) || mentionsLocation(message)) && !!tavilyKey
    console.log('[insights/chat] webSearch:', { doWebSearch, tavilyKeySet: !!tavilyKey, message: message.slice(0, 60) })

    // Extract merchant name if present
    const merchantMatch = message.match(
      /(?:at|from|to|costco|starbucks|amazon|walmart|safeway|target)\s+([A-Za-z0-9\s&']+?)(?:\?|$|this|last|in\s+[A-Z])/i,
    )
    const merchantQuery = merchantMatch ? merchantMatch[1].trim() : null

    // Previous month calculation
    const prevMonth = month === 1 ? 12 : month - 1
    const prevYear  = month === 1 ? year - 1 : year

    // ── Fetch context (parallel) ────────────────────────────────────────────
    const start = new Date(year, month - 1, 1)
    const end   = new Date(year, month, 0, 23, 59, 59)

    const [summary, txRows, merchantStats, comparison, subscriptionData, webSearchResults] = await Promise.all([
      // Always: summary
      computeMonthSummary(userId, year, month),
      // Always: raw transactions (up to 200)
      prisma.transaction.findMany({
        where: {
          account: { userId },
          isExcluded:  false,
          isTransfer:  false,
          isDuplicate: false,
          date: { gte: start, lte: end },
        },
        select: {
          date:               true,
          merchantNormalized: true,
          description:        true,
          amount:             true,
          appCategory:        true,
          category:           { select: { name: true } },
          overrideCategory:   { select: { name: true } },
        },
        orderBy: { date: 'asc' },
        take: 200,
      }),
      // Conditional: merchant stats
      needsMerchant && merchantQuery
        ? getMerchantStats(userId, merchantQuery, year, month).catch(() => null)
        : Promise.resolve(null),
      // Conditional: month comparison
      needsComparison
        ? compareMonths(userId, prevYear, prevMonth, year, month).catch(() => null)
        : Promise.resolve(null),
      // Conditional: subscriptions
      needsSubscriptions
        ? detectSubscriptions(userId, year, month).catch(() => null)
        : Promise.resolve(null),
      // Conditional: web search for price/deal questions
      doWebSearch
        ? tavilySearch(buildSearchQuery(message, history), tavilyKey)
        : Promise.resolve(''),
    ])

    // Map raw transaction rows to a clean shape
    const transactions = txRows.map(tx => {
      const categoryName =
        tx.overrideCategory?.name ??
        tx.category?.name ??
        tx.appCategory ??
        null
      const merchant = tx.merchantNormalized?.trim() || tx.description?.trim() || ''
      const amount = tx.amount < 0 ? Math.abs(tx.amount) : tx.amount
      return {
        date: tx.date.toISOString().slice(0, 10),
        merchant,
        amount,
        category: categoryName,
      }
    })

    // ── Build context block ─────────────────────────────────────────────────
    const monthName = new Date(year, month - 1, 1).toLocaleString('en-US', {
      month: 'long',
      year: 'numeric',
    })

    const savingsRate = summary.totalIncome > 0
      ? Math.max(0, (summary.net / summary.totalIncome) * 100)
      : 0

    const dateRangeStart = summary.dateRangeStart
      ? summary.dateRangeStart.toISOString().slice(0, 10)
      : `${year}-${String(month).padStart(2, '0')}-01`
    const dateRangeEnd = summary.dateRangeEnd
      ? summary.dateRangeEnd.toISOString().slice(0, 10)
      : `${year}-${String(month).padStart(2, '0')}-${end.getDate()}`

    // Category breakdown (spending only)
    const spendingCats = summary.categoryTotals.filter(c => !c.isIncome)
    const catSection = spendingCats.length > 0
      ? spendingCats
          .map(c => `  - ${c.categoryName}: $${c.total.toFixed(2)} (${c.pctOfSpending.toFixed(1)}%, ${c.transactionCount} tx)`)
          .join('\n')
      : '  (no category data)'

    // Top merchants from transactions (top 10 by total spend)
    const merchantMap = new Map<string, { total: number; count: number }>()
    for (const tx of transactions) {
      if (tx.amount > 0 && tx.merchant) {
        const existing = merchantMap.get(tx.merchant) ?? { total: 0, count: 0 }
        merchantMap.set(tx.merchant, { total: existing.total + tx.amount, count: existing.count + 1 })
      }
    }
    const topMerchants = Array.from(merchantMap.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
    const merchantSection = topMerchants.length > 0
      ? topMerchants
          .map(([name, { total, count }]) => `  - ${name}: $${total.toFixed(2)} (${count} tx)`)
          .join('\n')
      : '  (no merchant data)'

    // Individual transactions section
    const txSection = transactions.length > 0
      ? `\nINDIVIDUAL TRANSACTIONS (${transactions.length} total${txRows.length === 200 ? ' — truncated at 200' : ''}):\n` +
        transactions
          .map(tx => `  - ${tx.date} ${tx.merchant}: $${tx.amount.toFixed(2)} (${tx.category ?? 'Uncategorized'})`)
          .join('\n')
      : ''

    // Merchant detail section
    let merchantDetailSection = ''
    if (merchantStats) {
      merchantDetailSection = `
MERCHANT DETAIL — ${merchantStats.merchantNormalized}:
  Visit count: ${merchantStats.visitCount}
  Total spent: $${merchantStats.totalSpent.toFixed(2)}
  Avg per visit: $${merchantStats.avgPerVisit.toFixed(2)}
  Weekly avg: ${merchantStats.weeklyAvg}x/week
  Category: ${merchantStats.category ?? 'Uncategorized'}
  Dates: ${merchantStats.dates.join(', ')}`
    }

    // Comparison section
    let comparisonSection = ''
    if (comparison) {
      const sign = (n: number) => (n >= 0 ? '+' : '')
      comparisonSection = `
MONTH-OVER-MONTH COMPARISON (${comparison.labelA} vs ${comparison.labelB}):
  Spending: $${comparison.spendingA.toFixed(2)} → $${comparison.spendingB.toFixed(2)} (${sign(comparison.spendingDelta)}$${comparison.spendingDelta.toFixed(2)}, ${comparison.spendingDeltaPct != null ? sign(comparison.spendingDeltaPct) + comparison.spendingDeltaPct.toFixed(1) + '%' : 'N/A'})
  Income: $${comparison.incomeA.toFixed(2)} → $${comparison.incomeB.toFixed(2)} (${sign(comparison.incomeDelta)}$${comparison.incomeDelta.toFixed(2)})
  Net: $${comparison.netA.toFixed(2)} → $${comparison.netB.toFixed(2)} (${sign(comparison.netDelta)}$${comparison.netDelta.toFixed(2)})
  Tx count: ${comparison.transactionCountA} → ${comparison.transactionCountB}
  Category changes (by delta):
${comparison.categoryDeltas.map(c => `    - ${c.categoryName}: $${c.amountA.toFixed(2)} → $${c.amountB.toFixed(2)} (${sign(c.delta)}$${c.delta.toFixed(2)})`).join('\n')}`
    }

    // Subscriptions section
    let subscriptionSection = ''
    if (subscriptionData) {
      const highConf = subscriptionData.subscriptions?.filter(c => c.confidence === 'HIGH') ?? []
      const trials = subscriptionData.trials ?? []
      subscriptionSection = `
SUBSCRIPTIONS & RECURRING:
  Active subscriptions (HIGH confidence): ${highConf.length}
${highConf.slice(0, 8).map(s => `    - ${s.merchantNormalized}: $${s.typicalAmount.toFixed(2)}/mo`).join('\n')}
  Trials detected: ${trials.length}
${trials.slice(0, 5).map(t => `    - ${t.merchantNormalized}: $${t.trialAmount.toFixed(2)}`).join('\n')}`
    }

    if (doWebSearch) console.log('[insights/chat] webSearch result chars:', webSearchResults.length, webSearchResults.slice(0, 100))

    const contextBlock = `FINANCIAL DATA FOR ${monthName.toUpperCase()}:${webSearchResults}

Summary:
  Total Income:     $${summary.totalIncome.toFixed(2)}
  Total Spending:   $${summary.totalSpending.toFixed(2)}
  Net:              $${summary.net.toFixed(2)}
  Savings Rate:     ${savingsRate.toFixed(1)}%
  Transaction Count: ${summary.transactionCount}
  Date Range: ${dateRangeStart} → ${dateRangeEnd}

Category Breakdown:
${catSection}

Top Merchants (by spend):
${merchantSection}
${txSection}
${merchantDetailSection}
${comparisonSection}
${subscriptionSection}

IMPORTANT: Only reference the data shown above. Do not invent any numbers, merchants, or categories not listed here.`

    // ── Call OpenAI ─────────────────────────────────────────────────────────
    console.log('[insights/chat] calling OpenAI, userId:', userId, 'key prefix:', apiKey.slice(0, 7))

    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: doWebSearch ? 900 : 600,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          // Financial context is always first, attached to a user turn
          { role: 'user', content: contextBlock },
          { role: 'assistant', content: 'Got it — I have your financial data for this month. What would you like to know?' },
          // Prior conversation turns (skip the opening assistant greeting, max 6)
          ...history
            .filter(m => m.role === 'user' || m.role === 'assistant')
            .slice(-6)
            .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          // Current user message
          { role: 'user', content: message },
        ],
      }),
    })

    if (!oaiRes.ok) {
      const errBody = await oaiRes.text()
      console.error('[insights/chat] OpenAI error:', oaiRes.status, errBody)
      return NextResponse.json({ error: `OpenAI error ${oaiRes.status}: ${errBody}` }, { status: 502 })
    }

    interface OaiChoice { message: { content: string } }
    interface OaiResponse { choices: OaiChoice[] }
    const oaiData = await oaiRes.json() as OaiResponse
    const rawText = oaiData.choices[0]?.message?.content ?? ''

    // ── Parse response ──────────────────────────────────────────────────────

    // 1. Extract FILTERS line
    const filters: Record<string, string> = {}
    const filtersLine = rawText.match(/^FILTERS:(.+)$/m)
    if (filtersLine) {
      const parts = filtersLine[1].split('|').map(s => s.trim())
      for (const part of parts) {
        const [key, val] = part.split('=').map(s => s.trim())
        if (key && val && val !== 'undefined') filters[key] = val
      }
    }

    // 2. Extract Numbers used section
    type NumberEntry = { label: string; value: string }
    let numbersUsed: NumberEntry[] = []
    const nuMatch = rawText.match(/Numbers used:\n((?:•[^\n]+\n?)+)/)
    if (nuMatch) {
      const lines = nuMatch[1].trim().split('\n')
      numbersUsed = lines
        .map(line => {
          const m = line.match(/•\s*(.+?):\s*(.+)/)
          return m ? { label: m[1].trim(), value: m[2].trim() } : null
        })
        .filter((x): x is NumberEntry => x !== null)
    }

    // 3. Clean message: remove FILTERS, Sources, Numbers used block; strip markdown bold
    const cleanedText = rawText
      .replace(/^FILTERS:[^\n]*\n?/m, '')
      .replace(/^Sources:[^\n]*\n?/m, '')
      .replace(/^Numbers used:\n((?:•[^\n]+\n?)+)/m, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .trim()

    return NextResponse.json({
      message: cleanedText,
      numbersUsed,
      ...(Object.keys(filters).length > 0 ? { filters } : {}),
    })

  } catch (err) {
    console.error('[insights/chat] unhandled error:', err)
    const errType = err instanceof Error ? err.constructor.name : 'Unknown'
    const rawMsg = err instanceof Error ? err.message : String(err)
    const safeMsg = rawMsg.replace(/sk-[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    return NextResponse.json({ error: `Chat error [${errType}]: ${safeMsg}` }, { status: 500 })
  }
}
