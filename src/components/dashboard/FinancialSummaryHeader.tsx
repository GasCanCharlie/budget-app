'use client'

import Link from 'next/link'
import { TrendingUp, TrendingDown } from 'lucide-react'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

interface Props {
  month: number
  year: number
  totalIncome: number
  totalSpending: number
  net: number
  transactionCount: number
  prevMonthNet: number | null
  prevMonthSpending: number | null
  largestCategory: { name: string; pct: number } | null
  latestUploadId?: string
}

export function FinancialSummaryHeader({
  month, year, totalIncome, totalSpending, net, transactionCount,
  prevMonthNet, largestCategory, latestUploadId,
}: Props) {
  const monthName = MONTHS[month - 1] ?? ''
  const isPositive = net >= 0
  const spendingRatio = totalIncome > 0 ? Math.round((totalSpending / totalIncome) * 100) : null

  // Month-over-month net % change
  let momPct: number | null = null
  let momLabel = ''
  if (prevMonthNet !== null && prevMonthNet !== 0) {
    momPct = Math.round(((net - prevMonthNet) / Math.abs(prevMonthNet)) * 100)
    const prevMonthIdx = month === 1 ? 11 : month - 2
    momLabel = MONTHS[prevMonthIdx] ?? 'last month'
  }

  // Ratio status — inline style values
  const ratioStyle: React.CSSProperties =
    spendingRatio === null ? { color: 'var(--text-secondary)' }
    : spendingRatio > 95   ? { color: 'var(--danger)' }
    : spendingRatio > 80   ? { color: '#d97706' }
    : { color: 'var(--success)' }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)' }}>
      {/* Header row */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-secondary)' }}>
            {monthName} {year}
          </p>
          <h1 className="text-base font-bold mt-0.5" style={{ color: 'var(--text)' }}>Financial Summary</h1>
        </div>
        {latestUploadId && (
          <Link
            href={`/upload/${latestUploadId}`}
            className="text-xs hover:text-blue-600 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            Statement detail →
          </Link>
        )}
      </div>

      {/* Net cash flow hero */}
      <div className="px-6 py-5">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--text-secondary)' }}>
              Net Cash Flow
            </p>
            <p className="text-5xl font-extrabold tabular-nums tracking-tight leading-none" style={{ color: isPositive ? 'var(--success)' : 'var(--danger)' }}>
              {isPositive ? '+' : ''}{fmt(net)}
            </p>
          </div>

          {momPct !== null && (
            <div className="flex items-center gap-1.5 mb-1 text-sm font-semibold rounded-full px-3 py-1.5" style={
              momPct >= 0
                ? { background: 'rgba(16,185,129,0.1)', color: 'var(--success)', border: '1px solid rgba(16,185,129,0.25)' }
                : { background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.25)' }
            }>
              {momPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {momPct >= 0 ? '+' : ''}{momPct}% vs {momLabel}
            </div>
          )}
        </div>

        {/* 3-stat row */}
        <div className="mt-5 grid grid-cols-3 divide-x rounded-xl overflow-hidden" style={{ border: '1px solid var(--border)', borderColor: 'var(--border)' }}>
          <div className="px-4 py-3" style={{ background: 'var(--surface2, rgba(0,0,0,0.03))' }}>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-secondary)' }}>Income</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--success)' }}>{fmt(totalIncome)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-secondary)' }}>Spending</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--text)' }}>{fmt(totalSpending)}</p>
          </div>
          <div className="px-4 py-3" style={{ background: 'var(--surface2, rgba(0,0,0,0.03))' }}>
            <p className="text-xs uppercase tracking-wide mb-0.5" style={{ color: 'var(--text-secondary)' }}>Ratio</p>
            <p className="text-lg font-bold tabular-nums" style={ratioStyle}>
              {spendingRatio !== null ? `${spendingRatio}%` : '—'}
            </p>
          </div>
        </div>

        {/* Footer context line */}
        {(largestCategory || transactionCount > 0) && (
          <div className="mt-3 flex items-center gap-2 flex-wrap text-xs" style={{ color: 'var(--text-secondary)' }}>
            {largestCategory && (
              <span>
                Largest driver:{' '}
                <strong className="font-semibold" style={{ color: 'var(--text)' }}>{largestCategory.name}</strong>
                {' '}· {largestCategory.pct}% of spending
              </span>
            )}
            {largestCategory && transactionCount > 0 && (
              <span className="select-none" style={{ color: 'var(--border)' }}>·</span>
            )}
            {transactionCount > 0 && (
              <span>
                <strong className="font-semibold" style={{ color: 'var(--text)' }}>
                  {transactionCount.toLocaleString()}
                </strong>{' '}transactions
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
