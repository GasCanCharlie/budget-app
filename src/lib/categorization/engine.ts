/**
 * Categorization Engine — Phase 3
 * Layer 1: Deterministic rules (system + user)
 * Layer 3: AI fallback (GPT-4o-mini, constrained enum output)
 */

import prisma from '@/lib/db'
import OpenAI from 'openai'

// Lazy-initialize so the client is only created at runtime (not during next build)
let _openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openai
}

// ─── Merchant normalization ───────────────────────────────────────────────────

export function normalizeMerchant(description: string): string {
  let s = description.toLowerCase().trim()

  // ── Strip credit card statement bank metadata ─────────────────────────────
  // Bank of Hawaii (Bankoh) / many issuers append: "CITY STATE Date X Xx X CARDNO Card NN TXID"
  // Examples:
  //   "Anthropic San Francisc Ca Date X Xx X 734 Card 25 G0a3lmse"
  //   "Elevenlabs.io New York Ny Date X Xx X 734 Card 25 U7b8stp1"
  //   "650 Industries (expo) Palo Alto Ca Date 02/13/26 X Xx X 734 C"
  // Strip " [state] Date ..." — two-letter word then "date" then the rest
  s = s.replace(/\s+[a-z]{2}\s+date[\s\S]*/i, '').trim()
  // Fallback: strip " Date X Xx X..." without the state prefix
  s = s.replace(/\s+date\s+[\dx/]+\s+xx\s+x[\s\S]*/i, '').trim()
  // Strip ACH/wire structured fields: " Type: ... Co: ... Id: ..."
  s = s.replace(/\s+(type|co|id\d*):\s+[\s\S]*/i, '').trim()
  // Strip " Card NN [txid]" leftover
  s = s.replace(/\s+card\s+\d+[\s\S]*/i, '').trim()

  // ── Strip common bank noise ───────────────────────────────────────────────
  s = s
    .replace(/\*+/g, ' ')
    .replace(/#\s*\d+/g, '')        // branch/check numbers like #422 or # 144
    .replace(/\d{4,}/g, '')         // long digit strings (card numbers, etc.)
    .replace(/\b(debit|credit|purchase|pos|sq\s*\*|tst\*|ach|www\.)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  // ── Strip trailing location info ──────────────────────────────────────────
  // Bug fix: string is already lowercase, so must use [a-z]{2} not [A-Z]{2}
  s = s.replace(/\s+[a-z]{2}\s*$/, '').trim()   // trailing two-letter state code
  s = s.replace(/,\s*[a-z\s]+$/, '').trim()      // trailing ", city" patterns

  // Title case
  return s.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

// ─── PII sanitization for AI ─────────────────────────────────────────────────

function sanitizeForAI(description: string): string {
  return description
    .replace(/\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g, '[CARD]')    // card numbers
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '[PHONE]')             // phone numbers
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]')
    .replace(/\b\d{9}\b/g, '[ACCOUNT]')                                    // 9-digit account numbers
    .replace(/\*{4}\d{4}/g, '[CARD]')                                      // **** 1234 patterns
    .trim()
    .slice(0, 200) // hard max
}

// ─── System categories cache ──────────────────────────────────────────────────

let categoryCache: { id: string; name: string; isIncome: boolean; isTransfer: boolean }[] | null = null

async function getCategories() {
  if (!categoryCache) {
    categoryCache = await prisma.category.findMany({
      where: { isSystem: true, userId: null },
      select: { id: true, name: true, isIncome: true, isTransfer: true },
    })
  }
  return categoryCache
}

// Invalidate cache when categories change
export function invalidateCategoryCache() {
  categoryCache = null
}

// ─── Layer 1: Rule engine ─────────────────────────────────────────────────────

interface RuleMatch {
  categoryId: string
  categoryName: string
  confidence: number
  source: 'rule'
}

async function applyRules(description: string, userId: string): Promise<RuleMatch | null> {
  const descLower = description.toLowerCase()

  // Fetch user rules first (higher priority), then system rules
  const rules = await prisma.categoryRule.findMany({
    where: {
      OR: [
        { userId: userId },
        { isSystem: true, userId: null },
      ]
    },
    include: { category: { select: { id: true, name: true } } },
    orderBy: [
      { userId: 'desc' },  // user rules first (non-null userId sorts first)
      { priority: 'desc' },
    ],
  })

  for (const rule of rules) {
    let matches = false
    switch (rule.matchType) {
      case 'exact':
        matches = descLower === rule.matchValue.toLowerCase()
        break
      case 'contains':
        matches = descLower.includes(rule.matchValue.toLowerCase())
        break
      case 'regex':
        try {
          matches = new RegExp(rule.matchValue, 'i').test(description)
        } catch { matches = false }
        break
    }
    if (matches) {
      return {
        categoryId: rule.categoryId,
        categoryName: rule.category.name,
        confidence: 1.0,
        source: 'rule',
      }
    }
  }
  return null
}

// ─── Layer 2: Built-in keyword/merchant matching ──────────────────────────────

/**
 * Common merchant/keyword → category mappings.
 * Checked before the AI call to reduce latency and handle OpenAI outages.
 * Each entry: [pattern (lowercase substring), category name]
 */
const MERCHANT_KEYWORDS: Array<[string, string]> = [
  // Groceries
  ['whole foods', 'Groceries'], ['wholefoods', 'Groceries'],
  ['kroger', 'Groceries'], ['safeway', 'Groceries'], ['publix', 'Groceries'],
  ['trader joe', 'Groceries'], ['aldi', 'Groceries'], ['wegmans', 'Groceries'],
  ['sprouts', 'Groceries'], ['harris teeter', 'Groceries'], ['giant', 'Groceries'],
  ['heb ', 'Groceries'], ['meijer', 'Groceries'], ['winn dixie', 'Groceries'],
  ['food lion', 'Groceries'], ['price chopper', 'Groceries'], ['stop shop', 'Groceries'],
  ['ralph', 'Groceries'], ['vons', 'Groceries'], ['tom thumb', 'Groceries'],
  ['market basket', 'Groceries'], ['hannaford', 'Groceries'],
  // Food & Dining
  ['mcdonald', 'Food & Dining'], ['starbucks', 'Food & Dining'],
  ['subway', 'Food & Dining'], ['chipotle', 'Food & Dining'],
  ['dunkin', 'Food & Dining'], ['doordash', 'Food & Dining'],
  ['grubhub', 'Food & Dining'], ['uber eats', 'Food & Dining'],
  ['ubereats', 'Food & Dining'], ['instacart', 'Food & Dining'],
  ['chick-fil-a', 'Food & Dining'], ['chickfila', 'Food & Dining'],
  ['taco bell', 'Food & Dining'], ['burger king', 'Food & Dining'],
  ['wendy', 'Food & Dining'], ['pizza hut', 'Food & Dining'],
  ['domino', 'Food & Dining'], ['panera', 'Food & Dining'],
  ['olive garden', 'Food & Dining'], ['applebee', 'Food & Dining'],
  ['ihop', 'Food & Dining'], ['denny', 'Food & Dining'],
  ['panda express', 'Food & Dining'], ['popeye', 'Food & Dining'],
  ['five guys', 'Food & Dining'], ['in-n-out', 'Food & Dining'],
  ['shake shack', 'Food & Dining'], ['wingstop', 'Food & Dining'],
  ['raising cane', 'Food & Dining'], ['dairy queen', 'Food & Dining'],
  ['sonic drive', 'Food & Dining'], ['jack in the box', 'Food & Dining'],
  ['hardee', 'Food & Dining'], ['carl jr', 'Food & Dining'],
  ['arby', 'Food & Dining'], ['whataburger', 'Food & Dining'],
  ['dutch bros', 'Food & Dining'], ['tim horton', 'Food & Dining'],
  ['postmates', 'Food & Dining'],
  // Transport
  ['shell ', 'Transport'], ['chevron', 'Transport'], ['exxon', 'Transport'],
  ['mobil', 'Transport'], ['bp gas', 'Transport'], ['sunoco', 'Transport'],
  ['marathon', 'Transport'], ['citgo', 'Transport'], ['valero', 'Transport'],
  ['speedway', 'Transport'], ['circle k', 'Transport'], ['casey', 'Transport'],
  ['kwik trip', 'Transport'], ['wawa', 'Transport'], ['sheetz', 'Transport'],
  ['pilot flying', 'Transport'], ['loves travel', 'Transport'],
  ['uber*', 'Transport'], ['lyft*', 'Transport'],
  ['enterprise rent', 'Transport'], ['hertz', 'Transport'], ['avis', 'Transport'],
  ['budget rent', 'Transport'], ['national car', 'Transport'],
  ['e-zpass', 'Transport'], ['ezpass', 'Transport'], ['sunpass', 'Transport'],
  ['parkwhiz', 'Transport'], ['spothero', 'Transport'], ['impark', 'Transport'],
  ['autozone', 'Transport'], ['advance auto', 'Transport'], ['oreilly auto', 'Transport'],
  ['pep boys', 'Transport'], ['jiffy lube', 'Transport'], ['midas', 'Transport'],
  ['firestone', 'Transport'], ['goodyear', 'Transport'], ['mavis', 'Transport'],
  ['car wash', 'Transport'],
  // Entertainment
  ['netflix', 'Entertainment'], ['hulu', 'Entertainment'], ['disney+', 'Entertainment'],
  ['disneyplus', 'Entertainment'], ['hbo', 'Entertainment'],
  ['paramount+', 'Entertainment'], ['peacock', 'Entertainment'],
  ['amc theatre', 'Entertainment'], ['regal cinema', 'Entertainment'],
  ['cinemark', 'Entertainment'], ['ticketmaster', 'Entertainment'],
  ['stubhub', 'Entertainment'], ['eventbrite', 'Entertainment'],
  ['xbox', 'Entertainment'], ['playstation', 'Entertainment'],
  ['nintendo', 'Entertainment'], ['steam games', 'Entertainment'],
  ['twitch', 'Entertainment'], ['youtube premium', 'Entertainment'],
  ['siriusxm', 'Entertainment'], ['pandora', 'Entertainment'],
  ['audible', 'Entertainment'],
  // Subscriptions — streaming, SaaS, AI services
  ['elevenlabs', 'Subscriptions'], ['eleven labs', 'Subscriptions'],
  ['midjourney', 'Subscriptions'], ['runway', 'Subscriptions'],
  ['notion', 'Subscriptions'], ['figma', 'Subscriptions'],
  ['spotify', 'Subscriptions'], ['apple.com/bill', 'Subscriptions'],
  ['google play', 'Subscriptions'], ['microsoft', 'Subscriptions'],
  ['adobe', 'Subscriptions'], ['dropbox', 'Subscriptions'],
  ['icloud', 'Subscriptions'], ['amazon prime', 'Subscriptions'],
  ['amazon digital', 'Subscriptions'], ['nytimes', 'Subscriptions'],
  ['wsj.com', 'Subscriptions'], ['linkedin', 'Subscriptions'],
  ['zoom', 'Subscriptions'], ['slack', 'Subscriptions'],
  ['github', 'Subscriptions'], ['squarespace', 'Subscriptions'],
  ['mailchimp', 'Subscriptions'], ['shopify', 'Subscriptions'],
  ['chatgpt', 'Subscriptions'], ['openai', 'Subscriptions'],
  ['anthropic', 'Subscriptions'],
  // Shopping
  ['amazon', 'Shopping'], ['walmart', 'Shopping'], ['target', 'Shopping'],
  ['costco', 'Shopping'], ['home depot', 'Shopping'], ['lowes', 'Shopping'],
  ['best buy', 'Shopping'], ['ikea', 'Shopping'], ['wayfair', 'Shopping'],
  ['ebay', 'Shopping'], ['etsy', 'Shopping'], ['overstock', 'Shopping'],
  ['kohls', 'Shopping'], ["tj maxx", 'Shopping'], ['marshalls', 'Shopping'],
  ['ross stores', 'Shopping'], ['burlington', 'Shopping'], ['old navy', 'Shopping'],
  ['gap ', 'Shopping'], ['banana republic', 'Shopping'], ['h&m', 'Shopping'],
  ['zara', 'Shopping'], ['uniqlo', 'Shopping'], ['nike', 'Shopping'],
  ['adidas', 'Shopping'], ['macys', 'Shopping'], ['nordstrom', 'Shopping'],
  ['saks', 'Shopping'], ['neiman marcus', 'Shopping'],
  ['dollar tree', 'Shopping'], ['dollar general', 'Shopping'],
  ['five below', 'Shopping'], ['party city', 'Shopping'],
  ['bed bath', 'Shopping'], ['container store', 'Shopping'],
  ['crate and barrel', 'Shopping'], ['williams sonoma', 'Shopping'],
  ['michaels', 'Shopping'], ["hobby lobby", 'Shopping'],
  ['petco', 'Pets'], ['petsmart', 'Pets'], ['chewy', 'Pets'],
  // Health — drug stores / pharmacies
  ['cvs', 'Health'], ['walgreens', 'Health'], ['rite aid', 'Health'],
  ['duane reade', 'Health'], ['bartell drug', 'Health'],
  ['longs drugs', 'Health'], ['longs drug', 'Health'],
  ['navarro', 'Health'], ['harmons drug', 'Health'],
  ['planet fitness', 'Health'], ['la fitness', 'Health'],
  ['anytime fitness', 'Health'], ['ymca', 'Health'],
  ['orange theory', 'Health'], ['equinox', 'Health'],
  ['24 hour fitness', 'Health'], ['crossfit', 'Health'],
  ['peloton', 'Health'], ['lifetime fitness', 'Health'],
  ['mayo clinic', 'Health'], ['kaiser', 'Health'],
  // Utilities
  ['at&t', 'Utilities'], ['verizon', 'Utilities'], ['t-mobile', 'Utilities'],
  ['sprint', 'Utilities'], ['xfinity', 'Utilities'], ['comcast', 'Utilities'],
  ['spectrum', 'Utilities'], ['cox communication', 'Utilities'],
  ['directv', 'Utilities'], ['dish network', 'Utilities'],
  ['pg&e', 'Utilities'], ['con edison', 'Utilities'], ['duke energy', 'Utilities'],
  ['dominion energy', 'Utilities'], ['national grid', 'Utilities'],
  ['georgia power', 'Utilities'], ['southern company', 'Utilities'],
  ['american electric', 'Utilities'],
  // Travel — hotels, airlines, car rentals
  ['ritz-carlton', 'Travel'], ['ritz carlton', 'Travel'], ['four seasons', 'Travel'],
  ['intercontinental', 'Travel'], ['sheraton', 'Travel'], ['westin', 'Travel'],
  ['renaissance hotel', 'Travel'], ['courtyard', 'Travel'], ['residence inn', 'Travel'],
  ['hampton inn', 'Travel'], ['holiday inn', 'Travel'], ['doubletree', 'Travel'],
  ['embassy suites', 'Travel'], ['extended stay', 'Travel'],
  ['marriott', 'Travel'], ['hilton', 'Travel'], ['hyatt', 'Travel'],
  ['ihg', 'Travel'], ['wyndham', 'Travel'], ['best western', 'Travel'],
  ['airbnb', 'Travel'], ['vrbo', 'Travel'], ['booking.com', 'Travel'],
  ['expedia', 'Travel'], ['priceline', 'Travel'], ['hotels.com', 'Travel'],
  ['delta air', 'Travel'], ['united air', 'Travel'], ['american air', 'Travel'],
  ['southwest air', 'Travel'], ['jetblue', 'Travel'], ['spirit air', 'Travel'],
  ['frontier air', 'Travel'], ['alaska air', 'Travel'],
  ['amtrak', 'Travel'], ['greyhound', 'Travel'],
  // Insurance — includes USAA (primary insurance + financial services)
  ['usaa', 'Insurance'],
  ['geico', 'Insurance'], ['state farm', 'Insurance'], ['allstate', 'Insurance'],
  ['progressive', 'Insurance'], ['farmers insurance', 'Insurance'],
  ['usaa insurance', 'Insurance'], ['nationwide', 'Insurance'],
  ['liberty mutual', 'Insurance'], ['travelers insurance', 'Insurance'],
  ['aetna', 'Insurance'], ['cigna', 'Insurance'], ['humana', 'Insurance'],
  ['bcbs', 'Insurance'], ['blue cross', 'Insurance'],
  ['unitedhealth', 'Insurance'], ['anthem', 'Insurance'],
  // Fees & Charges — bank fees, card fees, cross-border
  ['annual fee', 'Fees & Charges'], ['late payment', 'Fees & Charges'],
  ['overdraft fee', 'Fees & Charges'], ['atm fee', 'Fees & Charges'],
  ['card fee', 'Fees & Charges'], ['cross-border fee', 'Fees & Charges'],
  ['foreign transaction', 'Fees & Charges'], ['currency conversion', 'Fees & Charges'],
  ['issuer fee', 'Fees & Charges'], ['mastercard issuer', 'Fees & Charges'],
  ['visa issuer', 'Fees & Charges'], ['interchange fee', 'Fees & Charges'],
  // Income / Transfers
  ['direct dep', 'Income'], ['payroll', 'Income'],
  ['zelle payment', 'Transfer'], ['venmo payment', 'Transfer'],
  ['paypal transfer', 'Transfer'], ['cash app', 'Transfer'],
  // Bank checks and loan payments
  ['check #', 'Transfer'], ['check number', 'Transfer'],
  ['loan pymt', 'Transfer'], ['loan payment', 'Transfer'],
  ['loan pmt', 'Transfer'], ['mortgage pymt', 'Transfer'],
  ['bankoh', 'Transfer'], ['bank of hawaii', 'Transfer'],
  ['bank of america', 'Transfer'], ['wells fargo bank', 'Transfer'],
  // Food & Dining — regional / Hawaii chains
  ['aloha', 'Food & Dining'],
  // Entertainment — expo / trade shows
  ['expo palo alto', 'Entertainment'], ['tech expo', 'Entertainment'],
  ['trade show', 'Entertainment'], ['conference reg', 'Entertainment'],
]

interface KeywordMatch {
  categoryId: string
  categoryName: string
  confidence: number
  source: 'rule'
}

async function applyKeywordRules(description: string): Promise<KeywordMatch | null> {
  const descLower = description.toLowerCase()
  const categories = await getCategories()

  for (const [keyword, categoryName] of MERCHANT_KEYWORDS) {
    if (descLower.includes(keyword.toLowerCase())) {
      const cat = categories.find(c => c.name === categoryName)
      if (cat) {
        return { categoryId: cat.id, categoryName, confidence: 0.85, source: 'rule' }
      }
    }
  }
  return null
}

// ─── Layer 3: AI fallback ─────────────────────────────────────────────────────

const AI_CATEGORY_NAMES = [
  'Food & Dining', 'Groceries', 'Housing', 'Transport', 'Entertainment',
  'Shopping', 'Health', 'Utilities', 'Subscriptions', 'Personal Care',
  'Education', 'Travel', 'Insurance', 'Pets', 'Gifts & Charity',
  'Fees & Charges', 'Income', 'Transfer', 'Other'
]

interface AIResult {
  categoryName: string
  confidence: number
  source: 'ai'
}

async function classifyWithAI(description: string): Promise<AIResult> {
  const sanitized = sanitizeForAI(description)
  const categoryList = AI_CATEGORY_NAMES.join(', ')

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await getOpenAI().chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0,
        max_tokens: 60,
        messages: [
          {
            role: 'system',
            content: `You are a transaction classifier. Classify the merchant/transaction into exactly ONE category from this list: ${categoryList}. Respond with JSON only: {"category": "<name>", "confidence": <0.0-1.0>}. No explanations. Only use categories from the list.`
          },
          {
            role: 'user',
            content: `Transaction: "${sanitized}"`
          }
        ]
      })

      const raw = response.choices[0]?.message?.content?.trim() || ''
      const match = raw.match(/\{"category"\s*:\s*"([^"]+)"\s*,\s*"confidence"\s*:\s*([\d.]+)\}/)
      if (!match) throw new Error('Non-conforming AI response')

      const catName = match[1]
      const confidence = Math.min(1.0, Math.max(0.0, parseFloat(match[2])))

      if (!AI_CATEGORY_NAMES.includes(catName)) throw new Error(`Unknown category: ${catName}`)

      if (confidence < 0.6) {
        console.warn(`[categorize] low confidence (${confidence.toFixed(2)}) for: ${sanitized.slice(0, 40)}`)
      }

      return { categoryName: catName, confidence, source: 'ai' }
    } catch (err) {
      if (attempt === 0) continue // retry once on malformed response
      console.warn('[categorize] AI fallback exhausted:', (err as Error).message)
    }
  }
  return { categoryName: 'Other', confidence: 0.0, source: 'ai' }
}

