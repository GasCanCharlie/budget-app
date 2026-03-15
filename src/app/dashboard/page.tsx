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
import { UpcomingChargesPanel } from '@/components/dashboard/UpcomingChargesPanel'
import { HealthScoreCard } from '@/components/dashboard/HealthScoreCard'
import { OnboardingWelcome } from '@/components/dashboard/OnboardingWelcome'
import { FinancialAutopsyPanel } from '@/components/dashboard/FinancialAutopsyPanel'
import { MonthlyStorylineCard } from '@/components/dashboard/MonthlyStorylineCard'
import type { InsightCard } from '@/lib/insights/types'

// Recharts uses ResizeObserver / window — must be client-only to avoid SSR crash
const SpendingCharts = dynamic(
  () => import('@/components/dashboard/SpendingCharts').then(m => m.SpendingCharts),
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

  const { data: subsData } = useQuery<{ subscriptions: { id: string; merchantNormalized: string; estimatedMonthlyAmount: number; recurringConfidence: string; subscriptionScore: number; estimatedNextCharge: string | null; consecutiveMonths: number; serviceCategory: string | null }[] }>({
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

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets'],
    queryFn:  () => apiFetch('/api/budgets'),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  })

  const { data: insightsData } = useQuery<{ cards: InsightCard[]; isStale: boolean }>({
    queryKey: ['insights', year, month],
    queryFn:  () => apiFetch(`/api/insights?year=${year}&month=${month}`),
    enabled:  !!user && !!year && !!month,
    staleTime: 5 * 60_000,
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
          <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#6C7CFF', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: '#9CA3AF' }}>Loading dashboard…</p>
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

  // ── No uploads yet — show onboarding ──────────────────────────────────────
  if (data.availableMonths.length === 0) return (
    <AppShell year={year} month={month} availableMonths={[]} onMonthChange={handleMonthChange}>
      <OnboardingWelcome
        uploadsDone={data.availableMonths.length > 0 || data.dashboardState === 'categorization_required'}
        uncategorizedCount={data.uncategorizedCount ?? 0}
      />
    </AppShell>
  )

  // ── Categorization Required (Strict Mode Gate) ─────────────────────────────
  if (data.dashboardState === 'categorization_required') {
    return (
      <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
        {(isRefetching || trendsRefetching) && (
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs mb-4" style={{ background: 'rgba(108,124,255,0.08)', borderColor: 'rgba(108,124,255,0.2)', color: '#939AFF' }}>
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
    background: 'var(--card, #111827)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: 16,
    boxShadow: '0 4px 6px rgba(0,0,0,0.12), 0 12px 28px rgba(0,0,0,0.32)',
    transition: 'border-color 180ms ease, box-shadow 180ms ease, transform 180ms ease',
  }

  return (
    <AppShell year={year} month={month} availableMonths={availableMonths} onMonthChange={handleMonthChange}>
      <div className="space-y-6 pb-24">

        {/* Background-refetch indicator */}
        {!!(isRefetching || trendsRefetching) && (
          <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs" style={{ background: 'rgba(108,124,255,0.08)', borderColor: 'rgba(108,124,255,0.2)', color: '#939AFF' }}>
            <Loader2 size={12} className="animate-spin flex-shrink-0" />
            Refreshing dashboard…
          </div>
        )}

        {/* ── Monthly Storyline Hero ────────────────────────────────────────── */}
        <MonthlyStorylineCard
          cards={insightsData?.cards ?? []}
          loading={!insightsData && !!user}
        />

        {/* Partial month banner */}
        {!!summary.isPartialMonth && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <Info size={15} className="mt-0.5 flex-shrink-0" style={{ color: '#F59E0B' }} />
            <p className="text-sm" style={{ color: '#FCD34D' }}>
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
          <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card, #111827)', border: '1px solid var(--border, #1F2937)' }}>
            <div className="flex items-center gap-2 px-5 py-3" style={{ borderBottom: '1px solid var(--border, #1F2937)' }}>
              <AlertTriangle size={14} style={{ color: '#F59E0B' }} />
              <span className="text-sm font-semibold" style={{ color: '#E5E7EB' }}>Anomaly Alerts</span>
              <span className="px-1.5 py-0.5 rounded-full text-xs font-semibold" style={{ background: 'rgba(245,158,11,0.15)', color: '#F59E0B' }}>
                {(summary.alerts as unknown[]).length}
              </span>
            </div>
            <div>
              {(summary.alerts as { id?: string; type: string; message: string }[]).map((alert, i) => (
                <div key={alert.id ?? i} className="flex items-start gap-3 px-5 py-3" style={{ borderBottom: '1px solid var(--border, #1F2937)' }}>
                  <AlertTriangle size={13} className="mt-0.5 flex-shrink-0" style={{ color: '#F59E0B' }} />
                  <p className="text-sm flex-1" style={{ color: '#D1D5DB' }}>{alert.message}</p>
                  {alert.id && (
                    <button
                      onClick={() => dismissAlert.mutate(alert.id!)}
                      disabled={dismissAlert.isPending}
                      className="transition flex-shrink-0"
                      style={{ color: '#6B7280' }}
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
              budgets={budgetsData?.budgets ?? []}
            />
          </div>

          {/* RIGHT: Change / Insight Panel — lg:col-span-5 */}
          <div className="lg:col-span-5">
            <div style={cardStyle} className="p-5 space-y-5 h-full bl-card-interactive">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <h2 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #E5E7EB)', letterSpacing: '-0.01em', margin: 0 }}>
                  Monthly Snapshot
                </h2>
              </div>

              {/* vs Last Month */}
              <div style={{ borderRadius: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 12 }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7280', marginBottom: 8 }}>
                  vs Last Month
                </p>
                {prevMonthSpending !== null ? (
                  <p style={{ fontSize: 13, color: '#D1D5DB', margin: 0, lineHeight: 1.5 }}>
                    Spending changed by{' '}
                    <strong style={{ color: summary.totalSpending > prevMonthSpending ? '#EF4444' : '#22C55E', fontSize: 15 }}>
                      {summary.totalSpending > prevMonthSpending ? '+' : ''}
                      {Math.round(((summary.totalSpending - prevMonthSpending) / prevMonthSpending) * 100)}%
                    </strong>
                    {' '}from last month.
                  </p>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: '#6B7280' }}>
                    <UploadCloud size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                    <p style={{ fontSize: 12, margin: 0, lineHeight: 1.5 }}>Upload previous statement to compare months</p>
                  </div>
                )}
              </div>

              {/* Largest Transaction */}
              <div style={{ borderRadius: 12, padding: '14px 16px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#6B7280', marginBottom: 8 }}>
                  Largest Transaction
                </p>
                {topTransactions.length > 0 ? (
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 600, color: '#9CA3AF', margin: 0, marginBottom: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {topTransactions[0].merchantNormalized || topTransactions[0].description}
                    </p>
                    <p style={{ fontSize: 22, fontWeight: 800, color: '#EF4444', margin: 0, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
                      ${Math.abs(topTransactions[0].amount).toFixed(2)}
                    </p>
                  </div>
                ) : (
                  <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>No transactions yet</p>
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

        {/* ── Spending breakdown: bar + donut ───────────────────────────────── */}
        <SpendingCharts categories={spendingCategories} totalSpending={summary.totalSpending as number} />

        {/* ── Financial Autopsy section label ───────────────────────────────── */}
        <div style={{ paddingTop: 4 }}>
          <p className="bl-section-label">Financial Autopsy</p>
        </div>

        {/* ── Financial Autopsy ─────────────────────────────────────────────── */}
        <FinancialAutopsyPanel
          cards={insightsData?.cards ?? []}
          year={year}
          month={month}
          onGenerated={() => queryClient.invalidateQueries({ queryKey: ['insights', year, month] })}
        />

        {/* ── Row 3: Full-width tabbed panel ────────────────────────────────── */}
        <div style={cardStyle} className="overflow-hidden bl-card-interactive">
          {/* Tab header */}
          <div className="flex items-center gap-0 px-5 pt-4 pb-0" style={{ borderBottom: '1px solid var(--border, #1F2937)' }}>
            {(['transactions', 'insights'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-4 py-2.5 text-sm font-semibold -mb-px transition-all"
                style={activeTab === tab
                  ? { borderBottom: '2px solid #6366F1', color: '#a5b4fc', marginBottom: -1 }
                  : { borderBottom: '2px solid transparent', color: '#6B7280', marginBottom: -1 }
                }
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

        {/* ── Subscription Intelligence section ─────────────────────────────── */}
        <div style={{ paddingTop: 4 }}>
          <p className="bl-section-label">Subscription Intelligence</p>
        </div>
        <UpcomingChargesPanel subscriptions={subsData?.subscriptions ?? []} />
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
