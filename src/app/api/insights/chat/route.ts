/**
 * POST /api/insights/chat
 * Auth: JWT cookie / Bearer
 *
 * Body: { message: string, context: AiChatContext }
 *
 * Streams a response from OpenAI (gpt-4o-mini).
 * The AI receives only structured numeric context — never raw transaction text.
 * Returns: ReadableStream (text/plain; charset=utf-8)
 *
 * If OPENAI_API_KEY is not set, returns 503.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import OpenAI from 'openai'

// ─── AiChatContext (mirrors Turn 1 spec) ─────────────────────────────────────

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

const SYSTEM_PROMPT = `You are a financial assistant for BudgetLens. You may ONLY reference the structured financial data provided. Never invent merchants, amounts, categories, or dates. If you cannot answer from the provided data, say exactly: "I don't have enough data to answer that."

Rules:
- Cite specific numbers from the context in every response
- Maximum 3 short paragraphs
- Use neutral language (never judgmental)
- End every response with "Sources: [list the specific fields you referenced]"`

// ─── Context formatter ────────────────────────────────────────────────────────

function formatContext(ctx: AiChatContext): string {
  const monthName = new Date(ctx.year, ctx.month - 1, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const cats = ctx.categoryTotals
    .map(c => `  - ${c.name}: $${c.total.toFixed(2)} (${c.pctOfSpending.toFixed(1)}% of spending, ${c.transactionCount} transactions)`)
    .join('\n')

  const merchants = ctx.topMerchants
    .map(m => `  - ${m.merchantNormalized}: $${m.totalAmount.toFixed(2)} (${m.transactionCount} transactions)`)
    .join('\n')

  const momSpending =
    ctx.momSpendingPctChange !== null
      ? `Month-over-month spending change: ${ctx.momSpendingPctChange >= 0 ? '+' : ''}${ctx.momSpendingPctChange.toFixed(1)}%`
      : 'Month-over-month spending change: insufficient data'

  const momIncome =
    ctx.momIncomePctChange !== null
      ? `Month-over-month income change: ${ctx.momIncomePctChange >= 0 ? '+' : ''}${ctx.momIncomePctChange.toFixed(1)}%`
      : 'Month-over-month income change: insufficient data'

  return `FINANCIAL DATA FOR ${monthName.toUpperCase()}:

Summary:
  Total Income:   $${ctx.totalIncome.toFixed(2)}
  Total Spending: $${ctx.totalSpending.toFixed(2)}
  Net:            $${ctx.net.toFixed(2)}
  Savings Rate:   ${ctx.savingsRatePct.toFixed(1)}%

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
  const user = getUserFromRequest(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

  const client = new OpenAI({ apiKey })
  const contextBlock = formatContext(context)

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const response = await client.chat.completions.create({
          model: 'gpt-4o-mini',
          max_tokens: 512,
          stream: true,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `${contextBlock}\n\nUser question: ${message}` },
          ],
        })

        for await (const chunk of response) {
          const text = chunk.choices[0]?.delta?.content ?? ''
          if (text) {
            controller.enqueue(new TextEncoder().encode(text))
          }
        }

        controller.close()
      } catch (err) {
        console.error('[insights/chat] stream error:', err)
        controller.error(err)
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
