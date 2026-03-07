/**
 * Import Scrubbing — Layer 2
 *
 * Pure client-safe module. No DB, no API calls, no server-only imports.
 * Runs in-memory on the staging transaction array to produce an ImportSummary
 * with category suggestions, duplicate flags, transfer flags, and recurring detection.
 *
 * Nothing here is persisted. All suggestions are session-level only.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

interface StagingTx {
  id: string
  vendorRaw: string
  vendorKey: string
  amountCents: number
  date: string | null
  description: string
  status: 'uncategorized' | 'categorized' | 'needs_review' | 'excluded' | 'transfer'
}

export type Confidence = 'high' | 'medium' | 'low'

export interface TxSuggestion {
  category: string
  confidence: Confidence
  isDuplicate: boolean
  isTransfer: boolean
  isIncome: boolean
  isRecurring: boolean
  normalizedMerchant: string
}

export interface ImportSummary {
  transactionCount: number
  categoryBreakdown: Array<{ category: string; count: number }>
  recurringCount: number
  transferCount: number
  needsReview: number
  incomeCount: number
  suggestions: Map<string, TxSuggestion>
}

// ─── Merchant normalization (client-safe copy) ────────────────────────────────

function normalizeMerchantDisplay(raw: string): string {
  let s = raw.toLowerCase().trim()
  // Strip bank metadata noise: state code + "Date ..."
  s = s.replace(/\s+[a-z]{2}\s+date[\s\S]*/i, '').trim()
  s = s.replace(/\s+date\s+[\dx/]+\s+xx\s+x[\s\S]*/i, '').trim()
  s = s.replace(/\s+(type|co|id\d*):\s+[\s\S]*/i, '').trim()
  s = s.replace(/\s+card\s+\d+[\s\S]*/i, '').trim()
  // Strip noise tokens
  s = s
    .replace(/\*+/g, ' ')
    .replace(/#\s*\d+/g, '')
    .replace(/\d{4,}/g, '')
    .replace(/\b(debit|credit|purchase|pos|sq\s*\*|tst\*|ach|www\.)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  // Strip trailing state code / city
  s = s.replace(/\s+[a-z]{2}\s*$/, '').trim()
  s = s.replace(/,\s*[a-z\s]+$/, '').trim()
  // Title case
  return s.split(' ').map(w => w ? w.charAt(0).toUpperCase() + w.slice(1) : '').join(' ').trim()
}

// ─── Category keyword mapping (client-safe, no DB) ───────────────────────────

const KEYWORDS: Array<[string, string, Confidence]> = [
  // Groceries — high confidence
  ['whole foods', 'Groceries', 'high'], ['safeway', 'Groceries', 'high'],
  ['trader joe', 'Groceries', 'high'], ['kroger', 'Groceries', 'high'],
  ['publix', 'Groceries', 'high'], ['aldi', 'Groceries', 'high'],
  ['wegmans', 'Groceries', 'high'], ['sprouts', 'Groceries', 'high'],
  ['foodland', 'Groceries', 'high'], ['times supermarket', 'Groceries', 'high'],
  ['walmart', 'Shopping', 'high'], ['target', 'Shopping', 'high'],
  // Food & Dining
  ['mcdonald', 'Food & Dining', 'high'], ['starbucks', 'Food & Dining', 'high'],
  ['subway', 'Food & Dining', 'high'], ['chipotle', 'Food & Dining', 'high'],
  ['doordash', 'Food & Dining', 'high'], ['grubhub', 'Food & Dining', 'high'],
  ['uber eats', 'Food & Dining', 'high'], ['taco bell', 'Food & Dining', 'high'],
  ['burger king', 'Food & Dining', 'high'], ['pizza hut', 'Food & Dining', 'high'],
  ['domino', 'Food & Dining', 'high'], ['panera', 'Food & Dining', 'high'],
  ['dunkin', 'Food & Dining', 'high'], ['chick-fil-a', 'Food & Dining', 'high'],
  ['wendy', 'Food & Dining', 'high'], ['panda express', 'Food & Dining', 'high'],
  ['postmates', 'Food & Dining', 'high'], ['instacart', 'Food & Dining', 'medium'],
  // Transport / Fuel
  ['shell ', 'Transport', 'high'], ['chevron', 'Transport', 'high'],
  ['exxon', 'Transport', 'high'], ['mobil', 'Transport', 'high'],
  ['texaco', 'Transport', 'high'], ['valero', 'Transport', 'high'],
  ['speedway', 'Transport', 'high'], ['circle k', 'Transport', 'high'],
  ['wawa', 'Transport', 'high'], ['sheetz', 'Transport', 'high'],
  ['uber', 'Transport', 'medium'], ['lyft', 'Transport', 'high'],
  ['e-zpass', 'Transport', 'high'], ['ezpass', 'Transport', 'high'],
  ['autozone', 'Transport', 'high'], ['jiffy lube', 'Transport', 'high'],
  // Entertainment / Subscriptions
  ['netflix', 'Entertainment', 'high'], ['hulu', 'Entertainment', 'high'],
  ['disney', 'Entertainment', 'high'], ['hbo', 'Entertainment', 'high'],
  ['paramount', 'Entertainment', 'high'], ['peacock', 'Entertainment', 'high'],
  ['spotify', 'Subscriptions', 'high'], ['apple.com/bill', 'Subscriptions', 'high'],
  ['google play', 'Subscriptions', 'high'], ['microsoft', 'Subscriptions', 'medium'],
  ['adobe', 'Subscriptions', 'high'], ['dropbox', 'Subscriptions', 'high'],
  ['notion', 'Subscriptions', 'high'], ['openai', 'Subscriptions', 'high'],
  ['chatgpt', 'Subscriptions', 'high'], ['anthropic', 'Subscriptions', 'high'],
  ['zoom', 'Subscriptions', 'high'], ['github', 'Subscriptions', 'high'],
  // Shopping
  ['amazon', 'Shopping', 'high'], ['costco', 'Shopping', 'high'],
  ['home depot', 'Shopping', 'high'], ['lowes', 'Shopping', 'high'],
  ['best buy', 'Shopping', 'high'], ['ikea', 'Shopping', 'high'],
  ['wayfair', 'Shopping', 'high'], ['ebay', 'Shopping', 'high'],
  ['etsy', 'Shopping', 'high'], ['kohls', 'Shopping', 'high'],
  ['tj maxx', 'Shopping', 'high'], ['marshalls', 'Shopping', 'high'],
  // Health
  ['cvs', 'Health', 'high'], ['walgreens', 'Health', 'high'],
  ['rite aid', 'Health', 'high'], ['longs drug', 'Health', 'high'],
  ['planet fitness', 'Health', 'high'], ['la fitness', 'Health', 'high'],
  ['ymca', 'Health', 'high'],
  // Utilities
  ['at&t', 'Utilities', 'high'], ['verizon', 'Utilities', 'high'],
  ['t-mobile', 'Utilities', 'high'], ['xfinity', 'Utilities', 'high'],
  ['comcast', 'Utilities', 'high'], ['spectrum', 'Utilities', 'high'],
  // Travel
  ['airbnb', 'Travel', 'high'], ['marriott', 'Travel', 'high'],
  ['hilton', 'Travel', 'high'], ['delta air', 'Travel', 'high'],
  ['united air', 'Travel', 'high'], ['southwest air', 'Travel', 'high'],
  ['expedia', 'Travel', 'high'], ['booking.com', 'Travel', 'high'],
  // Insurance
  ['usaa', 'Insurance', 'high'], ['geico', 'Insurance', 'high'],
  ['state farm', 'Insurance', 'high'], ['allstate', 'Insurance', 'high'],
  ['progressive', 'Insurance', 'high'],
  // Income / Transfer detection
  ['direct dep', 'Income', 'high'], ['payroll', 'Income', 'high'],
  ['salary', 'Income', 'high'], ['employer', 'Income', 'medium'],
  ['zelle', 'Transfer', 'high'], ['venmo', 'Transfer', 'high'],
  ['paypal', 'Transfer', 'medium'], ['cash app', 'Transfer', 'high'],
  ['bank transfer', 'Transfer', 'high'], ['loan pymt', 'Transfer', 'high'],
  ['mortgage', 'Transfer', 'high'],
  // Fees
  ['annual fee', 'Fees & Charges', 'high'], ['late payment', 'Fees & Charges', 'high'],
  ['overdraft', 'Fees & Charges', 'high'], ['foreign transaction', 'Fees & Charges', 'high'],
]

function suggestCategory(
  vendorRaw: string,
  amountCents: number,
  expensesAreNegative: boolean,
): { category: string; confidence: Confidence } | null {
  const lower = vendorRaw.toLowerCase()

  for (const [keyword, category, confidence] of KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return { category, confidence }
    }
  }

  // Income heuristic: if sign convention is that expenses are negative
  // and this is positive, it's likely income
  const isPositive = amountCents > 0
  const likelyIncome = expensesAreNegative ? isPositive : !isPositive
  if (likelyIncome) return { category: 'Income', confidence: 'low' }

  return null
}

