'use client'

import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useInvalidateSnapshot } from '@/hooks/useSessionSnapshot'
import { MinusCircle, Loader2, ChevronLeft, PlusCircle, CreditCard, Building2, HelpCircle } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ExcludedTx {
  id:                 string
  date:               string
  description:        string
  merchantNormalized: string
  amount:             number
  appCategory:        string | null
  isTransfer:         boolean
  accountId:          string
  accountName:        string
  accountType:        string
  categoryName:       string | null
  categoryColor:      string | null
  categoryIcon:       string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n))
}

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function AccountIcon({ type }: { type: string }) {
  const t = type.toLowerCase()
  const Icon = t.includes('credit') ? CreditCard : t.includes('checking') || t.includes('savings') ? Building2 : HelpCircle
  return <Icon size={13} style={{ color: '#6B7280', flexShrink: 0 }} />
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ExcludedPage() {
  const router           = useRouter()
  const user             = useAuthStore(s => s.user)
  const { apiFetch }     = useApi()
  const qc               = useQueryClient()
  const invalidateSnapshot = useInvalidateSnapshot()

  const { data: sessionData } = useQuery<{ session: { id: string; title: string } | null }>({
    queryKey: ['session-active'],
    queryFn:  () => apiFetch('/api/sessions/active'),
    enabled:  !!user,
    staleTime: 30_000,
  })
  const sessionId = sessionData?.session?.id

  const EXCLUDED_KEY = ['excluded', sessionId]

  const { data, isLoading } = useQuery<{ transactions: ExcludedTx[]; total: number }>({
    queryKey:       EXCLUDED_KEY,
    queryFn:        () => apiFetch(`/api/sessions/${sessionId}/excluded`),
    enabled:        !!sessionId,
    staleTime:      0,
    refetchOnMount: 'always',
  })

  const unexcludeMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        body:   JSON.stringify({ isExcluded: false }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: EXCLUDED_KEY })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      invalidateSnapshot()
    },
  })

  if (!user) return null

  const txs   = data?.transactions ?? []
  const total = data?.total ?? 0

  return (
    <AppShell>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '24px 16px 96px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
          <button
            onClick={() => router.back()}
            style={{ padding: 6, borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', color: '#9CA3AF', cursor: 'pointer', lineHeight: 0, flexShrink: 0 }}
          >
            <ChevronLeft size={16} />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(239,68,68,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <MinusCircle size={16} style={{ color: '#F87171' }} />
              </div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#E5E7EB' }}>
                Excluded Transactions
              </h1>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6B7280', lineHeight: 1.5 }}>
              Excluded transactions are hidden from all totals, category counts, and the unlock threshold.
              Un-exclude any that were marked by mistake.
            </p>
          </div>
        </div>

        {/* Count bar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderRadius: 12, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: '1rem', fontWeight: 700, color: '#E5E7EB', fontVariantNumeric: 'tabular-nums' }}>
              {isLoading ? '—' : total}
            </p>
            <p style={{ fontSize: '0.7rem', color: '#6B7280', marginTop: 1 }}>
              excluded transaction{total !== 1 ? 's' : ''}
            </p>
          </div>
          <p style={{ fontSize: '0.72rem', color: '#6B7280', maxWidth: 280, textAlign: 'right', lineHeight: 1.5 }}>
            These do not count toward your spending totals or the categorization progress.
          </p>
        </div>

        {/* Loading */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, gap: 10, color: '#6B7280', fontSize: '0.85rem' }}>
            <Loader2 size={18} className="animate-spin" />
            Loading…
          </div>
        )}

        {/* Empty state */}
        {!isLoading && total === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(108,124,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <MinusCircle size={22} style={{ color: '#4B5563' }} />
            </div>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#E5E7EB', marginBottom: 6 }}>
              No excluded transactions
            </p>
            <p style={{ fontSize: '0.78rem', color: '#6B7280', maxWidth: 320, margin: '0 auto', lineHeight: 1.6 }}>
              When you exclude a transaction from the Transactions page, it will appear here. Excluded transactions are completely hidden from your analysis.
            </p>
          </div>
        )}

        {/* Transaction list */}
        {!isLoading && txs.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {txs.map(tx => {
              const name = tx.merchantNormalized?.trim() || tx.description?.trim() || 'Unknown'
              const isPending = unexcludeMutation.isPending && unexcludeMutation.variables === tx.id
              return (
                <div
                  key={tx.id}
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)', opacity: isPending ? 0.5 : 1, transition: 'opacity 0.15s' }}
                >
                  <AccountIcon type={tx.accountType} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#9CA3AF', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {name}
                    </p>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                      <p style={{ fontSize: '0.72rem', color: '#6B7280' }}>
                        {fmtDate(tx.date)} · {tx.accountName}
                      </p>
                      {tx.appCategory && (
                        <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 20, background: 'rgba(34,197,94,0.08)', color: '#4ADE80', border: '1px solid rgba(34,197,94,0.15)' }}>
                          {tx.appCategory}
                        </span>
                      )}
                      {tx.isTransfer && (
                        <span style={{ fontSize: '0.68rem', padding: '1px 6px', borderRadius: 20, background: 'rgba(108,124,255,0.08)', color: '#818CF8' }}>
                          Transfer
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.85rem', color: tx.amount >= 0 ? '#22c55e' : '#F87171', flexShrink: 0 }}>
                    {tx.amount >= 0 ? '+' : '-'}{fmtAmt(tx.amount)}
                  </span>
                  <button
                    onClick={() => unexcludeMutation.mutate(tx.id)}
                    disabled={unexcludeMutation.isPending}
                    title="Un-exclude — restore to analysis"
                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, color: '#6C7CFF', background: 'rgba(108,124,255,0.08)', border: '1px solid rgba(108,124,255,0.18)', cursor: 'pointer', flexShrink: 0 }}
                  >
                    {isPending ? <Loader2 size={11} className="animate-spin" /> : <PlusCircle size={11} />}
                    Restore
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </AppShell>
  )
}
