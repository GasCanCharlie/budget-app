'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import {
  LayoutDashboard, Upload, ArrowLeftRight, Tags, Layers,
  LogOut, ChevronLeft, ChevronRight, ShieldCheck, Gavel, History, MessageCircle, Lightbulb
} from 'lucide-react'
import clsx from 'clsx'
import { LogoMark } from '@/components/LogoMark'
import { ThemeToggle } from '@/components/ThemeToggle'

interface AppShellProps {
  children: React.ReactNode
  year?: number
  month?: number
  availableMonths?: { year: number; month: number }[]
  onMonthChange?: (year: number, month: number) => void
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const navItems = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/insights',     label: 'Insights',     icon: Lightbulb },
  { href: '/history',      label: 'History',      icon: History },
  { href: '/upload',       label: 'Upload',       icon: Upload },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/categorize',   label: 'Categorize',   icon: Tags },
  { href: '/categories',   label: 'Categories',   icon: Layers },
  { href: '/rules',        label: 'Rules',        icon: Gavel },
  { href: '/chat',         label: 'Chat',         icon: MessageCircle },
]

export function AppShell({ children, year, month, availableMonths, onMonthChange }: AppShellProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const logout   = useAuthStore(s => s.logout)
  const user     = useAuthStore(s => s.user)
  const qc       = useQueryClient()

  function handleLogout() {
    logout()
    qc.clear()
    router.push('/')
  }

  function navigateMonth(dir: -1 | 1) {
    if (!availableMonths || !year || !month) return
    const idx = availableMonths.findIndex(m => m.year === year && m.month === month)
    const next = availableMonths[idx + dir]
    if (next) onMonthChange?.(next.year, next.month)
  }

  const canGoPrev = availableMonths && year && month
    ? availableMonths.findIndex(m => m.year === year && m.month === month) < availableMonths.length - 1
    : false
  const canGoNext = availableMonths && year && month
    ? availableMonths.findIndex(m => m.year === year && m.month === month) > 0
    : false

  return (
    <div className="min-h-screen">
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 w-64 border-r hidden md:flex flex-col z-40"
        style={{ background: 'var(--sidebar)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {/* Logo */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="bl-logo-container" style={{ width: 36, height: 36 }}>
            <LogoMark size={34} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>BudgetLens</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Statement Intelligence</div>
          </div>
        </div>

        {/* Nav links */}
        <nav className="p-3 space-y-0.5 flex-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href === '/upload' && pathname.startsWith('/upload')) || (href === '/staging' && pathname.startsWith('/staging')) || (href === '/insights' && pathname.startsWith('/insights'))
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'bl-nav-link flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                  active ? 'active' : ''
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Bottom: integrity badge + logout */}
        <div className="p-3 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: 'var(--surface2)' }}>
            <ShieldCheck className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--success)' }} />
            <div className="text-xs leading-tight" style={{ color: 'var(--text-secondary)' }}>
              Privacy-first<br />No bank login required
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleLogout}
              className="bl-nav-link flex-1 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition"
            >
              <LogOut className="h-4 w-4" />
              Sign out
            </button>
            <ThemeToggle />
          </div>
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────────────── */}
      <div className="md:pl-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header
          className="sticky top-0 z-30 h-14 border-b"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div className="h-full px-4 flex items-center justify-between gap-4">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="bl-logo-container" style={{ width: 30, height: 30 }}>
                <LogoMark size={28} />
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>BudgetLens</span>
            </div>

            {/* Month navigator (desktop) */}
            {availableMonths && availableMonths.length > 0 && year && month && (
              <div className="hidden md:flex items-center gap-1">
                <button
                  onClick={() => navigateMonth(1)}
                  disabled={!canGoPrev}
                  className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={15} style={{ color: 'var(--text-secondary)' }} />
                </button>
                <span className="font-semibold text-sm min-w-[90px] text-center" style={{ color: 'var(--text-primary)' }}>
                  {MONTH_NAMES[month - 1]} {year}
                </span>
                <button
                  onClick={() => navigateMonth(-1)}
                  disabled={!canGoNext}
                  className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight size={15} style={{ color: 'var(--text-secondary)' }} />
                </button>
              </div>
            )}

            <div className="hidden md:block text-xs" style={{ color: 'var(--text-secondary)' }}>
              Privacy-first · No bank login · Local-first
            </div>

            {/* User email + theme toggle */}
            <div className="flex items-center gap-2">
              <div className="text-xs hidden sm:block truncate max-w-[200px]" style={{ color: 'var(--text-secondary)' }}>
                {user?.email}
              </div>
              <ThemeToggle />
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 max-w-6xl mx-auto w-full">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav
        className="fixed bottom-0 inset-x-0 md:hidden border-t px-2 py-2 flex justify-around z-40"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href === '/upload' && pathname.startsWith('/upload'))
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'bl-nav-link flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                active ? 'active' : ''
              )}
            >
              <Icon size={20} />
              {label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
