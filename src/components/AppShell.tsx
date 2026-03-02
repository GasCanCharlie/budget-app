'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import {
  LayoutDashboard, Upload, ReceiptText, Tags, FolderKanban,
  LogOut, ChevronLeft, ChevronRight, ShieldCheck, Repeat2
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
  { href: '/upload',       label: 'Upload',       icon: Upload },
  { href: '/transactions', label: 'Transactions', icon: ReceiptText },
  { href: '/categorize',   label: 'Categorize',   icon: FolderKanban },
  { href: '/categories',   label: 'Categories',   icon: Tags },
  { href: '/rules',        label: 'Rules',        icon: Repeat2 },
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
    <div className="app-dark min-h-screen">
      {/* ── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="fixed inset-y-0 left-0 w-64 text-slate-100 border-r hidden md:flex flex-col z-40"
        style={{ background: 'linear-gradient(180deg, #0b1020 0%, #070a14 100%)', borderColor: 'rgba(255,255,255,.07)' }}
      >
        {/* Logo */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b" style={{ borderColor: 'rgba(255,255,255,.07)' }}>
          <div className="logo-mark h-8 w-8" aria-hidden="true" />
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide text-[#eaf0ff]">BudgetLens</div>
            <div className="text-xs text-[#8b97c3]">Statement Intelligence</div>
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
                    ? 'bg-white/10 text-white'
                    : 'text-[#8b97c3] hover:bg-white/[0.06] hover:text-[#c8d4f5]'
                )}
              >
                <Icon className={clsx('h-4 w-4', active ? 'text-[#6ea8ff]' : 'text-[#8b97c3]')} />
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Bottom: integrity badge + logout */}
        <div className="p-3 border-t space-y-2" style={{ borderColor: 'rgba(255,255,255,.07)' }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: 'rgba(0,0,0,.30)' }}>
            <ShieldCheck className="h-4 w-4 text-[#2ee59d] flex-shrink-0" />
            <div className="text-xs text-[#8b97c3] leading-tight">
              Privacy-first<br />No bank login required
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[#8b97c3] hover:bg-white/[0.06] hover:text-[#c8d4f5] transition"
          >
            <LogOut className="h-4 w-4 text-[#8b97c3]" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content area ────────────────────────────────────────── */}
      <div className="md:pl-64 flex flex-col min-h-screen">
        {/* Topbar */}
        <header
          className="sticky top-0 z-30 h-14 border-b"
          style={{
            background: 'linear-gradient(180deg, rgba(11,16,32,.88), rgba(11,16,32,.72))',
            borderColor: 'rgba(255,255,255,.07)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
          }}
        >
          <div className="h-full px-4 flex items-center justify-between gap-4">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="logo-mark h-7 w-7" aria-hidden="true" />
              <span className="text-sm font-semibold text-[#eaf0ff]">BudgetLens</span>
            </div>

            {/* Month navigator (desktop) */}
            {availableMonths && availableMonths.length > 0 && year && month && (
              <div className="hidden md:flex items-center gap-1">
                <button
                  onClick={() => navigateMonth(1)}
                  disabled={!canGoPrev}
                  className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronLeft size={15} className="text-[#a8b3d6]" />
                </button>
                <span className="font-semibold text-sm min-w-[90px] text-center text-[#eaf0ff]">
                  {MONTH_NAMES[month - 1]} {year}
                </span>
                <button
                  onClick={() => navigateMonth(-1)}
                  disabled={!canGoNext}
                  className="p-1.5 rounded-md hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition"
                >
                  <ChevronRight size={15} className="text-[#a8b3d6]" />
                </button>
              </div>
            )}

            <div className="hidden md:block text-xs text-[#8b97c3]">
              Privacy-first · No bank login · Local-first
            </div>

            {/* User email */}
            <div className="text-xs text-[#8b97c3] font-mono hidden sm:block truncate max-w-[200px]">
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
      <nav
        className="fixed bottom-0 inset-x-0 md:hidden border-t px-2 py-2 flex justify-around z-40"
        style={{
          background: 'rgba(7,10,20,.92)',
          borderColor: 'rgba(255,255,255,.08)',
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
                'flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                active ? 'text-[#6ea8ff] bg-white/10' : 'text-[#8b97c3] hover:text-[#c8d4f5]'
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
