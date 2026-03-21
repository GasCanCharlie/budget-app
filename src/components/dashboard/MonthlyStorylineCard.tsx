'use client'

import { BookOpen, Lightbulb, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { InsightCard } from '@/lib/insights/types'

const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
]

interface Props {
  cards: InsightCard[]
  loading?: boolean
}

// Split the narrative from the final action sentence.
// The generator always pushes the action sentence last.
function splitNarrative(summary: string): { body: string; suggestion: string } {
  // Split on sentence boundaries — last sentence is the suggestion
  const sentences = summary.match(/[^.!?]+[.!?]+(\s|$)/g) ?? [summary]
  if (sentences.length <= 1) return { body: summary, suggestion: '' }
  const suggestion = sentences[sentences.length - 1].trim()
  const body = sentences.slice(0, -1).join('').trim()
  return { body, suggestion }
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function StorylineSkeleton() {
  return (
    <div className="storyline-card" style={{
      background: 'linear-gradient(135deg, #0F172A 0%, #0B1220 100%)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 20,
      padding: '28px 32px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
        <div className="bl-skeleton" style={{ width: 32, height: 32, borderRadius: 10 }} />
        <div>
          <div className="bl-skeleton" style={{ width: 180, height: 12, borderRadius: 6, marginBottom: 6 }} />
          <div className="bl-skeleton" style={{ width: 90, height: 10, borderRadius: 6 }} />
        </div>
      </div>
      <div className="bl-skeleton" style={{ width: '100%', height: 12, borderRadius: 6, marginBottom: 10 }} />
      <div className="bl-skeleton" style={{ width: '92%', height: 12, borderRadius: 6, marginBottom: 10 }} />
      <div className="bl-skeleton" style={{ width: '80%', height: 12, borderRadius: 6, marginBottom: 10 }} />
      <div className="bl-skeleton" style={{ width: '87%', height: 12, borderRadius: 6, marginBottom: 24 }} />
      <div className="bl-skeleton" style={{ width: '100%', height: 52, borderRadius: 12 }} />
    </div>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function StorylineEmpty() {
  return (
    <div className="storyline-card" style={{
      background: 'linear-gradient(135deg, #0F172A 0%, #0B1220 100%)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 20,
      padding: '28px 32px',
      display: 'flex', alignItems: 'center', gap: 16,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: 12, flexShrink: 0,
        background: 'var(--accent-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <BookOpen size={18} style={{ color: 'var(--accent2)' }} />
      </div>
      <div>
        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
          Your Month in Plain English
        </div>
        <div style={{ fontSize: 13, color: 'var(--text3)', lineHeight: 1.5 }}>
          Your financial briefing generates automatically once your transactions are categorized.
        </div>
      </div>
    </div>
  )
}

// ─── Main card ────────────────────────────────────────────────────────────────

export function MonthlyStorylineCard({ cards, loading }: Props) {
  if (loading) return <StorylineSkeleton />

  const card = cards.find(c => c.card_type === 'monthly_storyline')
  if (!card) return <StorylineEmpty />

  const { body, suggestion } = splitNarrative(card.summary)
  const monthLabel = `${MONTH_NAMES[(card.month ?? 1) - 1]} ${card.year}`

  // Key numbers — first 4, skip generic labels
  const keyNums = (card.numbers_used ?? []).slice(0, 4)

  // CTA action (non-dismiss)
  const ctaAction = card.actions.find(a => a.action_key !== 'dismiss')

  // Net sentiment for accent color
  const net = (card.supporting_data as { net?: number }).net ?? 0
  const sentimentColor = net >= 0 ? '#22C55E' : '#EF4444'
  const sentimentBg = net >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)'

  return (
    <div className="storyline-card" style={{
      background: 'linear-gradient(150deg, #0F172A 0%, #0D1528 60%, #0B1220 100%)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 20,
      padding: '28px 32px',
      position: 'relative',
      overflow: 'hidden',
    }}>

      {/* Subtle ambient glow top-right */}
      <div style={{
        position: 'absolute', top: -60, right: -60,
        width: 260, height: 260,
        background: 'radial-gradient(circle, rgba(99,102,241,0.09) 0%, transparent 70%)',
        pointerEvents: 'none',
      }} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10, flexShrink: 0,
            background: 'rgba(99,102,241,0.14)',
            border: '1px solid rgba(99,102,241,0.22)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <BookOpen size={16} style={{ color: '#818CF8' }} />
          </div>
          <div>
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: 'var(--accent)', marginBottom: 3,
            }}>
              Monthly Briefing
            </div>
            <div style={{
              fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em',
              color: 'var(--text)', lineHeight: 1.1,
            }}>
              Your Month in Plain English
            </div>
          </div>
        </div>

        {/* Month badge */}
        <div className="storyline-month-badge" style={{
          fontSize: 11, fontWeight: 600, color: '#6B7280',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: '4px 10px',
          flexShrink: 0,
        }}>
          {monthLabel}
        </div>
      </div>

      {/* ── Narrative body ──────────────────────────────────────────────────── */}
      <p style={{
        fontSize: 15,
        lineHeight: 1.75,
        color: 'var(--text2)',
        margin: '0 0 20px 0',
        fontWeight: 400,
        maxWidth: 760,
      }}>
        {body}
      </p>

      {/* ── Key numbers chips ───────────────────────────────────────────────── */}
      {keyNums.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {keyNums.map(n => (
            <div key={n.field} className="storyline-chip" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8, padding: '5px 10px',
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {n.label}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
                {n.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* ── Suggestion sub-panel ────────────────────────────────────────────── */}
      {suggestion && (
        <div className="storyline-suggestion" style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 12,
          padding: '14px 18px',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 16,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 8, flexShrink: 0, marginTop: 1,
              background: 'var(--warn-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Lightbulb size={13} style={{ color: 'var(--warn)' }} />
            </div>
            <div>
              <div style={{
                fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.08em', color: 'var(--warn)', marginBottom: 4,
              }}>
                Recommended action
              </div>
              <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.55, margin: 0, fontWeight: 400 }}>
                {suggestion}
              </p>
            </div>
          </div>

          {/* CTA */}
          {ctaAction?.href && (
            <Link
              href={ctaAction.href}
              className="storyline-cta"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: 12, fontWeight: 600, color: '#818CF8',
                background: 'rgba(99,102,241,0.12)',
                border: '1px solid rgba(99,102,241,0.22)',
                borderRadius: 8, padding: '6px 12px',
                textDecoration: 'none', flexShrink: 0,
                transition: 'background 180ms ease',
                whiteSpace: 'nowrap',
              }}
            >
              {ctaAction.label}
              <ArrowRight size={12} />
            </Link>
          )}
        </div>
      )}

      {/* ── Net sentiment bar ───────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        height: 3,
        background: `linear-gradient(90deg, ${sentimentColor}55 0%, ${sentimentColor}22 60%, transparent 100%)`,
        borderRadius: '0 0 20px 20px',
      }} />
    </div>
  )
}
