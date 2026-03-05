/**
 * POST /api/insights/chat
 * Auth: JWT cookie / Bearer
 *
 * Body: { message: string, context: AiChatContext }
 *
 * Returns a JSON response from OpenAI (gpt-4o-mini).
 * The AI receives only structured numeric context — never raw transaction text.
 * Returns: { message: string }
 *
 * If OPENAI_API_KEY is not set, returns 503.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'

// ─── AiChatContext ────────────────────────────────────────────────────────────

interface CategoryTotal {
  name: string
  total: number
  pctOfSpending: number
  transactionCount: number
}

interface TopMerchant {
  merchantNormalized: string
  totalAmount: number
  transactionCount: number
}

interface AiChatContext {
  month: number
  year: number
  totalIncome: number
  totalSpending: number
  net: number
  savingsRatePct: number
  categoryTotals: CategoryTotal[]
  topMerchants: TopMerchant[]
  momSpendingPctChange: number | null
  momIncomePctChange: number | null
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a warm, insightful financial assistant for BudgetLens. You may ONLY reference the structured financial data provided. Never invent merchants, amounts, categories, or dates. If you cannot answer from the provided data, say exactly: "I don't have enough data to answer that."

Rules:
- Give the real numbers clearly and specifically (totals, deltas, percentages)
- Use a metaphor or everyday analogy to make the numbers feel intuitive (e.g. "that's roughly the cost of a round-trip flight" or "think of it like leaving a tap dripping")
- Use neutral, non-judgmental language always
- End EVERY response with a short, soothing wisdom saying or proverb — original, poetic, and unique to the situation. Never repeat the same saying twice. It should feel like a gentle reminder that money is a tool, not a measure of worth.
- Format: numbers first, metaphor woven in, then a "—" separator, then the wisdom saying on its own line in italics
- Sources last: "Sources: [fields referenced]"

Example closing format:
—
*"A river doesn't rush — it simply finds its way."*

Sources: totalSpending, categoryTotals`

// ─── Context formatter ────────────────────────────────────────────────────────

function formatContext(ctx: AiChatContext): string {
  const monthName = new Date(ctx.year, ctx.month - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const cats = ctx.categoryTotals
    .map(c => `  - ${c.name}: $${c.total.toFixed(2)} (${c.pctOfSpending.toFixed(1)}% of spending${c.transactionCount != null ? `, ${c.transactionCount} transactions` : ''})`)
    .join('\n')

  const merchants = ctx.topMerchants
    .map(m => `  - ${m.merchantNormalized}: $${m.totalAmount.toFixed(2)} (${m.transactionCount} transactions)`)
    .join('\n')

  const savingsRate = ctx.savingsRatePct != null
    ? ctx.savingsRatePct
    : ctx.totalIncome > 0 ? ((ctx.net / ctx.totalIncome) * 100) : 0

  const momSpending = ctx.momSpendingPctChange != null
    ? `Month-over-month spending change: ${ctx.momSpendingPctChange >= 0 ? '+' : ''}${ctx.momSpendingPctChange.toFixed(1)}%`
    : 'Month-over-month spending change: insufficient data'

  const momIncome = ctx.momIncomePctChange != null
    ? `Month-over-month income change: ${ctx.momIncomePctChange >= 0 ? '+' : ''}${ctx.momIncomePctChange.toFixed(1)}%`
    : 'Month-over-month income change: insufficient data'

  return `FINANCIAL DATA FOR ${monthName.toUpperCase()}:

Summary:
  Total Income:   $${ctx.totalIncome.toFixed(2)}
  Total Spending: $${ctx.totalSpending.toFixed(2)}
  Net:            $${ctx.net.toFixed(2)}
  Savings Rate:   ${savingsRate.toFixed(1)}%

${momSpending}
${momIncome}

Category Breakdown:
${cats || '  (no category data)'}

Top Merchants:
${merchants || '  (no merchant data)'}

IMPORTANT: Only reference the data shown above. Do not invent any numbers, merchants, or categories not listed here.`
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Auth is optional — low-risk endpoint (aggregated numeric context only)
    const user = getUserFromRequest(req)
    if (user) console.log('[insights/chat] userId:', user.userId)

    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return NextResponse.json(
        { error: 'AI chat is not configured. OPENAI_API_KEY is not set.' },
        { status: 503 },
      )
    }

    let message: string
    let context: AiChatContext
    try {
      const body = (await req.json()) as { message?: unknown; context?: unknown }
      if (typeof body.message !== 'string' || !body.message.trim()) {
        return NextResponse.json({ error: 'message is required' }, { status: 400 })
      }
      message = body.message.trim()
      context = body.context as AiChatContext
      if (!context || typeof context.totalIncome !== 'number') {
        return NextResponse.json({ error: 'context is required' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const contextBlock = formatContext(context)

    console.log('[insights/chat] calling OpenAI, key prefix:', apiKey.slice(0, 7))

    const oaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 512,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `${contextBlock}\n\nUser question: ${message}` },
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
    const data = await oaiRes.json() as OaiResponse
    const responseText = data.choices[0]?.message?.content ?? ''
    return NextResponse.json({ message: responseText })

  } catch (err) {
    console.error('[insights/chat] unhandled error:', err)
    const errType = err instanceof Error ? err.constructor.name : 'Unknown'
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Chat error [${errType}]: ${msg}` }, { status: 500 })
  }
}
