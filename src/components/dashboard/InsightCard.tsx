'use client'

import {
  TrendingUp, AlertCircle, RefreshCw, DollarSign, Wrench, Zap,
  Sparkles, X, ExternalLink,
} from 'lucide-react'
import type { InsightCard as InsightCardData } from '@/lib/insights/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface InsightCardProps {
  card: InsightCardData
  onDismiss: (id: string) => void
  onAction: (id: string, actionKey: string, href?: string) => void
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ICON_MAP: Record<string, React.ComponentType<any>> = {
  TrendingUp,
  AlertCircle,
  RefreshCw,
  DollarSign,
  Wrench,
  Zap,
  Sparkles,
}

function getIcon(suggestion: string) {
  return ICON_MAP[suggestion] ?? Sparkles
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// ─── Confidence badge ─────────────────────────────────────────────────────────

const CONFIDENCE_STYLES: Record<string, React.CSSProperties> = {
  high: {
    background: 'var(--success-muted, rgba(46,229,157,0.12))',
    color: 'var(--success)',
    border: '1px solid var(--success-muted, rgba(46,229,157,0.20))',
  },
  medium: {
    background: 'var(--warn-muted, rgba(251,191,36,0.12))',
    color: 'var(--warn)',
    border: '1px solid var(--warn-muted, rgba(251,191,36,0.20))',
  },
  low: {
    background: 'var(--surface2)',
    color: 'var(--text3)',
    border: '1px solid var(--border)',
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InsightCard({ card, onDismiss, onAction }: InsightCardProps) {
  const IconComponent = getIcon(card.icon_suggestion)
  const confidenceStyle = CONFIDENCE_STYLES[card.confidence] ?? CONFIDENCE_STYLES.low

  const nonDismissActions = card.actions.filter(a => a.action_key !== 'dismiss')
  const hasDismiss = card.actions.some(a => a.action_key === 'dismiss')

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        gap: 0,
      }}
    >
      {/* ── Header row ── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        {/* Icon */}
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--accent-muted)',
            border: '1px solid var(--accent-muted)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <IconComponent size={15} style={{ color: 'var(--accent)' }} />
        </div>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: 'var(--text)',
              lineHeight: 1.3,
              margin: 0,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.title}
          </p>
        </div>

        {/* Confidence badge */}
        <span
          style={{
            ...confidenceStyle,
            fontSize: 10,
            fontWeight: 600,
            borderRadius: 9999,
            padding: '2px 8px',
            whiteSpace: 'nowrap',
            flexShrink: 0,
            textTransform: 'capitalize',
          }}
        >
          {card.confidence}
        </span>
      </div>

      {/* ── Summary ── */}
      <p
        style={{
          fontSize: 12,
          color: 'var(--text2)',
          lineHeight: 1.6,
          marginTop: 8,
          marginBottom: 0,
        }}
      >
        {card.summary}
      </p>

      {/* ── Wisdom ── */}
      {(() => {
        const wisdom = (card.supporting_data as unknown as Record<string, unknown>)['_wisdom']
        if (!wisdom || typeof wisdom !== 'string') return null
        return (
          <p
            style={{
              fontSize: 11,
              fontStyle: 'italic',
              color: 'var(--text3)',
              lineHeight: 1.5,
              marginTop: 8,
              marginBottom: 0,
            }}
          >
            {wisdom}
          </p>
        )
      })()}

      {/* ── View transactions link ── */}
      {card.filters && Object.values(card.filters).some(v => v !== undefined) && (() => {
        const params = new URLSearchParams()
        if (card.filters!.merchant !== undefined)  params.set('merchant',  card.filters!.merchant)
        if (card.filters!.category !== undefined)  params.set('category',  card.filters!.category)
        if (card.filters!.dateFrom !== undefined)  params.set('dateFrom',  card.filters!.dateFrom)
        if (card.filters!.dateTo   !== undefined)  params.set('dateTo',    card.filters!.dateTo)
        if (card.filters!.minAmount !== undefined) params.set('minAmount', String(card.filters!.minAmount))
        const href = `/transactions?${params.toString()}`
        return (
          <a
            href={href}
            style={{
              fontSize: 11,
              color: 'var(--accent)',
              background: 'transparent',
              border: 'none',
              padding: '4px 0',
              cursor: 'pointer',
              textDecoration: 'underline',
              textUnderlineOffset: 2,
              marginTop: 6,
              display: 'inline-block',
            }}
          >
            View transactions →
          </a>
        )
      })()}

      {/* ── Stat chips (numbers_used) ── */}
      {card.numbers_used && card.numbers_used.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {card.numbers_used.slice(0, 3).map((chip) => (
            <div
              key={chip.field}
              style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '4px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <span style={{ fontSize: 9, color: 'var(--text3)', lineHeight: 1.2 }}>{chip.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.2 }}>{chip.value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Actions row ── */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 12 }}>
        {nonDismissActions.map((action, i) => (
          <button
            key={action.action_key}
            onClick={() => onAction(card.id, action.action_key, action.href)}
            style={{
              background: 'var(--accent-muted)',
              border: '1px solid var(--accent-muted)',
              color: 'var(--accent)',
              fontSize: 11,
              fontWeight: 500,
              borderRadius: 8,
              padding: '5px 10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '0.8'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.opacity = '1'
            }}
          >
            {action.href && <ExternalLink size={10} />}
            {action.label}
          </button>
        ))}

        {hasDismiss && (
          <button
            onClick={() => onDismiss(card.id)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text3)',
              fontSize: 11,
              borderRadius: 8,
              padding: '5px 10px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text2)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text3)'
            }}
          >
            <X size={10} />
            Dismiss
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function InsightCardSkeleton() {
  return (
    <div
      style={{
        background: 'var(--card2)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 16,
        boxShadow: 'var(--shadow-soft)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div
          className="animate-pulse"
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: 'var(--surface2)',
            flexShrink: 0,
          }}
        />
        <div
          className="animate-pulse"
          style={{
            flex: 1,
            height: 12,
            borderRadius: 6,
            background: 'var(--surface2)',
            maxWidth: '75%',
          }}
        />
        <div
          className="animate-pulse"
          style={{
            width: 40,
            height: 18,
            borderRadius: 9999,
            background: 'var(--surface2)',
          }}
        />
      </div>

      {/* Summary lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <div
          className="animate-pulse"
          style={{ height: 10, borderRadius: 5, background: 'var(--surface2)', width: '100%' }}
        />
        <div
          className="animate-pulse"
          style={{ height: 10, borderRadius: 5, background: 'var(--surface2)', width: '66%' }}
        />
      </div>

      {/* Action pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div
          className="animate-pulse"
          style={{ width: 96, height: 24, borderRadius: 8, background: 'var(--surface2)' }}
        />
        <div
          className="animate-pulse"
          style={{ width: 64, height: 24, borderRadius: 8, background: 'var(--surface2)' }}
        />
      </div>
    </div>
  )
}
