'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { PersonalityCard } from '@/components/dashboard/FinancialAutopsyPanel'
import { FinancialSummaryHeader } from '@/components/dashboard/FinancialSummaryHeader'
import { CategoryRanking } from '@/components/dashboard/CategoryRanking'
import { TopTransactions } from '@/components/dashboard/TopTransactions'
import { computeSignals } from '@/lib/personality/signals'
import { detectPersonality } from '@/lib/personality/detect'
import type { PersonalityResults } from '@/lib/personality/types'
import {
  Archive, Plus, Loader2, CheckCircle2, CreditCard, Building2, HelpCircle,
  AlertCircle, RefreshCw,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { ArchiveConfirmModal } from '@/components/session/ArchiveConfirmModal'
import { useInvalidateSnapshot } from '@/hooks/useSessionSnapshot'

const SpendingCharts = dynamic(
  () => import('@/components/dashboard/SpendingCharts').then(m => m.SpendingCharts),
  { ssr: false }
)

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionAccount {
  id: string; name: string; accountType: string; institution: string;
  uploadCount: number; txCount: number;
  dateStart: string | null; dateEnd: string | null;
}

interface CategoryTotal {
  categoryId: string; categoryName: string; categoryColor: string;
  categoryIcon: string; masterKey: string | null; total: number;
  transactionCount: number; pctOfSpending: number; isIncome: boolean;
}

interface TopTx {
  id: string; date: string; description: string; merchantNormalized: string;
  amount: number; categoryName: string; categoryColor: string; categoryIcon: string;
  accountName: string;
}

interface SessionSummary {
  sessionId: string; title: string; status: string;
  totalIncome: number; totalSpending: number; net: number;
  transactionCount: number; incomeTxCount: number;
  dateRangeStart: string | null; dateRangeEnd: string | null;
  accountCount: number; accounts: SessionAccount[];
  categoryTotals: CategoryTotal[]; topTransactions: TopTx[];
  statementType: 'bank' | 'credit' | 'mixed' | 'unknown';
  interestDetected: boolean;
  secondCatName: string; secondCatPct: number;
  uncategorizedCount: number;
}

interface ActiveSession {
  id: string; title: string; status: string;
  dateRangeStart: string | null; dateRangeEnd: string | null;
  accountCount: number; txCount: number; createdAt: string;
}

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function AccountTypeIcon({ type }: { type: string }) {
  const t = type.toLowerCase()
  const Icon = t.includes('credit') ? CreditCard : t.includes('checking') || t.includes('savings') ? Building2 : HelpCircle
  return <Icon size={14} style={{ color: '#9CA3AF' }} />
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SessionPage() {
  const router      = useRouter()
  const user        = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc          = useQueryClient()
  const invalidateSnapshot = useInvalidateSnapshot()
  const [showArchive, setShowArchive] = useState(false)

  useEffect(() => { if (!user) router.replace('/login') }, [user, router])

  const { data: sessionData, isLoading: sessionLoading } = useQuery<{ session: ActiveSession | null }>({
    queryKey: ['session-active'],
    queryFn:  () => apiFetch('/api/sessions/active'),
    enabled:  !!user,
    refetchOnMount: 'always',
    staleTime: 0,
  })

  const sessionId = sessionData?.session?.id

  const { data: summaryData, isLoading: summaryLoading, refetch: refetchSummary } = useQuery<{ summary: SessionSummary }>({
    queryKey: ['session-summary', sessionId],
    queryFn:  () => apiFetch(`/api/sessions/${sessionId}/summary`),
    enabled:  !!sessionId,
    staleTime: 0,
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify({ action: 'archive' }),
    }),
    onSuccess: () => {
      invalidateSnapshot()
      qc.invalidateQueries({ queryKey: ['session-active'] })
      qc.invalidateQueries({ queryKey: ['session-list'] })
      setShowArchive(false)
      router.push('/history')
    },
  })

  const archiveAndNewMutation = useMutation({
    mutationFn: () => apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify({ forceNew: true }) }),
    onSuccess: () => {
      invalidateSnapshot()
      qc.invalidateQueries({ queryKey: ['session-active'] })
      qc.invalidateQueries({ queryKey: ['session-list'] })
      qc.invalidateQueries({ queryKey: ['session-summary'] })
      setShowArchive(false)
      router.push('/upload')
    },
  })

  if (!user) return null

  const isLoading = sessionLoading || (!!sessionId && summaryLoading)

  if (isLoading) return (
    <AppShell>
      <div className="flex items-center justify-center h-64">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: '#6C7CFF', borderTopColor: 'transparent' }} />
          <p className="text-sm" style={{ color: '#9CA3AF' }}>Loading analysis…</p>
        </div>
      </div>
    </AppShell>
  )

  if (!sessionData?.session) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center h-80 gap-6 text-center">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: 'rgba(108,124,255,0.1)' }}>
            <Plus size={28} style={{ color: '#6C7CFF' }} />
          </div>
          <div>
            <h2 className="text-xl font-bold mb-2" style={{ color: '#E5E7EB' }}>No Active Analysis</h2>
            <p className="text-sm max-w-xs" style={{ color: '#9CA3AF' }}>
              Upload a bank or credit card statement to start a new Financial Autopsy session.
            </p>
          </div>
          <button
            onClick={() => router.push('/upload')}
            className="px-6 py-3 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'linear-gradient(135deg, #6C7CFF, #8B5CF6)', color: '#fff' }}
          >
            Upload Statement
          </button>
        </div>
      </AppShell>
    )
  }

  const session = sessionData.session
  const summary = summaryData?.summary

  if (!summary || summary.transactionCount === 0) {
    return (
      <AppShell>
        <SessionHeader session={session} onArchive={() => setShowArchive(true)} archiving={archiveMutation.isPending || archiveAndNewMutation.isPending} />
        <div className="mt-8 flex flex-col items-center gap-4 text-center py-16">
          <AlertCircle size={32} style={{ color: '#6B7280' }} />
          <p className="text-sm" style={{ color: '#9CA3AF' }}>
            {summary?.uncategorizedCount && summary.uncategorizedCount > 0
              ? `${summary.uncategorizedCount} transactions need categorization before analysis is available.`
              : 'No transactions in this session yet. Upload a statement to get started.'}
          </p>
          <button onClick={() => router.push('/upload')} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: 'rgba(108,124,255,0.15)', color: '#939AFF' }}>
            Upload Statement
          </button>
        </div>
      </AppShell>
    )
  }

  const spendingCategories = summary.categoryTotals.filter(c => !c.isIncome)
  const topTransactions    = summary.topTransactions

  const personalitySignals = computeSignals({
    income:       summary.totalIncome,
    spending:     summary.totalSpending,
    net:          summary.net,
    categories:   spendingCategories.map(c => ({
      name: c.categoryName, pctOfSpending: c.pctOfSpending, masterKey: c.masterKey ?? null,
    })),
    subCount:     0,
    anomalyCount: 0,
    statementType: summary.statementType === 'mixed' ? 'unknown' : summary.statementType,
    interestDetected: summary.interestDetected,
  })
  const personalityResults: PersonalityResults = detectPersonality(personalitySignals)

  const txsForHeader = topTransactions.map(t => ({
    id: t.id, date: t.date as unknown as Date, description: t.description,
    merchantNormalized: t.merchantNormalized, amount: t.amount,
    categoryName: t.categoryName, categoryColor: t.categoryColor, categoryIcon: t.categoryIcon,
  }))
  const largestCategory = spendingCategories[0]
    ? { name: spendingCategories[0].categoryName, pct: Math.round(spendingCategories[0].pctOfSpending) }
    : null

  return (
    <AppShell>
      <div className="space-y-6 pb-24">
        {/* Session header */}
        <SessionHeader
          session={session}
          summary={summary}
          onArchive={() => setShowArchive(true)}
          archiving={archiveMutation.isPending || archiveAndNewMutation.isPending}
          onRefresh={() => refetchSummary()}
        />

        {/* Categorization gate */}
        {summary.uncategorizedCount > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
            <AlertCircle size={15} style={{ color: '#F59E0B' }} />
            <p className="text-sm flex-1" style={{ color: '#FCD34D' }}>
              <strong>{summary.uncategorizedCount}</strong> transactions still need categorization.
              {' '}<a href="/categorize" className="underline">Categorize now</a> for full personality scoring.
            </p>
          </div>
        )}

        {/* Personality */}
        <PersonalityCard
          results={personalityResults}
          signals={personalitySignals}
          secondaryHref="/personality/secondary"
        />

        {/* Financial summary hero */}
        <FinancialSummaryHeader
          month={summary.dateRangeStart ? new Date(summary.dateRangeStart).getMonth() + 1 : new Date().getMonth() + 1}
          year={summary.dateRangeStart ? new Date(summary.dateRangeStart).getFullYear() : new Date().getFullYear()}
          totalIncome={summary.totalIncome}
          totalSpending={summary.totalSpending}
          net={summary.net}
          transactionCount={summary.transactionCount}
          prevMonthNet={null}
          prevMonthSpending={null}
          largestCategory={largestCategory}
          latestUploadId={undefined}
          label={`${summary.accountCount} account${summary.accountCount !== 1 ? 's' : ''} · ${summary.transactionCount.toLocaleString()} transactions`}
        />

        {/* Spending charts */}
        <SpendingCharts categories={spendingCategories} totalSpending={summary.totalSpending} />

        {/* Category ranking */}
        <CategoryRanking
          categories={spendingCategories}
          totalSpending={summary.totalSpending}
          year={0}
          month={0}
          prevCategories={[]}
          budgets={[]}
        />

        {/* Accounts in this session */}
        <AccountList accounts={summary.accounts} />

        {/* Top transactions */}
        <div className="card bl-card-interactive overflow-hidden">
          <div className="px-5 pt-4 pb-3" style={{ borderBottom: '1px solid var(--border, #1F2937)' }}>
            <p className="text-sm font-semibold" style={{ color: '#E5E7EB' }}>Top Transactions</p>
          </div>
          <div className="p-5">
            <TopTransactions transactions={txsForHeader} />
          </div>
        </div>

        {/* Finish analysis CTA */}
        <div className="rounded-xl px-5 py-5 text-center space-y-3" style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.15)' }}>
          <p className="text-sm font-semibold" style={{ color: '#22c55e' }}>Ready to wrap up?</p>
          <p className="text-xs" style={{ color: '#9CA3AF' }}>
            Archive this analysis to lock in your results. Your next session will start fresh.
          </p>
          <button
            onClick={() => setShowArchive(true)}
            disabled={archiveMutation.isPending || archiveAndNewMutation.isPending}
            className="flex items-center gap-2 mx-auto px-5 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
          >
            <Archive size={14} />
            Finish Analysis
          </button>
        </div>
      </div>

      <ArchiveConfirmModal
        isOpen={showArchive}
        onClose={() => setShowArchive(false)}
        sessionTitle={session.title}
        dateRangeStart={summary?.dateRangeStart ?? session.dateRangeStart}
        dateRangeEnd={summary?.dateRangeEnd ?? session.dateRangeEnd}
        txCount={summary?.transactionCount ?? session.txCount}
        accountCount={summary?.accountCount ?? session.accountCount}
        accounts={summary?.accounts ?? []}
        isPending={archiveMutation.isPending || archiveAndNewMutation.isPending}
        onConfirm={startNew => {
          if (startNew) archiveAndNewMutation.mutate()
          else archiveMutation.mutate(session.id)
        }}
      />
    </AppShell>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SessionHeader({ session, summary, onArchive, archiving, onRefresh }: {
  session: ActiveSession
  summary?: SessionSummary
  onArchive: () => void
  archiving: boolean
  onRefresh?: () => void
}) {
  const statusLabel = session.status === 'READY' ? 'Ready' : session.status === 'PROCESSING' ? 'Processing…' : 'Active'
  const statusColor = session.status === 'READY' ? '#22c55e' : session.status === 'PROCESSING' ? '#f59e0b' : '#6C7CFF'

  return (
    <div className="rounded-xl px-4 py-4" style={{ background: 'rgba(108,124,255,0.06)', border: '1px solid rgba(108,124,255,0.15)' }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
            <span className="text-xs font-medium" style={{ color: statusColor }}>{statusLabel}</span>
          </div>
          <h1 className="text-lg font-bold truncate" style={{ color: '#E5E7EB' }}>{session.title}</h1>
          {summary && summary.dateRangeStart && (
            <p className="text-xs mt-1" style={{ color: '#9CA3AF' }}>
              {fmtDate(summary.dateRangeStart)} – {fmtDate(summary.dateRangeEnd)}
              {' · '}{summary.accountCount} account{summary.accountCount !== 1 ? 's' : ''}
              {' · '}{summary.transactionCount.toLocaleString()} transactions
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {onRefresh && (
            <button onClick={onRefresh} className="p-2 rounded-lg transition-opacity hover:opacity-70" style={{ color: '#6B7280' }} title="Refresh">
              <RefreshCw size={14} />
            </button>
          )}
          <button
            onClick={onArchive}
            disabled={archiving}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
            style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
          >
            {archiving ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
            Finish
          </button>
        </div>
      </div>
    </div>
  )
}

function AccountList({ accounts }: { accounts: SessionAccount[] }) {
  if (accounts.length === 0) return null
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card, #111827)', border: '1px solid var(--border, #1F2937)' }}>
      <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border, #1F2937)' }}>
        <p className="text-sm font-semibold" style={{ color: '#E5E7EB' }}>Accounts in This Analysis</p>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--border, #1F2937)' }}>
        {accounts.map(a => (
          <div key={a.id} className="flex items-center gap-3 px-5 py-3">
            <CheckCircle2 size={15} style={{ color: '#22c55e', flexShrink: 0 }} />
            <AccountTypeIcon type={a.accountType} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate" style={{ color: '#E5E7EB' }}>{a.name}</p>
              {a.institution && <p className="text-xs" style={{ color: '#6B7280' }}>{a.institution}</p>}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-xs font-medium" style={{ color: '#D1D5DB' }}>{a.txCount} txns</p>
              {a.dateStart && (
                <p className="text-xs" style={{ color: '#6B7280' }}>
                  {new Date(a.dateStart).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  {' – '}
                  {a.dateEnd ? new Date(a.dateEnd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '…'}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
