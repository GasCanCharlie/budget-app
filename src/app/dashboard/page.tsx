'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import Link from 'next/link'
import {
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  TrendingUp,
  ArrowUpRight,
  Info,
} from 'lucide-react'
import React from 'react'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// ─── Inline panel components ──────────────────────────────────────────────────

function Panel({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm">
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function MetricCard({ label, value, hint, positive }: { label: string; value: string; hint?: string; positive?: boolean }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={['mt-1 text-2xl font-semibold tabular-nums', positive === true ? 'text-green-700' : positive === false ? 'text-red-600' : 'text-slate-900'].join(' ')}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router = useRouter()
  const user   = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const queryClient = useQueryClient()

  const now = new Date()
  const [year,      setYear]      = useState(now.getFullYear())
  const [month,     setMonth]     = useState(now.getMonth() + 1)
  const [auditMode, setAuditMode] = useState(false)

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
    queryFn: () => apiFetch('/api/summaries/trends?months=36'),
    enabled: !!user,
  })

  const { data: uploadsData } = useQuery({
    queryKey: ['uploads'],
    queryFn: () => apiFetch('/api/uploads'),
    enabled: !!user,
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
        body: JSON.stringify({ dismissed: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['summary', year, month] }),
  })

  const summary         = data?.summary
  const availableMonths = data?.availableMonths ?? []
  const rolling         = data?.rolling
  const trendMonths: {
    year: number; month: number; label: string;
    totalIncome: number | null; totalSpending: number | null; net: number | null; hasData: boolean
  }[] = trendsData?.months ?? []

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
      <div className="space-y-5">
        <Panel title="No statement data">
          <div className="py-8 flex flex-col items-center gap-4 text-center">
            <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
              <TrendingUp size={22} className="text-slate-400" />
            </div>
            <div>
              <p className="text-slate-700 font-semibold mb-1">No transactions for this period</p>
              <p className="text-slate-500 text-sm max-w-xs">
                Upload a bank statement to see your financial intelligence dashboard.
              </p>
            </div>
            <Link
              href="/upload"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 transition"
            >
              Upload statement <ArrowUpRight size={14} />
            </Link>
          </div>
        </Panel>
      </div>
    </AppShell>
  )

  // ── Derived values ─────────────────────────────────────────────────────────
  const alertCount         = (summary.alerts?.length ?? 0) as number
  const spendingCategories = (summary.categoryTotals as {
    categoryId: string;
    categoryName: string;
    categoryColor: string;
    categoryIcon: string;
    total: number;
    transactionCount: number;
    pctOfSpending: number;
    isIncome: boolean;
    sourceMix?: { source: string; pct: number }[];
  }[]).filter(c => !c.isIncome)

  const totalSpending = summary.totalSpending as number
  const totalIncome   = summary.totalIncome as number
  const net           = summary.net as number
  const netPositive   = net >= 0

  // Statement status derived metrics
  const txCount    = summary.transactionCount as number
  const totalCats  = summary.categoryTotals as { total: number }[]
  const coveredAmt = totalCats.reduce((s, c) => s + c.total, 0)
  const coveragePct = totalSpending > 0
    ? Math.round((coveredAmt / (totalSpending + totalIncome)) * 100)
    : 0

  // Confidence badge
  const confidenceBadge = (() => {
    if (alertCount === 0 && latestUpload?.reconciliationStatus === 'PASS') {
      return { label: 'High confidence', icon: ShieldCheck, cls: 'text-green-700 bg-green-50 border-green-200' }
    }
    if (alertCount <= 2) {
      return { label: 'Good confidence', icon: CheckCircle2, cls: 'text-blue-700 bg-blue-50 border-blue-200' }
    }
    return { label: 'Review recommended', icon: AlertTriangle, cls: 'text-amber-700 bg-amber-50 border-amber-200' }
  })()

  const hasSourceMix = spendingCategories.some(c => c.sourceMix && c.sourceMix.length > 0)

  // Suppress unused-variable warning for variables kept for data-fetching parity
  void auditMode
  void setAuditMode
  void rolling
  void trendMonths

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="space-y-5 pb-24">

        {/* ── Page title + confidence badge ──────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">
              {MONTH_NAMES[month - 1]} {year}
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">Financial summary</p>
          </div>
          <span className={[
            'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-semibold',
            confidenceBadge.cls,
          ].join(' ')}>
            <confidenceBadge.icon size={12} />
            {confidenceBadge.label}
          </span>
        </div>

        {/* ── Partial month info banner ───────────────────────────────────── */}
        {summary.isPartialMonth && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
            <Info size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>Partial month</strong> — data covers only the imported date range. Totals may not reflect the full month.
            </p>
          </div>
        )}

        {/* ── Statement Status panel ─────────────────────────────────────── */}
        <Panel
          title="Statement Status"
          right={
            latestUpload ? (
              <Link
                href={`/upload/${latestUpload.id}`}
                className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-0.5"
              >
                View detail <ArrowUpRight size={11} />
              </Link>
            ) : undefined
          }
        >
          <dl className="grid grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-4 text-sm">
            <div>
              <dt className="text-xs text-slate-500 font-medium mb-0.5">Transactions</dt>
              <dd className="font-semibold text-slate-800 tabular-nums">{txCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 font-medium mb-0.5">Coverage</dt>
              <dd className="font-semibold text-slate-800 tabular-nums">{coveragePct}%</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 font-medium mb-0.5">Duplicates removed</dt>
              <dd className="font-semibold text-slate-800 tabular-nums">
                {latestUpload ? (latestUpload.rowCountAccepted > 0 ? '—' : '0') : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 font-medium mb-0.5">Ingestion issues</dt>
              <dd className={[
                'font-semibold tabular-nums',
                latestUpload && latestUpload.totalRowsUnresolved > 0 ? 'text-orange-600' : 'text-slate-800',
              ].join(' ')}>
                {latestUpload ? latestUpload.totalRowsUnresolved : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 font-medium mb-0.5">Anomalies</dt>
              <dd className={[
                'font-semibold tabular-nums',
                alertCount > 0 ? 'text-amber-600' : 'text-slate-800',
              ].join(' ')}>
                {alertCount}
              </dd>
            </div>
          </dl>
        </Panel>

        {/* ── KPI cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <MetricCard
            label="Income"
            value={fmt(totalIncome)}
            hint={`${summary.categoryTotals.filter((c: { isIncome: boolean }) => c.isIncome).reduce((s: number, c: { transactionCount: number }) => s + c.transactionCount, 0)} income transactions`}
            positive={true}
          />
          <MetricCard
            label="Spending"
            value={fmt(totalSpending)}
            hint={`${txCount} transactions`}
            positive={false}
          />
          <MetricCard
            label="Net Position"
            value={fmt(Math.abs(net))}
            hint={netPositive ? 'Surplus this month' : 'Deficit this month'}
            positive={netPositive ? true : false}
          />
        </div>

        {/* ── Category breakdown table ───────────────────────────────────── */}
        <Panel title="Category Breakdown">
          {spendingCategories.length === 0 ? (
            <p className="text-slate-400 text-sm text-center py-4">No spending categories this month</p>
          ) : (
            <div className="overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-semibold text-slate-500 pb-2 pr-4">Category</th>
                    <th className="text-right text-xs font-semibold text-slate-500 pb-2 pr-4">Amount</th>
                    <th className="text-right text-xs font-semibold text-slate-500 pb-2 pr-4">%</th>
                    {hasSourceMix && (
                      <th className="text-left text-xs font-semibold text-slate-500 pb-2">Source mix</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {spendingCategories.map(cat => {
                    const pct = totalSpending > 0
                      ? ((cat.total / totalSpending) * 100)
                      : 0
                    return (
                      <tr key={cat.categoryId} className="hover:bg-slate-50 transition">
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center gap-2">
                            <span className="text-base leading-none">{cat.categoryIcon}</span>
                            <div>
                              <div className="font-medium text-slate-800">{cat.categoryName}</div>
                              <div className="text-xs text-slate-400">{cat.transactionCount} txn{cat.transactionCount !== 1 ? 's' : ''}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 pr-4 text-right font-semibold tabular-nums text-slate-800">
                          {fmt(cat.total)}
                        </td>
                        <td className="py-2.5 pr-4">
                          <div className="flex items-center justify-end gap-2">
                            <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full bg-blue-500"
                                style={{ width: `${Math.min(pct, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500 tabular-nums w-8 text-right">
                              {pct.toFixed(0)}%
                            </span>
                          </div>
                        </td>
                        {hasSourceMix && (
                          <td className="py-2.5 text-xs text-slate-500">
                            {cat.sourceMix && cat.sourceMix.length > 0
                              ? cat.sourceMix.map(s => `${s.source} ${s.pct}%`).join(' · ')
                              : '—'}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {/* ── Anomalies panel ───────────────────────────────────────────── */}
        {summary.alerts && summary.alerts.length > 0 && (
          <Panel
            title="Anomalies"
            right={
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">
                {summary.alerts.length}
              </span>
            }
          >
            <div className="space-y-2">
              {(summary.alerts as { id?: string; type: string; message: string }[]).map((alert, i) => (
                <div
                  key={alert.id ?? i}
                  className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-100 rounded-md"
                >
                  <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-amber-900 flex-1">{alert.message}</p>
                  {alert.id && (
                    <button
                      onClick={() => dismissAlert.mutate(alert.id!)}
                      disabled={dismissAlert.isPending}
                      className="text-xs text-slate-400 hover:text-slate-600 font-medium flex-shrink-0 transition"
                      title="Dismiss"
                    >
                      Dismiss
                    </button>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        )}

      </div>
    </AppShell>
  )
}
