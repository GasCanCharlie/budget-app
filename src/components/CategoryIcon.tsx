import {
  UtensilsCrossed, ShoppingCart, Home, Car, Film, ShoppingBag,
  HeartPulse, Zap, CreditCard, Scissors, BookOpen, Plane, Shield,
  PawPrint, Gift, DollarSign, TrendingUp, Utensils, Wine, Package,
  ArrowLeftRight, Ban, MoreHorizontal, Wallet, type LucideIcon,
} from 'lucide-react'
import { getCategoryIcon } from '@/lib/icons'

// Map of icon name strings (as stored in the DB) → LucideIcon component.
// These are the canonical names seeded by prisma/seed.ts.
const ICON_MAP: Record<string, LucideIcon> = {
  UtensilsCrossed,
  ShoppingCart,
  Home,
  Car,
  Film,
  ShoppingBag,
  HeartPulse,
  Zap,
  CreditCard,
  Scissors,
  BookOpen,
  Plane,
  Shield,
  PawPrint,
  Gift,
  DollarSign,
  TrendingUp,
  Utensils,
  Wine,
  Package,
  ArrowLeftRight,
  Ban,
  MoreHorizontal,
  Wallet,
}

/**
 * Renders the correct Lucide icon for a category.
 *
 * Resolution order:
 *  1. `name` matches a DB icon name string in ICON_MAP (e.g. "UtensilsCrossed")
 *  2. `name` matches a normalized category name via getCategoryIcon() (e.g. "Food & Dining")
 *  3. Falls back to Package icon
 */
export function CategoryIcon({
  name,
  color,
  size = 18,
  className,
}: {
  name: string
  color?: string
  size?: number
  className?: string
}) {
  const Icon = ICON_MAP[name] ?? getCategoryIcon(name)
  return <Icon size={size} color={color ?? '#94a3b8'} className={className} />
}
