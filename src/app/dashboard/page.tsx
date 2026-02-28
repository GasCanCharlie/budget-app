'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { format } from 'date-fns'
import { TrendingDown, AlertTriangle, Info, ArrowUpRight, X } from 'lucide-react'
import Link from 'next/link'

function fmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}
function fmtFull(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n))
}

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function DashboardPage() {
  const router = useRouter()
  const user   = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const queryClient = useQueryClient()

  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)

  useEffect(() => {
    if (!user) router.replace('/')
  }, [user, router])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['summary', year, month],
    queryFn: () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled: !!user,
  })

  const { data: trendsData } = useQuery({
    queryKey: ['trends'],
    queryFn: () => apiFetch('/api/summaries/trends'),
    enabled: !!user,
  })

  const dismissAlert = useMutation({
    mutationFn: (alertId: string) =>
      apiFetch(`/api/anomaly-alerts/${alertId}`, {
        method: 'PATCH',
        body: JSON.stringify({ dismissed: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['summary', year, month] }),
  })

  const summary        = data?.summary
  const availableMonths = data?.availableMonths ?? []
  const rolling        = data?.rolling
  const trendMonths: {
    year: number; month: number; label: string;
    totalIncome: number | null; totalSpending: number | null; net: number | null; hasData: boolean
  }[] = trendsData?.months ?? []

  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y); setMonth(m)
  }, [])

  if (!user) return null

  if (isLoading) return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-accent-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 text-sm">Loading your dashboard…</p>
        </div>
      </div>
    </AppShell>
  )

  if (isError || !summary) return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <div className="text-5xl mb-4">📭</div>
        <h2 className="text-xl font-bold text-slate-800 mb-2">No data yet</h2>
        <p className="text-slate-500 mb-6">Upload a bank statement to see your spending breakdown.</p>
        <Link href="/upload" className="btn-primary">Upload Statement</Link>
      </div>
    </AppShell>
  )

  const spendingCategories = summary.categoryTotals.filter((c: { isIncome: boolean }) => !c.isIncome)
  const topCategories      = spendingCategories.slice(0, 8)

  // Bar chart: top spending categories
  const barData = topCategories.map((c: { categoryName: string; total: number }) => ({
    name: c.categoryName.replace(' & ', ' '),
    amount: Math.round(c.total),
  }))

  // Donut chart
  const donutData = topCategories.slice(0, 6).map((c: { categoryName: string; total: number; categoryColor: string }) => ({
    name: c.categoryName,
    value: Math.round(c.total),
    color: c.categoryColor,
  }))

  const netPositive = summary.net >= 0

  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <main className="max-w-6xl mx-auto px-4 py-6 space-y-6 pb-24">

        {/* Partial month warning */}
        {summary.isPartialMonth && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
            <Info size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <strong>Partial month data</strong> — showing{' '}
              {summary.dateRangeStart && format(new Date(summary.dateRangeStart), 'MMM d')} –{' '}
              {summary.dateRangeEnd && format(new Date(summary.dateRangeEnd), 'MMM d, yyyy')}{' '}
              ({Math.round(
                (new Date(summary.dateRangeEnd).getTime() - new Date(summary.dateRangeStart).getTime())
                / (1000 * 60 * 60 * 24)
              ) + 1} days).
              Totals below reflect only imported transactions.
            </div>
          </div>
        )}

        {/* Anomaly alerts */}
        {summary.alerts && summary.alerts.length > 0 && (
          <div className="space-y-2">
            {summary.alerts.map((alert: { id?: string; type: string; message: string }, i: number) => (
              <div key={alert.id ?? i} className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-start gap-3">
                <AlertTriangle size={16} className="text-amber-600 mt-0.5 flex-shrink-0" />
                <p className="text-sm text-amber-800 flex-1">{alert.message}</p>
                {alert.id && (
                  <button
                    onClick={() => dismissAlert.mutate(alert.id!)}
                    disabled={dismissAlert.isPending}
                    className="text-amber-500 hover:text-amber-700 transition flex-shrink-0 ml-1"
                    title="Dismiss alert"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard
            label="Total Income"
            value={fmt(summary.totalIncome)}
            sub={`${(summary.categoryTotals.filter((c: { isIncome: boolean }) => c.isIncome).reduce((s: number, c: { transactionCount: number }) => s + c.transactionCount, 0))} transactions`}
            color="green"
            icon="💰"
          />
          <KpiCard
            label="Total Spending"
            value={fmt(summary.totalSpending)}
            sub={`${summary.transactionCount} transactions`}
            color="red"
            icon="💸"
          />
          <KpiCard
            label="Net Balance"
            value={fmt(Math.abs(summary.net))}
            sub={netPositive ? 'Surplus' : 'Deficit'}
            color={netPositive ? 'blue' : 'red'}
            icon={netPositive ? '📈' : '📉'}
          />
          <KpiCard
            label="Top Category"
            value={spendingCategories[0]?.categoryName ?? '—'}
            sub={spendingCategories[0] ? fmt(spendingCategories[0].total) : ''}
            color="purple"
            icon={spendingCategories[0]?.categoryIcon ?? '🔥'}
          />
        </div>

        {/* Rolling average context */}
        {rolling && (rolling.spending > 0 || rolling.income > 0) && (
          <div className="card p-4">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-3">3-Month Rolling Average</p>
            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <TrendingDown size={16} className="text-red-500" />
                <span className="text-sm font-semibold text-slate-700">Avg spending: <span className="text-red-600">{fmt(rolling.spending)}</span></span>
                {summary.totalSpending > 0 && rolling.spending > 0 && (
                  <span className={`badge text-xs ${summary.totalSpending > rolling.spending ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                    {summary.totalSpending > rolling.spending
                      ? `↑${Math.round((summary.totalSpending / rolling.spending - 1) * 100)}%`
                      : `↓${Math.round((1 - summary.totalSpending / rolling.spending) * 100)}%`}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Charts */}
        <div className="grid md:grid-cols-3 gap-4">
          {/* Bar chart */}
          <div className="card md:col-span-2">
            <h3 className="font-bold text-slate-800 mb-4">Spending by Category</h3>
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 20 }}>
                  <XAxis type="number" tickFormatter={v => `$${v}`} tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={90} />
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, 'Spent']} />
                  <Bar dataKey="amount" fill="#6366f1" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40 text-slate-400 text-sm">No spending data</div>
            )}
          </div>

          {/* Donut chart */}
          <div className="card">
            <h3 className="font-bold text-slate-800 mb-4">Breakdown</h3>
            {donutData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={2}>
                    {donutData.map((entry: { name: string; color: string }, idx: number) => (
                      <Cell key={idx} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString()}`, '']} />
                  <Legend
                    formatter={(value) => <span style={{ fontSize: 11 }}>{value}</span>}
                    iconSize={8}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-40 text-slate-400 text-sm">No data</div>
            )}
          </div>
        </div>

        {/* 12-month trends chart */}
        {trendMonths.some(m => m.hasData) && (
          <div className="card">
            <h3 className="font-bold text-slate-800 mb-4">12-Month Trends</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendMonths} margin={{ left: 0, right: 8, top: 4, bottom: 0 }} barGap={2} barCategoryGap="20%">
                <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 10 }} width={42} />
                <Tooltip
                  formatter={(v: number, name: string) => [
                    `$${v.toLocaleString()}`,
                    name === 'totalIncome' ? 'Income' : 'Spending',
                  ]}
                  labelStyle={{ fontSize: 12, fontWeight: 600 }}
                />
                <Bar dataKey="totalIncome"   name="Income"   fill="#22c55e" radius={[3, 3, 0, 0]} />
                <Bar dataKey="totalSpending" name="Spending" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Category list */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800">Category Breakdown</h3>
            <span className="text-xs text-slate-400">{MONTH_NAMES[month - 1]} {year}</span>
          </div>
          <div className="space-y-2">
            {spendingCategories.slice(0, 10).map((cat: {
              categoryId: string; categoryIcon: string; categoryName: string;
              transactionCount: number; total: number; pctOfSpending: number;
            }) => (
              <CategoryRow key={cat.categoryId} cat={cat} totalSpending={summary.totalSpending} />
            ))}
          </div>
        </div>

        {/* Top 5 transactions */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-slate-800">🏆 Top 5 Biggest Expenses</h3>
            <Link href="/transactions" className="text-xs text-accent-500 font-semibold flex items-center gap-1 hover:underline">
              View all <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="space-y-2">
            {summary.topTransactions.map((tx: {
              id: string; merchantNormalized: string; description: string;
              date: string; amount: number; categoryName: string;
              categoryColor: string; categoryIcon: string;
            }, i: number) => (
              <div key={tx.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl hover:bg-slate-100 transition">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-black ${
                  i === 0 ? 'bg-yellow-100 text-yellow-700' :
                  i === 1 ? 'bg-slate-100 text-slate-600' :
                  i === 2 ? 'bg-orange-100 text-orange-600' :
                  'bg-accent-50 text-accent-600'
                }`}>{i + 1}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-800 truncate">
                    {tx.merchantNormalized || tx.description}
                  </p>
                  <p className="text-xs text-slate-400">{format(new Date(tx.date), 'MMM d')} · {tx.categoryIcon} {tx.categoryName}</p>
                </div>
                <span className="text-sm font-bold text-red-600">{fmtFull(tx.amount)}</span>
              </div>
            ))}
            {summary.topTransactions.length === 0 && (
              <p className="text-slate-400 text-sm text-center py-4">No expense transactions yet</p>
            )}
          </div>
        </div>

      </main>
    </AppShell>
  )
}

function KpiCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub: string; color: string; icon: string
}) {
  const colorMap: Record<string, string> = {
    green:  'border-green-400',
    red:    'border-red-400',
    blue:   'border-blue-400',
    purple: 'border-purple-400',
  }
  const valColor: Record<string, string> = {
    green:  'text-green-600',
    red:    'text-red-600',
    blue:   'text-blue-600',
    purple: 'text-purple-600',
  }
  return (
    <div className={`card p-4 border-l-4 ${colorMap[color]}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
          <p className={`text-xl font-black mt-1 ${valColor[color]}`}>{value}</p>
          <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  )
}

function CategoryRow({ cat, totalSpending }: {
  cat: { categoryId: string; categoryIcon: string; categoryName: string; transactionCount: number; total: number; pctOfSpending: number };
  totalSpending: number;
}) {
  const pct = totalSpending > 0 ? (cat.total / totalSpending) * 100 : 0
  return (
    <Link href={`/transactions?category=${cat.categoryId}`} className="flex items-center gap-3 group">
      <span className="text-base w-6 text-center">{cat.categoryIcon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex justify-between text-sm mb-1">
          <span className="font-medium text-slate-700 group-hover:text-accent-600 transition truncate">{cat.categoryName}</span>
          <span className="font-bold text-slate-800 ml-2 flex-shrink-0">${cat.total.toFixed(0)}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full rounded-full bg-accent-500 transition-all" style={{ width: `${Math.min(pct, 100)}%` }} />
          </div>
          <span className="text-xs text-slate-400 w-8 text-right">{pct.toFixed(0)}%</span>
        </div>
      </div>
    </Link>
  )
}
