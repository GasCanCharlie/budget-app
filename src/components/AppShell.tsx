'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import { useInsightsUnlock } from '@/hooks/useInsightsUnlock'
import {
  LayoutDashboard, FileText, ArrowLeftRight, Tags, Layers,
  LogOut, ChevronLeft, ChevronRight, ShieldCheck, Gavel, History, Lightbulb, Lock, Settings,
} from 'lucide-react'
import clsx from 'clsx'
import { LogoMark } from '@/components/LogoMark'
import { ThemeToggle } from '@/components/ThemeToggle'
import { useEffect, useRef, useState } from 'react'

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
  { href: '/insights',     label: 'Insights Q&A', icon: Lightbulb },
  { href: '/upload',       label: 'Uploads',      icon: FileText },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/categorize',   label: 'Categorize',   icon: Tags },
  { href: '/categories',   label: 'Categories',   icon: Layers },
  { href: '/rules',        label: 'Rules',        icon: Gavel },
  { href: '/history',      label: 'History',      icon: History },
  { href: '/settings',    label: 'Settings',     icon: Settings },
]

const TOOLTIP_TEXT = 'Finish categorizing all transactions to unlock AI Insights.'

export function AppShell({ children, year, month, availableMonths, onMonthChange }: AppShellProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const logout   = useAuthStore(s => s.logout)
  const user     = useAuthStore(s => s.user)
  const qc       = useQueryClient()
  const { unlocked, loading: unlockLoading } = useInsightsUnlock()

  // Track transition locked→unlocked to trigger "just unlocked" toast + glow
  const prevUnlockedRef = useRef<boolean | null>(null)
  const [justUnlocked, setJustUnlocked] = useState(false)
  const [showUnlockToast, setShowUnlockToast] = useState(false)
  const [insightsTooltip, setInsightsTooltip] = useState(false)
  const tooltipTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (unlockLoading) return
    if (prevUnlockedRef.current === false && unlocked === true) {
      setJustUnlocked(true)
      setShowUnlockToast(true)
      const t1 = setTimeout(() => setJustUnlocked(false), 2500)
      const t2 = setTimeout(() => setShowUnlockToast(false), 4500)
      return () => { clearTimeout(t1); clearTimeout(t2) }
    }
    prevUnlockedRef.current = unlocked
  }, [unlocked, unlockLoading])

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

  function handleLockedInsightsClick() {
    router.push('/categorize?from=insights')
  }

  function onInsightsMouseEnter() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    tooltipTimer.current = setTimeout(() => setInsightsTooltip(true), 200)
  }

  function onInsightsMouseLeave() {
    if (tooltipTimer.current) clearTimeout(tooltipTimer.current)
    setInsightsTooltip(false)
  }

  return (
    <div className="min-h-screen">
      <style>{`
        @keyframes bl-unlock-glow {
          0%   { box-shadow: none; }
          30%  { box-shadow: 0 0 0 3px rgba(111,128,255,0.35), 0 0 16px rgba(111,128,255,0.25); }
          100% { box-shadow: none; }
        }
        .bl-unlock-glow {
          animation: bl-unlock-glow 2.5s ease-out forwards;
        }
      `}</style>

      {/* ── Unlock toast ────────────────────────────────────────────────── */}
      {showUnlockToast && (
        <div
          style={{
            position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'linear-gradient(135deg, rgba(39,210,120,0.18), rgba(63,180,255,0.14))',
            border: '1px solid rgba(63,220,140,0.4)',
            borderRadius: 14,
            padding: '12px 20px',
            display: 'flex', alignItems: 'center', gap: 10,
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 18 }}>🎉</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#d1fae5' }}>
            Insights unlocked! Your spending analysis is now ready.
          </span>
        </div>
      )}

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
            const active = pathname === href
              || (href === '/upload' && pathname.startsWith('/upload'))
              || (href === '/staging' && pathname.startsWith('/staging'))
              || (href === '/insights' && (pathname.startsWith('/insights') || pathname.startsWith('/chat')))

            if (href === '/insights' && !unlocked) {
              // Locked state
              return (
                <div key={href} style={{ position: 'relative' }}>
                  <button
                    onClick={handleLockedInsightsClick}
                    onMouseEnter={onInsightsMouseEnter}
                    onMouseLeave={onInsightsMouseLeave}
                    className="bl-nav-link flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition w-full text-left"
                    style={{ opacity: 0.5, cursor: 'not-allowed' }}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                    <Lock className="h-3 w-3 ml-auto flex-shrink-0" />
                  </button>
                  {insightsTooltip && (
                    <div style={{
                      position: 'absolute', left: '100%', top: '50%', transform: 'translateY(-50%)',
                      marginLeft: 10, zIndex: 100,
                      background: 'rgba(10,18,40,0.97)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#d0dbff',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                      pointerEvents: 'none',
                    }}>
                      {TOOLTIP_TEXT}
                    </div>
                  )}
                </div>
              )
            }

            return (
              <Link
                key={href}
                href={href}
                className={clsx(
                  'bl-nav-link flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                  active ? 'active' : '',
                  href === '/insights' && justUnlocked ? 'bl-unlock-glow' : '',
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

          if (href === '/insights' && !unlocked) {
            return (
              <button
                key={href}
                onClick={handleLockedInsightsClick}
                className={clsx(
                  'bl-nav-link flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                )}
                style={{ opacity: 0.45, cursor: 'not-allowed', position: 'relative' }}
              >
                <Icon size={20} />
                <Lock size={8} style={{ position: 'absolute', top: 4, right: 8 }} />
                {label}
              </button>
            )
          }

          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'bl-nav-link flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all',
                active ? 'active' : '',
                href === '/insights' && justUnlocked ? 'bl-unlock-glow' : '',
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