// ─── Main scrubbing function ──────────────────────────────────────────────────

export function scrubTransactions(transactions: StagingTx[]): ImportSummary {
  const active = transactions.filter(tx => tx.status !== 'excluded')
  const transactionCount = active.length

  // Detect sign convention
  const nonZero = active.filter(tx => tx.amountCents !== 0)
  const negCount = nonZero.filter(tx => tx.amountCents < 0).length
  const expensesAreNegative = negCount > nonZero.length / 2

  // ── Duplicate detection ───────────────────────────────────────────────────
  const seenKeys = new Map<string, number>()
  const duplicateIds = new Set<string>()
  for (const tx of active) {
    const key = `${tx.date}|${tx.vendorKey}|${tx.amountCents}`
    const count = seenKeys.get(key) ?? 0
    seenKeys.set(key, count + 1)
    if (count > 0) duplicateIds.add(tx.id)
  }

  // ── Recurring detection ───────────────────────────────────────────────────
  const byVendor = new Map<string, number[]>()
  for (const tx of active) {
    if (!tx.vendorKey?.trim()) continue
    const spending = expensesAreNegative ? tx.amountCents < 0 : tx.amountCents > 0
    if (!spending) continue
    const arr = byVendor.get(tx.vendorKey) ?? []
    arr.push(Math.abs(tx.amountCents))
    byVendor.set(tx.vendorKey, arr)
  }
  const recurringVendors = new Set<string>()
  for (const [vendor, amounts] of byVendor.entries()) {
    if (amounts.length < 2) continue
    const ref = amounts[0]
    if (amounts.every(a => Math.abs(a - ref) <= ref * 0.1)) recurringVendors.add(vendor)
  }

  // ── Per-transaction scrubbing ─────────────────────────────────────────────
  const suggestions = new Map<string, TxSuggestion>()
  const catCounts = new Map<string, number>()
  let transferCount = 0
  let incomeCount = 0
  let needsReview = 0

  for (const tx of active) {
    const normalizedMerchant = normalizeMerchantDisplay(tx.vendorRaw)
    const suggestion = suggestCategory(tx.vendorRaw, tx.amountCents, expensesAreNegative)
    const isDuplicate = duplicateIds.has(tx.id)
    const isRecurring = tx.vendorKey ? recurringVendors.has(tx.vendorKey) : false
    const isTransfer = suggestion?.category === 'Transfer'
    const isIncome = suggestion?.category === 'Income'

    if (isTransfer) transferCount++
    if (isIncome) incomeCount++
    if (!suggestion || suggestion.confidence === 'low') needsReview++

    const cat = suggestion?.category ?? 'Uncategorized'
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1)

    suggestions.set(tx.id, {
      category: cat,
      confidence: suggestion?.confidence ?? 'low',
      isDuplicate,
      isTransfer,
      isIncome,
      isRecurring,
      normalizedMerchant,
    })
  }

  const categoryBreakdown = Array.from(catCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([category, count]) => ({ category, count }))

  return {
    transactionCount,
    categoryBreakdown,
    recurringCount: recurringVendors.size,
    transferCount,
    needsReview,
    incomeCount,
    suggestions,
  }
}
