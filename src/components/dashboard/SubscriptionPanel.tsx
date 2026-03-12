'use client'

import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/hooks/useApi'
import { Repeat2, Zap, Loader2, TrendingUp } from 'lucide-react'

interface Subscription {
  id: string
  merchantNormalized: string
  estimatedMonthlyAmount: number
  recurringConfidence: string
  consecutiveMonths: number
  serviceCategory: string | null
  estimatedNextCharge: string | null
  subscriptionScore: number
}

function fmtAmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)
}

function toTitleCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase()).replace(/_/g, ' ')
}

function ConfBadge({ conf }: { conf: string }) {
  const colors: Record<string, { bg: string; color: string }> = {
    high:   { bg: 'rgba(57,208,127,0.15)',  color: '#39d07f' },
    medium: { bg: 'rgba(245,158,11,0.15)',  color: '#f59e0b' },
    low:    { bg: 'rgba(139,151,195,0.12)', color: '#8b97c3' },
  }
  const style = colors[conf] ?? colors.low
  return (
    <span style={{ ...style, fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {conf}
    </span>
  )
}

export function SubscriptionPanel({ userId }: { userId: string | undefined }) {
  const { apiFetch } = useApi()
  const qc = useQueryClient()

  // Auto-detect on mount
  const detectMutation = useMutation({
    mutationFn: () => apiFetch('/api/subscriptions', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscriptions'] }),
  })

  const { data, isLoading } = useQuery<{ subscriptions: Subscription[] }>({
    queryKey: ['subscriptions'],
    queryFn: () => apiFetch('/api/subscriptions'),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  })

  useEffect(() => {
    if (userId) detectMutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const subs = (data?.subscriptions ?? []).filter(s => s.recurringConfidence !== 'low' && s.subscriptionScore >= 40)

  if (isLoading || detectMutation.isPending) {
    return (
      <div style={{ background: 'var(--card2)', border: '1px solid var(--border-soft)', borderRadius: 16, padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <Loader2 size={16} style={{ color: '#7c91ff', animation: 'spin 1s linear infinite' }} />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>Scanning for subscriptions…</span>
      </div>
    )
  }

  if (subs.length === 0) return null

  const totalMonthly = subs.reduce((s, sub) => s + sub.estimatedMonthlyAmount, 0)

  return (
    <div style={{ background: 'var(--card2)', border: '1px solid var(--border-soft)', borderRadius: 16, padding: '20px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: 'rgba(124,145,255,0.12)', borderRadius: 8, padding: '6px 7px', display: 'inline-flex' }}>
            <Repeat2 size={15} style={{ color: '#7c91ff' }} />
          </div>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Recurring Charges</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>{subs.length} detected</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#7c91ff' }}>{fmtAmt(totalMonthly)}<span style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', marginLeft: 3 }}>/mo</span></div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>{fmtAmt(totalMonthly * 12)}/yr</div>
        </div>
      </div>

      {/* Subscription rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {subs.slice(0, 6).map(sub => (
          <div key={sub.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--surface2)', borderRadius: 10, border: '1px solid var(--border)' }}>
            <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(124,145,255,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <TrendingUp size={14} style={{ color: '#7c91ff' }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {toTitleCase(sub.merchantNormalized)}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
                {sub.consecutiveMonths} month{sub.consecutiveMonths !== 1 ? 's' : ''} detected
                {sub.serviceCategory && ` · ${sub.serviceCategory}`}
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fmtAmt(sub.estimatedMonthlyAmount)}</div>
              <div style={{ marginTop: 3 }}><ConfBadge conf={sub.recurringConfidence} /></div>
            </div>
          </div>
        ))}
        {subs.length > 6 && (
          <div style={{ textAlign: 'center', fontSize: 12, color: 'var(--muted)', padding: '4px 0' }}>
            +{subs.length - 6} more recurring charges
          </div>
        )}
      </div>
    </div>
  )
}
