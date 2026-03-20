'use client'

import { useState } from 'react'
import {
  Coins, Target, RefreshCw, TrendingUp, Gauge,
  ChevronDown, ChevronRight, Loader2, Lightbulb,
  Layers, Activity, Zap, Brain, BarChart3, type LucideIcon,
} from 'lucide-react'

// ─── Caduceus icon (custom SVG — not in lucide) ───────────────────────────────

function CaduceusIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      {/* Staff */}
      <line x1="12" y1="3.5" x2="12" y2="22" />
      {/* Orb */}
      <circle cx="12" cy="2" r="1.3" fill={color} stroke="none" />
      {/* Left wing — sweeps outward and upward from staff */}
      <path d="M12 7 C9 5.5 5.5 4 2.5 4.5" />
      <path d="M2.5 4.5 C4.5 2.5 9 4 12 6" />
      {/* Right wing — sweeps outward and upward from staff */}
      <path d="M12 7 C15 5.5 18.5 4 21.5 4.5" />
      <path d="M21.5 4.5 C19.5 2.5 15 4 12 6" />
      {/* Snake 1 — wraps left → right → left */}
      <path d="M12 5.5 C8 7.5 8 10 12 11 C16 12 16 14.5 12 15.5 C8 16.5 8 19 12 20.5" />
      {/* Snake 2 — wraps right → left → right */}
      <path d="M12 5.5 C16 7.5 16 10 12 11 C8 12 8 14.5 12 15.5 C16 16.5 16 19 12 20.5" />
    </svg>
  )
}
import type { InsightCard } from '@/lib/insights/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonalityInput {
  income:       number
  spending:     number
  net:          number
  topCatPct:    number
  subCount:     number
  anomalyCount: number
}

interface Props {
  cards:        InsightCard[]
  year:         number
  month:        number
  onGenerated?: () => void
  personality?: PersonalityInput
}

// ─── Money Personality ────────────────────────────────────────────────────────

interface Personality {
  type:     string
  icon:     LucideIcon
  tagline:  string
  vibe:     string
  accent:   string
  accentBg: string
}

function getPersonality(p: PersonalityInput): Personality {
  const spendRatio = p.income > 0 ? p.spending / p.income : 1

  if (p.subCount >= 5) return {
    type: 'The Subscription Collector', icon: Layers,
    tagline: 'Your subscriptions are stacking up. A quick audit could pay off.',
    vibe: 'You love your services — just make sure they all still spark joy.',
    accent: '#818CF8', accentBg: 'rgba(129,140,248,0.10)',
  }
  if (spendRatio < 0.5 && p.net > 0) return {
    type: 'The Low-Key Saver', icon: TrendingUp,
    tagline: 'You keep more than half of what you earn. Quietly winning.',
    vibe: 'Steady hands, healthy balance. Keep it up.',
    accent: '#22C55E', accentBg: 'rgba(34,197,94,0.08)',
  }
  if (p.topCatPct > 50) return {
    type: 'The Big Ticket Player', icon: Target,
    tagline: 'One category dominates your spending this period.',
    vibe: 'Intentional move, or worth a second look — you decide.',
    accent: '#F59E0B', accentBg: 'rgba(245,158,11,0.08)',
  }
  if (p.income > 5000 && spendRatio > 0.85) return {
    type: 'The Flow Master', icon: Activity,
    tagline: 'Money moves freely — in and out. You live with confidence.',
    vibe: "You're in full flow. Just watch the current.",
    accent: '#06B6D4', accentBg: 'rgba(6,182,212,0.08)',
  }
  if (p.net > 0 && p.anomalyCount === 0 && spendRatio < 0.8) return {
    type: 'The Smooth Operator', icon: Zap,
    tagline: 'Controlled spending, zero surprises. You make it look easy.',
    vibe: 'Strong, steady, and under control.',
    accent: '#818CF8', accentBg: 'rgba(129,140,248,0.10)',
  }
  if (p.net > 0 && spendRatio < 0.9) return {
    type: 'The Smart Spender', icon: Brain,
    tagline: 'Balanced spending with room to grow.',
    vibe: "You're in a healthy financial position this month.",
    accent: '#4F46E5', accentBg: 'rgba(79,70,229,0.08)',
  }
  return {
    type: 'The Steady Builder', icon: BarChart3,
    tagline: 'Consistent, controlled, and building toward something.',
    vibe: "You're running a tight ship this month.",
    accent: '#6366F1', accentBg: 'rgba(99,102,241,0.08)',
  }
}

