export const MASTER_KEYS = [
  'FOOD', 'GROCERY', 'FAST_FOOD', 'ALCOHOL', 'COFFEE',
  'TRANSPORT', 'HOME', 'HEALTH',
  'ENTERTAINMENT', 'SHOPPING', 'TRAVEL', 'DIGITAL',
  'PERSONAL_CARE', 'EDUCATION', 'BUSINESS', 'SOCIAL',
  'FINANCIAL', 'LIFESTYLE', 'PETS', 'TOBACCO',
] as const

export type MasterKey = typeof MASTER_KEYS[number]

export interface MasterCategory {
  key: MasterKey
  name: string
  icon: string
  color: string
}

export const MASTER_CATEGORIES: MasterCategory[] = [
  { key: 'FOOD',         name: 'Food & Dining',   icon: 'UtensilsCrossed', color: '#f97316' },
  { key: 'GROCERY',      name: 'Groceries',        icon: 'ShoppingCart',    color: '#fb923c' },
  { key: 'FAST_FOOD',    name: 'Fast Food',        icon: 'Utensils',        color: '#ef4444' },
  { key: 'ALCOHOL',      name: 'Alcohol',          icon: 'Wine',            color: '#8b5cf6' },
  { key: 'COFFEE',       name: 'Coffee',           icon: 'Coffee',          color: '#d97706' },
  { key: 'TRANSPORT',    name: 'Transport',        icon: 'Car',             color: '#3b82f6' },
  { key: 'HOME',         name: 'Home',             icon: 'Home',            color: '#6366f1' },
  { key: 'HEALTH',       name: 'Health',           icon: 'HeartPulse',      color: '#10b981' },
  { key: 'ENTERTAINMENT',name: 'Entertainment',    icon: 'Film',            color: '#ec4899' },
  { key: 'SHOPPING',     name: 'Shopping',         icon: 'ShoppingBag',     color: '#a855f7' },
  { key: 'TRAVEL',       name: 'Travel',           icon: 'Plane',           color: '#f59e0b' },
  { key: 'DIGITAL',      name: 'Digital & Tech',   icon: 'Monitor',         color: '#06b6d4' },
  { key: 'PERSONAL_CARE',name: 'Personal Care',    icon: 'Scissors',        color: '#8b5cf6' },
  { key: 'EDUCATION',    name: 'Education',        icon: 'BookOpen',        color: '#0ea5e9' },
  { key: 'BUSINESS',     name: 'Business',         icon: 'Briefcase',       color: '#64748b' },
  { key: 'SOCIAL',       name: 'Social & Gifts',   icon: 'Gift',            color: '#ef4444' },
  { key: 'FINANCIAL',    name: 'Financial',        icon: 'DollarSign',      color: '#94a3b8' },
  { key: 'LIFESTYLE',    name: 'Lifestyle',        icon: 'Sparkles',        color: '#84cc16' },
  { key: 'PETS',         name: 'Pets',             icon: 'PawPrint',        color: '#84cc16' },
  { key: 'TOBACCO',      name: 'Tobacco',          icon: 'Ban',             color: '#78716c' },
]
