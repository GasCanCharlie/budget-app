/**
 * Maps normalized bank category strings → internal BudgetLens category names.
 * Normalization: trim + lowercase + collapse whitespace + remove punctuation.
 */

export function normalizeBankCategory(raw: string): string {
  return raw.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ')
}

/** Map from normalized bank category string → BudgetLens category name */
const BANK_CATEGORY_MAP: Record<string, string> = {
  // Groceries
  'groceries': 'Groceries',
  'grocery stores': 'Groceries',
  'supermarkets': 'Groceries',
  'supermarkets and grocery stores': 'Groceries',

  // Food & Dining
  'restaurants': 'Food & Dining',
  'restaurants and dining': 'Food & Dining',
  'dining': 'Food & Dining',
  'food and drink': 'Food & Dining',
  'food  drink': 'Food & Dining',
  'fast food': 'Food & Dining',
  'coffee shops': 'Food & Dining',
  'cafes': 'Food & Dining',
  'bars': 'Food & Dining',

  // Transport
  'gas': 'Transport',
  'gasolinefuel': 'Transport',
  'gasoline and fuel': 'Transport',
  'gasoline': 'Transport',
  'fuel': 'Transport',
  'gas stations': 'Transport',
  'automotive': 'Transport',
  'transportation': 'Transport',
  'ride share': 'Transport',
  'rideshare': 'Transport',
  'parking': 'Transport',
  'public transit': 'Transport',
  'taxi': 'Transport',
  'tolls': 'Transport',

  // Entertainment
  'entertainment': 'Entertainment',
  'movies and dvds': 'Entertainment',
  'movies': 'Entertainment',
  'music': 'Entertainment',
  'sports': 'Entertainment',
  'hobbies': 'Entertainment',
  'arts': 'Entertainment',

  // Shopping
  'shopping': 'Shopping',
  'merchandise': 'Shopping',
  'clothing': 'Shopping',
  'apparel': 'Shopping',
  'electronics': 'Shopping',
  'online shopping': 'Shopping',
  'department stores': 'Shopping',
  'sporting goods': 'Shopping',
  'books': 'Shopping',
  'home and garden': 'Shopping',

  // Utilities
  'utilities': 'Utilities',
  'electricity': 'Utilities',
  'internet': 'Utilities',
  'cable': 'Utilities',
  'phone': 'Utilities',
  'cell phone': 'Utilities',
  'mobile phone': 'Utilities',
  'water': 'Utilities',
  'gas and electric': 'Utilities',

  // Subscriptions
  'subscriptions': 'Subscriptions',
  'streaming': 'Subscriptions',
  'software': 'Subscriptions',

  // Health
  'health': 'Health',
  'healthcare': 'Health',
  'medical': 'Health',
  'pharmacy': 'Health',
  'fitness': 'Health',
  'gym': 'Health',
  'dental': 'Health',
  'vision': 'Health',
  'doctor': 'Health',

  // Housing
  'housing': 'Housing',
  'rent': 'Housing',
  'mortgage': 'Housing',
  'home improvement': 'Housing',
  'home maintenance': 'Housing',
  'furniture': 'Housing',

  // Travel
  'travel': 'Travel',
  'hotels': 'Travel',
  'airlines': 'Travel',
  'airline': 'Travel',
  'rental car': 'Travel',
  'car rental': 'Travel',
  'vacation': 'Travel',
  'lodging': 'Travel',

  // Education
  'education': 'Education',
  'tuition': 'Education',
  'student loan': 'Education',
  'books and supplies': 'Education',

  // Personal Care
  'personal care': 'Personal Care',
  'beauty': 'Personal Care',
  'hair': 'Personal Care',
  'spa': 'Personal Care',

  // Insurance
  'insurance': 'Insurance',
  'auto insurance': 'Insurance',
  'life insurance': 'Insurance',
  'health insurance': 'Insurance',

  // Pets
  'pets': 'Pets',
  'pet supplies': 'Pets',
  'veterinary': 'Pets',

  // Gifts & Charity
  'gifts': 'Gifts & Charity',
  'charity': 'Gifts & Charity',
  'donations': 'Gifts & Charity',
  'charitable giving': 'Gifts & Charity',

  // Fees & Charges
  'fees': 'Fees & Charges',
  'bank fees': 'Fees & Charges',
  'service charges': 'Fees & Charges',
  'finance charge': 'Fees & Charges',
  'late fee': 'Fees & Charges',

  // Income
  'income': 'Income',
  'payroll': 'Income',
  'salary': 'Income',
  'wages': 'Income',
  'direct deposit': 'Income',
  'interest income': 'Income',
  'dividends': 'Income',
  'refund': 'Income',

  // Transfer
  'transfer': 'Transfer',
  'transfers': 'Transfer',
  'account transfer': 'Transfer',
  'payment': 'Transfer',
}

/**
 * Given a raw bank category string and the list of system categories,
 * return the matching category ID or null if unmapped.
 */
export function mapBankCategory(
  raw: string,
  categories: Array<{ id: string; name: string }>,
): { categoryId: string | null; normalized: string } {
  const normalized = normalizeBankCategory(raw)
  const mappedName = BANK_CATEGORY_MAP[normalized] ?? null
  if (!mappedName) return { categoryId: null, normalized }
  const cat = categories.find(c => c.name === mappedName)
  return { categoryId: cat?.id ?? null, normalized }
}
