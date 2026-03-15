import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeKey } from '@/lib/intelligence/detect-subscriptions'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DuplicateItem {
  merchant: string
  amount: number
  dates: string[]
}

interface AnomalyItem {
  message: string
  type: string
}

interface SubscriptionItem {
  merchant: string
  amount: number
  confidence: string
}

interface TopMerchant {
  merchant: string
  total: number
  count: number
}

interface CategoryBreakdownItem {
  category: string
  total: number
  pct: number
}

interface ScanReport {
  uploadId: string
  generatedAt: string
  summary: string
  totals: {
    income: number
    spending: number
    net: number
    transactionCount: number
  }
  findings: {
    duplicates: { count: number; items: DuplicateItem[] }
    anomalies: { count: number; items: AnomalyItem[] }
    subscriptions: { count: number; monthlyTotal: number; items: SubscriptionItem[] }
    topMerchants: TopMerchant[]
    categoryBreakdown: CategoryBreakdownItem[]
    balanceIssues: number
    ingestionIssues: { high: number; medium: number; low: number }
  }
}

// ─── Core aggregation ─────────────────────────────────────────────────────────

async function buildReport(uploadId: string, userId: string): Promise<ScanReport> {
  console.log('[scan-report] buildReport called', { uploadId, userId })

  // Verify upload belongs to this user
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, userId },
    select: { id: true, createdAt: true },
  })
  console.log('[scan-report] upload lookup', { found: !!upload, uploadId, userId })
  if (!upload) {
    // Extra diagnostic: check if the upload exists at all (without userId constraint)
    const uploadAny = await prisma.upload.findUnique({ where: { id: uploadId }, select: { id: true, userId: true } })
    console.log('[scan-report] upload exists globally?', { found: !!uploadAny, ownerUserId: uploadAny?.userId, requestUserId: userId })
    throw Object.assign(new Error('Upload not found'), { status: 404 })
  }

  // Fetch all signals in parallel
  const [transactions, ingestionIssues, anomalyAlerts] =
    await Promise.all([
      prisma.transaction.findMany({
        where: { uploadId },
        select: {
          id: true,
          date: true,
          merchantNormalized: true,
          amount: true,
          appCategory: true,
          isPossibleDuplicate: true,
          bankFingerprint: true,
          balanceChainValid: true,
        },
      }),
      prisma.ingestionIssue.findMany({
        where: { uploadId },
        select: { issueType: true, severity: true, description: true },
      }),
      prisma.anomalyAlert.findMany({
        where: { userId },
        select: { alertType: true, message: true, isDismissed: true },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ])

  // ── Totals ────────────────────────────────────────────────────────────────

  let totalIncome = 0
  let totalSpending = 0

  for (const tx of transactions) {
    if (tx.amount > 0) totalIncome += tx.amount
    else totalSpending += Math.abs(tx.amount)
  }

  const net = totalIncome - totalSpending
  const transactionCount = transactions.length

  // ── Duplicates ────────────────────────────────────────────────────────────

  const dupTxs = transactions.filter(tx => tx.isPossibleDuplicate)
  // Group by bankFingerprint
  const dupGroups = new Map<string, typeof dupTxs>()
  for (const tx of dupTxs) {
    const key = tx.bankFingerprint || tx.id
    if (!dupGroups.has(key)) dupGroups.set(key, [])
    dupGroups.get(key)!.push(tx)
  }

  const duplicateItems: DuplicateItem[] = []
  for (const [, group] of dupGroups) {
    duplicateItems.push({
      merchant: group[0].merchantNormalized || 'Unknown',
      amount: Math.abs(group[0].amount),
      dates: group.map(tx => tx.date.toISOString().split('T')[0]),
    })
  }

  // ── Anomalies ─────────────────────────────────────────────────────────────

  const anomalyItems: AnomalyItem[] = anomalyAlerts
    .filter(a => !a.isDismissed)
    .map(a => ({ message: a.message, type: a.alertType }))

  // ── Subscriptions (inline detection scoped to this upload) ───────────────
  // Group negative transactions by normalized merchant key and detect recurring
  // patterns inline — no category filter so uncategorized uploads still work.

  const merchantGroups = new Map<string, { amounts: number[]; dates: Date[] }>()
  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    const key = normalizeKey(tx.merchantNormalized || '')
    if (!key || key.length < 2) continue
    if (!merchantGroups.has(key)) merchantGroups.set(key, { amounts: [], dates: [] })
    const g = merchantGroups.get(key)!
    g.amounts.push(Math.abs(tx.amount))
    g.dates.push(tx.date)
  }

  const subscriptionItems: SubscriptionItem[] = []
  for (const [merchant, { amounts, dates }] of merchantGroups) {
    if (amounts.length < 2) continue
    const mean = amounts.reduce((s, a) => s + a, 0) / amounts.length
    if (mean < 2) continue
    const stdDev = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / amounts.length)
    const cv = (stdDev / mean) * 100
    if (cv > 40) continue

    // Check that intervals suggest a recurring pattern (weekly / biweekly / monthly / annual)
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime())
    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      intervals.push((sorted[i].getTime() - sorted[i - 1].getTime()) / 86_400_000)
    }
    const avgInterval = intervals.reduce((s, d) => s + d, 0) / intervals.length
    const isRecurring =
      (avgInterval >= 5  && avgInterval <= 9)  ||   // weekly
      (avgInterval >= 12 && avgInterval <= 16) ||   // biweekly
      (avgInterval >= 20 && avgInterval <= 40) ||   // monthly
      (avgInterval >= 340 && avgInterval <= 400)    // annual
    if (!isRecurring) continue

    const confidence = cv < 10 && amounts.length >= 3 ? 'high' : cv < 25 ? 'medium' : 'low'
    subscriptionItems.push({ merchant, amount: mean, confidence })
  }
  subscriptionItems.sort((a, b) => b.amount - a.amount)

  const monthlyTotal = subscriptionItems.reduce((sum, s) => sum + s.amount, 0)

  // ── Top merchants ─────────────────────────────────────────────────────────

  const merchantMap = new Map<string, { total: number; count: number }>()
  for (const tx of transactions) {
    if (tx.amount >= 0) continue // only spending
    const key = tx.merchantNormalized || 'Unknown'
    const existing = merchantMap.get(key) ?? { total: 0, count: 0 }
    merchantMap.set(key, {
      total: existing.total + Math.abs(tx.amount),
      count: existing.count + 1,
    })
  }

  const topMerchants: TopMerchant[] = Array.from(merchantMap.entries())
    .map(([merchant, { total, count }]) => ({ merchant, total, count }))
    .sort((a, b) => b.total - a.total)

  // ── Category breakdown ────────────────────────────────────────────────────

  const catMap = new Map<string, number>()
  for (const tx of transactions) {
    if (tx.amount >= 0) continue
    const cat = tx.appCategory || 'Uncategorized'
    catMap.set(cat, (catMap.get(cat) ?? 0) + Math.abs(tx.amount))
  }

  const catTotal = Array.from(catMap.values()).reduce((s, v) => s + v, 0)
  const categoryBreakdown: CategoryBreakdownItem[] = Array.from(catMap.entries())
    .map(([category, total]) => ({
      category,
      total,
      pct: catTotal > 0 ? Math.round((total / catTotal) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  // ── Balance issues ────────────────────────────────────────────────────────

  const balanceIssues = transactions.filter(
    tx => tx.balanceChainValid === false,
  ).length

  // ── Ingestion issues grouped by severity ─────────────────────────────────

  const issuesBySeverity = { high: 0, medium: 0, low: 0 }
  for (const issue of ingestionIssues) {
    const sev = issue.severity.toUpperCase()
    if (sev === 'ERROR') issuesBySeverity.high++
    else if (sev === 'WARNING') issuesBySeverity.medium++
    else issuesBySeverity.low++
  }

  // ── AI or rule-based narrative ────────────────────────────────────────────

  const summary = await generateSummary({
    totalIncome,
    totalSpending,
    net,
    transactionCount,
    duplicateCount: duplicateItems.length,
    anomalyCount: anomalyItems.length,
    subscriptionCount: subscriptionItems.length,
    monthlySubTotal: monthlyTotal,
    topMerchant: topMerchants[0] ?? null,
    balanceIssues,
    ingestionIssues: issuesBySeverity,
  })

  return {
    uploadId,
    generatedAt: new Date().toISOString(),
    summary,
    totals: { income: totalIncome, spending: totalSpending, net, transactionCount },
    findings: {
      duplicates: { count: duplicateItems.length, items: duplicateItems },
      anomalies: { count: anomalyItems.length, items: anomalyItems },
      subscriptions: { count: subscriptionItems.length, monthlyTotal, items: subscriptionItems },
      topMerchants,
      categoryBreakdown,
      balanceIssues,
      ingestionIssues: issuesBySeverity,
    },
  }
}

// ─── Summary generator ────────────────────────────────────────────────────────

interface SummaryInput {
  totalIncome: number
  totalSpending: number
  net: number
  transactionCount: number
  duplicateCount: number
  anomalyCount: number
  subscriptionCount: number
  monthlySubTotal: number
  topMerchant: { merchant: string; total: number } | null
  balanceIssues: number
  ingestionIssues: { high: number; medium: number; low: number }
}

async function generateSummary(input: SummaryInput): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY
  if (apiKey) {
    try {
      const prompt = buildPrompt(input)
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'system',
              content:
                'You are a concise financial analyst writing plain-English summaries of bank statement scans. ' +
                'Write 3-4 sentences. Be specific with numbers. Do not use markdown.',
            },
            { role: 'user', content: prompt },
          ],
          max_tokens: 200,
          temperature: 0.4,
        }),
      })

      if (res.ok) {
        const data = await res.json() as {
          choices?: { message?: { content?: string } }[]
        }
        const text = data.choices?.[0]?.message?.content?.trim()
        if (text) return text
      }
    } catch {
      // fall through to rule-based
    }
  }

  return buildRuleBasedSummary(input)
}

