/**
 * Import Scrubbing — Layer 2
 *
 * Pure client-safe module. No DB, no API calls, no server-only imports.
 * Runs in-memory on the staging transaction array to produce an ImportSummary
 * with category suggestions, duplicate flags, transfer flags, and recurring detection.
 *
 * Nothing here is persisted. All suggestions are session-level only.
 */

import { mapBankCategoryToName } from '@/lib/categorization/bank-category-map'

// ─── Types ────────────────────────────────────────────────────────────────────

interface StagingTx {
  id: string
  vendorRaw: string
  vendorKey: string
  amountCents: number
  date: string | null
  description: string
  status: 'uncategorized' | 'categorized' | 'needs_review' | 'excluded' | 'transfer'
  /** Raw bank-provided category string from the CSV (e.g. "Gasoline/Fuel") */
  bankCategoryRaw?: string | null
}

export type Confidence = 'high' | 'medium' | 'low'

export type MerchantType =
  | 'grocery'
  | 'gas'
  | 'restaurant'
  | 'transport'
  | 'income'
  | 'transfer'
  | 'subscription'
  | 'shopping'
  | 'utility'
  | 'health'
  | 'travel'
  | 'insurance'
  | 'fees'
  | 'unknown'

export type ReviewFlag =
  | 'aggregator_prefix'
  | 'unclear_merchant'
  | 'possible_transfer'
  | 'possible_income'
  | 'needs_manual_review'

export interface TxSuggestion {
  // Original display
  normalizedMerchant: string
  canonicalMerchant: string
  merchantConfidence: Confidence
  merchantType: MerchantType
  // Category suggestion
  category: string
  confidence: Confidence
  /** 'bank' = came from CSV Transaction Category column; 'engine' = merchant/keyword engine */
  categorySource: 'bank' | 'engine'
  // Flags
  isDuplicate: boolean
  isTransfer: boolean
  isIncome: boolean
  isRecurring: boolean
  reviewFlags: ReviewFlag[]
}

// ─── Filter discriminant ──────────────────────────────────────────────────────

export type ScrubFilter =
  | { kind: 'category'; value: string }
  | { kind: 'merchant_type'; value: MerchantType }
  | { kind: 'canonical_merchant'; value: string }
  | { kind: 'recurring' }
  | { kind: 'transfer' }
  | { kind: 'income' }
  | { kind: 'needs_review' }

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

// ─── Aggregator prefix stripping ─────────────────────────────────────────────

const AGGREGATOR_RE = /^(paypal\s*\*|sq\s*\*|tst\s*\*|ach\s+(credit|debit)\s+|pos\s+(debit|purchase)\s+|visa\s+purchase\s+|checkcard\s+|debit\s+card\s+|zelle\s+(payment\s+to|payment\s+from|to|from)\s+|venmo\s+payment\s+)/i

function stripAggregatorPrefix(raw: string): { stripped: string; hasAggregator: boolean } {
  const match = AGGREGATOR_RE.exec(raw.trim())
  if (match) return { stripped: raw.trim().slice(match[0].length).trim(), hasAggregator: true }
  return { stripped: raw.trim(), hasAggregator: false }
}

// ─── Canonical merchant map ───────────────────────────────────────────────────
// [pattern, canonicalName, merchantType]

