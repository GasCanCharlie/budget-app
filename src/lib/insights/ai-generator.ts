/**
 * AI Insight Generator
 *
 * Calls OpenAI with a structured prompt to generate 4 fresh, varied insight
 * cards from the user's actual transaction data. Each refresh produces different
 * content because the AI explores different angles of the same dataset.
 */

import { randomUUID } from 'crypto'
import type { InsightCard, ComputedInsightMetrics, AiInsightData } from './types'

const SLOT_TYPES = [
  'ai_insight_1',
  'ai_insight_2',
  'ai_insight_3',
  'ai_insight_4',
] as const

type AiSlotType = typeof SLOT_TYPES[number]

interface AiInsightRaw {
  title: string
  summary: string
  icon: string
  confidence: 'high' | 'medium' | 'low'
  filter_merchant?: string
  filter_category?: string
}

const VALID_ICONS = ['TrendingUp', 'AlertCircle', 'DollarSign', 'Sparkles', 'RefreshCw', 'Zap', 'Wrench']

function buildContext(metrics: ComputedInsightMetrics, monthName: string): string {
  const { monthly, categories, merchants, largeTransactions, subscriptions } = metrics

  const spendingCats = categories
    .filter(c => !c.isIncome && c.currentMonthTotal > 0)
    .sort((a, b) => b.currentMonthTotal - a.currentMonthTotal)
    .slice(0, 8)

  const catLines = spendingCats
    .map(c => `  - ${c.categoryName}: $${c.currentMonthTotal.toFixed(2)} (${c.pctOfSpending.toFixed(1)}%, ${c.transactionCount} transactions)`)
    .join('\n')

  const topMerchants = merchants
    .sort((a, b) => b.merchantTotal - a.merchantTotal)
    .slice(0, 8)

  const merchantLines = topMerchants
    .map(m => `  - ${m.merchantDisplay}: $${m.merchantTotal.toFixed(2)} (${m.merchantCount} visits)`)
    .join('\n')

  const largeTxLines = largeTransactions.slice(0, 5)
    .map(t => `  - ${t.merchant}: $${t.amount.toFixed(2)} (${t.categoryName})`)
    .join('\n')

  const activeSubs = subscriptions.allSubscriptions
    .filter(s => !s.isSuppressed && (s.recurringConfidence === 'high' || s.recurringConfidence === 'medium'))
    .slice(0, 5)

  const subLines = activeSubs
    .map(s => `  - ${s.merchantDisplay}: $${s.estimatedMonthlyAmount.toFixed(2)}/mo`)
    .join('\n')

  return `FINANCIAL DATA — ${monthName.toUpperCase()}

Summary:
  Income:    $${monthly.totalIncome.toFixed(2)}
  Spending:  $${monthly.totalSpending.toFixed(2)}
  Net:       $${monthly.net.toFixed(2)}
  Daily rate: $${monthly.dailySpendingRate.toFixed(2)}/day

Category Breakdown:
${catLines || '  (no category data)'}

Top Merchants:
${merchantLines || '  (no merchant data)'}

${largeTransactions.length > 0 ? `Large Transactions:\n${largeTxLines}` : ''}

${activeSubs.length > 0 ? `Recurring Subscriptions:\n${subLines}\n  Monthly total: $${subscriptions.subscriptionMonthlyTotal.toFixed(2)}` : ''}`
}

export async function generateAiInsights(
  metrics: ComputedInsightMetrics,
): Promise<InsightCard[]> {
  const apiKey = (process.env.OPENAI_API_KEY ?? '').replace(/\s+/g, '')
  if (!apiKey) return []

  const { monthly } = metrics
  const monthName = new Date(monthly.year, monthly.month - 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  })

  const context = buildContext(metrics, monthName)

  const prompt = `You are a sharp financial analyst. Analyze this user's ${monthName} data and generate exactly 4 distinct insights. Each refresh you should explore DIFFERENT angles — look for patterns, savings opportunities, spending habits, comparisons, or actionable observations not immediately obvious.

${context}

Return ONLY a valid JSON array with exactly 4 objects. Each object must have:
- "title": string, max 60 chars, specific and punchy
- "summary": string, 2-3 sentences with real numbers from the data, actionable
- "icon": one of: TrendingUp, AlertCircle, DollarSign, Sparkles, RefreshCw, Zap, Wrench
- "confidence": "high", "medium", or "low"
- "filter_merchant": (optional) exact merchant name from the data if this insight is about a specific merchant
- "filter_category": (optional) exact category name from the data if this insight is about a specific category

Focus on variety — cover different aspects: one on spending patterns, one on a specific merchant or category, one on a saving opportunity or behavior, one surprising or noteworthy finding. Use specific dollar amounts. Do not repeat the same insight type.

Return only the JSON array, no other text.`

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 800,
        temperature: 0.9,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      console.error('[ai-generator] OpenAI error:', res.status)
      return []
    }

    interface OaiResp { choices: Array<{ message: { content: string } }> }
    const data = await res.json() as OaiResp
    const raw = data.choices[0]?.message?.content ?? ''

    // Extract JSON array from response
    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) return []

    const parsed = JSON.parse(match[0]) as unknown[]
    if (!Array.isArray(parsed)) return []

    const now = new Date().toISOString()
    const cards: InsightCard[] = []

    for (let i = 0; i < Math.min(parsed.length, 4); i++) {
      const item = parsed[i] as Record<string, unknown>
      const slotType = SLOT_TYPES[i] as AiSlotType

      const title = typeof item.title === 'string' ? item.title.slice(0, 60) : 'Insight'
      const summary = typeof item.summary === 'string' ? item.summary : ''
      const icon = typeof item.icon === 'string' && VALID_ICONS.includes(item.icon) ? item.icon : 'Sparkles'
      const confidence = ['high', 'medium', 'low'].includes(item.confidence as string)
        ? item.confidence as 'high' | 'medium' | 'low'
        : 'medium'
      const filterMerchant = typeof item.filter_merchant === 'string' ? item.filter_merchant : null
      const filterCategory = typeof item.filter_category === 'string' ? item.filter_category : null

      const baseParams = `year=${monthly.year}&month=${monthly.month}`
      let txHref: string | null = null
      if (filterMerchant) {
        txHref = `/transactions?search=${encodeURIComponent(filterMerchant)}&${baseParams}`
      } else if (filterCategory) {
        txHref = `/transactions?displayCategory=${encodeURIComponent(filterCategory)}&${baseParams}`
      } else {
        txHref = `/transactions?${baseParams}`
      }

      const supportingData: AiInsightData = { ai_generated: true }

      cards.push({
        id: randomUUID(),
        card_type: slotType,
        priority: 5,
        title,
        summary,
        supporting_data: supportingData,
        actions: [{ label: 'View transactions', action_key: 'view_transactions', href: txHref }, { label: 'Dismiss', action_key: 'dismiss' }],
        confidence,
        icon_suggestion: icon,
        generated_at: now,
        year: monthly.year,
        month: monthly.month,
        numbers_used: [],
        filters: filterMerchant ? { merchant: filterMerchant } : filterCategory ? { category: filterCategory } : undefined,
      })
    }

    return cards
  } catch (err) {
    console.error('[ai-generator] error:', err)
    return []
  }
}