function PersonalityCard({ data }: { data: PersonalityInput }) {
  const p    = getPersonality(data)
  const Icon = p.icon
  // Split "The " off for typographic hierarchy
  const name = p.type.startsWith('The ') ? p.type.slice(4) : p.type

  return (
    <div style={{
      position: 'relative',
      background: `radial-gradient(ellipse at 12% 30%, ${p.accent}22 0%, transparent 60%),
                   radial-gradient(ellipse at 88% 80%, ${p.accent}10 0%, transparent 50%),
                   var(--card2, #0F1623)`,
      border: `1px solid ${p.accent}35`,
      borderRadius: 18,
      padding: '26px 24px 22px',
      marginBottom: 14,
      overflow: 'hidden',
      boxShadow: `0 8px 32px ${p.accent}18, 0 1px 0 ${p.accent}12 inset`,
    }}>

      {/* Top bar: label + "this month" chip */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.10em', color: p.accent,
        }}>
          Your Money Personality
        </span>
        <span style={{
          fontSize: 10, fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase',
          color: 'var(--text-faint, #6B7280)',
          background: 'rgba(255,255,255,0.04)',
          border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 6, padding: '3px 8px',
        }}>
          This month
        </span>
      </div>

      {/* Hero row: icon + name block */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18 }}>

        {/* Icon with layered glow */}
        <div style={{
          width: 68, height: 68, flexShrink: 0, borderRadius: 20,
          background: `radial-gradient(circle at 35% 35%, ${p.accent}28, ${p.accent}10)`,
          border: `1.5px solid ${p.accent}50`,
          boxShadow: `0 0 0 5px ${p.accent}12, 0 6px 24px ${p.accent}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={30} strokeWidth={1.5} color={p.accent} />
        </div>

        {/* Name block */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: '0 0 3px',
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.15em', color: p.accent,
          }}>
            The
          </p>
          <p style={{
            margin: 0,
            fontSize: 30, fontWeight: 800,
            letterSpacing: '-0.04em', lineHeight: 1.05,
            color: 'var(--text-primary, #e5e7eb)',
          }}>
            {name}
          </p>
        </div>
      </div>

      {/* Tagline */}
      <p style={{
        margin: '0 0 16px',
        fontSize: 13, color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.6,
      }}>
        {p.tagline}
      </p>

      {/* Divider */}
      <div style={{ height: 1, background: `${p.accent}20`, margin: '0 0 14px' }} />

      {/* Vibe */}
      <p style={{
        margin: 0,
        fontSize: 13, fontStyle: 'italic',
        color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.55,
      }}>
        &ldquo;{p.vibe}&rdquo;
      </p>
    </div>
  )
}

// ─── Icon map ─────────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Coins,
  Target,
  RefreshCw,
  TrendingUp,
  Gauge,
  Lightbulb,
}

// ─── Impact styling — informational, not alert-driven ─────────────────────────

const IMPACT_COLOR: Record<InsightCard['confidence'], string> = {
  high:   '#818CF8',   // indigo — priority, not danger
  medium: '#F59E0B',   // amber  — moderate, informational
  low:    '#64748B',   // slate  — context
}

const IMPACT_BG: Record<InsightCard['confidence'], string> = {
  high:   'rgba(129,140,248,0.10)',
  medium: 'rgba(245,158,11,0.08)',
  low:    'rgba(100,116,139,0.08)',
}

const IMPACT_ACCENT: Record<InsightCard['confidence'], string> = {
  high:   '#818CF8',
  medium: 'rgba(245,158,11,0.6)',
  low:    'rgba(100,116,139,0.3)',
}

const IMPACT_LABEL: Record<InsightCard['confidence'], string> = {
  high:   'High impact',
  medium: 'Medium impact',
  low:    'Low impact',
}

// ─── Single insight card ──────────────────────────────────────────────────────

function InsightCard({ card, prominent }: { card: InsightCard; prominent?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const IconComp: LucideIcon = ICON_MAP[card.icon_suggestion] ?? Lightbulb
  const color  = IMPACT_COLOR[card.confidence]
  const bg     = IMPACT_BG[card.confidence]
  const accent = IMPACT_ACCENT[card.confidence]

  return (
    <div style={{
      background: prominent ? `radial-gradient(ellipse at 5% 50%, ${bg}, transparent 70%), var(--card2, #0F1623)` : 'var(--card2, #0F1623)',
      border: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
      borderLeft: `3px solid ${accent}`,
      borderRadius: 14,
      overflow: 'hidden',
      transition: 'border-color 200ms ease, box-shadow 200ms ease',
      boxShadow: prominent ? `0 0 0 1px ${bg}` : 'none',
    }}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(e => !e)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: prominent ? '16px 16px 16px 14px' : '13px 16px 13px 14px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        {/* Icon */}
        <div style={{
          width: prominent ? 38 : 34, height: prominent ? 38 : 34,
          borderRadius: prominent ? 11 : 9,
          background: bg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <IconComp size={prominent ? 17 : 15} style={{ color }} />
        </div>

        {/* Title + impact tag */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: prominent ? 14 : 13,
            fontWeight: prominent ? 700 : 600,
            color: 'var(--text-primary, #e5e7eb)',
            marginBottom: 4,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {card.title}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.06em',
            color, padding: '2px 7px', borderRadius: 4,
            background: bg,
            display: 'inline-block',
          }}>
            {IMPACT_LABEL[card.confidence]}
          </span>
        </div>

        {/* Chevron */}
        <div style={{ color: 'var(--text-faint, #6B7280)', flexShrink: 0 }}>
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </div>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div style={{
          padding: '0 16px 16px 14px',
          borderTop: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
        }}>
          {/* Summary */}
          <p style={{
            fontSize: 13, color: 'var(--text-secondary, #9ca3af)',
            lineHeight: 1.6, margin: '12px 0',
          }}>
            {card.summary}
          </p>

          {/* Interpretation nudge */}
          <p style={{
            fontSize: 11, color: 'var(--text-faint, #6B7280)',
            lineHeight: 1.55, margin: '0 0 12px',
            fontStyle: 'italic',
          }}>
            This may be worth reviewing — or it could be exactly what you planned.
          </p>

          {/* Numbers */}
          {card.numbers_used.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {card.numbers_used.map(n => (
                <div key={n.field} style={{
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
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
                  padding: '6px 13px', borderRadius: 8,
                  border: action.action_key === 'dismiss'
                    ? '1px solid rgba(255,255,255,0.08)'
                    : `1px solid ${color}35`,
                  background: action.action_key === 'dismiss'
                    ? 'rgba(255,255,255,0.03)'
                    : bg,
                  color: action.action_key === 'dismiss'
                    ? 'var(--text-faint, #6B7280)'
                    : color,
                  cursor: 'pointer',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
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

export function FinancialAutopsyPanel({ cards, year, month, onGenerated, personality }: Props) {
  const [generating, setGenerating] = useState(false)
  const [genError,   setGenError]   = useState<string | null>(null)

  const insightCards = cards
    .filter(c => c.card_type.startsWith('autopsy_'))
    .sort((a, b) => a.priority - b.priority)

  async function handleGenerate() {
    setGenerating(true)
    setGenError(null)
    try {
      const res = await fetch('/api/insights/generate', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ year, month }),
      })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      onGenerated?.()
    } catch (e) {
      setGenError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div style={{ marginBottom: 8 }}>

      {/* ── Section header ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes bl-scope-pulse {
          0%, 100% { box-shadow: 0 0 5px 1px rgba(129,140,248,0.30), 0 0 12px 2px rgba(129,140,248,0.12); }
          50%       { box-shadow: 0 0 9px 3px rgba(129,140,248,0.50), 0 0 22px 5px rgba(129,140,248,0.20); }
        }
        .bl-scope-glow { animation: bl-scope-pulse 2.8s ease-in-out infinite; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <div
          className="bl-scope-glow"
          style={{
            width: 32, height: 32, borderRadius: 9,
            background: 'rgba(129,140,248,0.14)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <CaduceusIcon size={18} color="#818CF8" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary, #e5e7eb)', letterSpacing: '0.01em' }}>
            Financial Autopsy
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint, #6B7280)', marginTop: 1 }}>
            {insightCards.length === 0
              ? 'Deep-dive analysis of your spending patterns'
              : `${insightCards.length} finding${insightCards.length !== 1 ? 's' : ''} this month`
            }
          </div>
        </div>

        {/* Analyze button */}
        <button
          onClick={handleGenerate}
          disabled={generating}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            fontSize: 12, fontWeight: 700,
            padding: '6px 14px', borderRadius: 8,
            border: '1px solid rgba(129,140,248,0.3)',
            background: generating ? 'rgba(129,140,248,0.05)' : 'rgba(129,140,248,0.10)',
            color: generating ? '#6B7280' : '#a5b4fc',
            cursor: generating ? 'not-allowed' : 'pointer',
            transition: 'opacity 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={e => { if (!generating) e.currentTarget.style.opacity = '0.75' }}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          {generating
            ? <><Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> Analyzing…</>
            : insightCards.length > 0 ? 'Re-analyze' : 'Analyze'
          }
        </button>
      </div>

      {/* Error */}
      {genError && (
        <div style={{
          fontSize: 12, color: '#9ca3af',
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 8, padding: '8px 12px', marginBottom: 10,
        }}>
          {genError}
        </div>
      )}

      {/* Empty state */}
      {insightCards.length === 0 && !generating && (
        <div style={{
          background: 'var(--card2, #111827)',
          border: '1px solid var(--border-soft, rgba(255,255,255,0.06))',
          borderRadius: 12, padding: '20px 16px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-faint, #6B7280)', lineHeight: 1.6 }}>
            Click <strong style={{ color: 'var(--text-secondary, #9ca3af)' }}>Analyze</strong> to generate personalized insights for this month.
          </div>
        </div>
      )}

      {/* Insight cards */}
      {insightCards.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {insightCards.map((card, i) => (
            <InsightCard key={card.id} card={card} prominent={i === 0} />
          ))}
        </div>
      )}

      {/* ── Money Personality ──────────────────────────────────────────────── */}
      {personality && (
        <div style={{ marginTop: 16 }}>
          <PersonalityCard data={personality} />
        </div>
      )}
    </div>
  )
}
