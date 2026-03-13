'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { AlertTriangle, Info, X, Loader2, UploadCloud } from 'lucide-react'
import { FinancialSummaryHeader } from '@/components/dashboard/FinancialSummaryHeader'
import { AskAiDrawer } from '@/components/dashboard/AskAiDrawer'
import { CategoryRanking } from '@/components/dashboard/CategoryRanking'
import { FinancialControlPanel } from '@/components/dashboard/FinancialControlPanel'
import { TopTransactions } from '@/components/dashboard/TopTransactions'
import { CategorizationGate } from '@/components/dashboard/CategorizationGate'
import { InsightPanel } from '@/components/dashboard/InsightPanel'
import { SubscriptionPanel } from '@/components/dashboard/SubscriptionPanel'
import { HealthScoreCard } from '@/components/dashboard/HealthScoreCard'
import { OnboardingWelcome } from '@/components/dashboard/OnboardingWelcome'

// Recharts uses ResizeObserver / window — must be client-only to avoid SSR crash
const TrendChart = dynamic(
  () => import('@/components/dashboard/TrendChart').then(m => m.TrendChart),
  { ssr: false }
)

// ─── Types ─────────────────────────────────────────────────────────────────────

type DashboardState = 'categorization_required' | 'analysis_unlocked'

interface CategoryTotal {
  categoryId: string; categoryName: string; categoryColor: string;
  categoryIcon: string; total: number; transactionCount: number;
  pctOfSpending: number; isIncome: boolean;
}

interface TopTx {
  id: string; date: string; description: string; merchantNormalized: string;
  amount: number; categoryName: string; categoryColor: string; categoryIcon: string;
}

interface UnlockedSummary {
  totalIncome:      number
  totalSpending:    number
  net:              number
  transactionCount: number
  incomeTxCount:    number
  isPartialMonth:   boolean
  dateRangeStart:   string | null
  dateRangeEnd:     string | null
  categoryTotals:   CategoryTotal[]
  topTransactions:  TopTx[]
  alerts:           { id?: string; type: string; message: string }[]
}

interface SummaryResponse {
  dashboardState:     DashboardState
  uncategorizedCount: number
  totalCount:         number
  categorizedCount?:  number
  dateRangeStart?:    string | null
  dateRangeEnd?:      string | null
  accountNames?:      string[]
  availableMonths:    { year: number; month: number }[]
  rolling:            { spending: number; income: number } | null
  summary:            UnlockedSummary | null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const router      = useRouter()
  const user        = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const queryClient = useQueryClient()

