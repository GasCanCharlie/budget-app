import type { MasterKey } from './masters'

// Maps lowercase category name substrings → MasterKey
// Order matters — more specific entries first
const NAME_MAP: Array<[string, MasterKey]> = [
  // COFFEE (before FOOD so coffee shops don't fall into food)
  ['coffee', 'COFFEE'],
  ['café', 'COFFEE'],
  ['cafe', 'COFFEE'],
  ['espresso', 'COFFEE'],
  ['tea', 'COFFEE'],

  // GROCERY (before FOOD so grocery doesn't fall into generic food)
  ['groceries', 'GROCERY'],
  ['grocery', 'GROCERY'],
  ['supermarket', 'GROCERY'],

  // FAST_FOOD (before FOOD)
  ['fast food', 'FAST_FOOD'],

  // ALCOHOL (before FOOD so bars/drinks don't fall into food)
  ['alcohol', 'ALCOHOL'],
  ['nightlife', 'ALCOHOL'],
  ['brewery', 'ALCOHOL'],
  ['winery', 'ALCOHOL'],
  ['liquor', 'ALCOHOL'],

  // FOOD
  ['food', 'FOOD'],
  ['dining', 'FOOD'],
  ['restaurant', 'FOOD'],
  ['meal', 'FOOD'],
  ['bar', 'FOOD'],        // keeping bar under FOOD for ambiguous cases
  ['drinks', 'FOOD'],

  // TRANSPORT
  ['transport', 'TRANSPORT'],
  ['gas', 'TRANSPORT'],
  ['fuel', 'TRANSPORT'],
  ['uber', 'TRANSPORT'],
  ['lyft', 'TRANSPORT'],
  ['parking', 'TRANSPORT'],
  ['transit', 'TRANSPORT'],
  ['auto', 'TRANSPORT'],
  ['vehicle', 'TRANSPORT'],
  ['toll', 'TRANSPORT'],

  // HOME
  ['housing', 'HOME'],
  ['rent', 'HOME'],
  ['mortgage', 'HOME'],
  ['utilities', 'HOME'],
  ['internet', 'HOME'],
  ['phone', 'HOME'],
  ['home improvement', 'HOME'],
  ['furniture', 'HOME'],
  ['decor', 'HOME'],
  ['cleaning', 'HOME'],
  ['security', 'HOME'],

  // HEALTH
  ['health', 'HEALTH'],
  ['gym', 'HEALTH'],
  ['fitness', 'HEALTH'],
  ['pharmacy', 'HEALTH'],
  ['medical', 'HEALTH'],
  ['dental', 'HEALTH'],
  ['mental health', 'HEALTH'],
  ['supplement', 'HEALTH'],
  ['wellness', 'HEALTH'],
  ['vision', 'HEALTH'],
  ['doctor', 'HEALTH'],

  // ENTERTAINMENT
  ['entertainment', 'ENTERTAINMENT'],
  ['movie', 'ENTERTAINMENT'],
  ['music', 'ENTERTAINMENT'],
  ['event', 'ENTERTAINMENT'],
  ['concert', 'ENTERTAINMENT'],
  ['sport', 'ENTERTAINMENT'],
  ['hobby', 'ENTERTAINMENT'],
  ['game', 'ENTERTAINMENT'],
  ['night out', 'ENTERTAINMENT'],

  // SHOPPING
  ['shopping', 'SHOPPING'],
  ['clothing', 'SHOPPING'],
  ['fashion', 'SHOPPING'],
  ['electronics', 'SHOPPING'],
  ['amazon', 'SHOPPING'],
  ['online', 'SHOPPING'],
  ['department', 'SHOPPING'],

  // TRAVEL
  ['travel', 'TRAVEL'],
  ['flight', 'TRAVEL'],
  ['hotel', 'TRAVEL'],
  ['airbnb', 'TRAVEL'],
  ['vacation', 'TRAVEL'],
  ['car rental', 'TRAVEL'],
  ['cruise', 'TRAVEL'],

  // DIGITAL
  ['subscription', 'DIGITAL'],
  ['software', 'DIGITAL'],
  ['saas', 'DIGITAL'],
  ['streaming', 'DIGITAL'],
  ['app', 'DIGITAL'],
  ['cloud', 'DIGITAL'],
  ['tech', 'DIGITAL'],

  // PERSONAL CARE
  ['personal care', 'PERSONAL_CARE'],
  ['beauty', 'PERSONAL_CARE'],
  ['cosmetic', 'PERSONAL_CARE'],
  ['hair', 'PERSONAL_CARE'],
  ['salon', 'PERSONAL_CARE'],
  ['spa', 'PERSONAL_CARE'],
  ['massage', 'PERSONAL_CARE'],
  ['grooming', 'PERSONAL_CARE'],

  // EDUCATION
  ['education', 'EDUCATION'],
  ['tuition', 'EDUCATION'],
  ['course', 'EDUCATION'],
  ['book', 'EDUCATION'],
  ['learning', 'EDUCATION'],
  ['coaching', 'EDUCATION'],
  ['certification', 'EDUCATION'],
  ['conference', 'EDUCATION'],

  // BUSINESS
  ['business', 'BUSINESS'],
  ['coworking', 'BUSINESS'],
  ['advertising', 'BUSINESS'],
  ['contractor', 'BUSINESS'],
  ['freelance', 'BUSINESS'],
  ['office', 'BUSINESS'],
  ['professional', 'BUSINESS'],

  // SOCIAL
  ['gift', 'SOCIAL'],
  ['charity', 'SOCIAL'],
  ['donation', 'SOCIAL'],
  ['celebration', 'SOCIAL'],
  ['wedding', 'SOCIAL'],
  ['holiday', 'SOCIAL'],

  // FINANCIAL
  ['insurance', 'FINANCIAL'],
  ['fee', 'FINANCIAL'],
  ['charge', 'FINANCIAL'],
  ['credit card', 'FINANCIAL'],
  ['loan', 'FINANCIAL'],
  ['interest', 'FINANCIAL'],
  ['bank', 'FINANCIAL'],
  ['investment', 'FINANCIAL'],
  ['savings', 'FINANCIAL'],

  // PETS (before LIFESTYLE)
  ['pet', 'PETS'],

  // TOBACCO (before LIFESTYLE)
  ['tobacco', 'TOBACCO'],
  ['cigarette', 'TOBACCO'],

  // LIFESTYLE
  ['gambling', 'LIFESTYLE'],
  ['lottery', 'LIFESTYLE'],
]

