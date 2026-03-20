'use client'

import { useState } from 'react'
import {
  Coins, Target, RefreshCw, TrendingUp, Gauge,
  ChevronDown, ChevronRight, Loader2, Lightbulb,
  Layers, Activity, Zap, Brain, BarChart3, type LucideIcon,
  Star, Shield, Shuffle, Minus, ArrowLeftRight, Crown, CreditCard,
  AlertTriangle,
} from 'lucide-react'
import type { PersonalityResult, PersonalityMeta } from '@/lib/personality/types'
import type { CorePersonalityId, PremiumPersonalityId } from '@/lib/personality/types'

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

interface Props {
  cards:        InsightCard[]
  year:         number
  month:        number
  onGenerated?: () => void
  personality?: PersonalityResult
  personalitySignals?: { income: number; spending: number; net: number; topCatName?: string }
}

// ─── Icon map by CorePersonalityId / PremiumPersonalityId ─────────────────────

type AnyPersonalityId = CorePersonalityId | PremiumPersonalityId

const PERSONALITY_ICON_MAP: Record<AnyPersonalityId, LucideIcon> = {
  full_send:              Zap,
  wire_dancer:            Activity,
  breakeven_poet:         Minus,
  adrenaline_accountant:  Gauge,
  chaos_controller:       Shuffle,
  big_ticket_player:      Target,
  subscription_collector: Layers,
  low_key_saver:          TrendingUp,
  safety_buffer:          Shield,
  smooth_operator:        Zap,
  flow_master:            Activity,
  savvy_spender:          Brain,
  steady_builder:         BarChart3,
  direct_depositor:       RefreshCw,
  cash_keeper:            Coins,
  overdraft_artist:       AlertTriangle,
  revolving_door:         RefreshCw,
  points_chaser:          Star,
  minimum_payer:          AlertTriangle,
  cashback_architect:     BarChart3,
  one_card_wonder:        CreditCard,
  utilization_king:       Gauge,
  balance_transfer:       ArrowLeftRight,
  quiet_millionaire:      Crown,
  strategic_deployer:     Target,
  compounding_machine:    TrendingUp,
}

function getPersonalityIcon(id: string): LucideIcon {
  return (PERSONALITY_ICON_MAP as Record<string, LucideIcon>)[id] ?? BarChart3
}

// ─── shareParams ──────────────────────────────────────────────────────────────

function shareParams(result: PersonalityResult, signals?: { income: number; spending: number; net: number; topCatName?: string }): string {
  const params = new URLSearchParams({
    type:   result.core.name,
    vibe:   result.core.vibe,
    income: String(signals?.income ?? 0),
    spend:  String(signals?.spending ?? 0),
    net:    String(signals?.net ?? 0),
  })
  if (result.trait) params.set('trait', result.trait.name)
  if (signals?.topCatName) params.set('topCat', signals.topCatName)
  return params.toString()
}

// ─── PersonalityCard ──────────────────────────────────────────────────────────

