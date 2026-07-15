'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/hooks/useApi'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Plus, Archive, ChevronRight, Loader2, CreditCard, Building2, HelpCircle } from 'lucide-react'

interface SessionUpload {
  id: string; filename: string; status: string; createdAt: string;
  rowCountAccepted: number;
  account: { id: string; name: string; accountType: string; institution: string }
}

interface ActiveSession {
  id: string; title: string; status: string;
  dateRangeStart: string | null; dateRangeEnd: string | null;
  accountCount: number; txCount: number; createdAt: string;
  uploads: SessionUpload[]
}

function accountIcon(type: string) {
  const t = type.toLowerCase()
  if (t.includes('credit')) return CreditCard
  if (t.includes('checking') || t.includes('savings') || t.includes('bank')) return Building2
  return HelpCircle
}

function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return 'No transactions yet'
  const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (!end || start === end) return fmt(start)
  const s = new Date(start), e = new Date(end)
  if (s.getFullYear() === e.getFullYear()) {
    if (s.getMonth() === e.getMonth()) return `${fmt(start)} – ${e.getDate()}, ${e.getFullYear()}`
    return `${fmt(start)} – ${fmt(end)}, ${e.getFullYear()}`
  }
  return `${fmt(start)}, ${s.getFullYear()} – ${fmt(end)}, ${e.getFullYear()}`
}

export function SessionStatusBar() {
  const { apiFetch } = useApi()
  const router       = useRouter()
  const qc           = useQueryClient()

  const { data, isLoading } = useQuery<{ session: ActiveSession | null }>({
    queryKey: ['session-active'],
    queryFn:  () => apiFetch('/api/sessions/active'),
    staleTime: 30_000,
    refetchOnMount: 'always',
  })

  const archiveMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify({ action: 'archive' }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-active'] })
      qc.invalidateQueries({ queryKey: ['session-list'] })
      router.push('/history')
    },
  })

  if (isLoading) return (
    <div className="rounded-xl px-4 py-3 flex items-center gap-2" style={{ background: 'rgba(108,124,255,0.06)', border: '1px solid rgba(108,124,255,0.15)' }}>
      <Loader2 size={13} className="animate-spin" style={{ color: '#6C7CFF' }} />
      <span className="text-xs" style={{ color: '#6B7280' }}>Loading session…</span>
    </div>
  )

  const session = data?.session

  // Unique accounts + live tx count from upload records
  const seen = new Set<string>()
  const accounts: SessionUpload['account'][] = []
  let liveTxCount = 0
  for (const u of session?.uploads ?? []) {
    liveTxCount += u.rowCountAccepted ?? 0
    if (!seen.has(u.account.id)) { seen.add(u.account.id); accounts.push(u.account) }
  }

  const statusColor = session?.status === 'READY'
    ? '#22c55e'
    : session?.status === 'PROCESSING'
    ? '#f59e0b'
    : '#6C7CFF'

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(108,124,255,0.06)', border: '1px solid rgba(108,124,255,0.15)' }}>
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: accounts.length > 0 ? '1px solid rgba(108,124,255,0.12)' : undefined }}>
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}` }} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: '#E5E7EB' }}>
            {session ? session.title : 'No Active Analysis'}
          </p>
          {session && (
            <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
              {formatDateRange(session.dateRangeStart, session.dateRangeEnd)}
              {liveTxCount > 0 && ` · ${liveTxCount.toLocaleString()} transactions`}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {session ? (
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
                onClick={() => archiveMutation.mutate(session.id)}
                disabled={archiveMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
                style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}
                title="Finish analysis and archive"
              >
                {archiveMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Archive size={12} />}
                Finish
              </button>
            </>
          ) : (
            <button
              onClick={() => apiFetch('/api/sessions', { method: 'POST', body: JSON.stringify({}) })
                .then(() => qc.invalidateQueries({ queryKey: ['session-active'] }))}
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
      {accounts.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 flex-wrap">
          {accounts.map(a => {
            const Icon = accountIcon(a.accountType)
            return (
              <div key={a.id} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#D1D5DB' }}>
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
