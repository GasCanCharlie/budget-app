'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AlertTriangle, Info, X, Loader2 } from 'lucide-react'
import { FinancialSummaryHeader } from '@/components/dashboard/FinancialSummaryHeader'
import { InsightPanel } from '@/components/dashboard/InsightPanel'
import { CategoryRanking } from '@/components/dashboard/CategoryRanking'
import { FinancialControlPanel } from '@/components/dashboard/FinancialControlPanel'
import { TopTransactions } from '@/components/dashboard/TopTransactions'

// Recharts uses ResizeObserver / window — must be client-only to avoid SSR crash
const TrendChart = dynamic(
  () => import('@/components/dashboard/TrendChart').then(m => m.TrendChart),
  { ssr: false }
)

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router      = useRouter()
  const user        = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const queryClient = useQueryClient()

  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const autoNavigated = useRef(false)

  useEffect(() => {
    if (!user) router.replace('/')
  }, [user, router])

  const { data, isLoading, isError, isRefetching } = useQuery({
    queryKey: ['summary', year, month],
    queryFn:  () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled:  !!user,
    refetchOnMount: 'always',
  })

  const { data: trendsData, isRefetching: trendsRefetching } = useQuery({
    queryKey: ['trends'],
    queryFn:  () => apiFetch('/api/summaries/trends?months=36'),
    enabled:  !!user,
    refetchOnMount: 'always',
  })

  const { data: uploadsData } = useQuery({
    queryKey: ['uploads'],
    queryFn:  () => apiFetch('/api/uploads'),
    enabled:  !!user,
  })

  const { data: uncatData } = useQuery<{ uncategorizedCount: number }>({
    queryKey: ['uncategorized-count'],
    queryFn:  () => apiFetch('/api/transactions?limit=1'),
    enabled:  !!user,
    staleTime: 30_000,
  })

  const latestUpload = uploadsData?.uploads?.[0] as {
    id: string
    filename: string
    account: { name: string }
    rowCountAccepted: number
    createdAt: string
    reconciliationStatus: string
    totalRowsUnresolved: number
    status: string
  } | undefined

  const dismissAlert = useMutation({
    mutationFn: (alertId: string) =>
      apiFetch(`/api/anomaly-alerts/${alertId}`, {
        method: 'PATCH',
        body:   JSON.stringify({ dismissed: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['summary', year, month] }),
  })

  const summary         = data?.summary
  const availableMonths = data?.availableMonths ?? []
  const rolling         = data?.rolling ?? null
  const trendMonths     = trendsData?.months ?? []

  // Auto-jump to the most recent month with data on first load
  useEffect(() => {
    if (autoNavigated.current || isLoading || !data) return
    if ((summary?.transactionCount ?? 0) === 0 && availableMonths.length > 0) {
      const latest = availableMonths[0]
      if (latest && (latest.year !== year || latest.month !== month)) {
        autoNavigated.current = true
        setYear(latest.year)
        setMonth(latest.month)
      }
    } else if ((summary?.transactionCount ?? 0) > 0) {
      autoNavigated.current = true
    }
  }, [data, isLoading, summary, availableMonths, year, month])

  const handleMonthChange = useCallback((y: number, m: number) => {
    setYear(y); setMonth(m)
  }, [])

  if (!user) return null

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-slate-500 text-sm">Loading dashboard…</p>
        </div>
      </div>
    </AppShell>
  )

  // ── Empty / error state ────────────────────────────────────────────────────
  if (isError || !summary) return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="max-w-md mx-auto py-20 text-center space-y-4">
        <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto">
          <span className="text-3xl">📭</span>
        </div>
        <div>
          <h2 className="text-lg font-bold text-slate-900 mb-1">No data yet</h2>
          <p className="text-slate-500 text-sm">Upload a bank statement to see your financial dashboard.</p>
        </div>
        <Link href="/upload" className="btn-primary inline-flex">
          Upload statement
        </Link>
      </div>
    </AppShell>
  )

  // ── Derived values ─────────────────────────────────────────────────────────
  const allCategories      = summary.categoryTotals as {
    categoryId: string; categoryName: string; categoryColor: string;
    categoryIcon: string; total: number; transactionCount: number;
    pctOfSpending: number; isIncome: boolean;
  }[]
  const spendingCategories = allCategories.filter(c => !c.isIncome)

  const topTransactions = (summary.topTransactions ?? []) as {
    id: string; date: string; description: string; merchantNormalized: string;
    amount: number; categoryName: string; categoryColor: string; categoryIcon: string;
  }[]

  // Previous month data for MoM change (from trend history)
  const prevMonthYear  = month === 1 ? year - 1 : year
  const prevMonthMonth = month === 1 ? 12 : month - 1
  const prevMonthData  = (trendMonths as { year: number; month: number; totalSpending: number | null; net: number | null; hasData: boolean }[])
    .find(m => m.year === prevMonthYear && m.month === prevMonthMonth)
  const prevMonthNet      = prevMonthData?.net      ?? null
  const prevMonthSpending = prevMonthData?.totalSpending ?? null

  // Largest spending category
  const largestCategory = spendingCategories.length > 0
    ? { name: spendingCategories[0].categoryName, pct: Math.round(spendingCategories[0].pctOfSpending) }
    : null

  // Suppress unused variable warning for rolling (still available if needed later)
  void rolling

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="space-y-5 pb-24">

        {/* Background-refetch indicator */}
        {(isRefetching || trendsRefetching) && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-600">
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            Refreshing dashboard…
          </div>
        )}

        {/* Partial month banner */}
        {summary.isPartialMonth && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <Info size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>Partial month</strong> — totals reflect only the imported date range, not the full month.
            </p>
          </div>
        )}

        {/* ── Uncategorized transactions banner ────────────────────────────── */}
        {(uncatData?.uncategorizedCount ?? 0) > 0 && (
          <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 text-xs font-bold">
              {uncatData!.uncategorizedCount > 99 ? '99+' : uncatData!.uncategorizedCount}
            </span>
            <p className="flex-1 text-sm text-amber-800">
              <strong>{uncatData!.uncategorizedCount}</strong> transaction{uncatData!.uncategorizedCount !== 1 ? 's' : ''} still need a category — charts reflect only categorized data.
            </p>
            <Link
              href="/categorize"
              className="flex-shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 transition"
            >
              Categorize Now →
            </Link>
          </div>
        )}

        {/* ── Section 1: Financial Summary Header ──────────────────────────── */}
        <FinancialSummaryHeader
          month={month}
          year={year}
          totalIncome={summary.totalIncome as number}
          totalSpending={summary.totalSpending as number}
          net={summary.net as number}
          transactionCount={summary.transactionCount as number}
          prevMonthNet={prevMonthNet}
          prevMonthSpending={prevMonthSpending}
          largestCategory={largestCategory}
          latestUploadId={latestUpload?.id}
        />

        {/* ── Anomaly alerts ────────────────────────────────────────────────── */}
        {summary.alerts && summary.alerts.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
              <AlertTriangle size={14} className="text-amber-600" />
              <span className="text-sm font-semibold text-slate-700">Anomaly Alerts</span>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                {summary.alerts.length}
              </span>
            </div>
            <div className="divide-y divide-slate-50">
              {(summary.alerts as { id?: string; type: string; message: string }[]).map((alert, i) => (
                <div key={alert.id ?? i} className="flex items-start gap-3 px-5 py-3">
                  <AlertTriangle size={13} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-900 flex-1">{alert.message}</p>
                  {alert.id && (
                    <button
                      onClick={() => dismissAlert.mutate(alert.id!)}
                      disabled={dismissAlert.isPending}
                      className="text-slate-400 hover:text-slate-600 transition flex-shrink-0"
                      title="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Section 2: Intelligent Insights ──────────────────────────────── */}
        <InsightPanel
          categories={spendingCategories}
          topTransactions={topTransactions}
          totalIncome={summary.totalIncome as number}
          totalSpending={summary.totalSpending as number}
          prevMonthSpending={prevMonthSpending}
        />

        {/* ── Section 3: Category Ranking ───────────────────────────────────── */}
        <CategoryRanking
          categories={spendingCategories}
          totalSpending={summary.totalSpending as number}
        />

        {/* ── Section 4: Financial Control Panel ───────────────────────────── */}
        <FinancialControlPanel
          totalIncome={summary.totalIncome as number}
          totalSpending={summary.totalSpending as number}
          net={summary.net as number}
          categories={spendingCategories}
          trendMonths={trendMonths}
          topTransactions={topTransactions}
        />

        {/* ── Section 5: 12-month cash flow trend ──────────────────────────── */}
        <TrendChart months={trendMonths} />

        {/* ── Section 6: Top expenses ───────────────────────────────────────── */}
        <TopTransactions transactions={topTransactions} />

      </div>
    </AppShell>
  )
}