function PersonalityCard({ result, signals }: { result: PersonalityResult; signals?: { income: number; spending: number; net: number; topCatName?: string } }) {
  const core  = result.core
  const trait = result.trait
  const soft  = result.softTrait
  const name  = core.name.startsWith('The ') ? core.name.slice(4) : core.name

  const Icon = getPersonalityIcon(core.id as string)

  // ── Illustration card (shared by personalities with custom art) ─────────
  const ILLUSTRATION_CARDS: Partial<Record<string, { src: string; dotColor: string; btnColor: string; btnBorder: string }>> = {
    subscription_collector: {
      src: '/personalities/subscription-collector.webp',
      dotColor: '#FBBF24', btnColor: 'rgba(251,191,36,0.22)', btnBorder: 'rgba(251,191,36,0.45)',
    },
    wire_dancer: {
      src: '/personalities/wire-dancer.webp',
      dotColor: '#2DD4BF', btnColor: 'rgba(45,212,191,0.22)', btnBorder: 'rgba(45,212,191,0.45)',
    },
  }

  const illus = ILLUSTRATION_CARDS[core.id as string]
  if (illus) {
    return (
      <div style={{
        position: 'relative',
        borderRadius: 18, overflow: 'hidden',
        marginBottom: 14,
        boxShadow: '0 12px 48px rgba(0,0,0,0.45)',
        border: `1px solid ${illus.dotColor}40`,
      }}>
        {/* Illustration — natural aspect ratio */}
        <img
          src={illus.src}
          alt={core.name}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />

        {/* Thin top gradient for badge readability only */}
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 64,
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, transparent 100%)',
          pointerEvents: 'none',
        }} />

        {/* Bottom gradient for vibe + share button */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, height: 90,
          background: 'linear-gradient(to top, rgba(0,0,0,0.78) 0%, transparent 100%)',
          pointerEvents: 'none',
        }} />

        {/* Top-left badge */}
        <div style={{
          position: 'absolute', top: 14, left: 16,
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(0,0,0,0.35)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 999, padding: '4px 10px',
        }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: illus.dotColor }} />
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.85)' }}>
            Money Personality
          </span>
        </div>

        {/* Bottom: vibe saying (left) + share button (right) */}
        <div style={{
          position: 'absolute', bottom: 14, left: 16, right: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
          pointerEvents: 'none',
        }}>
          <p style={{
            margin: 0,
            fontSize: 11, fontStyle: 'italic', fontWeight: 500,
            color: 'rgba(255,255,255,0.70)',
            letterSpacing: '0.01em', lineHeight: 1.4,
            pointerEvents: 'none',
          }}>
            &ldquo;{core.vibe}&rdquo;
          </p>
          <button
            onClick={() => window.open(`/api/share/personality?${shareParams(result, signals)}`, '_blank')}
            aria-label="Share your money personality card"
            style={{
              flexShrink: 0,
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 12, fontWeight: 700, color: '#fff',
              background: illus.btnColor,
              backdropFilter: 'blur(10px)',
              border: `1px solid ${illus.btnBorder}`,
              borderRadius: 999, padding: '7px 16px',
              cursor: 'pointer', transition: 'opacity 150ms ease',
              pointerEvents: 'all',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.75')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            ↗ Share your card
          </button>
        </div>
      </div>
    )
  }

  // ── All other personalities — standard card ──────────────────────────────
  const accent   = core.accent
  const accentBg = core.accentBg
  const isCaution = core.isCaution

  // Icon background color: caution → amber, normal → core accent
  const iconBgColor = isCaution ? '#FB923C' : accent

  // Effective vibe: use trait.vibe if trait exists (more personal), else core.vibe
  const vibeText = trait ? trait.vibe : core.vibe

  // Label text: "Heads up" for caution, "Your Money Personality" otherwise
  const labelText = isCaution ? 'Heads up' : 'Your Money Personality'

  return (
    <div style={{
      position: 'relative',
      background: `radial-gradient(ellipse at 12% 30%, ${accent}22 0%, transparent 60%),
                   radial-gradient(ellipse at 88% 80%, ${accent}10 0%, transparent 50%),
                   var(--card2, #0F1623)`,
      border: `1px solid ${accent}35`,
      borderRadius: 18,
      padding: '26px 24px 22px',
      marginBottom: 14,
      overflow: 'hidden',
      boxShadow: `0 8px 32px ${accent}18, 0 1px 0 ${accent}12 inset`,
    }}>

      {/* Top bar: label + share button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
          letterSpacing: '0.10em', color: isCaution ? '#FB923C' : accent,
        }}>
          {labelText}
        </span>
        <button
          onClick={() => window.open(`/api/share/personality?${shareParams(result)}`, '_blank')}
          aria-label="Share your money personality card"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 5,
            fontSize: 11, fontWeight: 600,
            color: accent, background: accentBg,
            border: `1px solid ${accent}35`,
            borderRadius: 999, padding: '4px 12px',
            cursor: 'pointer', letterSpacing: '0.01em',
            transition: 'opacity 150ms ease',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          ↗ Share card
        </button>
      </div>

      {/* Hero row: icon + name block */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 18 }}>
        <div style={{
          width: 68, height: 68, flexShrink: 0, borderRadius: 20,
          background: isCaution
            ? 'radial-gradient(circle at 35% 35%, rgba(251,146,60,0.28), rgba(251,146,60,0.10))'
            : `radial-gradient(circle at 35% 35%, ${accent}28, ${accent}10)`,
          border: `1.5px solid ${iconBgColor}50`,
          boxShadow: `0 0 0 5px ${iconBgColor}12, 0 6px 24px ${iconBgColor}35`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={30} strokeWidth={1.5} color={iconBgColor} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            margin: '0 0 3px', fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.15em', color: accent,
          }}>The</p>
          <p style={{
            margin: 0, fontSize: 30, fontWeight: 800,
            letterSpacing: '-0.04em', lineHeight: 1.05,
            color: 'var(--text-primary, #e5e7eb)',
          }}>
            {name}
          </p>
          {/* Trait display */}
          {trait && (
            <p style={{
              margin: '4px 0 0', fontSize: 13, fontWeight: 600,
              color: trait.accent,
              lineHeight: 1.2,
            }}>
              · {trait.name}
            </p>
          )}
          {/* Soft trait display (no strong trait, faded) */}
          {!trait && soft && (
            <p style={{
              margin: '4px 0 0', fontSize: 11, fontWeight: 500,
              color: soft.accent,
              opacity: 0.45,
              lineHeight: 1.2,
            }}>
              · {soft.name}
            </p>
          )}
        </div>
      </div>

      {/* Tagline */}
      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.6 }}>
        {core.tagline}
      </p>

      {/* Divider */}
      <div style={{ height: 1, background: `${accent}20`, margin: '0 0 14px' }} />

      {/* Vibe */}
      <p style={{ margin: 0, fontSize: 13, fontStyle: 'italic', color: 'var(--text-secondary, #9ca3af)', lineHeight: 1.55 }}>
        &ldquo;{vibeText}&rdquo;
      </p>
    </div>
  )
}

