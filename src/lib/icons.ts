// ─── Nav icon name constants (matches AppShell.tsx imports) ──────────────────

export const NavIcons = {
  dashboard:    'LayoutDashboard',
  insights:     'Lightbulb',
  history:      'History',
  upload:       'Upload',
  transactions: 'ArrowLeftRight',
  categorize:   'FolderKanban',
  categories:   'Tags',
  rules:        'Repeat2',
  chat:         'MessageCircle',
  inbox:        'Inbox',
} as const

// ─── Category icon registry ───────────────────────────────────────────────────

import {
  Home, Car, Wine, Ticket, PlugZap, ShoppingBag, CreditCard, Shield,
  ShoppingCart, Repeat, UtensilsCrossed, Plane, Heart, Dumbbell, GraduationCap,
  Briefcase, Baby, PawPrint, Wrench, Coffee, Music, Gamepad2, Landmark,
  TrendingUp, DollarSign, Building2, Zap, Package, CircleHelp,
  Film, HeartPulse, Scissors, BookOpen, Gift, Utensils, Ban, ArrowLeftRight,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export const CATEGORY_ICON_MAP: Record<string, LucideIcon> = {
  // ── Housing / Home ──────────────────────────────────────────────────────────
  housing: Home,
  home: Home,
  rent: Home,
  mortgage: Home,
  // ── Transport ───────────────────────────────────────────────────────────────
  transport: Car,
  transportation: Car,
  auto: Car,
  car: Car,
  gas: Zap,
  fuel: Zap,
  // ── Food & Drink ────────────────────────────────────────────────────────────
  'food & dining': UtensilsCrossed,
  'food and dining': UtensilsCrossed,
  food: UtensilsCrossed,
  dining: UtensilsCrossed,
  restaurants: UtensilsCrossed,
  restaurant: UtensilsCrossed,
  'fast food': Utensils,
  fastfood: Utensils,
  groceries: ShoppingCart,
  grocery: ShoppingCart,
  alcohol: Wine,
  bar: Wine,
  drinking: Wine,
  coffee: Coffee,
  cafe: Coffee,
  // ── Entertainment ───────────────────────────────────────────────────────────
  entertainment: Film,
  movies: Film,
  events: Ticket,
  music: Music,
  gaming: Gamepad2,
  games: Gamepad2,
  // ── Utilities ───────────────────────────────────────────────────────────────
  utilities: PlugZap,
  utility: PlugZap,
  electric: PlugZap,
  internet: PlugZap,
  phone: PlugZap,
  // ── Shopping ────────────────────────────────────────────────────────────────
  shopping: ShoppingBag,
  retail: ShoppingBag,
  clothing: ShoppingBag,
  // ── Financial ───────────────────────────────────────────────────────────────
  'credit card': CreditCard,
  creditcard: CreditCard,
  credit_card: CreditCard,
  subscriptions: CreditCard,
  subscription: CreditCard,
  streaming: Repeat,
  debt: CreditCard,
  insurance: Shield,
  'fees & charges': DollarSign,
  'fees and charges': DollarSign,
  fees: DollarSign,
  charges: DollarSign,
  // ── Health ──────────────────────────────────────────────────────────────────
  health: HeartPulse,
  medical: Heart,
  healthcare: Heart,
  fitness: Dumbbell,
  gym: Dumbbell,
  // ── Travel ──────────────────────────────────────────────────────────────────
  travel: Plane,
  vacation: Plane,
  // ── Education ───────────────────────────────────────────────────────────────
  education: GraduationCap,
  school: GraduationCap,
  // ── Work / Business ─────────────────────────────────────────────────────────
  business: Briefcase,
  work: Briefcase,
  // ── Kids / Family ───────────────────────────────────────────────────────────
  kids: Baby,
  children: Baby,
  childcare: Baby,
  // ── Pets ────────────────────────────────────────────────────────────────────
  pets: PawPrint,
  pet: PawPrint,
  // ── Personal care ───────────────────────────────────────────────────────────
  'personal care': Scissors,
  personalcare: Scissors,
  // ── Home improvement ────────────────────────────────────────────────────────
  'home improvement': Wrench,
  maintenance: Wrench,
  repairs: Wrench,
  // ── Income ──────────────────────────────────────────────────────────────────
  income: TrendingUp,
  salary: TrendingUp,
  paycheck: TrendingUp,
  investments: TrendingUp,
  // ── Financial services / bank ────────────────────────────────────────────────
  banking: Landmark,
  bank: Landmark,
  savings: Landmark,
  // ── Gifts & Charity ─────────────────────────────────────────────────────────
  'gifts & charity': Gift,
  'gifts and charity': Gift,
  gifts: Gift,
  charity: Heart,
  // ── Tobacco ─────────────────────────────────────────────────────────────────
  'cigarettes & tobacco': Ban,
  'cigarettes and tobacco': Ban,
  tobacco: Ban,
  cigarettes: Ban,
  smoking: Ban,
  // ── Transfer ────────────────────────────────────────────────────────────────
  transfer: ArrowLeftRight,
  // ── Misc ────────────────────────────────────────────────────────────────────
  taxes: Building2,
  government: Building2,
  personal: DollarSign,
  misc: Package,
  miscellaneous: Package,
  other: Package,
}

export const FALLBACK_ICON: LucideIcon = CircleHelp

/** Normalize a category name to a registry key */
export function normalizeCategoryKey(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9 &_]/g, '').replace(/\s+/g, ' ')
}

/** Get the LucideIcon component for a category name, with fallback */
export function getCategoryIcon(categoryName: string): LucideIcon {
  const key = normalizeCategoryKey(categoryName)
  return CATEGORY_ICON_MAP[key] ?? FALLBACK_ICON
}
