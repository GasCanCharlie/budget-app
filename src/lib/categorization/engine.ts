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

  // Strip common bank noise
  s = s
    .replace(/\*+/g, ' ')
    .replace(/#\d+/g, '')           // branch numbers like #422
    .replace(/\d{4,}/g, '')         // long digit strings (card numbers, etc.)
    .replace(/\b(debit|credit|purchase|pos|sq\s*\*|tst\*|ach|www\.)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()

  // Strip trailing location info (city ST patterns)
  s = s.replace(/\s+[A-Z]{2}\s*$/, '').trim()
  s = s.replace(/,\s*[a-z\s]+$/, '').trim()

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
    // Strict output validation
    const match = raw.match(/\{"category"\s*:\s*"([^"]+)"\s*,\s*"confidence"\s*:\s*([\d.]+)\}/)
    if (!match) throw new Error('Non-conforming AI response')

    const catName = match[1]
    const confidence = Math.min(1.0, Math.max(0.0, parseFloat(match[2])))

    // Validate category is in our enum
    if (!AI_CATEGORY_NAMES.includes(catName)) throw new Error(`Unknown category: ${catName}`)

    return { categoryName: catName, confidence, source: 'ai' }
  } catch {
    return { categoryName: 'Other', confidence: 0.0, source: 'ai' }
  }
}

// ─── Main categorization pipeline ────────────────────────────────────────────

export interface CategorizationResult {
  categoryId: string | undefined
  categoryName: string
  confidence: number
  source: 'rule' | 'ai' | 'user'
}

export async function categorize(
  description: string,
  userId: string,
  amount: number,
): Promise<CategorizationResult> {
  const categories = await getCategories()

  function findCatId(name: string): string | undefined {
    return categories.find(c => c.name === name)?.id ?? categories.find(c => c.name === 'Other')?.id
  }

  // Positive amounts might be income — check before rules
  // (rules can still override this if description matches something else)
  const isLikelyIncome = amount > 0

  // Layer 1: Rules
  const ruleMatch = await applyRules(description, userId)
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

  // Layer 3: AI fallback
  const aiResult = await classifyWithAI(description)

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
  const results: CategorizationResult[] = []

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]
    const result = await categorize(tx.description, userId, tx.amount)
    results.push(result)
    onProgress?.(i + 1, transactions.length)
  }

  return results
}
