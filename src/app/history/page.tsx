'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useQuery } from '@tanstack/react-query'
import { Loader2, Clock } from 'lucide-react'

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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const router = useRouter()
  const user   = useAuthStore(s => s.user)
  const { apiFetch } = useApi()

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
      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>History</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Past monthly summaries</p>
        </div>

        {/* Card */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-soft)',
          overflow: 'hidden',
        }}>

          {/* Loading */}
          {isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <Loader2 size={24} className="animate-spin" style={{ color: 'var(--accent)' }} />
              <p className="text-sm" style={{ color: 'var(--muted)' }}>Loading history…</p>
            </div>
          )}

          {/* Error */}
          {isError && !isLoading && (
            <div className="flex flex-col items-center justify-center py-20 gap-2">
              <p className="text-sm font-medium" style={{ color: 'var(--danger)' }}>
                Failed to load history. Please try again.
              </p>
            </div>
          )}

          {/* Empty */}
          {!isLoading && !isError && months.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: 'var(--surface2)' }}>
                <Clock size={22} style={{ color: 'var(--muted)' }} />
              </div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No history yet</p>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Upload a statement to see monthly summaries here.
              </p>
            </div>
          )}

          {/* Table */}
          {!isLoading && !isError && months.length > 0 && (
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Month', 'Income', 'Spending', 'Net', ''].map((label, i) => (
                    <th
                      key={i}
                      className={`px-5 py-3 text-xs font-semibold uppercase tracking-wider ${i === 0 ? 'text-left' : i === 4 ? 'hidden sm:table-cell' : 'text-right'}`}
                      style={{ color: 'var(--muted)' }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => {
                  const isPositive = m.net >= 0
                  const barPct     = m.totalIncome > 0
                    ? Math.min(100, (m.totalSpending / m.totalIncome) * 100)
                    : 0
                  const isLast = i === months.length - 1

                  return (
                    <tr
                      key={`${m.year}-${m.month}`}
                      onClick={() => router.push(`/dashboard?year=${m.year}&month=${m.month}`)}
                      style={{
                        borderBottom: isLast ? 'none' : '1px solid var(--border)',
                        cursor: 'pointer',
                      }}
                      className="group transition-colors"
                      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Month */}
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
                          {m.label}
                        </span>
                      </td>

                      {/* Income */}
                      <td className="px-5 py-3.5 text-right whitespace-nowrap tabular-nums font-semibold" style={{ color: 'var(--success)' }}>
                        {fmtAmt(m.totalIncome)}
                      </td>

                      {/* Spending */}
                      <td className="px-5 py-3.5 text-right whitespace-nowrap tabular-nums" style={{ color: 'var(--text2)' }}>
                        {fmtAmt(m.totalSpending)}
                      </td>

                      {/* Net */}
                      <td className="px-5 py-3.5 text-right whitespace-nowrap tabular-nums font-semibold" style={{ color: isPositive ? 'var(--success)' : 'var(--danger)' }}>
                        {isPositive ? '+' : '-'}{fmtAmt(m.net)}
                      </td>

                      {/* Spend bar */}
                      <td className="px-5 py-3.5 hidden sm:table-cell" style={{ minWidth: 120 }}>
                        <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--track)' }}>
                          <div
                            className="absolute inset-y-0 left-0 rounded-full transition-all"
                            style={{
                              width: `${barPct}%`,
                              background: barPct >= 100 ? 'var(--danger)' : 'var(--accent)',
                            }}
                          />
                        </div>
                        <p className="text-[10px] mt-0.5 text-right" style={{ color: 'var(--muted)' }}>
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

        {/* Mobile nav padding */}
        <div className="h-20 md:hidden" />
      </main>
    </AppShell>
  )
}
