'use client'

import { CalendarClock, Zap } from 'lucide-react'

interface Subscription {
  id: string
  merchantNormalized: string
  estimatedMonthlyAmount: number
  estimatedNextCharge: string | null
  recurringConfidence: string
  subscriptionScore: number
}

interface Props {
  subscriptions: Subscription[]
}

function fmtAmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(n)
}

function toTitleCase(s: string) {
  return s.replace(/\b\w/g, c => c.toUpperCase()).replace(/_/g, ' ')
}

function daysUntil(dateStr: string): number {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr)
  target.setHours(0, 0, 0, 0)
  return Math.round((target.getTime() - now.getTime()) / 86_400_000)
}

export function UpcomingChargesPanel({ subscriptions }: Props) {
  const now = new Date()
  const in14 = new Date(now.getTime() + 14 * 86_400_000)

  const upcoming = subscriptions
    .filter(s =>
      s.estimatedNextCharge !== null &&
      s.recurringConfidence !== 'low' &&
      s.subscriptionScore >= 40
    )
    .map(s => ({ ...s, days: daysUntil(s.estimatedNextCharge!) }))
    .filter(s => s.days >= 0 && s.days <= 14)
    .sort((a, b) => a.days - b.days)

  if (upcoming.length === 0) return null

  const totalUpcoming = upcoming.reduce((sum, s) => sum + s.estimatedMonthlyAmount, 0)

  return (
    <div style={{
      background: 'var(--card2)',
      border: '1px solid var(--border-soft)',
      borderRadius: 16,
      padding: '20px 24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ background: 'rgba(245,158,11,0.12)', borderRadius: 8, padding: '6px 7px', display: 'inline-flex' }}>
            <CalendarClock size={15} style={{ color: '#F59E0B' }} />
          </div>
          <div>
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>Upcoming Charges</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>next 14 days</span>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: '#F59E0B' }}>{fmtAmt(totalUpcoming)}</div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 1 }}>due soon</div>
        </div>
      </div>

      {/* Charge rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {upcoming.map(sub => {
          const isToday    = sub.days === 0
          const isTomorrow = sub.days === 1
          const isThisWeek = sub.days <= 7
          const dayLabel = isToday ? 'Today' : isTomorrow ? 'Tomorrow' : `In ${sub.days} days`
          const tagColor = isToday || isTomorrow
            ? { bg: 'rgba(239,68,68,0.12)', color: '#EF4444' }
            : isThisWeek
              ? { bg: 'rgba(245,158,11,0.12)', color: '#F59E0B' }
              : { bg: 'rgba(108,124,255,0.12)', color: '#8794ff' }

          return (
            <div key={sub.id} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 12px',
              background: 'var(--surface2)',
              borderRadius: 10,
              border: '1px solid var(--border)',
            }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(245,158,11,0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Zap size={14} style={{ color: '#F59E0B' }} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {toTitleCase(sub.merchantNormalized)}
                </div>
                <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '1px 6px', ...tagColor }}>
                  {dayLabel}
                </span>
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', flexShrink: 0 }}>
                {fmtAmt(sub.estimatedMonthlyAmount)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
