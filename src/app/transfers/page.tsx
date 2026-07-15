'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useInvalidateSnapshot } from '@/hooks/useSessionSnapshot'
import {
  ArrowLeftRight, RefreshCw, Loader2, CheckCircle2, X,
  CreditCard, Building2, HelpCircle, ChevronLeft,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxSummary {
  id:                 string
  date:               string
  description:        string
  merchantNormalized: string
  amount:             number
  accountId:          string
  accountName:        string
  accountType:        string
}

interface TransferPair {
  linkId:          string
  confirmedByUser: boolean
  confidence:      number
  txA:             TxSummary
  txB:             TxSummary
}

interface TransfersData {
  pairs:         TransferPair[]
  unpaired:      TxSummary[]
  totalCount:    number
  pairedCount:   number
  unpairedCount: number
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

function AmtLabel({ amount }: { amount: number }) {
  const color = amount >= 0 ? '#22c55e' : '#F87171'
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600, fontSize: '0.85rem', color, flexShrink: 0 }}>
      {amount >= 0 ? '+' : '-'}{fmtAmt(amount)}
    </span>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TxRow({ tx }: { tx: TxSummary }) {
  const name = tx.merchantNormalized?.trim() || tx.description?.trim() || 'Unknown'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px' }}>
      <AccountIcon type={tx.accountType} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#E5E7EB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </p>
        <p style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: 1 }}>
          {fmtDate(tx.date)} · {tx.accountName}
        </p>
      </div>
      <AmtLabel amount={tx.amount} />
    </div>
  )
}

function PairCard({
  pair, onNotTransfer, onConfirm, isNotTransferPending, isConfirmPending,
}: {
  pair:               TransferPair
  onNotTransfer:      () => void
  onConfirm:          () => void
  isNotTransferPending: boolean
  isConfirmPending:   boolean
}) {
  const isPending = isNotTransferPending || isConfirmPending
  return (
    <div style={{ borderRadius: 12, overflow: 'hidden', border: pair.confirmedByUser ? '1px solid rgba(34,197,94,0.3)' : '1px solid rgba(255,255,255,0.08)', background: pair.confirmedByUser ? 'rgba(34,197,94,0.04)' : 'rgba(255,255,255,0.02)' }}>
      <TxRow tx={pair.txA} />
      <div style={{ height: 1, background: 'rgba(255,255,255,0.05)' }} />
      <TxRow tx={pair.txB} />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: 'rgba(255,255,255,0.02)', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
        {pair.confirmedByUser ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: '#22c55e', fontWeight: 600 }}>
            <CheckCircle2 size={12} />
            Confirmed transfer
          </span>
        ) : (
          <span style={{ fontSize: '0.72rem', color: '#6B7280' }}>
            {Math.round(pair.confidence * 100)}% confidence
          </span>
        )}
        <div style={{ display: 'flex', gap: 8 }}>
          {!pair.confirmedByUser && (
            <button
              onClick={onConfirm}
              disabled={isPending}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, color: '#22c55e', background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.2)', cursor: 'pointer', opacity: isPending ? 0.6 : 1 }}
            >
              {isConfirmPending ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}
              Confirm pair
            </button>
          )}
          <button
            onClick={onNotTransfer}
            disabled={isPending}
            style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, color: '#9CA3AF', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', opacity: isPending ? 0.6 : 1 }}
          >
            {isNotTransferPending ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
            Not a transfer
          </button>
        </div>
      </div>
    </div>
  )
}