function buildPrompt(input: SummaryInput): string {
  const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`
  return [
    `Statement scan results:`,
    `- Total income: ${fmt(input.totalIncome)}`,
    `- Total spending: ${fmt(input.totalSpending)}`,
    `- Net: ${input.net >= 0 ? '+' : ''}${fmt(input.net)}`,
    `- Transactions: ${input.transactionCount}`,
    `- Possible duplicate transactions: ${input.duplicateCount}`,
    `- Anomaly alerts: ${input.anomalyCount}`,
    `- Recurring subscriptions detected: ${input.subscriptionCount} (est. ${fmt(input.monthlySubTotal)}/mo)`,
    input.topMerchant
      ? `- Top merchant by spend: ${input.topMerchant.merchant} (${fmt(input.topMerchant.total)})`
      : '',
    `- Balance chain issues: ${input.balanceIssues}`,
    `- High-severity ingestion issues: ${input.ingestionIssues.high}`,
    `Please write a 3-4 sentence summary of the financial health and any notable findings.`,
  ]
    .filter(Boolean)
    .join('\n')
}

function buildRuleBasedSummary(input: SummaryInput): string {
  const fmt = (n: number) => '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const netLabel = input.net >= 0 ? `a surplus of ${fmt(input.net)}` : `a deficit of ${fmt(Math.abs(input.net))}`

  const parts: string[] = [
    `This statement contains ${input.transactionCount} transaction${input.transactionCount !== 1 ? 's' : ''} with ${fmt(input.totalIncome)} in income and ${fmt(input.totalSpending)} in spending, resulting in ${netLabel}.`,
  ]

  if (input.subscriptionCount > 0) {
    parts.push(
      `${input.subscriptionCount} recurring subscription${input.subscriptionCount !== 1 ? 's' : ''} were detected totaling an estimated ${fmt(input.monthlySubTotal)} per month.`,
    )
  }

  if (input.duplicateCount > 0 || input.anomalyCount > 0) {
    const flags: string[] = []
    if (input.duplicateCount > 0) flags.push(`${input.duplicateCount} possible duplicate${input.duplicateCount !== 1 ? 's' : ''}`)
    if (input.anomalyCount > 0) flags.push(`${input.anomalyCount} anomal${input.anomalyCount !== 1 ? 'ies' : 'y'}`)
    parts.push(`The scan flagged ${flags.join(' and ')} that may need your review.`)
  }

  if (input.topMerchant) {
    parts.push(
      `Your top merchant by spending was ${input.topMerchant.merchant} at ${fmt(input.topMerchant.total)}.`,
    )
  }

  if (input.ingestionIssues.high > 0) {
    parts.push(
      `There ${input.ingestionIssues.high === 1 ? 'is' : 'are'} ${input.ingestionIssues.high} high-severity ingestion issue${input.ingestionIssues.high !== 1 ? 's' : ''} that could affect accuracy.`,
    )
  }

  return parts.join(' ')
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const report = await buildReport(params.id, payload.userId)
    return NextResponse.json(report)
  } catch (err) {
    const e = err as Error & { status?: number }
    if (e.status === 404) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    console.error('GET scan-report error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const report = await buildReport(params.id, payload.userId)
    return NextResponse.json(report)
  } catch (err) {
    const e = err as Error & { status?: number }
    if (e.status === 404) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
    console.error('POST scan-report error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