// ─── Main categorization pipeline ────────────────────────────────────────────

export interface CategorizationResult {
  categoryId: string | undefined
  categoryName: string
  confidence: number
  source: 'rule' | 'ai' | 'user' | 'bank'
}

export async function categorize(
  description: string,
  userId: string,
  amount: number,
): Promise<CategorizationResult> {
  const categories = await getCategories()
  const normalized = normalizeMerchant(description)

  function findCatId(name: string): string | undefined {
    return categories.find(c => c.name === name)?.id ?? categories.find(c => c.name === 'Other')?.id
  }

  // Positive amounts might be income — check before rules
  // (rules can still override this if description matches something else)
  const isLikelyIncome = amount > 0

  // Layer 1: User/system rules (highest priority)
  const ruleMatch = await applyRules(normalized, userId)
  if (ruleMatch) {
    return {
      categoryId: ruleMatch.categoryId,
      categoryName: ruleMatch.categoryName,
      confidence: 1.0,
      source: 'rule',
    }
  }

  // If positive amount and no rule matched, default to Income
  if (isLikelyIncome) {
    return {
      categoryId: findCatId('Income'),
      categoryName: 'Income',
      confidence: 0.75,
      source: 'rule',
    }
  }

  // Layer 2: Built-in keyword/merchant matching (before AI to reduce latency + handle outages)
  const keywordMatch = await applyKeywordRules(normalized)
  if (keywordMatch) {
    return {
      categoryId: keywordMatch.categoryId,
      categoryName: keywordMatch.categoryName,
      confidence: keywordMatch.confidence,
      source: 'rule',
    }
  }

  // Layer 3: AI fallback
  const aiResult = await classifyWithAI(normalized)

  // Confidence thresholds (Phase 3 agreed design)
  // <0.60 → Uncategorized / Other
  if (aiResult.confidence < 0.6) {
    return {
      categoryId: findCatId('Other'),
      categoryName: 'Other',
      confidence: aiResult.confidence,
      source: 'ai',
    }
  }

  return {
    categoryId: findCatId(aiResult.categoryName),
    categoryName: aiResult.categoryName,
    confidence: aiResult.confidence,
    source: 'ai',
  }
}

// ─── Batch categorization ─────────────────────────────────────────────────────

export interface TransactionInput {
  description: string
  amount: number
}

export async function categorizeBatch(
  transactions: TransactionInput[],
  userId: string,
  onProgress?: (done: number, total: number) => void
): Promise<CategorizationResult[]> {
  const CONCURRENCY = 10
  const results: CategorizationResult[] = new Array(transactions.length)
  let completed = 0

  async function processOne(idx: number) {
    const tx = transactions[idx]
    results[idx] = await categorize(tx.description, userId, tx.amount)
    completed++
    onProgress?.(completed, transactions.length)
  }

  for (let i = 0; i < transactions.length; i += CONCURRENCY) {
    const batch: Promise<void>[] = []
    for (let j = i; j < Math.min(i + CONCURRENCY, transactions.length); j++) {
      batch.push(processOne(j))
    }
    await Promise.all(batch)
  }

  return results
}