  const now = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [askAiOpen, setAskAiOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'transactions' | 'insights'>('transactions')
  const autoNavigated = useRef(false)
  const lastSeenUploadId = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (!user) router.replace('/login')
  }, [user, router])

  const { data, isLoading, isError, isRefetching } = useQuery<SummaryResponse>({
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

  // Previous month summary for per-category MoM deltas in CategoryRanking
  const prevYearCalc  = month === 1 ? year - 1 : year
  const prevMonthCalc = month === 1 ? 12 : month - 1
  const { data: prevSummaryData } = useQuery<SummaryResponse>({
    queryKey: ['summary', prevYearCalc, prevMonthCalc],
    queryFn:  () => apiFetch(`/api/summaries/${prevYearCalc}/${prevMonthCalc}`),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  })

  const { data: subsData } = useQuery<{ subscriptions: { estimatedMonthlyAmount: number; recurringConfidence: string; subscriptionScore: number }[] }>({
    queryKey: ['subscriptions'],
    queryFn:  () => apiFetch('/api/subscriptions'),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  })

  const { data: uploadsData } = useQuery({
    queryKey: ['uploads'],
    queryFn:  () => apiFetch('/api/uploads'),
    enabled:  !!user,
    refetchOnMount: 'always',
    staleTime: 0,
  })

  const latestUpload = uploadsData?.uploads?.[0] as {
    id: string; filename: string; account: { name: string }
    rowCountAccepted: number; createdAt: string
    reconciliationStatus: string; totalRowsUnresolved: number; status: string
  } | undefined

  const dismissAlert = useMutation({
    mutationFn: (alertId: string) =>
      apiFetch(`/api/anomaly-alerts/${alertId}`, {
        method: 'PATCH',
        body:   JSON.stringify({ dismissed: true }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['summary', year, month] }),
  })

  const availableMonths = data?.availableMonths ?? []
  const trendMonths     = trendsData?.months ?? []

  // Auto-jump to the most recent month with data on first load and whenever
  // availableMonths changes (e.g. after a new upload adds a new month).
  useEffect(() => {
    if (isLoading || availableMonths.length === 0) return

    const latestUploadId = uploadsData?.uploads?.[0]?.id as string | undefined
    const newUploadDetected = latestUploadId !== undefined && latestUploadId !== lastSeenUploadId.current
    if (latestUploadId !== undefined) {
      lastSeenUploadId.current = latestUploadId
    }

    const latest = availableMonths[0]
    if (!latest) return

    const selectedIsInList = availableMonths.some(m => m.year === year && m.month === month)
    const latestIsNewer =
      latest.year > year || (latest.year === year && latest.month > month)

    if (!autoNavigated.current || newUploadDetected || !selectedIsInList || latestIsNewer) {
      if (latest.year !== year || latest.month !== month) {
        setYear(latest.year)
        setMonth(latest.month)
      }
      autoNavigated.current = true
    }
  }, [availableMonths, isLoading, uploadsData, year, month])

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
  if (isError || !data) return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <OnboardingWelcome />
    </AppShell>
  )

  // ── Categorization Required (Strict Mode Gate) ─────────────────────────────
  if (data.dashboardState === 'categorization_required') {
    return (
      <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
        {(isRefetching || trendsRefetching) && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-600 mb-4">
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            Refreshing…
          </div>
        )}
        <CategorizationGate
          uncategorizedCount={data.uncategorizedCount}
          totalCount={data.totalCount}
          categorizedCount={data.categorizedCount ?? (data.totalCount - data.uncategorizedCount)}
          dateRangeStart={data.dateRangeStart ?? null}
          dateRangeEnd={data.dateRangeEnd ?? null}
          accountNames={data.accountNames ?? []}
        />
      </AppShell>
    )
  }

  // ── Analysis Unlocked ──────────────────────────────────────────────────────
  const summary = data.summary!

  // Strict: spending charts ONLY include expense categories (isIncome === false)
  const spendingCategories = summary.categoryTotals.filter(c => !c.isIncome)
  const topTransactions    = summary.topTransactions ?? []
  const prevSpendingCategories = (prevSummaryData?.summary?.categoryTotals ?? []).filter(c => !c.isIncome)

  // Previous month data for MoM change
  const prevMonthYear  = month === 1 ? year - 1 : year
  const prevMonthMonth = month === 1 ? 12 : month - 1
  const prevMonthData  = (trendMonths as { year: number; month: number; totalSpending: number | null; net: number | null; hasData: boolean }[])
    .find(m => m.year === prevMonthYear && m.month === prevMonthMonth)
  const prevMonthNet      = prevMonthData?.net      ?? null
  const prevMonthSpending = prevMonthData?.totalSpending ?? null

  const monthlySubscriptions = (subsData?.subscriptions ?? [])
    .filter(s => s.recurringConfidence !== 'low' && s.subscriptionScore >= 40)
    .reduce((sum, s) => sum + s.estimatedMonthlyAmount, 0)

  const largestCategory = spendingCategories.length > 0
    ? { name: spendingCategories[0].categoryName, pct: Math.round(spendingCategories[0].pctOfSpending) }
    : null

  const cardStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
  }

  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="space-y-5 pb-24">

        {/* Background-refetch indicator */}
        {!!(isRefetching || trendsRefetching) && (
          <div className="flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-600">
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            Refreshing dashboard…
          </div>
        )}

        {/* Partial month banner */}
        {!!summary.isPartialMonth && (
          <div className="flex items-start gap-2.5 px-4 py-3 bg-amber-50 border border-amber-200 rounded-xl">
            <Info size={15} className="text-amber-600 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-800">
              <strong>Partial month</strong> — totals reflect only the imported date range, not the full month.
            </p>
          </div>
        )}

        {/* ── Row 1: Financial Hero (full width) ───────────────────────────── */}
        <div style={cardStyle}>
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
        </div>

        {/* ── Anomaly alerts ────────────────────────────────────────────────── */}
        {summary.alerts && (summary.alerts as unknown[]).length > 0 && (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-slate-100">
              <AlertTriangle size={14} className="text-amber-600" />
              <span className="text-sm font-semibold text-slate-700">Anomaly Alerts</span>
              <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold">
                {(summary.alerts as unknown[]).length}
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

        {/* ── Financial Health Score ────────────────────────────────────────── */}
        <HealthScoreCard
          totalIncome={summary.totalIncome as number}
          totalSpending={summary.totalSpending as number}
          net={summary.net as number}
          trendMonths={(trendMonths as { net: number | null; hasData: boolean }[])}
          categories={spendingCategories}
          monthlySubscriptions={monthlySubscriptions}
        />

        {/* ── Row 2: 2-column split ─────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

          {/* LEFT: Category Ranking — lg:col-span-7 */}
          <div className="lg:col-span-7">
            <CategoryRanking
              categories={spendingCategories}
              totalSpending={summary.totalSpending as number}
              year={year}
              month={month}
              prevCategories={prevSpendingCategories}
            />
          </div>

          {/* RIGHT: Change / Insight Panel — lg:col-span-5 */}
          <div className="lg:col-span-5">
            <div style={cardStyle} className="p-5 space-y-5 h-full">
              <h2 className="text-sm font-semibold text-slate-800">Monthly Snapshot</h2>

              {/* vs Last Month */}
              <div className="rounded-xl border border-slate-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  vs Last Month
                </p>
                {prevMonthSpending !== null ? (
                  <p className="text-sm text-slate-600">
                    Spending changed by{' '}
                    <strong className={
                      summary.totalSpending > prevMonthSpending ? 'text-red-600' : 'text-emerald-600'
                    }>
                      {summary.totalSpending > prevMonthSpending ? '+' : ''}
                      {Math.round(((summary.totalSpending - prevMonthSpending) / prevMonthSpending) * 100)}%
                    </strong>
                    {' '}from last month.
                  </p>
                ) : (
                  <div className="flex items-start gap-2.5 text-slate-400">
                    <UploadCloud size={15} className="mt-0.5 flex-shrink-0" />
                    <p className="text-sm">Upload previous statement to compare months</p>
                  </div>
                )}
              </div>

              {/* Unusual Purchases placeholder — anomaly alerts already shown above */}
              <div className="rounded-xl border border-slate-100 p-4">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Largest Transaction
                </p>
                {topTransactions.length > 0 ? (
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                      {topTransactions[0].merchantNormalized || topTransactions[0].description}
                    </p>
                    <p className="text-lg font-bold text-red-500 mt-0.5">
                      ${Math.abs(topTransactions[0].amount).toFixed(2)}
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-400">No transactions yet</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Financial Control Panel ───────────────────────────────────────── */}
        <FinancialControlPanel
          totalIncome={summary.totalIncome as number}
          totalSpending={summary.totalSpending as number}
          net={summary.net as number}
          categories={spendingCategories}
          trendMonths={trendMonths}
          topTransactions={topTransactions}
        />

        {/* ── 12-month cash flow trend ──────────────────────────────────────── */}
        <TrendChart months={trendMonths} />

        {/* ── Row 3: Full-width tabbed panel ────────────────────────────────── */}
        <div style={cardStyle} className="overflow-hidden">
          {/* Tab header */}
          <div className="flex items-center gap-1 px-5 pt-4 pb-0 border-b border-slate-100">
            {(['transactions', 'insights'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${
                  activeTab === tab
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab === 'transactions' ? 'Top Transactions' : 'Insights'}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="p-5">
            {activeTab === 'transactions' ? (
              <TopTransactions transactions={topTransactions} />
            ) : (
              <InsightPanel
                categories={spendingCategories}
                topTransactions={topTransactions}
                totalIncome={summary.totalIncome as number}
                totalSpending={summary.totalSpending as number}
                prevMonthSpending={prevMonthSpending}
              />
            )}
          </div>
        </div>

        {/* ── Subscription Panel ────────────────────────────────────────────── */}
        <SubscriptionPanel userId={user?.id} />

      </div>

      {/* ── Ask AI Drawer ─────────────────────────────────────────────────────── */}
      <AskAiDrawer
        isOpen={askAiOpen}
        onClose={() => setAskAiOpen(false)}
        context={{
          year,
          month,
          totalIncome: summary.totalIncome as number,
          totalSpending: summary.totalSpending as number,
          net: summary.net as number,
          categoryTotals: spendingCategories.map(c => ({
            name: c.categoryName,
            total: c.total,
            pctOfSpending: c.pctOfSpending,
          })),
          topMerchants: topTransactions.map(tx => ({
            merchantNormalized: tx.merchantNormalized || tx.description,
            totalAmount: Math.abs(tx.amount),
            transactionCount: 1,
          })),
          momSpendingPctChange: prevMonthSpending !== null && prevMonthSpending > 0
            ? Math.round(((summary.totalSpending - prevMonthSpending) / prevMonthSpending) * 100)
            : null,
        }}
      />
    </AppShell>
  )
}
