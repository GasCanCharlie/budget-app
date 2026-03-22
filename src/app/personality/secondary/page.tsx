'use client'

import { Suspense, useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { computeSignals } from '@/lib/personality/signals'
import { detectPersonality } from '@/lib/personality/detect'
import { getCategoryIcon } from '@/lib/icons'
import { ArrowLeft, Sparkles, FlaskConical, Loader2 } from 'lucide-react'
import type { PersonalityResult } from '@/lib/personality/types'

// ─── Types ────────────────────────────────────────────────────────────────────

interface CategoryTotal {
  categoryId:    string
  categoryName:  string
  categoryColor: string
  categoryIcon:  string
  masterKey:     string | null
  total:         number
  transactionCount: number
  pctOfSpending: number
  isIncome:      boolean
}

interface SummaryResponse {
  dashboardState: 'categorization_required' | 'analysis_unlocked'
  summary: {
    totalIncome:    number
    totalSpending:  number
    net:            number
    categoryTotals: CategoryTotal[]
    alerts:         { id?: string; type: string; message: string }[]
  } | null
}

// ─── Intensity label ──────────────────────────────────────────────────────────

function getIntensity(pct: number): { label: string; color: string } {
  if (pct >= 25) return { label: 'HIGH',     color: '#f97316' }
  if (pct >= 10) return { label: 'MODERATE', color: '#f59e0b' }
  return              { label: 'LOW',      color: '#6b7280' }
}

// ─── Trait image registry — add entries as art arrives ───────────────────────

const PERSONALITY_IMAGES: Partial<Record<string, { src: string; dotColor: string }>> = {
  glowing_broke:        { src: '/personalities/glowing-broke.webp',        dotColor: '#c026d3' },
  currency_combustion:  { src: '/personalities/currency-combustion.webp',  dotColor: '#EF4444' },
  balance_transfer:     { src: '/personalities/balance_transfer.webp',     dotColor: '#FBBF24' },
  utilization_king:     { src: '/personalities/utilization_king.webp',     dotColor: '#FB923C' },
  cashback_architect:   { src: '/personalities/cashback_architect.webp',   dotColor: '#818CF8' },
  minimum_payer:        { src: '/personalities/minimum_payer.webp',        dotColor: '#FB923C' },
  points_chaser:        { src: '/personalities/points_chaser.webp',        dotColor: '#FBBF24' },
  revolving_door:       { src: '/personalities/revolving_door.webp',       dotColor: '#F87171' },
  direct_depositor:     { src: '/personalities/direct_depositor.webp',     dotColor: '#34D399' },
  cash_keeper:          { src: '/personalities/cash_keeper.webp',          dotColor: '#FBBF24' },
  flow_master:          { src: '/personalities/flow_master.webp',          dotColor: '#2DD4BF' },
  breakeven_poet:       { src: '/personalities/breakeven_poet.webp',       dotColor: '#A78BFA' },
  overdraft_artist:     { src: '/personalities/overdraft_artist.webp',     dotColor: '#F97316' },
  quiet_millionaire:    { src: '/personalities/quiet_millionaire.webp',    dotColor: '#D97706' },
  savvy_spender:        { src: '/personalities/savvy_spender.webp',        dotColor: '#22C55E' },
  low_key_saver:        { src: '/personalities/low_key_saver.webp',        dotColor: '#60A5FA' },
  big_ticket_player:    { src: '/personalities/big_ticket_player.webp',    dotColor: '#F59E0B' },
  safety_buffer:        { src: '/personalities/safety_buffer.webp',        dotColor: '#34D399' },
  wire_dancer:          { src: '/personalities/wire-dancer.webp',          dotColor: '#2DD4BF' },
  full_send:            { src: '/personalities/full-send.webp',            dotColor: '#F97316' },
  subscription_collector: { src: '/personalities/subscription-collector.webp', dotColor: '#818CF8' },
}

// ─── Card — renders real image when available, placeholder otherwise ──────────

function SecondaryPersonalityPlaceholder({
  traitId,
  traitName,
  traitAccent,
  tagline,
}: {
  traitId?:     string
  traitName:    string
  traitAccent:  string
  tagline:      string
}) {
  const art = traitId ? PERSONALITY_IMAGES[traitId] : undefined

  // ── Illustration variant ─────────────────────────────────────────────────
  if (art) {
    return (
      <div style={{
        marginBottom: 24,
        padding: 16,
        borderRadius: 16,
        background: 'rgba(12, 15, 28, 0.95)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.50)',
      }}>
        {/* Image card */}
        <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
          <img
            src={art.src}
            alt={traitName}
            style={{ width: '100%', aspectRatio: '16/9', objectFit: 'cover', display: 'block' }}
          />

        </div>
      </div>
    )
  }

  // ── Placeholder variant (no image yet) ───────────────────────────────────
  return (
    <div style={{
      position: 'relative',
      borderRadius: 18, overflow: 'hidden',
      marginBottom: 24,
      padding: '36px 24px 32px',
      background: `
        radial-gradient(ellipse at 20% 35%, ${traitAccent}1a 0%, transparent 55%),
        radial-gradient(ellipse at 80% 75%, ${traitAccent}0e 0%, transparent 50%),
        rgba(13, 18, 30, 0.97)
      `,
      border: `1px solid ${traitAccent}30`,
      boxShadow: `0 8px 40px ${traitAccent}18`,
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      textAlign: 'center', gap: 12,
    }}>
      <div style={{
        width: 68, height: 68, borderRadius: 20, flexShrink: 0,
        background: `radial-gradient(circle at 35% 35%, ${traitAccent}28, ${traitAccent}10)`,
        border: `1.5px solid ${traitAccent}50`,
        boxShadow: `0 0 0 6px ${traitAccent}10, 0 6px 28px ${traitAccent}30`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Sparkles size={30} strokeWidth={1.5} color={traitAccent} />
      </div>
      <p style={{ margin: 0, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: traitAccent }}>
        Spending Personality
      </p>
      <p style={{ margin: 0, fontSize: 30, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.05, color: '#f2f5ff' }}>
        {traitName}
      </p>
      <p style={{ margin: 0, fontSize: 13, fontStyle: 'italic', color: 'rgba(255,255,255,0.55)', lineHeight: 1.55, maxWidth: 260 }}>
        &ldquo;{tagline}&rdquo;
      </p>
      <p style={{
        position: 'absolute', bottom: 8, right: 12, margin: 0,
        fontSize: 9, color: 'rgba(255,255,255,0.18)', fontStyle: 'italic', letterSpacing: '0.04em',
      }}>
        image coming soon
      </p>
    </div>
  )
}

// ─── Page inner ───────────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const EXCLUDED_MASTERS = new Set(['HOME', 'FINANCIAL'])

function SecondaryPersonalityInner() {
  const router       = useRouter()
  const user         = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const searchParams = useSearchParams()

  const now   = new Date()
  const year  = parseInt(searchParams.get('year')  ?? String(now.getFullYear()))
  const month = parseInt(searchParams.get('month') ?? String(now.getMonth() + 1))

  useEffect(() => {
    if (!user) router.replace('/login')
  }, [user, router])

  const { data, isLoading } = useQuery<SummaryResponse>({
    queryKey: ['summary', year, month],
    queryFn:  () => apiFetch(`/api/summaries/${year}/${month}`),
    enabled:  !!user,
    staleTime: 5 * 60_000,
  })

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading || !data) {
    return (
      <AppShell>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 10 }}>
          <Loader2 size={20} className="animate-spin" style={{ color: '#6c7cff' }} />
          <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)' }}>Loading…</span>
        </div>
      </AppShell>
    )
  }

  // ── Not unlocked ───────────────────────────────────────────────────────────

  if (data.dashboardState !== 'analysis_unlocked' || !data.summary) {
    return (
      <AppShell>
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <p style={{ color: 'rgba(255,255,255,0.45)', fontSize: 14, marginBottom: 12 }}>
            Complete categorization to unlock your spending personality.
          </p>
          <Link href="/categorize" style={{ color: '#6c7cff', fontSize: 13, textDecoration: 'none' }}>
            Go to Categorize →
          </Link>
        </div>
      </AppShell>
    )
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  const summary            = data.summary
  const spendingCategories = summary.categoryTotals.filter(c => !c.isIncome)

  const personalityResult: PersonalityResult = detectPersonality(computeSignals({
    income:        summary.totalIncome,
    spending:      summary.totalSpending,
    net:           summary.net,
    categories:    spendingCategories.map(c => ({
      name:          c.categoryName,
      pctOfSpending: c.pctOfSpending,
      masterKey:     c.masterKey ?? null,
    })),
    subCount:      0,
    anomalyCount:  summary.alerts?.length ?? 0,
    statementType: 'unknown',
  }))

  const trait  = personalityResult.trait
  const core   = personalityResult.core
  const accent = trait?.accent ?? core.accent

  // Top discretionary category (same logic as signals.ts)
  const topDiscretionary = spendingCategories.find(c =>
    c.masterKey && !EXCLUDED_MASTERS.has(c.masterKey)
  )

  const monthLabel = `${MONTH_NAMES[(month - 1) % 12]} ${year}`

  return (
    <AppShell>
      <div style={{ paddingBottom: 48 }}>

        {/* Back nav */}
        <div style={{ marginBottom: 22 }}>
          <Link
            href="/dashboard"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 13, color: 'rgba(255,255,255,0.40)',
              textDecoration: 'none',
            }}
          >
            <ArrowLeft size={14} />
            Dashboard
          </Link>
        </div>

        {/* ── Header ────────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 22 }}>

          {/* Eyebrow */}
          <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.50)' }}>
            {monthLabel} &bull; Behavior Report
          </p>

          {/* Section title + CTA aligned on same baseline */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <h1 style={{ margin: 0, fontSize: 19, fontWeight: 600, letterSpacing: '-0.01em', lineHeight: 1.2, color: '#f2f5ff' }}>
              Your Spending Personality
            </h1>
            <Link
              href="/insights"
              style={{
                flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 13, fontWeight: 700, color: '#fff',
                background: `linear-gradient(135deg, ${accent}cc, ${accent}88)`,
                border: `1px solid ${accent}55`,
                borderRadius: 999, padding: '10px 16px',
                textDecoration: 'none', whiteSpace: 'nowrap',
                boxShadow: `0 2px 12px ${accent}28`,
              }}
            >
              <FlaskConical size={13} strokeWidth={2} />
              Run Financial Autopsy
            </Link>
          </div>

          {/* Category chip — 6px below section title */}
          {topDiscretionary && (() => {
            const CatIcon  = getCategoryIcon(topDiscretionary.categoryName)
            const catColor = topDiscretionary.categoryColor
            return (
              <div style={{ marginTop: 6 }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 5,
                  fontSize: 13, fontWeight: 600, color: catColor,
                  background: `${catColor}18`,
                  border: `1px solid ${catColor}35`,
                  borderRadius: 999, padding: '5px 12px',
                  boxShadow: `0 0 14px ${catColor}22`,
                }}>
                  <CatIcon size={12} strokeWidth={2} color={catColor} />
                  {topDiscretionary.categoryName} Dominant
                </span>
              </div>
            )
          })()}

        </div>

        {/* ── Personality card ──────────────────────────────────────────────── */}
        <SecondaryPersonalityPlaceholder
          traitId={trait ? String(trait.id) : String(core.id)}
          traitName={trait ? trait.name : core.name}
          traitAccent={accent}
          tagline={trait ? trait.tagline : core.tagline}
        />

        {/* ── Behavior Breakdown ────────────────────────────────────────────── */}
        <div style={{ marginBottom: 24 }}>
          <p style={{ margin: '0 0 12px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: 'rgba(255,255,255,0.30)' }}>
            What&rsquo;s Driving This
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            {spendingCategories.slice(0, 6).map((cat) => {
              const intensity    = getIntensity(cat.pctOfSpending)
              const CatIcon      = getCategoryIcon(cat.categoryName)
              const isTopDisc    = topDiscretionary?.categoryId === cat.categoryId

              return (
                <div
                  key={cat.categoryId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px',
                    borderRadius: 12,
                    background: isTopDisc ? `${accent}0e` : 'rgba(255,255,255,0.025)',
                    border: isTopDisc
                      ? `1px solid ${accent}28`
                      : '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  {/* Category icon */}
                  <div style={{
                    width: 34, height: 34, borderRadius: 9, flexShrink: 0,
                    background: `${cat.categoryColor}16`,
                    border: `1px solid ${cat.categoryColor}28`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <CatIcon size={15} color={cat.categoryColor} strokeWidth={1.8} />
                  </div>

                  {/* Name + pct */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#e5e7eb', lineHeight: 1.2 }}>
                      {cat.categoryName}
                    </p>
                    <p style={{ margin: '1px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.30)', lineHeight: 1 }}>
                      {Math.round(cat.pctOfSpending)}% of spending
                    </p>
                  </div>

                  {/* Intensity + amount */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 9, fontWeight: 800, letterSpacing: '0.10em',
                      color: intensity.color, textTransform: 'uppercase',
                    }}>
                      {intensity.label}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.50)' }}>
                      ${cat.total.toFixed(0)}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Pattern Explanation ───────────────────────────────────────────── */}
        <div style={{
          marginBottom: 32,
          padding: '16px 18px',
          borderRadius: 14,
          background: `${accent}09`,
          border: `1px solid ${accent}1e`,
        }}>
          <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.12em', color: accent }}>
            The Pattern
          </p>
          <p style={{ margin: 0, fontSize: 13, color: 'rgba(255,255,255,0.60)', lineHeight: 1.7 }}>
            {trait
              ? `${core.name.startsWith('The ') ? core.name : `The ${core.name}`} + ${trait.name}: ${trait.tagline} ${core.tagline}`
              : core.tagline
            }
          </p>
        </div>

        {/* ── Financial Autopsy CTA ─────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <Link
            href="/insights"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '15px 24px',
              borderRadius: 14,
              background: `linear-gradient(135deg, ${accent}dd, ${accent}99)`,
              border: `1px solid ${accent}55`,
              boxShadow: `0 4px 24px ${accent}28`,
              fontSize: 15, fontWeight: 700, color: '#fff',
              textDecoration: 'none', letterSpacing: '0.01em',
            }}
          >
            <FlaskConical size={16} strokeWidth={1.8} />
            Run Financial Autopsy
          </Link>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.30)', textAlign: 'center', lineHeight: 1.5 }}>
            See exactly where your money is going and how to fix it.
          </p>
        </div>

      </div>
    </AppShell>
  )
}

// ─── Page export ──────────────────────────────────────────────────────────────

export default function SecondaryPersonalityPage() {
  return (
    <Suspense>
      <SecondaryPersonalityInner />
    </Suspense>
  )
}
