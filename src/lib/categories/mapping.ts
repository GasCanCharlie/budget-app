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

  // FOOD
  ['food', 'FOOD'],
  ['dining', 'FOOD'],
  ['restaurant', 'FOOD'],
  ['groceries', 'FOOD'],
  ['grocery', 'FOOD'],
  ['fast food', 'FOOD'],
  ['meal', 'FOOD'],
  ['alcohol', 'FOOD'],
  ['bar', 'FOOD'],
  ['nightlife', 'FOOD'],
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

  // LIFESTYLE
  ['pet', 'LIFESTYLE'],
  ['tobacco', 'LIFESTYLE'],
  ['cigarette', 'LIFESTYLE'],
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
