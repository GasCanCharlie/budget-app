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

  // Ratio status
  const ratioColor =
    spendingRatio === null ? 'text-slate-500'
    : spendingRatio > 95   ? 'text-red-600'
    : spendingRatio > 80   ? 'text-amber-600'
    : 'text-emerald-700'

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-slate-100">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">
            {monthName} {year}
          </p>
          <h1 className="text-base font-bold text-slate-900 mt-0.5">Financial Summary</h1>
        </div>
        {latestUploadId && (
          <Link
            href={`/upload/${latestUploadId}`}
            className="text-xs text-slate-400 hover:text-blue-600 transition-colors"
          >
            Statement detail →
          </Link>
        )}
      </div>

      {/* Net cash flow hero */}
      <div className="px-6 py-5">
        <div className="flex items-end gap-4 flex-wrap">
          <div>
            <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">
              Net Cash Flow
            </p>
            <p className={`text-5xl font-extrabold tabular-nums tracking-tight leading-none ${
              isPositive ? 'text-emerald-600' : 'text-red-500'
            }`}>
              {isPositive ? '+' : ''}{fmt(net)}
            </p>
          </div>

          {momPct !== null && (
            <div className={`flex items-center gap-1.5 mb-1 text-sm font-semibold rounded-full px-3 py-1.5 ${
              momPct >= 0
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-red-50 text-red-600 border border-red-200'
            }`}>
              {momPct >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
              {momPct >= 0 ? '+' : ''}{momPct}% vs {momLabel}
            </div>
          )}
        </div>

        {/* 3-stat row */}
        <div className="mt-5 grid grid-cols-3 divide-x divide-slate-100 border border-slate-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 bg-slate-50/60">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Income</p>
            <p className="text-lg font-bold text-emerald-700 tabular-nums">{fmt(totalIncome)}</p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Spending</p>
            <p className="text-lg font-bold text-slate-800 tabular-nums">{fmt(totalSpending)}</p>
          </div>
          <div className="px-4 py-3 bg-slate-50/60">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Ratio</p>
            <p className={`text-lg font-bold tabular-nums ${ratioColor}`}>
              {spendingRatio !== null ? `${spendingRatio}%` : '—'}
            </p>
          </div>
        </div>

        {/* Footer context line */}
        {(largestCategory || transactionCount > 0) && (
          <div className="mt-3 flex items-center gap-2 flex-wrap text-xs text-slate-400">
            {largestCategory && (
              <span>
                Largest driver:{' '}
                <strong className="text-slate-600 font-semibold">{largestCategory.name}</strong>
                {' '}· {largestCategory.pct}% of spending
              </span>
            )}
            {largestCategory && transactionCount > 0 && (
              <span className="text-slate-200 select-none">·</span>
            )}
            {transactionCount > 0 && (
              <span>
                <strong className="text-slate-600 font-semibold">
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
