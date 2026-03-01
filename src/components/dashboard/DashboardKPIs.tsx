'use client'

interface Props {
  totalIncome: number
  totalSpending: number
  net: number
  transactionCount: number
  incomeTxCount: number
  rolling: { spending: number; income: number } | null
}

const formatCurrency = (n: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

function RollingBadge({
  current,
  average,
}: {
  current: number
  average: number
}) {
  if (average === 0) return null

  const pct = Math.round(((current - average) / average) * 100)
  const isUp = pct >= 0
  const label = isUp ? `↑${pct}% vs avg` : `↓${Math.abs(pct)}% vs avg`

  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        isUp
          ? 'bg-red-100 text-red-700'
          : 'bg-green-100 text-green-700'
      }`}
    >
      {label}
    </span>
  )
}

export function DashboardKPIs({
  totalIncome,
  totalSpending,
  net,
  transactionCount,
  incomeTxCount,
  rolling,
}: Props) {
  const spendingTxCount = transactionCount - incomeTxCount
  const isPositiveNet = net >= 0
  const showRolling =
    rolling !== null && rolling.spending > 0 && totalSpending > 0

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      {/* Income */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <p className="text-sm font-medium text-slate-500">Income</p>
        <p className="mt-1 text-3xl font-bold tabular-nums text-green-700">
          {formatCurrency(totalIncome)}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {incomeTxCount} {incomeTxCount === 1 ? 'transaction' : 'transactions'}
        </p>
      </div>

      {/* Spending */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <p className="text-sm font-medium text-slate-500">Spending</p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <p className="text-3xl font-bold tabular-nums text-red-600">
            {formatCurrency(totalSpending)}
          </p>
          {showRolling && (
            <RollingBadge
              current={totalSpending}
              average={rolling!.spending}
            />
          )}
        </div>
        <p className="mt-1 text-xs text-slate-400">
          {spendingTxCount} {spendingTxCount === 1 ? 'transaction' : 'transactions'}
        </p>
      </div>

      {/* Net Position */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
        <p className="text-sm font-medium text-slate-500">Net Position</p>
        <p
          className={`mt-1 text-3xl font-bold tabular-nums ${
            isPositiveNet ? 'text-green-700' : 'text-red-600'
          }`}
        >
          {formatCurrency(net)}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          {isPositiveNet ? 'Surplus' : 'Deficit'}
        </p>
      </div>
    </div>
  )
}