const CANONICAL: Array<[RegExp, string, MerchantType]> = [
  // Amazon variants
  [/\bamazon\b|\bamzn\b/i, 'Amazon', 'shopping'],
  // Apple
  [/\bapple\.com\/bill\b|\bapple\s+cash\b|\bitunes\b/i, 'Apple', 'subscription'],
  // Google
  [/\bgoogle\s+play\b|\bgoogle\s+\*\b/i, 'Google Play', 'subscription'],
  // Grocery
  [/\bsafeway\b/i, 'Safeway', 'grocery'],
  [/\bwhole\s+foods\b/i, 'Whole Foods', 'grocery'],
  [/\btrader\s+joe/i, "Trader Joe's", 'grocery'],
  [/\bkroger\b/i, 'Kroger', 'grocery'],
  [/\bpublix\b/i, 'Publix', 'grocery'],
  [/\baldi\b/i, 'Aldi', 'grocery'],
  [/\bwegmans\b/i, 'Wegmans', 'grocery'],
  [/\bsprouts\b/i, 'Sprouts', 'grocery'],
  [/\bfoodland\b/i, 'Foodland', 'grocery'],
  [/\btimes\s+supermarket\b/i, 'Times Supermarket', 'grocery'],
  [/\bwalmarts?\b/i, 'Walmart', 'shopping'],
  [/\btarget\b/i, 'Target', 'shopping'],
  // Gas stations
  [/\bshell\b/i, 'Shell', 'gas'],
  [/\bchevron\b/i, 'Chevron', 'gas'],
  [/\bexxon(mobil)?\b/i, 'ExxonMobil', 'gas'],
  [/\bmobil\b/i, 'Mobil', 'gas'],
  [/\btexaco\b/i, 'Texaco', 'gas'],
  [/\bvalero\b/i, 'Valero', 'gas'],
  [/\bspeedway\b/i, 'Speedway', 'gas'],
  [/\bcircle\s*k\b/i, 'Circle K', 'gas'],
  [/\bwawa\b/i, 'Wawa', 'gas'],
  [/\bsheetz\b/i, 'Sheetz', 'gas'],
  // Restaurants / food
  [/\bmcdonald/i, "McDonald's", 'restaurant'],
  [/\bstarbucks\b/i, 'Starbucks', 'restaurant'],
  [/\bsubway\b/i, 'Subway', 'restaurant'],
  [/\bchipotle\b/i, 'Chipotle', 'restaurant'],
  [/\bdoordash\b/i, 'DoorDash', 'restaurant'],
  [/\bgrubhub\b/i, 'Grubhub', 'restaurant'],
  [/\buber\s+eats\b/i, 'Uber Eats', 'restaurant'],
  [/\btaco\s+bell\b/i, 'Taco Bell', 'restaurant'],
  [/\bburger\s+king\b/i, 'Burger King', 'restaurant'],
  [/\bpizza\s+hut\b/i, 'Pizza Hut', 'restaurant'],
  [/\bdomino/i, "Domino's", 'restaurant'],
  [/\bpanera\b/i, 'Panera Bread', 'restaurant'],
  [/\bdunkin/i, "Dunkin'", 'restaurant'],
  [/\bchick.fil.a\b/i, 'Chick-fil-A', 'restaurant'],
  [/\bwendy/i, "Wendy's", 'restaurant'],
  [/\bpanda\s+express\b/i, 'Panda Express', 'restaurant'],
  [/\bpostmates\b/i, 'Postmates', 'restaurant'],
  [/\binstacart\b/i, 'Instacart', 'grocery'],
  // Transport
  [/\buber\b/i, 'Uber', 'transport'],
  [/\blyft\b/i, 'Lyft', 'transport'],
  [/\be.?zpass\b/i, 'E-ZPass', 'transport'],
  [/\bautozone\b/i, 'AutoZone', 'transport'],
  [/\bjiffy\s+lube\b/i, 'Jiffy Lube', 'transport'],
  // Subscriptions / streaming
  [/\bnetflix\b/i, 'Netflix', 'subscription'],
  [/\bhulu\b/i, 'Hulu', 'subscription'],
  [/\bdisney\+?\b/i, 'Disney+', 'subscription'],
  [/\bhbo\b|\bmax\b/i, 'HBO Max', 'subscription'],
  [/\bparamount\+?\b/i, 'Paramount+', 'subscription'],
  [/\bpeacock\b/i, 'Peacock', 'subscription'],
  [/\bspotify\b/i, 'Spotify', 'subscription'],
  [/\bmicrosoft\b/i, 'Microsoft', 'subscription'],
  [/\badobe\b/i, 'Adobe', 'subscription'],
  [/\bdropbox\b/i, 'Dropbox', 'subscription'],
  [/\bnotion\b/i, 'Notion', 'subscription'],
  [/\bopenai\b/i, 'OpenAI', 'subscription'],
  [/\bchatgpt\b/i, 'ChatGPT', 'subscription'],
  [/\banthropiccom\b|\banthropoic\b|\bAnthropic\b/i, 'Anthropic', 'subscription'],
  [/\bzoom\b/i, 'Zoom', 'subscription'],
  [/\bgithub\b/i, 'GitHub', 'subscription'],
  // Shopping
  [/\bcostco\b/i, 'Costco', 'shopping'],
  [/\bhome\s+depot\b/i, 'Home Depot', 'shopping'],
  [/\blowe'?s\b/i, "Lowe's", 'shopping'],
  [/\bbest\s+buy\b/i, 'Best Buy', 'shopping'],
  [/\bikea\b/i, 'IKEA', 'shopping'],
  [/\bwayfair\b/i, 'Wayfair', 'shopping'],
  [/\bebay\b/i, 'eBay', 'shopping'],
  [/\betsy\b/i, 'Etsy', 'shopping'],
  [/\bkohl'?s\b/i, "Kohl's", 'shopping'],
  [/\btj\s+maxx\b/i, 'TJ Maxx', 'shopping'],
  [/\bmarshalls\b/i, 'Marshalls', 'shopping'],
  // Health
  [/\bcvs\b/i, 'CVS', 'health'],
  [/\bwalgreens\b/i, 'Walgreens', 'health'],
  [/\brite\s+aid\b/i, 'Rite Aid', 'health'],
  [/\blongs\s+drug\b/i, 'Longs Drug', 'health'],
  [/\bplanet\s+fitness\b/i, 'Planet Fitness', 'health'],
  [/\bla\s+fitness\b/i, 'LA Fitness', 'health'],
  [/\bymca\b/i, 'YMCA', 'health'],
  // Utilities / telecom
  [/\bat&t\b/i, 'AT&T', 'utility'],
  [/\bverizon\b/i, 'Verizon', 'utility'],
  [/\bt.mobile\b/i, 'T-Mobile', 'utility'],
  [/\bxfinity\b/i, 'Xfinity', 'utility'],
  [/\bcomcast\b/i, 'Comcast', 'utility'],
  [/\bspectrum\b/i, 'Spectrum', 'utility'],
  // Travel
  [/\bairbnb\b/i, 'Airbnb', 'travel'],
  [/\bmarriott\b/i, 'Marriott', 'travel'],
  [/\bhilton\b/i, 'Hilton', 'travel'],
  [/\bdelta\b/i, 'Delta Air Lines', 'travel'],
  [/\bunited\s+air/i, 'United Airlines', 'travel'],
  [/\bsouthwest\b/i, 'Southwest Airlines', 'travel'],
  [/\bexpedia\b/i, 'Expedia', 'travel'],
  [/\bbooking\.com\b/i, 'Booking.com', 'travel'],
  // Insurance
  [/\busaa\b/i, 'USAA', 'insurance'],
  [/\bgeico\b/i, 'GEICO', 'insurance'],
  [/\bstate\s+farm\b/i, 'State Farm', 'insurance'],
  [/\ballstate\b/i, 'Allstate', 'insurance'],
  [/\bprogressive\b/i, 'Progressive', 'insurance'],
  // Income / transfer
  [/\bdirect\s+dep/i, 'Direct Deposit', 'income'],
  [/\bpayroll\b/i, 'Payroll', 'income'],
  [/\bsalary\b/i, 'Salary', 'income'],
  [/\bzelle\b/i, 'Zelle', 'transfer'],
  [/\bvenmo\b/i, 'Venmo', 'transfer'],
  [/\bpaypal\b/i, 'PayPal', 'transfer'],
  [/\bcash\s+app\b/i, 'Cash App', 'transfer'],
]

function resolveCanonical(
  raw: string,
): { canonical: string; type: MerchantType; confidence: Confidence } {
  for (const [pattern, name, type] of CANONICAL) {
    if (pattern.test(raw)) return { canonical: name, type, confidence: 'high' }
  }
  // Fall back to the cleaned display name with unknown type
  return { canonical: normalizeMerchantDisplay(raw), type: 'unknown', confidence: 'low' }
}

// ─── Transfer pattern detection (mirrored from intelligence/transfers.ts) ─────
// Kept in sync manually — the original requires Prisma so cannot be imported.

const TRANSFER_PATTERNS = [
  /payment\s+thank\s+you/i, /autopay/i, /auto\s+pay/i,
  /credit\s+card\s+payment/i, /card\s+payment/i, /online\s+payment/i,
  /bill\s+payment/i, /bank\s+transfer/i, /ach\s+transfer/i,
  /wire\s+transfer/i, /transfer\s+(to|from)/i, /account\s+transfer/i,
]

function isTransferDescription(description: string): boolean {
  return TRANSFER_PATTERNS.some(p => p.test(description))
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
  // Transfer pattern check first (high confidence)
  if (isTransferDescription(vendorRaw)) {
    return { category: 'Transfer', confidence: 'high' }
  }

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

    // ── Stage 1C: aggregator strip + canonical resolution ─────────────────
    const { stripped, hasAggregator } = stripAggregatorPrefix(tx.vendorRaw)
    const { canonical, type: merchantType, confidence: merchantConfidence } = resolveCanonical(
      stripped || tx.vendorRaw,
    )

    // ── Review flags ───────────────────────────────────────────────────────
    const reviewFlags: ReviewFlag[] = []
    if (hasAggregator) reviewFlags.push('aggregator_prefix')
    if (merchantType === 'unknown') reviewFlags.push('unclear_merchant')

    // ── Category resolution — bank first, engine fallback ─────────────────
    // Run the engine always (needed for transfer-pattern detection + merchant signals)
    const engineSuggestion = suggestCategory(tx.vendorRaw, tx.amountCents, expensesAreNegative)

    // Transfer pattern detection (description-based) always takes precedence.
    // It overrides bank category when the description clearly matches a transfer pattern
    // (e.g. bank says "Transport" but desc says "PAYMENT THANK YOU").
    const isDescriptionTransfer = engineSuggestion?.category === 'Transfer'

    let cat: string
    let conf: Confidence
    let categorySource: 'bank' | 'engine'

    if (isDescriptionTransfer) {
      cat = 'Transfer'
      conf = 'high'
      categorySource = 'engine'
    } else if (tx.bankCategoryRaw) {
      const bankMapped = mapBankCategoryToName(tx.bankCategoryRaw)
      if (bankMapped) {
        cat = bankMapped
        // "Other" is a vague bank category → medium confidence; all others → high
        conf = bankMapped === 'Other' ? 'medium' : 'high'
        categorySource = 'bank'
      } else {
        // Bank category present but unmappable → fall back to engine
        cat = engineSuggestion?.category ?? 'Uncategorized'
        conf = engineSuggestion?.confidence ?? 'low'
        categorySource = 'engine'
      }
    } else {
      cat = engineSuggestion?.category ?? 'Uncategorized'
      conf = engineSuggestion?.confidence ?? 'low'
      categorySource = 'engine'
    }

    const isDuplicate = duplicateIds.has(tx.id)
    const isRecurring = tx.vendorKey ? recurringVendors.has(tx.vendorKey) : false
    const isTransfer = cat === 'Transfer' || merchantType === 'transfer'
    const isIncome = cat === 'Income' || merchantType === 'income'

    if (isTransfer) reviewFlags.push('possible_transfer')
    if (isIncome) reviewFlags.push('possible_income')

    if (isTransfer) transferCount++
    if (isIncome) incomeCount++
    if (conf === 'low') {
      needsReview++
      if (!reviewFlags.includes('possible_transfer') && !reviewFlags.includes('possible_income')) {
        reviewFlags.push('needs_manual_review')
      }
    }

    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1)

    suggestions.set(tx.id, {
      normalizedMerchant,
      canonicalMerchant: canonical,
      merchantConfidence,
      merchantType,
      category: cat,
      confidence: conf,
      categorySource,
      isDuplicate,
      isTransfer,
      isIncome,
      isRecurring,
      reviewFlags,
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
