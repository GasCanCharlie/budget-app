'use client'

import { useMutation } from '@tanstack/react-query'
import { useApi } from '@/hooks/useApi'
import { useRouter } from 'next/navigation'
import {
  CheckCircle2, Plus, Archive, ChevronRight, Loader2,
  CreditCard, Building2, HelpCircle, AlertCircle,
} from 'lucide-react'
import { useSessionSnapshot, useInvalidateSnapshot } from '@/hooks/useSessionSnapshot'

function accountIcon(type: string) {
  const t = type.toLowerCase()
  if (t.includes('credit'))                                              return CreditCard
  if (t.includes('checking') || t.includes('savings') || t.includes('bank')) return Building2
  return HelpCircle
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return 'No transactions yet'
  const fmt = (d: string) =>
    new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (!end || start === end) return fmt(start)
  const s = new Date(start), e = new Date(end)
  if (s.getFullYear() === e.getFullYear()) {
    if (s.getMonth() === e.getMonth())
      return `${fmt(start)} – ${e.getDate()}, ${e.getFullYear()}`
    return `${fmt(start)} – ${fmt(end)}, ${e.getFullYear()}`
  }
  return `${fmt(start)}, ${s.getFullYear()} – ${fmt(end)}, ${e.getFullYear()}`
}

export function SessionStatusBar() {
  const { apiFetch }       = useApi()
  const router             = useRouter()
  const invalidate         = useInvalidateSnapshot()
  const { data, isLoading } = useSessionSnapshot()

  const archiveMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/sessions/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ action: 'archive' }),
      }),
    onSuccess: () => {
      invalidate()
      router.push('/history')
    },
  })

  if (isLoading) return (
    <div
      className="rounded-xl px-4 py-3 flex items-center gap-2"
      style={{ background: 'rgba(108,124,255,0.06)', border: '1px solid rgba(108,124,255,0.15)' }}
    >
      <Loader2 size={13} className="animate-spin" style={{ color: '#6C7CFF' }} />
      <span className="text-xs" style={{ color: '#6B7280' }}>Loading session…</span>
    </div>
  )

  const snap = data?.snapshot

  const statusColor = snap?.status === 'READY'
    ? '#22c55e'
    : snap?.status === 'PROCESSING'
    ? '#f59e0b'
    : '#6C7CFF'

  const showAccountRow = snap && snap.accounts.length > 0

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: 'rgba(108,124,255,0.06)', border: '1px solid rgba(108,124,255,0.15)' }}
    >
      {/* Header row */}
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ borderBottom: showAccountRow ? '1px solid rgba(108,124,255,0.12)' : undefined }}
      >
        <div
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }}
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: '#E5E7EB' }}>
            {snap ? snap.title : 'No Active Analysis'}
          </p>
          {snap && (
            <p className="text-xs mt-0.5 flex items-center gap-2 flex-wrap" style={{ color: '#9CA3AF' }}>
              <span>{formatDateRange(snap.dateRangeStart, snap.dateRangeEnd)}</span>
              {snap.txCount > 0 && (
                <span>{snap.txCount.toLocaleString()} transactions</span>
              )}
              {snap.uncategorizedCount > 0 && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium"
                  style={{ background: 'rgba(251,191,36,0.12)', color: '#FBBF24', fontSize: '0.68rem' }}
                >
                  <AlertCircle size={10} />
                  {snap.uncategorizedCount.toLocaleString()} uncategorized
                </span>
              )}
            </p>
          )}
        </div>

        {/* Metrics strip (right of title, left of buttons) */}
        {snap && snap.hasData && (
          <div className="hidden sm:flex items-center gap-3 flex-shrink-0">
            {snap.uploadCount > 0 && (
              <div className="text-center">
                <p className="text-sm font-semibold tabular-nums" style={{ color: '#E5E7EB' }}>
                  {snap.uploadCount}
                </p>
                <p className="text-xs" style={{ color: '#6B7280' }}>
                  {snap.uploadCount === 1 ? 'statement' : 'statements'}
                </p>
              </div>
            )}
            {snap.monthsLoaded > 0 && (
              <div className="text-center">
                <p className="text-sm font-semibold tabular-nums" style={{ color: '#E5E7EB' }}>
                  {snap.monthsLoaded}
                </p>
                <p className="text-xs" style={{ color: '#6B7280' }}>
                  {snap.monthsLoaded === 1 ? 'month' : 'months'}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-shrink-0">
          {snap ? (
            <>
              <button
                onClick={() => router.push('/session')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'rgba(108,124,255,0.15)', color: '#939AFF' }}
              >
                View Analysis
                <ChevronRight size={13} />
              </button>
              <button
                onClick={() => archiveMutation.mutate(snap.sessionId)}
                disabled={archiveMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                title="Finish analysis and archive"
              >
                {archiveMutation.isPending
                  ? <Loader2 size={12} className="animate-spin" />
                  : <Archive size={12} />}
                Finish
              </button>
            </>
          ) : (
            <button
              onClick={() =>
                apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify({}) })
                  .then(invalidate)
              }
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'rgba(108,124,255,0.15)', color: '#939AFF' }}
            >
              <Plus size={12} />
              Start Analysis
            </button>
          )}
        </div>
      </div>

      {/* Account pills */}
      {showAccountRow && (
        <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
          {snap.accounts.map(a => {
            const Icon = accountIcon(a.accountType)
            return (
              <div
                key={a.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
                style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#D1D5DB' }}
              >
                <CheckCircle2 size={11} style={{ color: '#22c55e', flexShrink: 0 }} />
                <Icon size={11} style={{ color: '#9CA3AF', flexShrink: 0 }} />
                <span className="truncate max-w-[120px]">{a.name}</span>
              </div>
            )
          })}
          <p className="text-xs ml-auto" style={{ color: '#6B7280' }}>
            Add another account to make your analysis more complete.
          </p>
        </div>
      )}
    </div>
  )
}
