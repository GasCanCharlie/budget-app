'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import {
  LayoutDashboard, Upload, List, Tags, FolderKanban,
  LogOut, ChevronLeft, ChevronRight, ShieldCheck
} from 'lucide-react'
import clsx from 'clsx'

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
  { href: '/upload',       label: 'Ingest',       icon: Upload },
  { href: '/transactions', label: 'Transactions', icon: List },
  { href: '/categorize',   label: 'Categorize',   icon: FolderKanban },
  { href: '/categories',   label: 'Categories',   icon: Tags },
]

export function AppShell({ children, year, month, availableMonths, onMonthChange }: AppShellProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const logout   = useAuthStore(s => s.logout)
  const user     = useAuthStore(s => s.user)

  function handleLogout() {
    logout()
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
      <aside className="fixed inset-y-0 left-0 w-64 bg-slate-950 text-slate-100 border-r border-slate-900 hidden md:flex flex-col z-40">
        {/* Logo */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b border-slate-900">
          <div className="h-8 w-8 rounded-md bg-blue-600/20 border border-blue-500/30 flex items-center justify-center flex-shrink-0">
            <span className="text-blue-200 font-bold text-sm select-none">BL</span>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide">BudgetLens</div>
            <div className="text-xs text-slate-400">Statement Intelligence</div>
          </div>
        </div>

        {/* Nav links */}
        <nav className="p-3 space-y-0.5 flex-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || (href === '/upload' && pathname.startsWith('/upload'))
            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                  active
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300 hover:bg-slate-900/70 hover:text-white'
                )}
              >
                <Icon className={clsx('h-4 w-4', active ? 'text-blue-400' : 'text-slate-400')} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Bottom: integrity badge + logout */}
        <div className="p-3 border-t border-slate-900 space-y-2">
          <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-slate-900/50">
            <ShieldCheck className="h-4 w-4 text-green-400 flex-shrink-0" />
            <div className="text-xs text-slate-400 leading-tight">
              Privacy-first<br />No bank login required
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-300 hover:bg-slate-900/70 hover:text-white transition"
          >
            <LogOut className="h-4 w-4 text-slate-400" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────────────── */}
      <div className="md:pl-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header className="sticky top-0 z-30 h-14 bg-white/90 backdrop-blur border-b border-slate-200">
          <div className="h-full px-4 flex items-center justify-between gap-4">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="h-7 w-7 rounded-md bg-blue-600/10 border border-blue-600/20 flex items-center justify-center">
                <span className="text-blue-700 font-bold text-xs">BL</span>
              </div>
              <span className="text-sm font-semibold text-slate-900">BudgetLens</span>
            </div>

            {/* Month navigator (desktop — shown when year/month are provided) */}
            {availableMonths && availableMonths.length > 0 && year && month && (
              <div className="hidden md:flex items-center gap-1">
                <button
                  onClick={() => navigateMonth(1)}
                  disabled={!canGoPrev}
                  className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={15} className="text-slate-600" />
                </button>
                <span className="font-semibold text-sm min-w-[90px] text-center text-slate-700">
                  {MONTH_NAMES[month - 1]} {year}
                </span>
                <button
                  onClick={() => navigateMonth(-1)}
                  disabled={!canGoNext}
                  className="p-1.5 rounded-md hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight size={15} className="text-slate-600" />
                </button>
              </div>
            )}

            <div className="hidden md:block text-xs text-slate-400">
              Privacy-first · No bank login · Local-first
            </div>

            {/* User email */}
            <div className="text-xs text-slate-500 font-mono hidden sm:block truncate max-w-[200px]">
              {user?.email}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 px-4 py-6 max-w-6xl mx-auto w-full">
          {children}
        </main>
      </div>

      {/* ── Mobile bottom nav ────────────────────────────────────────── */}
      <nav className="fixed bottom-0 inset-x-0 md:hidden bg-white border-t border-slate-200 px-2 py-2 flex justify-around z-40">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href === '/upload' && pathname.startsWith('/upload'))
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                active ? 'text-blue-600 bg-blue-50' : 'text-slate-500 hover:text-slate-700'
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
