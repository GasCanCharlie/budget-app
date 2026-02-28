'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { LayoutDashboard, Receipt, Upload, LogOut, ChevronLeft, ChevronRight, Tags, Settings2 } from 'lucide-react'
import clsx from 'clsx'

interface AppShellProps {
  children: React.ReactNode
  year?: number
  month?: number
  availableMonths?: { year: number; month: number }[]
  onMonthChange?: (year: number, month: number) => void
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

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
    <div className="min-h-screen flex flex-col">
      {/* Top nav */}
      <header className="bg-navy-900 text-white px-4 py-0 sticky top-0 z-50 border-b border-navy-700">
        <div className="max-w-6xl mx-auto flex items-center justify-between h-14">

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded bg-accent-500 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-black text-white tracking-tight select-none">BL</span>
            </div>
            <span className="font-bold text-base tracking-tight">BudgetLens</span>
          </div>

          {/* Month navigator (shown on dashboard) */}
          {availableMonths && availableMonths.length > 0 && year && month && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => navigateMonth(1)}
                disabled={!canGoPrev}
                className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="font-semibold text-sm min-w-[90px] text-center text-white/90">
                {MONTH_NAMES[month - 1]} {year}
              </span>
              <button
                onClick={() => navigateMonth(-1)}
                disabled={!canGoNext}
                className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}

          {/* User + logout */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-white/50 hidden sm:block mr-2 font-mono">{user?.email}</span>
            <button
              onClick={handleLogout}
              className="p-2 rounded-md hover:bg-white/10 transition text-white/70 hover:text-white"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1">
        {children}
      </div>

      {/* Bottom nav */}
      <nav className="sticky bottom-0 bg-white border-t border-slate-200 px-2 py-2 flex justify-around z-40">
        {[
          { href: '/dashboard',     icon: LayoutDashboard, label: 'Dashboard' },
          { href: '/upload',        icon: Upload,           label: 'Ingest' },
          { href: '/transactions',  icon: Receipt,          label: 'Transactions' },
          { href: '/categorize',    icon: Tags,             label: 'Categorize' },
          { href: '/categories',    icon: Settings2,        label: 'Categories' },
        ].map(({ href, icon: Icon, label }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              'flex flex-col items-center gap-0.5 px-5 py-1.5 rounded-lg text-xs font-semibold transition-all',
              pathname === href || (href === '/upload' && pathname.startsWith('/upload'))
                ? 'text-accent-600 bg-accent-50'
                : 'text-slate-500 hover:text-slate-700'
            )}
          >
            <Icon size={20} />
            {label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
