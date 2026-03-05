'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useApi } from '@/hooks/useApi'
import { useAuthStore } from '@/store/auth'
import { Sparkles, RefreshCw, ChevronDown, ChevronUp, Lock, Lightbulb } from 'lucide-react'
import { InsightCard, InsightCardSkeleton } from './InsightCard'
import type { InsightCard as InsightCardData } from '@/lib/insights/types'
import { TrialWarningBanner } from './TrialWarningBanner'
import { useRouter } from 'next/navigation'

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiInsightsPanelProps {
  year: number
  month: number
}

interface InsightsResponse {
  cards: InsightCardData[]
  generatedAt: string
  isStale: boolean
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

const COLLAPSED_STORAGE_KEY = 'budgetlens:insights-collapsed'
const DEFAULT_VISIBLE = 4
const MAX_ROTATIONS = 4

function rotateArray<T>(arr: T[], by: number): T[] {
  if (arr.length === 0) return arr
  const offset = by % arr.length
  return [...arr.slice(offset), ...arr.slice(0, offset)]
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AiInsightsPanel({ year, month }: AiInsightsPanelProps) {
  const { apiFetch } = useApi()
  const token = useAuthStore(s => s.token)
  const queryClient = useQueryClient()
  const router = useRouter()

  // ── Collapse state (persisted) ─────────────────────────────────────────────
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
    } catch {
      return false
    }
  })

  function toggleCollapse() {
    setIsCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, String(next))
      } catch {
        // ignore
      }
      return next
    })
  }

  // ── Show-all state ─────────────────────────────────────────────────────────
  const [showAll, setShowAll] = useState(false)

  // ── Rotation state (cycles 0–3 on each Refresh) ────────────────────────────
  const [rotation, setRotation] = useState(0)

  // ── Trial banner dismissed state ───────────────────────────────────────────
  const [trialBannerDismissed, setTrialBannerDismissed] = useState(false)

  // Reset showAll, rotation, and banner dismissed when month/year changes
  useEffect(() => {
    setShowAll(false)
    setRotation(0)
    setTrialBannerDismissed(false)
  }, [year, month])

  // ── Fetch insights ─────────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isError,
    isStale: queryIsStale,
    refetch,
  } = useQuery<InsightsResponse>({
    queryKey: ['insights', year, month],
    queryFn: () => apiFetch(`/api/insights?year=${year}&month=${month}`),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  // ── Auto-refresh on stale ──────────────────────────────────────────────────
  const generateMutation = useMutation({
    mutationFn: () =>
      apiFetch('/api/insights/generate', {
        method: 'POST',
        body: JSON.stringify({ year, month }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights', year, month] })
    },
  })

  useEffect(() => {
    if (data?.isStale && !generateMutation.isPending) {
      generateMutation.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.isStale])

  // Auto-generate if 404 (no insights yet)
  useEffect(() => {
    if (isError && !generateMutation.isPending && !generateMutation.isSuccess) {
      generateMutation.mutate()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError])

  // ── Dismiss ────────────────────────────────────────────────────────────────
  const dismissMutation = useMutation({
    mutationFn: (cardId: string) =>
      apiFetch(`/api/insights/${cardId}/dismiss`, { method: 'PATCH' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insights', year, month] })
    },
  })

  // ── Action handler ─────────────────────────────────────────────────────────
  function handleAction(cardId: string, actionKey: string, href?: string) {
    if (actionKey === 'dismiss') {
      dismissMutation.mutate(cardId)
      return
    }
    if (href) {
      router.push(href)
    }
  }

  // ── Manual refresh — advance rotation then regenerate ─────────────────────
  function handleRefresh() {
    setRotation(r => (r + 1) % MAX_ROTATIONS)
    setShowAll(false)
    generateMutation.mutate()
  }

  // ── Derived state ──────────────────────────────────────────────────────────
  const cards = data?.cards ?? []
  // Rotate which cards surface first; step = ~¼ of total cards (min 1)
  const rotationStep = Math.max(1, Math.floor(cards.length / MAX_ROTATIONS))
  const rotatedCards = rotateArray(cards, rotation * rotationStep)
  const visibleCards = showAll ? rotatedCards : rotatedCards.slice(0, DEFAULT_VISIBLE)
  const hiddenCount = rotatedCards.length - DEFAULT_VISIBLE
  const isRefreshing = generateMutation.isPending || (isLoading && !data)
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  // Extract trial warning cards for the banner
  const trialCards = cards.filter(c => c.card_type === 'trial_warning')
  const trialBannerItems = trialCards.map(c => {
    const sd = c.supporting_data as { merchant?: string; trial_amount?: number }
    return {
      merchant: sd.merchant ?? '',
      amount: sd.trial_amount !== undefined ? `$${sd.trial_amount.toFixed(2)}` : '',
    }
  }).filter(t => t.merchant !== '')
  const showTrialBanner = trialBannerItems.length > 0 && !trialBannerDismissed

  // ── Panel container style ──────────────────────────────────────────────────
  const panelStyle: React.CSSProperties = {
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 20,
    padding: 20,
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={panelStyle}>
      {/* ── Header ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: isCollapsed ? 0 : 4,
        }}
      >
        {/* Left: icon + title + subtitle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
            <Sparkles size={15} style={{ color: '#6ea8ff' }} />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#eaf0ff', lineHeight: 1.2 }}>
              Insights
            </div>
            <div style={{ fontSize: 11, color: '#8b97c3', lineHeight: 1.2 }}>
              {monthLabel} · structured data only
            </div>
          </div>
        </div>

        {/* Right: refresh + collapse */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={handleRefresh}
            disabled={generateMutation.isPending}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: 8,
              padding: '5px 10px',
              fontSize: 11,
              color: '#8b97c3',
              cursor: generateMutation.isPending ? 'not-allowed' : 'pointer',
              opacity: generateMutation.isPending ? 0.5 : 1,
              transition: 'all 0.15s',
            }}
          >
            <RefreshCw
              size={12}
              style={{
                color: '#8b97c3',
                animation: generateMutation.isPending ? 'spin 1s linear infinite' : undefined,
              }}
            />
            Refresh
          </button>

          <button
            onClick={toggleCollapse}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8b97c3',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title={isCollapsed ? 'Expand' : 'Collapse'}
          >
            {isCollapsed
              ? <ChevronDown size={16} />
              : <ChevronUp size={16} />
            }
          </button>
        </div>
      </div>

      {/* Subheader: insight count + rotation indicator */}
      {!isCollapsed && !isRefreshing && cards.length > 0 && (
        <p style={{ fontSize: 11, color: '#8b97c3', margin: '4px 0 12px' }}>
          Powered by your transaction data · {cards.length} insight{cards.length !== 1 ? 's' : ''}
          {cards.length > DEFAULT_VISIBLE && (
            <span style={{ marginLeft: 6, opacity: 0.6 }}>· view {rotation + 1}/{MAX_ROTATIONS}</span>
          )}
        </p>
      )}

      {/* ── Body (hidden when collapsed) ── */}
      {!isCollapsed && (
        <>
          {/* Loading skeletons */}
          {isRefreshing && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(1, 1fr)',
                gap: 12,
                marginTop: 12,
              }}
              className="md:grid-cols-2 lg:grid-cols-3"
            >
              <InsightCardSkeleton />
              <InsightCardSkeleton />
              <InsightCardSkeleton />
            </div>
          )}

          {/* Error state */}
          {isError && !isRefreshing && !generateMutation.isPending && (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 0',
                color: '#8b97c3',
              }}
            >
              <p style={{ fontSize: 13, marginBottom: 8 }}>Could not load insights.</p>
              <button
                onClick={() => refetch()}
                style={{
                  background: 'rgba(110,168,255,0.12)',
                  border: '1px solid rgba(110,168,255,0.25)',
                  color: '#6ea8ff',
                  fontSize: 12,
                  borderRadius: 8,
                  padding: '6px 14px',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Cards grid */}
          {!isRefreshing && rotatedCards.length > 0 && (
            <>
              {/* Trial warning banner */}
              {showTrialBanner && (
                <TrialWarningBanner
                  trials={trialBannerItems}
                  onDismiss={() => setTrialBannerDismissed(true)}
                />
              )}

              <div
                style={{
                  display: 'grid',
                  gap: 12,
                  marginTop: 4,
                }}
                className="grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
              >
                {visibleCards.map(card => (
                  <InsightCard
                    key={card.id}
                    card={card}
                    onDismiss={(id) => dismissMutation.mutate(id)}
                    onAction={handleAction}
                  />
                ))}
              </div>

              {/* Show more / show less */}
              {rotatedCards.length > DEFAULT_VISIBLE && (
                <div style={{ textAlign: 'center', marginTop: 12 }}>
                  <button
                    onClick={() => setShowAll(prev => !prev)}
                    style={{
                      background: 'transparent',
                      border: '1px solid rgba(255,255,255,0.08)',
                      color: '#8b97c3',
                      fontSize: 12,
                      borderRadius: 8,
                      padding: '6px 16px',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      transition: 'color 0.15s',
                    }}
                  >
                    {showAll
                      ? <>Show fewer <ChevronUp size={12} /></>
                      : <>Show {hiddenCount} more <ChevronDown size={12} /></>
                    }
                  </button>
                </div>
              )}
            </>
          )}

          {/* Empty state — no cards */}
          {!isRefreshing && !isError && cards.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Lightbulb size={24} style={{ color: '#8b97c3', margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, color: '#8b97c3', marginBottom: 8 }}>
                No insights yet for this month.
              </p>
              <button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                style={{
                  background: 'rgba(110,168,255,0.12)',
                  border: '1px solid rgba(110,168,255,0.25)',
                  color: '#6ea8ff',
                  fontSize: 12,
                  borderRadius: 8,
                  padding: '6px 14px',
                  cursor: generateMutation.isPending ? 'not-allowed' : 'pointer',
                  opacity: generateMutation.isPending ? 0.5 : 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <RefreshCw size={11} style={{ animation: generateMutation.isPending ? 'spin 1s linear infinite' : undefined }} />
                Generate insights
              </button>
              {generateMutation.isError && (
                <p style={{ fontSize: 11, color: '#f87171', marginTop: 8 }}>
                  Generation failed — check that this month has categorized transactions.
                </p>
              )}
            </div>
          )}

          {/* Not-ready state: shown when categorization_required */}
          {!isRefreshing && !isError && cards.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '24px 0 0',
                display: 'none', // conditionally shown via parent dashboardState
              }}
            >
              <Lock size={18} style={{ color: '#8b97c3', margin: '0 auto 8px' }} />
              <p style={{ fontSize: 13, color: '#8b97c3' }}>
                Finish categorizing this month to generate AI insights.
              </p>
              <a
                href="/categorize"
                style={{ fontSize: 11, color: '#6ea8ff', textDecoration: 'none', marginTop: 4, display: 'inline-block' }}
              >
                Go to Categorize →
              </a>
            </div>
          )}
        </>
      )}

      {/* Spin animation */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .grid-cols-1 { grid-template-columns: repeat(1, 1fr); }
        @media (min-width: 768px) { .md\\:grid-cols-2 { grid-template-columns: repeat(2, 1fr); } }
        @media (min-width: 1024px) { .lg\\:grid-cols-3 { grid-template-columns: repeat(3, 1fr); } }
      `}</style>
    </div>
  )
}
