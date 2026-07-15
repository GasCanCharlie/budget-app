'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Archive, Clock, ChevronRight, CreditCard, Building2 } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SessionAccount {
  id: string; name: string; accountType: string
}

interface Session {
  id: string; title: string; status: string;
  dateRangeStart: string | null; dateRangeEnd: string | null;
  accountCount: number; txCount: number;
  createdAt: string; archivedAt: string | null;
  uploads: { account: SessionAccount }[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmtAmt = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function statusBadge(status: string) {
  if (status === 'ARCHIVED') return { label: 'Archived', color: '#6B7280', bg: 'rgba(107,114,128,0.1)' }
  if (status === 'READY')    return { label: 'Ready',    color: '#22c55e', bg: 'rgba(34,197,94,0.1)' }
  return { label: 'Active', color: '#6C7CFF', bg: 'rgba(108,124,255,0.1)' }
}

function AccountIcon({ type }: { type: string }) {
  const t = type.toLowerCase()
  const Icon = t.includes('credit') ? CreditCard : Building2
  return <Icon size={12} style={{ color: '#9CA3AF' }} />
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const router      = useRouter()
  const user        = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc          = useQueryClient()

  useEffect(() => { if (!user) router.push('/login') }, [user, router])

  const { data, isLoading, isError } = useQuery<{ sessions: Session[] }>({
    queryKey: ['session-list'],
    queryFn:  () => apiFetch('/api/sessions'),
    enabled:  !!user,
    refetchOnMount: 'always',
    staleTime: 0,
  })

  const reopenMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify({ action: 'reopen' }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['session-list'] })
      qc.invalidateQueries({ queryKey: ['session-active'] })
      router.push('/session')
    },
  })

  if (!user) return null

  const sessions = data?.sessions ?? []
  const archived = sessions.filter(s => s.status === 'ARCHIVED')
  const active   = sessions.filter(s => s.status !== 'ARCHIVED')

  return (
    <AppShell>
      <main className="max-w-3xl mx-auto px-4 py-6 pb-24">
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Past Autopsies</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>Archived financial analysis sessions</p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 gap-3">
            <Loader2 size={22} className="animate-spin" style={{ color: '#6C7CFF' }} />
            <p className="text-sm" style={{ color: '#9CA3AF' }}>Loading…</p>
          </div>
        )}

        {isError && (
          <p className="text-sm text-center py-10" style={{ color: '#ef4444' }}>Failed to load sessions.</p>
        )}

        {/* Active session notice */}
        {!isLoading && active.length > 0 && (
          <div className="mb-4">
            <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#6B7280' }}>Active</p>
            {active.map(s => <SessionCard key={s.id} session={s} onReopen={() => reopenMutation.mutate(s.id)} reopening={reopenMutation.isPending && reopenMutation.variables === s.id} onClick={() => router.push('/session')} />)}
          </div>
        )}

        {/* Archived sessions */}
        {!isLoading && !isError && (
          <div>
            {archived.length > 0 && (
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: '#6B7280' }}>Archived</p>
            )}
            {archived.length === 0 && !isLoading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ background: 'rgba(108,124,255,0.1)' }}>
                  <Clock size={22} style={{ color: '#6C7CFF' }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: '#E5E7EB' }}>No archived analyses yet</p>
                <p className="text-xs" style={{ color: '#9CA3AF' }}>
                  Finish an active session to archive it here.
                </p>
              </div>
            )}
            <div className="space-y-3">
              {archived.map(s => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onReopen={() => reopenMutation.mutate(s.id)}
                  reopening={reopenMutation.isPending && reopenMutation.variables === s.id}
                  onClick={() => {}}
                  showReopen={!active.length}
                />
              ))}
            </div>
          </div>
        )}
      </main>
    </AppShell>
  )
}

function SessionCard({ session, onReopen, reopening, onClick, showReopen }: {
  session: Session
  onReopen: () => void
  reopening: boolean
  onClick: () => void
  showReopen?: boolean
}) {
  const badge = statusBadge(session.status)

  // Unique accounts
  const seen = new Set<string>()
  const accounts: SessionAccount[] = []
  for (const u of session.uploads) {
    if (!seen.has(u.account.id)) { seen.add(u.account.id); accounts.push(u.account) }
  }

  return (
    <div
      className="rounded-xl overflow-hidden transition-all"
      style={{ background: 'var(--card, #111827)', border: '1px solid var(--border, #1F2937)' }}
    >
      <div className="flex items-center gap-3 px-4 py-4" style={{ borderBottom: accounts.length ? '1px solid var(--border, #1F2937)' : undefined }}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ background: badge.bg, color: badge.color }}>
              {badge.label}
            </span>
          </div>
          <p className="font-semibold truncate" style={{ color: '#E5E7EB' }}>{session.title}</p>
          <p className="text-xs mt-0.5" style={{ color: '#9CA3AF' }}>
            {fmtDate(session.dateRangeStart)} – {fmtDate(session.dateRangeEnd)}
            {session.txCount > 0 && ` · ${session.txCount.toLocaleString()} transactions`}
            {session.accountCount > 0 && ` · ${session.accountCount} account${session.accountCount !== 1 ? 's' : ''}`}
          </p>
          {session.archivedAt && (
            <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: '#6B7280' }}>
              <Archive size={10} />
              Archived {fmtDate(session.archivedAt)}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {showReopen && (
            <button
              onClick={e => { e.stopPropagation(); onReopen() }}
              disabled={reopening}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'rgba(108,124,255,0.12)', color: '#939AFF' }}
            >
              {reopening ? <Loader2 size={12} className="animate-spin" /> : 'Reopen'}
            </button>
          )}
          {session.status !== 'ARCHIVED' && (
            <button onClick={onClick} className="p-1.5 rounded-lg transition-opacity hover:opacity-70" style={{ color: '#6B7280' }}>
              <ChevronRight size={16} />
            </button>
          )}
        </div>
      </div>

      {accounts.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {accounts.map(a => (
            <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs" style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', color: '#D1D5DB' }}>
              <AccountIcon type={a.accountType} />
              <span className="truncate max-w-[100px]">{a.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
