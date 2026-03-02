'use client'

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
  const color = ratio > 95 ? '#ef4444' : ratio > 80 ? '#f59e0b' : '#10b981'
  const statusLabel = ratio > 95 ? 'Critical' : ratio > 85 ? 'Elevated' : ratio > 70 ? 'Moderate' : 'Healthy'
  const statusColor = ratio > 95 ? 'text-red-400' : ratio > 85 ? 'text-amber-400' : ratio > 70 ? 'text-amber-300' : 'text-emerald-400'

  return (
    <div>
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="text-3xl font-extrabold text-white tabular-nums">{ratio}%</span>
        <span className={`text-xs font-semibold ${statusColor}`}>{statusLabel}</span>
      </div>
      <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
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

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border border-slate-700 rounded-2xl shadow-xl p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-white/80">Financial Control</h2>
        <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30 tracking-wide">
          PRO
        </span>
      </div>

      {/* 4-metric grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {/* 1. Spending Ratio */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Spending Ratio</p>
          {spendingRatio !== null ? (
            <SpendingGauge ratio={spendingRatio} />
          ) : (
            <p className="text-3xl font-bold text-white/20">—</p>
          )}
          <p className="text-xs text-white/30 mt-auto">of monthly income</p>
        </div>

        {/* 2. Cash Flow Stability */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Cash Flow</p>
          <div>
            <div className="flex items-baseline gap-1.5 mb-1">
              <span className={`text-3xl font-extrabold tabular-nums ${
                direction === 'positive' ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {streak}
              </span>
              <span className="text-lg text-white/40 font-light">mo</span>
            </div>
            <p className={`text-xs font-semibold ${
              direction === 'positive' ? 'text-emerald-400' : 'text-red-400'
            }`}>
              {direction === 'positive' ? '↑ Positive streak' : '↓ Deficit streak'}
            </p>
          </div>
          <p className="text-xs text-white/30 mt-auto">consecutive months</p>
        </div>

        {/* 3. Top 3 Concentration */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Concentration</p>
          {top3Pct !== null ? (
            <div>
              <p className="text-3xl font-extrabold text-white tabular-nums mb-1">{top3Pct}%</p>
              <div className="space-y-0.5">
                {top3Names.map(name => (
                  <p key={name} className="text-xs text-white/40 truncate">{name}</p>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-3xl font-bold text-white/20">—</p>
          )}
          <p className="text-xs text-white/30 mt-auto">top 3 categories</p>
        </div>

        {/* 4. Largest Transaction */}
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3">
          <p className="text-xs font-medium text-white/40 uppercase tracking-wider">Largest Expense</p>
          {largest ? (
            <div>
              <p className="text-3xl font-extrabold text-white tabular-nums mb-1">
                {fmt(Math.abs(largest.amount))}
              </p>
              <p className="text-xs text-white/50 truncate">
                {largest.merchantNormalized || largest.description}
              </p>
            </div>
          ) : (
            <p className="text-3xl font-bold text-white/20">—</p>
          )}
          <p className="text-xs text-white/30 mt-auto">single transaction</p>
        </div>

      </div>

      {/* Net position footer */}
      <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
        <span className="text-xs text-white/30 uppercase tracking-wide">Net Position</span>
        <span className={`text-base font-bold tabular-nums ${net >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {net >= 0 ? '+' : ''}{fmt(net)}
        </span>
      </div>
    </div>
  )
}