// Generic/noisy category names — return null (no trait assigned)
const NOISY_NAMES = new Set([
  'other', 'uncategorized', 'miscellaneous', 'misc',
  'general', 'transfer', 'income', 'unknown',
])

export function normalizeCategoryName(name: string): MasterKey | null {
  const lower = name.toLowerCase().trim()

  // Skip noisy/generic categories
  if (NOISY_NAMES.has(lower)) return null

  for (const [substring, key] of NAME_MAP) {
    if (lower.includes(substring)) return key
  }

  return null
}

// Exact system category name → masterKey
const CATEGORY_NAME_TO_MASTERKEY: Record<string, MasterKey | null> = {
  'Food & Dining':        'FOOD',
  'Groceries':            'GROCERY',
  'Housing':              'HOME',
  'Transport':            'TRANSPORT',
  'Entertainment':        'ENTERTAINMENT',
  'Shopping':             'SHOPPING',
  'Health':               'HEALTH',
  'Utilities':            'HOME',
  'Subscriptions':        'DIGITAL',
  'Personal Care':        'PERSONAL_CARE',
  'Education':            'EDUCATION',
  'Travel':               'TRAVEL',
  'Insurance':            'FINANCIAL',
  'Fees & Charges':       'FINANCIAL',
  'Gifts & Charity':      'SOCIAL',
  'Fast Food':            'FAST_FOOD',
  'Alcohol':              'ALCOHOL',
  'Coffee':               'COFFEE',
  'Coffe':                'COFFEE',   // common typo
  'Restaurants':          'FOOD',
  'Gas/Fuel':             'TRANSPORT',
  'Gasoline/Fuel':        'TRANSPORT',
  'Cigarettes & Tobacco': 'TOBACCO',
  'Pets':                 'PETS',
  'Credit Card Payment':  'FINANCIAL',
  // Explicit null — these are known non-spending categories
  'Income':               null,
  'Transfer':             null,
  'Transfers':            null,
  'Other':                null,
  'Uncategorized':        null,
}

// Identity-based income category names (normalized)
const INCOME_CATEGORY_NAMES = new Set([
  'income', 'salary', 'paycheck', 'wages', 'payroll',
  'deposit income', 'direct deposit',
])

/** Returns true when a category is income by identity — regardless of transaction direction */
export function isIncomeCategory(name: string, masterKey?: string | null): boolean {
  // masterKey 'INCOME' is a future-proofing hook — not currently a valid MasterKey
  if (masterKey === 'INCOME') return true
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  return INCOME_CATEGORY_NAMES.has(normalized)
}

/**
 * Canonical masterKey resolver. Resolution order:
 * 1. DB value (if non-null)
 * 2. Exact system category name match
 * 3. Fuzzy substring match via normalizeCategoryName
 */
export function resolveMasterKey(
  dbMasterKey: string | null | undefined,
  categoryName: string,
): MasterKey | null {
  if (dbMasterKey) return dbMasterKey as MasterKey

  if (categoryName in CATEGORY_NAME_TO_MASTERKEY) {
    // Known entry — may be null (e.g. 'Income', 'Other') — return as-is, don't fuzzy-match
    return CATEGORY_NAME_TO_MASTERKEY[categoryName]
  }

  return normalizeCategoryName(categoryName)
}
