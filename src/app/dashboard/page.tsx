'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AlertTriangle, Info, X } from 'lucide-react'
import { DashboardKPIs } from '@/components/dashboard/DashboardKPIs'
import { TopTransactions } from '@/components/dashboard/TopTransactions'
import { CategoryBreakdown } from '@/components/dashboard/CategoryBreakdown'
import { StatementStatus } from '@/components/dashboard/StatementStatus'

// Recharts uses ResizeObserver / window — must be client-only to avoid SSR crash
const SpendingCharts = dynamic(
  () => import('@/components/dashboard/SpendingCharts').then(m => m.SpendingCharts),
  { ssr: false }
)
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

  useEffect(() => {
    if (!user) router.replace('/')
  }, [user, router])

  const { data, isLoading, isError } = useQuery({
    queryKey: ['summary', year, month],
    queryFn:  () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled:  !!user,
  })

  const { data: trendsData } = useQuery({
    queryKey: ['trends'],
    queryFn:  () => apiFetch('/api/summaries/trends?months=36'),
    enabled:  !!user,
  })

  const { data: uploadsData } = useQuery({
    queryKey: ['uploads'],
    queryFn:  () => apiFetch('/api/uploads'),
    enabled:  !!user,
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
          <p className="text-slate-500 text-sm">Upload a bank statement to see your financial intelligence dashboard.</p>
        </div>
        <Link href="/upload" className="btn-primary inline-flex">
          Upload statement
        </Link>
      </div>
    </AppShell>
  )

  // ── Derived values ─────────────────────────────────────────────────────────
  const alertCount         = (summary.alerts?.length ?? 0) as number
  const allCategories      = summary.categoryTotals as {
    categoryId: string; categoryName: string; categoryColor: string;
    categoryIcon: string; total: number; transactionCount: number;
    pctOfSpending: number; isIncome: boolean;
  }[]
  const spendingCategories = allCategories.filter(c => !c.isIncome)
  const incomeTxCount      = allCategories
    .filter(c => c.isIncome)
    .reduce((s, c) => s + c.transactionCount, 0)

  const topTransactions = (summary.topTransactions ?? []) as {
    id: string; date: string; description: string; merchantNormalized: string;
    amount: number; categoryName: string; categoryColor: string; categoryIcon: string;
  }[]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="space-y-5 pb-24">

        {/* ── Partial month banner ──────────────────────────────────────── */}
        {summary.isPartialMonth && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <Info size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>Partial month</strong> — totals reflect only the imported date range, not the full month.
            </p>
          </div>
        )}

        {/* ── Statement health ──────────────────────────────────────────── */}
        <StatementStatus
          latestUpload={latestUpload}
          alertCount={alertCount}
          txCount={summary.transactionCount as number}
        />

        {/* ── KPI cards ─────────────────────────────────────────────────── */}
        <DashboardKPIs
          totalIncome={summary.totalIncome as number}
          totalSpending={summary.totalSpending as number}
          net={summary.net as number}
          transactionCount={summary.transactionCount as number}
          incomeTxCount={incomeTxCount}
          rolling={rolling}
        />

        {/* ── Anomaly alerts ────────────────────────────────────────────── */}
        {summary.alerts && summary.alerts.length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-600" />
                <span className="text-sm font-semibold text-slate-700">Anomaly Alerts</span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                  {summary.alerts.length}
                </span>
              </div>
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

        {/* ── Spending charts ───────────────────────────────────────────── */}
        <SpendingCharts
          categories={spendingCategories}
          totalSpending={summary.totalSpending as number}
        />

        {/* ── 12-month trend ────────────────────────────────────────────── */}
        <TrendChart months={trendMonths} />

        {/* ── Category breakdown + Top transactions ─────────────────────── */}
        <div className="grid md:grid-cols-2 gap-5">
          <CategoryBreakdown
            categories={spendingCategories}
            totalSpending={summary.totalSpending as number}
            month={month}
            year={year}
          />
          <TopTransactions transactions={topTransactions} />
        </div>

      </div>
    </AppShell>
  )
}