function UnpairedRow({
  tx, onNotTransfer, isPending,
}: {
  tx:           TxSummary
  onNotTransfer: () => void
  isPending:    boolean
}) {
  const name = tx.merchantNormalized?.trim() || tx.description?.trim() || 'Unknown'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.07)', background: 'rgba(255,255,255,0.02)' }}>
      <AccountIcon type={tx.accountType} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: '0.82rem', fontWeight: 600, color: '#E5E7EB', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </p>
        <p style={{ fontSize: '0.72rem', color: '#6B7280', marginTop: 1 }}>
          {fmtDate(tx.date)} · {tx.accountName}
        </p>
      </div>
      <AmtLabel amount={tx.amount} />
      <button
        onClick={onNotTransfer}
        disabled={isPending}
        style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 8, fontSize: '0.72rem', fontWeight: 600, color: '#9CA3AF', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', cursor: 'pointer', flexShrink: 0, opacity: isPending ? 0.6 : 1 }}
      >
        {isPending ? <Loader2 size={11} className="animate-spin" /> : <X size={11} />}
        Not a transfer
      </button>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransfersPage() {
  const router     = useRouter()
  const user       = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc         = useQueryClient()
  const invalidateSnapshot = useInvalidateSnapshot()
  const [redetectMsg, setRedetectMsg] = useState<string | null>(null)

  const { data: sessionData } = useQuery<{ session: { id: string; title: string } | null }>({
    queryKey: ['session-active'],
    queryFn:  () => apiFetch('/api/sessions/active'),
    enabled:  !!user,
    staleTime: 30_000,
  })
  const sessionId = sessionData?.session?.id

  const TRANSFERS_KEY = ['transfers', sessionId]

  const { data, isLoading } = useQuery<TransfersData>({
    queryKey:       TRANSFERS_KEY,
    queryFn:        () => apiFetch(`/api/sessions/${sessionId}/transfers`),
    enabled:        !!sessionId,
    staleTime:      0,
    refetchOnMount: 'always',
  })

  const invalidate = () => qc.invalidateQueries({ queryKey: TRANSFERS_KEY })

  // Mark one or two txs as not-transfer
  const notTransferMutation = useMutation({
    mutationFn: (ids: string[]) =>
      Promise.all(
        ids.map(id =>
          apiFetch(`/api/transactions/${id}`, {
            method: 'PATCH',
            body:   JSON.stringify({ isTransfer: false }),
          }),
        ),
      ),
    onSuccess: () => {
      invalidate()
      invalidateSnapshot()
    },
  })

  // Confirm a transfer pair
  const confirmMutation = useMutation({
    mutationFn: (linkId: string) =>
      apiFetch(`/api/sessions/${sessionId}/transfers`, {
        method: 'PATCH',
        body:   JSON.stringify({ linkId }),
      }),
    onSuccess: () => invalidate(),
  })

  // Re-run detection
  const redetectMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sessions/${sessionId}/detect-transfers`, { method: 'POST' }),
    onSuccess: (res: { pairsFound: number }) => {
      invalidate()
      invalidateSnapshot()
      setRedetectMsg(
        res.pairsFound > 0
          ? `Found ${res.pairsFound} new transfer pair${res.pairsFound !== 1 ? 's' : ''}.`
          : 'No new transfer pairs found.',
      )
      setTimeout(() => setRedetectMsg(null), 5000)
    },
  })

  if (!user) return null

  if (!sessionData && !isLoading) {
    return (
      <AppShell>
        <div style={{ maxWidth: 600, margin: '0 auto', padding: '32px 16px', textAlign: 'center' }}>
          <p style={{ color: '#6B7280', fontSize: '0.9rem' }}>No active session.</p>
        </div>
      </AppShell>
    )
  }

  const pairs   = data?.pairs ?? []
  const unpaired = data?.unpaired ?? []
  const total   = data?.totalCount ?? 0

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
              <div style={{ width: 32, height: 32, borderRadius: 9, background: 'rgba(108,124,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <ArrowLeftRight size={16} style={{ color: '#939AFF' }} />
              </div>
              <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#E5E7EB' }}>
                Transfers
              </h1>
            </div>
            <p style={{ fontSize: '0.78rem', color: '#6B7280', lineHeight: 1.5 }}>
              Transfers are excluded from your spending totals. Review auto-detected transfers and remove any false positives.
            </p>
          </div>
        </div>

        {/* Stats bar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', borderRadius: 12, background: 'rgba(108,124,255,0.06)', border: '1px solid rgba(108,124,255,0.12)', marginBottom: 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 16, flex: 1 }}>
            {[
              { label: 'Total', value: total },
              { label: 'Paired', value: (data?.pairedCount ?? 0) },
              { label: 'Unpaired', value: unpaired.length },
              { label: 'Pairs', value: pairs.length },
            ].map(({ label, value }) => (
              <div key={label}>
                <p style={{ fontSize: '1rem', fontWeight: 700, color: '#E5E7EB', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>{isLoading ? '—' : value}</p>
                <p style={{ fontSize: '0.68rem', color: '#6B7280', marginTop: 1 }}>{label}</p>
              </div>
            ))}
          </div>
          <button
            onClick={() => redetectMutation.mutate()}
            disabled={redetectMutation.isPending || !sessionId}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 9, fontSize: '0.78rem', fontWeight: 600, color: '#939AFF', background: 'rgba(108,124,255,0.1)', border: '1px solid rgba(108,124,255,0.2)', cursor: 'pointer', flexShrink: 0 }}
          >
            {redetectMutation.isPending
              ? <Loader2 size={13} className="animate-spin" />
              : <RefreshCw size={13} />}
            Re-detect
          </button>
        </div>

        {/* Re-detect result message */}
        {redetectMsg && (
          <p style={{ fontSize: '0.78rem', color: '#22c55e', marginBottom: 16, padding: '8px 12px', background: 'rgba(34,197,94,0.08)', borderRadius: 8, border: '1px solid rgba(34,197,94,0.15)' }}>
            {redetectMsg}
          </p>
        )}

        {/* Loading */}
        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 160, gap: 10, color: '#6B7280', fontSize: '0.85rem' }}>
            <Loader2 size={18} className="animate-spin" />
            Loading transfers…
          </div>
        )}

        {/* Empty state */}
        {!isLoading && total === 0 && (
          <div style={{ textAlign: 'center', padding: '48px 24px' }}>
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'rgba(108,124,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
              <CheckCircle2 size={22} style={{ color: '#22c55e' }} />
            </div>
            <p style={{ fontSize: '0.95rem', fontWeight: 600, color: '#E5E7EB', marginBottom: 6 }}>No transfers detected</p>
            <p style={{ fontSize: '0.78rem', color: '#6B7280', maxWidth: 320, margin: '0 auto 20px', lineHeight: 1.6 }}>
              Financial Autopsy auto-detects credit card payments, bank transfers, and Zelle/Venmo transactions.
              Click Re-detect to run the engine again after uploading more statements.
            </p>
          </div>
        )}

        {/* Paired transfers */}
        {!isLoading && pairs.length > 0 && (
          <section style={{ marginBottom: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Detected Pairs
              </p>
              <span style={{ fontSize: '0.72rem', padding: '1px 8px', borderRadius: 20, background: 'rgba(108,124,255,0.1)', color: '#939AFF', fontWeight: 600 }}>
                {pairs.length}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {pairs.map(pair => (
                <PairCard
                  key={pair.linkId}
                  pair={pair}
                  onNotTransfer={() =>
                    notTransferMutation.mutate([pair.txA.id, pair.txB.id])
                  }
                  onConfirm={() => confirmMutation.mutate(pair.linkId)}
                  isNotTransferPending={
                    notTransferMutation.isPending &&
                    (notTransferMutation.variables?.includes(pair.txA.id) ?? false)
                  }
                  isConfirmPending={
                    confirmMutation.isPending && confirmMutation.variables === pair.linkId
                  }
                />
              ))}
            </div>
          </section>
        )}

        {/* Unpaired transfers */}
        {!isLoading && unpaired.length > 0 && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <p style={{ fontSize: '0.8rem', fontWeight: 700, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Unpaired
              </p>
              <span style={{ fontSize: '0.72rem', padding: '1px 8px', borderRadius: 20, background: 'rgba(255,255,255,0.06)', color: '#6B7280', fontWeight: 600 }}>
                {unpaired.length}
              </span>
              <span style={{ fontSize: '0.72rem', color: '#6B7280', marginLeft: 4 }}>
                — matched by description only, no counterpart found
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {unpaired.map(tx => (
                <UnpairedRow
                  key={tx.id}
                  tx={tx}
                  onNotTransfer={() => notTransferMutation.mutate([tx.id])}
                  isPending={
                    notTransferMutation.isPending &&
                    (notTransferMutation.variables?.includes(tx.id) ?? false)
                  }
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </AppShell>
  )
}