// ─── Icon map for insight cards ───────────────────────────────────────────────

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

export function FinancialAutopsyPanel({ cards, year, month, onGenerated, personality, personalitySignals }: Props) {
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
    <div style={{
      background: 'linear-gradient(145deg, rgba(129,140,248,0.07) 0%, rgba(99,102,241,0.03) 100%)',
      border: '1px solid rgba(129,140,248,0.22)',
      borderRadius: 22,
      padding: '22px 20px 18px',
      boxShadow: '0 0 0 1px rgba(129,140,248,0.06), 0 20px 60px rgba(0,0,0,0.22)',
      marginBottom: 8,
    }}>

      {/* ── Section header ─────────────────────────────────────────────────── */}
      <style>{`
        @keyframes bl-scope-pulse {
          0%, 100% { box-shadow: 0 0 7px 2px rgba(129,140,248,0.38), 0 0 18px 4px rgba(129,140,248,0.14); }
          50%       { box-shadow: 0 0 14px 4px rgba(129,140,248,0.58), 0 0 32px 8px rgba(129,140,248,0.22); }
        }
        .bl-scope-glow { animation: bl-scope-pulse 2.8s ease-in-out infinite; }
      `}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <div
          className="bl-scope-glow"
          style={{
            width: 44, height: 44, borderRadius: 13,
            background: 'rgba(129,140,248,0.16)',
            border: '1px solid rgba(129,140,248,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          <CaduceusIcon size={24} color="#818CF8" />
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary, #e5e7eb)', letterSpacing: '-0.01em' }}>
            Financial Autopsy
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-faint, #6B7280)', marginTop: 2 }}>
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
            padding: '8px 16px', borderRadius: 10,
            border: '1px solid rgba(129,140,248,0.35)',
            background: generating ? 'rgba(129,140,248,0.05)' : 'rgba(129,140,248,0.14)',
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

      {/* ── Money Personality ──────────────────────────────────────────────── */}
      {personality && (
        <div style={{ marginBottom: 18 }}>
          <PersonalityCard result={personality} signals={personalitySignals} />
        </div>
      )}

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
    </div>
  )
}
