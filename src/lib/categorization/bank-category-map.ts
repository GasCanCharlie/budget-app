/**
 * Maps normalized bank category strings → internal BudgetLens category names.
 * Normalization: trim + lowercase + collapse whitespace + remove punctuation.
 *
 * Covers: Chase, Bank of America, Capital One, Wells Fargo, Citi, Discover,
 * American Express, USAA, PNC, US Bank, TD Bank, and generic categories.
 */

export function normalizeBankCategory(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
}

/** Map from normalized bank category string → BudgetLens category name */
const BANK_CATEGORY_MAP: Record<string, string> = {
  // ── Groceries ────────────────────────────────────────────────────────────
  'groceries': 'Groceries',
  'grocery': 'Groceries',
  'grocery stores': 'Groceries',
  'supermarkets': 'Groceries',
  'supermarkets and grocery stores': 'Groceries',
  'supermarket': 'Groceries',
  'food and grocery': 'Groceries',
  'food grocery': 'Groceries',
  'wholesale clubs': 'Groceries',
  'warehouse clubs': 'Groceries',
  'costco': 'Groceries',
  'sams club': 'Groceries',

  // ── Food & Dining ────────────────────────────────────────────────────────
  'restaurants': 'Food & Dining',
  'restaurant': 'Food & Dining',
  'restaurants and dining': 'Food & Dining',
  'dining': 'Food & Dining',
  'food and drink': 'Food & Dining',
  'food  drink': 'Food & Dining',
  'food drink': 'Food & Dining',
  'food and dining': 'Food & Dining',
  'fast food': 'Food & Dining',
  'fast food and restaurants': 'Food & Dining',
  'coffee shops': 'Food & Dining',
  'coffee': 'Food & Dining',
  'cafes': 'Food & Dining',
  'cafe': 'Food & Dining',
  'bars': 'Food & Dining',
  'bar': 'Food & Dining',
  'bakeries': 'Food & Dining',
  'bakery': 'Food & Dining',
  'pizza': 'Food & Dining',
  'food delivery': 'Food & Dining',
  'takeout': 'Food & Dining',
  'dining out': 'Food & Dining',
  'eating out': 'Food & Dining',
  // Chase-specific
  'food and drink chase': 'Food & Dining',
  // Amex-specific
  'dining and nightlife': 'Food & Dining',
  // BofA
  'restaurants dining': 'Food & Dining',

  // ── Transport ────────────────────────────────────────────────────────────
  'gas': 'Transport',
  'gasoline': 'Transport',
  'gasolinefuel': 'Transport',
  'gasoline and fuel': 'Transport',
  'gasoline fuel': 'Transport',
  'fuel': 'Transport',
  'gas stations': 'Transport',
  'gas station': 'Transport',
  'automotive': 'Transport',
  'transportation': 'Transport',
  'ride share': 'Transport',
  'rideshare': 'Transport',
  'ride sharing': 'Transport',
  'parking': 'Transport',
  'parking and tolls': 'Transport',
  'public transit': 'Transport',
  'transit': 'Transport',
  'taxi': 'Transport',
  'tolls': 'Transport',
  'auto': 'Transport',
  'auto and gas': 'Transport',
  'gas and auto': 'Transport',
  'car wash': 'Transport',
  'auto service': 'Transport',
  'auto insurance': 'Insurance',
  'auto maintenance': 'Transport',
  'vehicle': 'Transport',
  'uber': 'Transport',
  'lyft': 'Transport',
  // Chase-specific
  'gas transportation': 'Transport',
  // Citi-specific
  'auto and transport': 'Transport',

  // ── Entertainment ────────────────────────────────────────────────────────
  'entertainment': 'Entertainment',
  'movies and dvds': 'Entertainment',
  'movies': 'Entertainment',
  'movie': 'Entertainment',
  'music': 'Entertainment',
  'sports': 'Entertainment',
  'hobbies': 'Entertainment',
  'arts': 'Entertainment',
  'amusement': 'Entertainment',
  'amusement parks': 'Entertainment',
  'games': 'Entertainment',
  'gaming': 'Entertainment',
  'recreation': 'Entertainment',
  'entertainment and recreation': 'Entertainment',
  'entertainment recreation': 'Entertainment',
  'nightlife': 'Entertainment',
  'concerts': 'Entertainment',
  'theater': 'Entertainment',
  'theatre': 'Entertainment',
  'live entertainment': 'Entertainment',
  'sporting events': 'Entertainment',
  'tickets': 'Entertainment',
  // Chase
  'movies and entertainment': 'Entertainment',

  // ── Shopping ─────────────────────────────────────────────────────────────
  'shopping': 'Shopping',
  'merchandise': 'Shopping',
  'clothing': 'Shopping',
  'apparel': 'Shopping',
  'electronics': 'Shopping',
  'online shopping': 'Shopping',
  'online purchases': 'Shopping',
  'department stores': 'Shopping',
  'department store': 'Shopping',
  'sporting goods': 'Shopping',
  'books': 'Shopping',
  'home and garden': 'Shopping',
  'home garden': 'Shopping',
  'retail': 'Shopping',
  'general merchandise': 'Shopping',
  'discount stores': 'Shopping',
  'specialty retail': 'Shopping',
  'toys': 'Shopping',
  'baby supplies': 'Shopping',
  'crafts': 'Shopping',
  'home goods': 'Shopping',
  'furniture': 'Housing',
  // Chase
  'shopping and merchandise': 'Shopping',
  // Amex
  'merchandise and supplies': 'Shopping',

  // ── Utilities ────────────────────────────────────────────────────────────
  'utilities': 'Utilities',
  'electricity': 'Utilities',
  'internet': 'Utilities',
  'cable': 'Utilities',
  'cable and internet': 'Utilities',
  'cable satellite internet': 'Utilities',
  'satellite': 'Utilities',
  'phone': 'Utilities',
  'cell phone': 'Utilities',
  'cellular phone': 'Utilities',
  'mobile phone': 'Utilities',
  'wireless': 'Utilities',
  'water': 'Utilities',
  'gas and electric': 'Utilities',
  'electric and gas utilities': 'Utilities',
  'electric': 'Utilities',
  'electric gas utilities': 'Utilities',
  'trash': 'Utilities',
  'sewer': 'Utilities',
  'home services': 'Utilities',
  'home and utilities': 'Utilities',
  // Chase
  'bills and utilities': 'Utilities',
  'bills utilities': 'Utilities',

  // ── Subscriptions ────────────────────────────────────────────────────────
  'subscriptions': 'Subscriptions',
  'streaming': 'Subscriptions',
  'software': 'Subscriptions',
  'streaming services': 'Subscriptions',
  'subscription': 'Subscriptions',
  'membership': 'Subscriptions',
  'memberships': 'Subscriptions',
  'digital purchases': 'Subscriptions',
  'apps': 'Subscriptions',
  'online services': 'Subscriptions',

  // ── Health ───────────────────────────────────────────────────────────────
  'health': 'Health',
  'healthcare': 'Health',
  'health care': 'Health',
  'medical': 'Health',
  'pharmacy': 'Health',
  'drug stores': 'Health',
  'drug storespharmacies': 'Health',
  'drug stores pharmacies': 'Health',
  'fitness': 'Health',
  'gym': 'Health',
  'gymfitness': 'Health',
  'gym fitness': 'Health',
  'dental': 'Health',
  'vision': 'Health',
  'doctor': 'Health',
  'hospital': 'Health',
  'health and wellness': 'Health',
  'health wellness': 'Health',
  'wellness': 'Health',
  'labs': 'Health',
  'specialist': 'Health',
  // Chase
  'health and fitness': 'Health',

  // ── Housing ──────────────────────────────────────────────────────────────
  'housing': 'Housing',
  'rent': 'Housing',
  'mortgage': 'Housing',
  'home improvement': 'Housing',
  'home maintenance': 'Housing',
  'home repair': 'Housing',
  'home and improvement': 'Housing',
  'lawn and garden': 'Housing',

  // ── Travel ───────────────────────────────────────────────────────────────
  'travel': 'Travel',
  'hotels': 'Travel',
  'hotel': 'Travel',
  'hotellodging': 'Travel',
  'hotels lodging': 'Travel',
  'lodging': 'Travel',
  'airlines': 'Travel',
  'airline': 'Travel',
  'flights': 'Travel',
  'rental car': 'Travel',
  'car rental': 'Travel',
  'vacation': 'Travel',
  'airport': 'Travel',
  'cruise': 'Travel',
  'vacation and travel': 'Travel',
  // Amex
  'travel and transportation': 'Travel',
  'travel transportation': 'Travel',
  // Capital One
  'air travel': 'Travel',

  // ── Education ────────────────────────────────────────────────────────────
  'education': 'Education',
  'tuition': 'Education',
  'student loan': 'Education',
  'student loans': 'Education',
  'books and supplies': 'Education',
  'school': 'Education',
  'college': 'Education',
  'university': 'Education',

  // ── Personal Care ────────────────────────────────────────────────────────
  'personal care': 'Personal Care',
  'beauty': 'Personal Care',
  'hair': 'Personal Care',
  'spa': 'Personal Care',
  'salon': 'Personal Care',
  'nail salon': 'Personal Care',
  'personal and wellness': 'Personal Care',

  // ── Insurance ────────────────────────────────────────────────────────────
  'insurance': 'Insurance',
  'life insurance': 'Insurance',
  'health insurance': 'Insurance',
  'home insurance': 'Insurance',
  'homeowners insurance': 'Insurance',
  'renters insurance': 'Insurance',

  // ── Pets ─────────────────────────────────────────────────────────────────
  'pets': 'Pets',
  'pet supplies': 'Pets',
  'veterinary': 'Pets',
  'vet': 'Pets',
  'pet care': 'Pets',
  'pet services': 'Pets',

  // ── Gifts & Charity ──────────────────────────────────────────────────────
  'gifts': 'Gifts & Charity',
  'gifts and donations': 'Gifts & Charity',
  'gifts donations': 'Gifts & Charity',
  'charity': 'Gifts & Charity',
  'donations': 'Gifts & Charity',
  'charitable giving': 'Gifts & Charity',
  'charitable donations': 'Gifts & Charity',
  'nonprofit': 'Gifts & Charity',

  // ── Fees & Charges ───────────────────────────────────────────────────────
  'fees': 'Fees & Charges',
  'bank fees': 'Fees & Charges',
  'service charges': 'Fees & Charges',
  'service charge': 'Fees & Charges',
  'finance charge': 'Fees & Charges',
  'finance charges': 'Fees & Charges',
  'late fee': 'Fees & Charges',
  'atm fees': 'Fees & Charges',
  'atm fee': 'Fees & Charges',
  'overdraft': 'Fees & Charges',
  'interest charge': 'Fees & Charges',
  'fees and adjustments': 'Fees & Charges',
  'fees adjustments': 'Fees & Charges',
  'charges': 'Fees & Charges',
  'penalty': 'Fees & Charges',
  // Chase
  'professional services': 'Fees & Charges',
  'legal': 'Fees & Charges',

  // ── Income ───────────────────────────────────────────────────────────────
  'income': 'Income',
  'payroll': 'Income',
  'salary': 'Income',
  'wages': 'Income',
  'direct deposit': 'Income',
  'direct deposits': 'Income',
  'interest income': 'Income',
  'interest earned': 'Income',
  'dividends': 'Income',
  'dividend': 'Income',
  'refund': 'Income',
  'refunds': 'Income',
  'reimbursement': 'Income',
  'reimbursements': 'Income',
  'credit': 'Income',
  'statement credit': 'Income',
  'rewards': 'Income',
  'cashback': 'Income',
  'cash back': 'Income',
  'tax refund': 'Income',

  // ── Transfer ─────────────────────────────────────────────────────────────
  'transfer': 'Transfer',
  'transfers': 'Transfer',
  'account transfer': 'Transfer',
  'payment': 'Transfer',
  'payments': 'Transfer',
  'online payment': 'Transfer',
  'bill payment': 'Transfer',
  'check': 'Transfer',
  'checks': 'Transfer',
  'zelle': 'Transfer',
  'venmo': 'Transfer',
  'paypal': 'Transfer',
  'wire': 'Transfer',
  'wire transfer': 'Transfer',
  'ach': 'Transfer',
  'ach transfer': 'Transfer',
  'debit': 'Transfer',
  'credit card payment': 'Transfer',
  'loan payment': 'Transfer',
  'mortgage payment': 'Transfer',

  // ── Other / Catch-all ─────────────────────────────────────────────────────
  'other': 'Other',
  'miscellaneous': 'Other',
  'misc': 'Other',
  'uncategorized': 'Other',
  'general': 'Other',
  'unknown': 'Other',
  'personal': 'Other',
}

