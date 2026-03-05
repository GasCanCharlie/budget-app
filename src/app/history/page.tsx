'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useQuery } from '@tanstack/react-query'

// ─── Types ────────────────────────────────────────────────────────────────────

interface MonthSummary {
  year: number
  month: number
  label: string
  totalIncome: number
  totalSpending: number
  net: number
  hasData: boolean
}

interface TrendsResponse {
  months: MonthSummary[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtAmt = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ─── Shared card styles ───────────────────────────────────────────────────────

const glassCard: React.CSSProperties = {
  borderRadius: 24,
  border: '1px solid rgba(255,255,255,.10)',
  background: 'rgba(255,255,255,.045)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 12px 32px rgba(0,0,0,.35)',
  overflow: 'hidden',
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const router = useRouter()
  const user   = useAuthStore(s => s.user)
  const { apiFetch } = useApi()

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user) router.push('/login')
  }, [user, router])

  const { data, isLoading, isError } = useQuery<TrendsResponse>({
    queryKey: ['trends', 36],
    queryFn:  () => apiFetch('/api/summaries/trends?months=36'),
    enabled:  !!user,
  })

  const months = (data?.months ?? [])
    .filter(m => m.hasData)
    .sort((a, b) => b.year !== a.year ? b.year - a.year : b.month - a.month)

  if (!user) return null

  return (
    <AppShell>
      {/* ── Page header ──────────────────────────────────────────────── */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-[#eaf0ff] tracking-tight">History</h1>
        <p className="text-sm text-[#8b97c3] mt-0.5">Past monthly summaries</p>
      </div>

      {/* ── Main card ────────────────────────────────────────────────── */}
      <div style={glassCard}>

        {/* Loading state */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div
              className="h-8 w-8 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'rgba(110,168,255,.4)', borderTopColor: 'transparent' }}
            />
            <p className="text-sm text-[#8b97c3]">Loading history…</p>
          </div>
        )}

        {/* Error state */}
        {isError && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-2">
            <p className="text-sm text-[#ff5b78]">Failed to load history. Please try again.</p>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !isError && months.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div
              className="h-12 w-12 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(255,255,255,.06)' }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-[#8b97c3]">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 3" strokeLinecap="round" />
              </svg>
            </div>
            <p className="text-sm font-medium text-[#c8d4f5]">No history yet</p>
            <p className="text-xs text-[#8b97c3]">Upload a statement to see monthly summaries here.</p>
          </div>
        )}

        {/* Table */}
        {!isLoading && !isError && months.length > 0 && (
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,.07)' }}>
                <th className="text-left px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#8b97c3]">
                  Month
                </th>
                <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#8b97c3]">
                  Income
                </th>
                <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#8b97c3]">
                  Spending
                </th>
                <th className="text-right px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#8b97c3]">
                  Net
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-[#8b97c3] hidden sm:table-cell">
                  &nbsp;
                </th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => {
                const isPositive   = m.net >= 0
                const netColor     = isPositive ? '#2ee59d' : '#ff5b78'
                const barPct       = m.totalIncome > 0
                  ? Math.min(100, (m.totalSpending / m.totalIncome) * 100)
                  : 0
                const isLast       = i === months.length - 1

                return (
                  <tr
                    key={`${m.year}-${m.month}`}
                    onClick={() => router.push(`/dashboard?year=${m.year}&month=${m.month}`)}
                    style={{
                      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.05)',
                      cursor: 'pointer',
                    }}
                    className="group transition-colors hover:bg-white/[0.04] active:bg-white/[0.07]"
                  >
                    {/* Month label */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="font-semibold text-[#eaf0ff]">{m.label}</span>
                    </td>

                    {/* Income */}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-mono text-[#2ee59d]">
                      {fmtAmt(m.totalIncome)}
                    </td>

                    {/* Spending */}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-mono text-[#c8d4f5]">
                      {fmtAmt(m.totalSpending)}
                    </td>

                    {/* Net */}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap font-mono font-semibold" style={{ color: netColor }}>
                      {isPositive ? '+' : '-'}{fmtAmt(m.net)}
                    </td>

                    {/* Bar indicator */}
                    <td className="px-5 py-3.5 hidden sm:table-cell" style={{ minWidth: 120 }}>
                      <div
                        className="relative h-1.5 rounded-full overflow-hidden"
                        style={{ background: 'rgba(255,255,255,.08)' }}
                      >
                        <div
                          className="absolute inset-y-0 left-0 rounded-full transition-all"
                          style={{
                            width: `${barPct}%`,
                            background: barPct >= 100 ? '#ff5b78' : '#6ea8ff',
                          }}
                        />
                      </div>
                      <p className="text-[10px] text-[#8b97c3] mt-0.5 text-right">
                        {barPct.toFixed(0)}% spent
                      </p>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Bottom padding for mobile nav */}
      <div className="h-20 md:hidden" />
    </AppShell>
  )
}
