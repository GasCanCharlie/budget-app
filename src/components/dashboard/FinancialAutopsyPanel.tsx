'use client'

import { useState } from 'react'
import {
  Coins, Target, RefreshCw, TrendingUp, Gauge,
  ChevronDown, ChevronRight, AlertTriangle, type LucideIcon,
} from 'lucide-react'
import type { InsightCard } from '@/lib/insights/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  cards: InsightCard[]
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Coins,
  Target,
  RefreshCw,
  TrendingUp,
  Gauge,
  AlertTriangle,
}

// ─── Severity colors ──────────────────────────────────────────────────────────

const CONFIDENCE_COLOR: Record<InsightCard['confidence'], string> = {
  high: '#EF4444',
  medium: '#F59E0B',
  low: '#6C7CFF',
}

const CONFIDENCE_BG: Record<InsightCard['confidence'], string> = {
  high: 'rgba(239,68,68,0.12)',
  medium: 'rgba(245,158,11,0.10)',
  low: 'rgba(108,124,255,0.10)',
}

const CONFIDENCE_LABEL: Record<InsightCard['confidence'], string> = {
  high: 'High impact',
  medium: 'Medium impact',
  low: 'Low impact',
}

// ─── Single autopsy card ──────────────────────────────────────────────────────

function AutopsyCard({ card }: { card: InsightCard }) {
  const [expanded, setExpanded] = useState(false)
  const IconComp: LucideIcon = ICON_MAP[card.icon_suggestion] ?? AlertTriangle
  const color = CONFIDENCE_COLOR[card.confidence]
  const bg = CONFIDENCE_BG[card.confidence]

  return (
    <div
      style={{
        background: 'var(--card2, #111827)',
        border: `1px solid var(--border-soft, rgba(255,255,255,0.06))`,
        borderRadius: 12,
        overflow: 'hidden',
        transition: 'border-color 0.2s',
      }}
    >
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '14px 16px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <IconComp size={16} style={{ color }} />
        </div>

        {/* Title + badge */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 700,
            color: 'var(--text-primary, #e5e7eb)',
            marginBottom: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {card.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              color, padding: '2px 6px', borderRadius: 4,
              background: bg,
            }}>
              {CONFIDENCE_LABEL[card.confidence]}
            </span>
          </div>
        </div>

        {/* Chevron */}
        <div style={{ color: 'var(--text-faint, #6B7280)', flexShrink: 0 }}>
          {expanded
            ? <ChevronDown size={16} />
            : <ChevronRight size={16} />
          }
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{
          padding: '0 16px 16px',
          borderTop: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
        }}>
          {/* Summary */}
          <p style={{
            fontSize: 13, color: 'var(--text-secondary, #9ca3af)',
            lineHeight: 1.55, margin: '12px 0',
          }}>
            {card.summary}
          </p>

          {/* Numbers */}
          {card.numbers_used.length > 0 && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12,
            }}>
              {card.numbers_used.map(n => (
                <div key={n.field} style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  borderRadius: 8, padding: '6px 10px',
                }}>
                  <div style={{ fontSize: 10, color: 'var(--text-faint, #6B7280)', fontWeight: 600, marginBottom: 2 }}>
                    {n.label}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary, #e5e7eb)' }}>
                    {n.value}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {card.actions.map(action => (
              <button
                key={action.action_key}
                onClick={() => {
                  if (action.action_key === 'dismiss') setExpanded(false)
                  else if (action.href) window.location.href = action.href
                }}
                style={{
                  fontSize: 12, fontWeight: 600,
                  padding: '6px 12px', borderRadius: 7,
                  border: action.action_key === 'dismiss'
                    ? '1px solid rgba(255,255,255,0.1)'
                    : `1px solid ${color}40`,
                  background: action.action_key === 'dismiss'
                    ? 'rgba(255,255,255,0.04)'
                    : bg,
                  color: action.action_key === 'dismiss'
                    ? 'var(--text-secondary, #9ca3af)'
                    : color,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Panel ────────────────────────────────────────────────────────────────────

export function FinancialAutopsyPanel({ cards }: Props) {
  const autopsyCards = cards
    .filter(c => c.card_type.startsWith('autopsy_'))
    .sort((a, b) => a.priority - b.priority)

  if (autopsyCards.length === 0) return null

  // Count high-impact cards for the section header badge
  const highCount = autopsyCards.filter(c => c.confidence === 'high').length

  return (
    <div style={{ marginBottom: 8 }}>
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8,
          background: 'rgba(239,68,68,0.12)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <AlertTriangle size={14} style={{ color: '#EF4444' }} />
        </div>
        <div>
          <div style={{
            fontSize: 13, fontWeight: 800,
            color: 'var(--text-primary, #e5e7eb)',
            letterSpacing: '0.01em',
          }}>
            Financial Autopsy
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint, #6B7280)', marginTop: 1 }}>
            {autopsyCards.length} finding{autopsyCards.length !== 1 ? 's' : ''}
            {highCount > 0 && (
              <span style={{
                marginLeft: 6, color: '#EF4444', fontWeight: 700,
              }}>
                · {highCount} high impact
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {autopsyCards.map(card => (
          <AutopsyCard key={card.id} card={card} />
        ))}
      </div>
    </div>
  )
}
