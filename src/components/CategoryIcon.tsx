import {
  UtensilsCrossed, ShoppingCart, Home, Car, Film, ShoppingBag,
  HeartPulse, Zap, CreditCard, Scissors, BookOpen, Plane, Shield,
  PawPrint, Gift, DollarSign, TrendingUp, Utensils, Wine, Package,
  ArrowLeftRight, Ban, MoreHorizontal, Wallet, type LucideIcon,
} from 'lucide-react'

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
  const Icon = ICON_MAP[name] ?? Package
  return <Icon size={size} color={color ?? '#94a3b8'} className={className} />
}
