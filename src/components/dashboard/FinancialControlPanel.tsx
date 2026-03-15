'use client'

import type React from 'react'

interface CategoryItem {
  categoryName: string
  total: number
  pctOfSpending: number
}

interface TrendMonth {
  year: number
  month: number
  net: number | null
  hasData: boolean
}

interface TopTx {
  description: string
  merchantNormalized: string
  amount: number
}

interface Props {
  totalIncome: number
  totalSpending: number
  net: number
  categories: CategoryItem[]
  trendMonths: TrendMonth[]
  topTransactions: TopTx[]
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// Count consecutive positive/negative months from the most recent data point
function computeCashFlowStreak(
  trendMonths: TrendMonth[],
): { streak: number; direction: 'positive' | 'negative' } {
  const withData = trendMonths.filter(m => m.hasData && m.net !== null)
  if (withData.length === 0) return { streak: 0, direction: 'positive' }

  const latest = withData[withData.length - 1]
  const direction: 'positive' | 'negative' = (latest.net ?? 0) >= 0 ? 'positive' : 'negative'

  let streak = 0
  for (let i = withData.length - 1; i >= 0; i--) {
    const n = withData[i].net ?? 0
    if ((direction === 'positive' && n >= 0) || (direction === 'negative' && n < 0)) {
      streak++
    } else {
      break
    }
  }

  return { streak, direction }
}

function SpendingGauge({ ratio }: { ratio: number }) {
  const clamped = Math.min(ratio, 120)
  const barPct = Math.min((clamped / 120) * 100, 100)
  const color = ratio > 95 ? 'var(--danger)' : ratio > 80 ? 'var(--warn)' : 'var(--success)'
  const statusLabel = ratio > 95 ? 'Critical' : ratio > 85 ? 'Elevated' : ratio > 70 ? 'Moderate' : 'Healthy'
  const statusColor = ratio > 95 ? 'var(--danger)' : ratio > 85 ? 'var(--warn)' : 'var(--success)'

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-3xl font-extrabold tabular-nums" style={{ color: 'var(--text)' }}>{ratio}%</span>
        <span className="text-xs font-semibold" style={{ color: statusColor }}>{statusLabel}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--track)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${barPct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

export function FinancialControlPanel({
  totalIncome, totalSpending, net, categories, trendMonths, topTransactions,
}: Props) {
  const spendingRatio = totalIncome > 0 ? Math.round((totalSpending / totalIncome) * 100) : null

  // Top 3 concentration
  const top3Sum = categories.slice(0, 3).reduce((s, c) => s + c.total, 0)
  const top3Pct = totalSpending > 0 ? Math.round((top3Sum / totalSpending) * 100) : null
  const top3Names = categories.slice(0, 3).map(c => c.categoryName)

  // Cash flow streak
  const { streak, direction } = computeCashFlowStreak(trendMonths)

  // Largest transaction
  const largest = topTransactions[0] ?? null

  const metricCard: React.CSSProperties = {
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 16,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
      padding: 20,
    }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Spending Intelligence</h2>
      </div>

      {/* 4-metric grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {/* 1. Spending Ratio */}
        <div style={metricCard}>
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Spending Ratio</p>
          {spendingRatio !== null ? (
            <SpendingGauge ratio={spendingRatio} />
          ) : (
            <p className="text-3xl font-bold" style={{ color: 'var(--text-secondary)' }}>—</p>
          )}
          <p className="text-xs mt-auto" style={{ color: 'var(--text-secondary)' }}>of monthly income</p>
        </div>

        {/* 2. Cash Flow Stability */}
        <div style={metricCard}>
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Cash Flow</p>
          <div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className="text-3xl font-extrabold tabular-nums"
                style={{ color: direction === 'positive' ? 'var(--success)' : 'var(--danger)' }}>
                {streak}
              </span>
              <span className="text-lg font-light" style={{ color: 'var(--text-secondary)' }}>mo</span>
            </div>
            <p className="text-xs font-semibold"
              style={{ color: direction === 'positive' ? 'var(--success)' : 'var(--danger)' }}>
              {direction === 'positive' ? '↑ Positive streak' : '↓ Deficit streak'}
            </p>
          </div>
          <p className="text-xs mt-auto" style={{ color: 'var(--text-secondary)' }}>consecutive months</p>
        </div>

        {/* 3. Top 3 Concentration */}
        <div style={metricCard}>
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Category Focus</p>
          {top3Pct !== null ? (
            <div>
              <p className="text-3xl font-extrabold tabular-nums mb-1" style={{ color: 'var(--text)' }}>{top3Pct}%</p>
              <div className="space-y-0.5">
                {top3Names.map(name => (
                  <p key={name} className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{name}</p>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-3xl font-bold" style={{ color: 'var(--text-secondary)' }}>—</p>
          )}
          <p className="text-xs mt-auto" style={{ color: 'var(--text-secondary)' }}>top 3 categories</p>
        </div>

        {/* 4. Largest Transaction */}
        <div style={metricCard}>
          <p className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Largest Expense</p>
          {largest ? (
            <div>
              <p className="text-3xl font-extrabold tabular-nums mb-1" style={{ color: 'var(--text)' }}>
                {fmt(Math.abs(largest.amount))}
              </p>
              <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                {largest.merchantNormalized || largest.description}
              </p>
            </div>
          ) : (
            <p className="text-3xl font-bold" style={{ color: 'var(--text-secondary)' }}>—</p>
          )}
          <p className="text-xs mt-auto" style={{ color: 'var(--text-secondary)' }}>single transaction</p>
        </div>

      </div>

      {/* Net position footer */}
      <div className="mt-4 pt-4 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Net Position</span>
        <span className="text-base font-bold tabular-nums"
          style={{ color: net >= 0 ? 'var(--success)' : 'var(--danger)' }}>
          {net >= 0 ? '+' : ''}{fmt(net)}
        </span>
      </div>
    </div>
  )
}
