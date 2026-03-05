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

function snakeToTitle(key: string): string {
  return key
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function formatValue(val: number | string | null): string {
  if (val === null) return '—'
  if (typeof val === 'string') return val
  // Currency if large enough and whole-dollar-ish
  if (Math.abs(val) >= 1 && Number.isFinite(val)) {
    if (val % 1 === 0 || String(val).split('.')[1]?.length <= 2) {
      // Show as currency if it looks like a dollar amount (> 0.01)
      if (Math.abs(val) >= 0.01) {
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          maximumFractionDigits: 2,
        }).format(val)
      }
    }
    return String(val)
  }
  return String(val)
}

function getNumericChips(
  supporting_data: Record<string, number | string | null>
): Array<{ label: string; value: string }> {
  const entries = Object.entries(supporting_data)
  const numeric = entries.filter(([, v]) => typeof v === 'number' && v !== null)
  return numeric.slice(0, 2).map(([k, v]) => ({
    label: snakeToTitle(k),
    value: formatValue(v as number),
  }))
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

const CONFIDENCE_STYLES: Record<string, React.CSSProperties> = {
  high: {
    background: 'rgba(46,229,157,0.12)',
    color: '#2ee59d',
    border: '1px solid rgba(46,229,157,0.20)',
  },
  medium: {
    background: 'rgba(251,191,36,0.12)',
    color: '#fbbf24',
    border: '1px solid rgba(251,191,36,0.20)',
  },
  low: {
    background: 'rgba(148,163,184,0.10)',
    color: '#8b97c3',
    border: '1px solid rgba(148,163,184,0.15)',
  },
}

// ─── Component ────────────────────────────────────────────────────────────────

export function InsightCard({ card, onDismiss, onAction }: InsightCardProps) {
  const IconComponent = getIcon(card.icon_suggestion)
  const confidenceStyle = CONFIDENCE_STYLES[card.confidence] ?? CONFIDENCE_STYLES.low
  const chips = getNumericChips(card.supporting_data as unknown as Record<string, number | string | null>)

  const nonDismissActions = card.actions.filter(a => a.action_key !== 'dismiss')
  const hasDismiss = card.actions.some(a => a.action_key === 'dismiss')

  return (
    <div
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.05)',
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
            background: 'rgba(110,168,255,0.12)',
            border: '1px solid rgba(110,168,255,0.20)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <IconComponent size={15} style={{ color: '#6ea8ff' }} />
        </div>

        {/* Title */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: 13,
              fontWeight: 700,
              color: '#eaf0ff',
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
          color: '#a8b3d6',
          lineHeight: 1.6,
          marginTop: 8,
          marginBottom: 0,
        }}
      >
        {card.summary}
      </p>

      {/* ── Stat chips ── */}
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {chips.map((chip) => (
            <div
              key={chip.label}
              style={{
                background: 'rgba(0,0,0,0.25)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 8,
                padding: '4px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              <span style={{ fontSize: 9, color: '#8b97c3', lineHeight: 1.2 }}>{chip.label}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#eaf0ff', lineHeight: 1.2 }}>{chip.value}</span>
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
              background: i === 0 ? 'rgba(110,168,255,0.12)' : 'rgba(110,168,255,0.06)',
              border: `1px solid ${i === 0 ? 'rgba(110,168,255,0.25)' : 'rgba(110,168,255,0.12)'}`,
              color: '#6ea8ff',
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
              (e.currentTarget as HTMLButtonElement).style.background = 'rgba(110,168,255,0.20)'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.background = i === 0
                ? 'rgba(110,168,255,0.12)'
                : 'rgba(110,168,255,0.06)'
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
              color: '#8b97c3',
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
              (e.currentTarget as HTMLButtonElement).style.color = '#c8d4f5'
            }}
            onMouseLeave={e => {
              (e.currentTarget as HTMLButtonElement).style.color = '#8b97c3'
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
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16,
        padding: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
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
            background: 'rgba(255,255,255,0.06)',
            flexShrink: 0,
          }}
        />
        <div
          className="animate-pulse"
          style={{
            flex: 1,
            height: 12,
            borderRadius: 6,
            background: 'rgba(255,255,255,0.06)',
            maxWidth: '75%',
          }}
        />
        <div
          className="animate-pulse"
          style={{
            width: 40,
            height: 18,
            borderRadius: 9999,
            background: 'rgba(255,255,255,0.06)',
          }}
        />
      </div>

      {/* Summary lines */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
        <div
          className="animate-pulse"
          style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.06)', width: '100%' }}
        />
        <div
          className="animate-pulse"
          style={{ height: 10, borderRadius: 5, background: 'rgba(255,255,255,0.06)', width: '66%' }}
        />
      </div>

      {/* Action pills */}
      <div style={{ display: 'flex', gap: 6 }}>
        <div
          className="animate-pulse"
          style={{ width: 96, height: 24, borderRadius: 8, background: 'rgba(255,255,255,0.06)' }}
        />
        <div
          className="animate-pulse"
          style={{ width: 64, height: 24, borderRadius: 8, background: 'rgba(255,255,255,0.06)' }}
        />
      </div>
    </div>
  )
}