/**
 * Keyword-based fallback map.
 * If exact lookup fails, check if any of these keywords appear in the normalized input.
 * Keys are substrings to search for; values are BudgetLens category names.
 * More specific keywords should be listed before general ones.
 */
const KEYWORD_FALLBACK: Array<[string, string]> = [
  ['grocery', 'Groceries'],
  ['supermarket', 'Groceries'],
  ['restaurant', 'Food & Dining'],
  ['dining', 'Food & Dining'],
  ['coffee', 'Food & Dining'],
  ['fast food', 'Food & Dining'],
  ['food drink', 'Food & Dining'],
  ['food and', 'Food & Dining'],
  ['gasoline', 'Transport'],
  ['fuel', 'Transport'],
  ['rideshare', 'Transport'],
  ['parking', 'Transport'],
  ['transit', 'Transport'],
  ['automotive', 'Transport'],
  ['entertainment', 'Entertainment'],
  ['recreation', 'Entertainment'],
  ['nightlife', 'Entertainment'],
  ['streaming', 'Subscriptions'],
  ['subscription', 'Subscriptions'],
  ['membership', 'Subscriptions'],
  ['utilities', 'Utilities'],
  ['electric', 'Utilities'],
  ['internet', 'Utilities'],
  ['wireless', 'Utilities'],
  ['pharmacy', 'Health'],
  ['healthcare', 'Health'],
  ['medical', 'Health'],
  ['fitness', 'Health'],
  ['wellness', 'Health'],
  ['dental', 'Health'],
  ['insurance', 'Insurance'],
  ['mortgage', 'Housing'],
  ['home', 'Housing'],
  ['hotel', 'Travel'],
  ['airline', 'Travel'],
  ['travel', 'Travel'],
  ['lodging', 'Travel'],
  ['education', 'Education'],
  ['tuition', 'Education'],
  ['personal care', 'Personal Care'],
  ['beauty', 'Personal Care'],
  ['charity', 'Gifts & Charity'],
  ['donation', 'Gifts & Charity'],
  ['fee', 'Fees & Charges'],
  ['charge', 'Fees & Charges'],
  ['payroll', 'Income'],
  ['salary', 'Income'],
  ['direct deposit', 'Income'],
  ['refund', 'Income'],
  ['transfer', 'Transfer'],
  ['payment', 'Transfer'],
  ['shopping', 'Shopping'],
  ['retail', 'Shopping'],
  ['clothing', 'Shopping'],
  ['pet', 'Pets'],
]

/**
 * Given a raw bank category string and the list of system categories,
 * return the matching category ID or null if unmapped.
 *
 * Strategy:
 * 1. Exact match on normalized string
 * 2. Keyword/substring fallback
 */
export function mapBankCategory(
  raw: string,
  categories: Array<{ id: string; name: string }>,
): { categoryId: string | null; normalized: string } {
  const normalized = normalizeBankCategory(raw)

  // 1. Exact match
  const exactName = BANK_CATEGORY_MAP[normalized] ?? null
  if (exactName) {
    const cat = categories.find(c => c.name === exactName)
    return { categoryId: cat?.id ?? null, normalized }
  }

  // 2. Keyword/substring fallback
  for (const [keyword, categoryName] of KEYWORD_FALLBACK) {
    if (normalized.includes(keyword)) {
      const cat = categories.find(c => c.name === categoryName)
      if (cat) return { categoryId: cat.id, normalized }
    }
  }

  return { categoryId: null, normalized }
}
