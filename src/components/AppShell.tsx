'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/store/auth'
import { useInsightsUnlock } from '@/hooks/useInsightsUnlock'
import {
  LayoutDashboard, FileText, ArrowLeftRight, Tags, Layers,
  LogOut, ChevronLeft, ChevronRight, ShieldCheck, Gavel, History, FlaskConical, Settings,
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

// Core product flow — shown in both desktop sidebar and mobile bottom nav
const primaryNavItems = [
  { href: '/dashboard',    label: 'Dashboard',    icon: LayoutDashboard },
  { href: '/upload',       label: 'Uploads',      icon: FileText },
  { href: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { href: '/categorize',   label: 'Categorize',   icon: Tags },
  { href: '/insights',     label: 'Financial Autopsy', icon: FlaskConical },
]

// Management utilities — desktop sidebar only, visually de-emphasized
const secondaryNavItems = [
  { href: '/categories', label: 'Categories', icon: Layers },
  { href: '/rules',      label: 'Rules',       icon: Gavel },
  { href: '/history',    label: 'History',     icon: History },
  { href: '/settings',   label: 'Settings',    icon: Settings },
]

// Two-part message: header + body so the tooltip feels informative, not punishing
const LOCKED_TOOLTIP = 'Complete categorization to unlock AI insights and financial analysis.'

export function AppShell({ children, year, month, availableMonths, onMonthChange }: AppShellProps) {
  const pathname = usePathname()
  const router   = useRouter()
  const logout   = useAuthStore(s => s.logout)
  const user     = useAuthStore(s => s.user)
  const qc       = useQueryClient()
  const { unlocked, loading: unlockLoading } = useInsightsUnlock()

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

  // Redirect to Categorize with context so user understands why they're there
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
        .bl-unlock-glow { animation: bl-unlock-glow 2.5s ease-out forwards; }
      `}</style>

      {/* ── Insights unlocked toast ──────────────────────────────────────────── */}
      {showUnlockToast && (
        <div style={{
          position: 'fixed', bottom: 80, left: '50%', transform: 'translateX(-50%)',
          zIndex: 9999,
          background: 'linear-gradient(135deg, rgba(39,210,120,0.18), rgba(63,180,255,0.14))',
          border: '1px solid rgba(63,220,140,0.4)',
          borderRadius: 14, padding: '12px 20px',
          display: 'flex', alignItems: 'center', gap: 10,
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.28)',
          whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 18 }}>🎉</span>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#d1fae5' }}>
            Insights unlocked! Your spending analysis is now ready.
          </span>
        </div>
      )}

      {/* ── Desktop sidebar ──────────────────────────────────────────────────── */}
      <aside
        className="fixed inset-y-0 left-0 w-64 border-r hidden md:flex flex-col z-40"
        style={{ background: 'var(--sidebar)', borderColor: 'var(--border)', color: 'var(--text)' }}
      >
        {/* Logo mark */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="bl-logo-container" style={{ width: 36, height: 36 }}>
            <LogoMark size={34} />
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-primary)' }}>BudgetLens</div>
            <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>Statement Intelligence</div>
          </div>
        </div>

        {/* Nav — primary core flow + secondary utilities */}
        <nav className="p-3 flex-1 flex flex-col overflow-y-auto">

          {/* Primary: core product flow */}
          <div className="space-y-0.5">
            {primaryNavItems.filter(i => i.href !== '/insights').map(({ href, label, icon: Icon }) => {
              const active = pathname === href
                || (href === '/upload' && pathname.startsWith('/upload'))

              return (
                <Link
                  key={href}
                  href={href}
                  className={clsx(
                    'bl-nav-link flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition',
                    active ? 'active' : '',
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </Link>
              )
            })}

            {/* Financial Autopsy — featured image card */}
            {(() => {
              const active = pathname.startsWith('/insights') || pathname.startsWith('/chat')
              const card = (
                <div style={{
                  position: 'relative',
                  marginTop: 6,
                  borderRadius: 12,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  border: active
                    ? '1px solid rgba(108,124,255,0.55)'
                    : '1px solid rgba(255,255,255,0.08)',
                  boxShadow: active
                    ? '0 0 0 1px rgba(108,124,255,0.18), 0 4px 20px rgba(108,124,255,0.20)'
                    : '0 2px 12px rgba(0,0,0,0.35)',
                  opacity: unlocked ? 1 : 0.60,
                  transition: 'opacity 150ms ease, border-color 150ms ease, box-shadow 150ms ease',
                }}
                  onMouseEnter={!unlocked ? onInsightsMouseEnter : undefined}
                  onMouseLeave={!unlocked ? onInsightsMouseLeave : undefined}
                >
                  <img
                    src="/financial-autopsy-nav.webp"
                    alt="Financial Autopsy"
                    style={{ width: '100%', height: 'auto', display: 'block' }}
                  />
                  {/* Bottom gradient + lock badge */}
                  <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: 40,
                    background: 'linear-gradient(to top, rgba(0,0,0,0.70) 0%, transparent 100%)',
                    pointerEvents: 'none',
                  }} />
                  {!unlocked && (
                    <span style={{
                      position: 'absolute', bottom: 8, right: 10,
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                      background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.14)',
                      borderRadius: 4, padding: '2px 6px', color: 'rgba(255,255,255,0.45)',
                      pointerEvents: 'none',
                    }}>
                      Locked
                    </span>
                  )}
                  {active && (
                    <div style={{
                      position: 'absolute', inset: 0,
                      border: '2px solid rgba(108,124,255,0.55)',
                      borderRadius: 12, pointerEvents: 'none',
                    }} />
                  )}
                </div>
              )

              if (!unlocked) {
                return (
                  <div key="/insights" style={{ position: 'relative' }}
                    onMouseEnter={onInsightsMouseEnter}
                    onMouseLeave={onInsightsMouseLeave}
                  >
                    <button onClick={handleLockedInsightsClick} style={{ width: '100%', background: 'none', border: 'none', padding: 0 }}>
                      {card}
                    </button>
                    {insightsTooltip && (
                      <div style={{
                        position: 'absolute', left: '100%', top: '50%',
                        transform: 'translateY(-50%)', marginLeft: 10, zIndex: 100,
                        background: 'rgba(10,18,40,0.97)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10, padding: '10px 14px',
                        fontSize: 12, fontWeight: 500, color: '#c8d4f0',
                        maxWidth: 220, lineHeight: 1.55,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
                        pointerEvents: 'none',
                      }}>
                        <div style={{ fontWeight: 700, marginBottom: 4, color: '#e5e7eb', fontSize: 13 }}>Insights locked</div>
                        {LOCKED_TOOLTIP}
                      </div>
                    )}
                  </div>
                )
              }

              return (
                <Link key="/insights" href="/insights"
                  className={clsx(justUnlocked ? 'bl-unlock-glow' : '')}
                  style={{ display: 'block', borderRadius: 12 }}
                >
                  {card}
                </Link>
              )
            })()}
          </div>

          {/* Secondary: management utilities, pushed to bottom */}
          <div className="mt-auto">
            <div className="pt-3 space-y-0.5" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="px-3 mb-1" style={{
                fontSize: 10, fontWeight: 700, letterSpacing: '0.07em',
                textTransform: 'uppercase', color: 'var(--text-muted)',
              }}>
                Manage
              </p>
              {secondaryNavItems.map(({ href, label, icon: Icon }) => {
                const active = pathname === href
                return (
                  <Link
                    key={href}
                    href={href}
                    className={clsx(
                      'bl-nav-link flex items-center gap-2.5 rounded-md px-3 py-2 transition',
                      active ? 'active' : '',
                    )}
                    style={{ fontSize: 12 }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                )
              })}
            </div>
          </div>
        </nav>

        {/* Footer: privacy badge + logout */}
        <div className="p-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-md mb-2" style={{ background: 'var(--surface2)' }}>
            <ShieldCheck className="h-4 w-4 flex-shrink-0" style={{ color: 'var(--success)' }} />
            <div className="text-xs leading-tight" style={{ color: 'var(--text-secondary)' }}>
              Privacy-first · No bank login
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="bl-nav-link w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition"
          >
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main content area ─────────────────────────────────────────────────── */}
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
            {/* Mobile: logo only */}
            <div className="flex items-center gap-2 md:hidden">
              <div className="bl-logo-container" style={{ width: 30, height: 30 }}>
                <LogoMark size={28} />
              </div>
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>BudgetLens</span>
            </div>

            {/* Desktop: month navigator */}
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

            {/* Desktop: privacy tagline */}
            <div className="hidden md:block text-xs" style={{ color: 'var(--text-secondary)' }}>
              Privacy-first · No bank login
            </div>

            {/* User + theme toggle (single instance) */}
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

      {/* ── Mobile bottom nav — core flow only ───────────────────────────────── */}
      <nav
        className="fixed bottom-0 inset-x-0 md:hidden border-t px-2 py-2 flex justify-around z-40"
        style={{
          background: 'var(--surface)',
          borderColor: 'var(--border)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        {primaryNavItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
            || (href === '/upload' && pathname.startsWith('/upload'))
            || (href === '/insights' && (pathname.startsWith('/insights') || pathname.startsWith('/chat')))

          if (href === '/insights' && !unlocked) {
            return (
              <button
                key={href}
                onClick={handleLockedInsightsClick}
                className="bl-nav-link flex flex-col items-center gap-0.5 px-4 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ opacity: 0.45, position: 'relative' }}
                aria-label="Insights — complete categorization to unlock"
              >
                <Icon size={20} />
                <span style={{
                  position: 'absolute', top: 2, right: 6,
                  fontSize: 8, fontWeight: 800, letterSpacing: '0.03em',
                  background: 'rgba(255,255,255,0.10)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: 3, padding: '1px 3px',
                  color: 'rgba(255,255,255,0.45)',
                  textTransform: 'uppercase',
                }}>
                  lock
                </span>
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
