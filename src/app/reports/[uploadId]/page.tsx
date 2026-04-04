'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Microscope, Brain, Sparkles } from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DuplicateItem {
  merchant: string
  amount: number
  dates: string[]
}

interface AnomalyItem {
  message: string
  type: string
}

interface SubscriptionItem {
  merchant: string
  amount: number
  confidence: string
}

interface TopMerchant {
  merchant: string
  total: number
  count: number
}

interface CategoryBreakdownItem {
  category: string
  total: number
  pct: number
}

interface ScanReport {
  uploadId: string
  generatedAt: string
  summary: string
  totals: {
    income: number
    spending: number
    net: number
    transactionCount: number
  }
  findings: {
    duplicates: { count: number; items: DuplicateItem[] }
    anomalies: { count: number; items: AnomalyItem[] }
    subscriptions: { count: number; monthlyTotal: number; items: SubscriptionItem[] }
    topMerchants: TopMerchant[]
    categoryBreakdown: CategoryBreakdownItem[]
    balanceIssues: number
    ingestionIssues: { high: number; medium: number; low: number }
  }
}

interface UnlockStatus {
  total: number
  categorized: number
  uncategorized: number
  unlocked: boolean
}

interface AutopsyCard {
  id: string
  card_type: string
  priority: number
  title: string
  summary: string
  supporting_data: Record<string, unknown>
  confidence: 'high' | 'medium' | 'low'
  icon_suggestion: string
  numbers_used: { label: string; value: string; field: string }[]
}

interface AutopsyState {
  status: 'pending' | 'generating' | 'ready' | 'failed'
  progress: number
  thresholdMet: boolean
  cards: AutopsyCard[]
  generatedAt: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '60vh', gap: 14 }}>
      <div style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        border: '3px solid var(--border)',
        borderTopColor: 'var(--accent)',
        animation: 'spin 0.9s linear infinite',
      }} />
      <p style={{ color: 'var(--muted)', fontSize: 14 }}>Generating report…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

function StatCard({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  const tint = color === 'var(--success)' ? 'rgba(52,211,153,0.07)'
    : color === 'var(--danger)' ? 'rgba(248,113,113,0.07)'
    : 'rgba(255,255,255,0.03)'
  const borderTint = color === 'var(--success)' ? 'rgba(52,211,153,0.18)'
    : color === 'var(--danger)' ? 'rgba(248,113,113,0.18)'
    : 'rgba(255,255,255,0.07)'
  return (
    <div style={{
      background: tint,
      border: `1px solid ${borderTint}`,
      borderRadius: 20,
      padding: '20px 22px',
    }}>
      <p style={{ margin: 0, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.38)' }}>
        {label}
      </p>
      <p style={{ margin: '10px 0 0', fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: color ?? 'rgba(255,255,255,0.88)' }}>
        {value}
      </p>
      {sub && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(255,255,255,0.3)' }}>{sub}</p>}
    </div>
  )
}

function LockIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
}

function LockedFeatureCard({ icon, iconColor, iconBg, title, description, bullets }: { icon: React.ReactNode; iconColor: string; iconBg: string; title: string; description: string; bullets: string[] }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.09)',
      borderRadius: 24,
      padding: '22px 22px 20px',
      flex: 1,
      minWidth: 0,
      position: 'relative',
      backdropFilter: 'blur(12px)',
    }}>
      {/* locked badge */}
      <div style={{
        position: 'absolute', top: 14, right: 14,
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '3px 9px', borderRadius: 999,
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.1)',
        color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.08em', textTransform: 'uppercase',
      }}>
        <LockIcon size={9} />
        Locked
      </div>

      <div style={{ width: 44, height: 44, borderRadius: 14, background: iconBg, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14, color: iconColor }}>
        {icon}
      </div>
      <p style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.92)', letterSpacing: '-0.02em' }}>{title}</p>
      <p style={{ margin: '6px 0 16px', fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.6 }}>{description}</p>

      <div style={{
        borderRadius: 14,
        border: '1px dashed rgba(255,255,255,0.12)',
        background: 'rgba(0,0,0,0.2)',
        padding: '12px 14px',
      }}>
        <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.16em', color: 'rgba(255,255,255,0.3)' }}>
          Included when unlocked
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {bullets.map((b, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(148,196,255,0.7)', flexShrink: 0 }} />
              {b}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── AutopsyPanel ─────────────────────────────────────────────────────────────

const CONFIDENCE_COLOR: Record<string, string> = {
  high:   '#34d399',
  medium: '#fbbf24',
  low:    '#94a3b8',
}

function AutopsyPanel({ autopsy, uploadId }: { autopsy: AutopsyState | null; uploadId: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const headerBadge = (label: string, color: string, bg: string) => (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      padding: '3px 8px', borderRadius: 999,
      background: bg, border: `1px solid ${color}40`,
      color, fontSize: 10, fontWeight: 700,
      letterSpacing: '0.05em', textTransform: 'uppercase',
    }}>
      {label}
    </div>
  )

  // ── Loading (null = not fetched yet) ──────────────────────────────────────
  if (!autopsy) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center',
        justifyContent: 'center', minHeight: 180,
      }}>
        <div style={{
          width: 22, height: 22, borderRadius: '50%',
          border: '2px solid var(--border)', borderTopColor: 'var(--accent)',
          animation: 'spin 0.9s linear infinite',
        }} />
      </div>
    )
  }

  // ── Generating (in-progress) ───────────────────────────────────────────────
  if (autopsy.status === 'generating') {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid rgba(99,102,241,0.3)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(99,102,241,0.06), transparent)',
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            FINANCIAL AUTOPSY
          </p>
          {headerBadge('Generating…', '#818cf8', 'rgba(129,140,248,0.12)')}
        </div>
        <div style={{ padding: '28px 20px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: '50%',
            border: '3px solid var(--border)', borderTopColor: '#818cf8',
            animation: 'spin 0.9s linear infinite',
          }} />
          <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', textAlign: 'center' }}>
            Analyzing your spending patterns…
          </p>
          <p style={{ margin: 0, fontSize: 11, color: 'var(--subtle)', textAlign: 'center' }}>
            This takes a few seconds. The page will update automatically.
          </p>
        </div>
      </div>
    )
  }

  // ── Ready with cards ───────────────────────────────────────────────────────
  if (autopsy.status === 'ready' && autopsy.cards.length > 0) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid rgba(99,102,241,0.25)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(99,102,241,0.06), transparent)',
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            FINANCIAL AUTOPSY
          </p>
          {headerBadge('Ready', '#34d399', 'rgba(34,197,94,0.10)')}
        </div>
        <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {autopsy.cards.map(card => (
            <div key={card.id} style={{
              borderRadius: 12, background: 'var(--card2)',
              border: '1px solid var(--border)', overflow: 'hidden',
            }}>
              <button
                onClick={() => toggle(card.id)}
                style={{
                  width: '100%', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
                  padding: '13px 16px', background: 'none', border: 'none',
                  cursor: 'pointer', textAlign: 'left', gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.4 }}>
                    {card.title}
                  </p>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                    {card.summary}
                  </p>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 999,
                    background: `${CONFIDENCE_COLOR[card.confidence]}18`,
                    color: CONFIDENCE_COLOR[card.confidence],
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                  }}>
                    {card.confidence}
                  </span>
                  <span style={{ fontSize: 16, color: 'var(--muted)' }}>
                    {expanded.has(card.id) ? '▲' : '▼'}
                  </span>
                </div>
              </button>

              {expanded.has(card.id) && card.numbers_used.length > 0 && (
                <div style={{
                  borderTop: '1px solid var(--border)',
                  padding: '10px 16px 14px',
                  display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 8,
                }}>
                  {card.numbers_used.map((n, i) => (
                    <div key={i} style={{
                      padding: '8px 12px', borderRadius: 8,
                      background: 'var(--card)', border: '1px solid var(--border)',
                    }}>
                      <p style={{ margin: 0, fontSize: 10, color: 'var(--subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        {n.label}
                      </p>
                      <p style={{ margin: '3px 0 0', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                        {n.value}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Ready but nothing triggered (all below thresholds) ────────────────────
  if (autopsy.status === 'ready' && autopsy.cards.length === 0) {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 18px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
        }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
            FINANCIAL AUTOPSY
          </p>
          {headerBadge('Complete', '#34d399', 'rgba(34,197,94,0.10)')}
        </div>
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <p style={{ margin: 0, fontSize: 22 }}>✓</p>
          <p style={{ margin: '8px 0 4px', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
            No significant patterns found
          </p>
          <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>
            Your spending looks balanced — no anomalies, spikes, or concentration issues to flag.
          </p>
        </div>
      </div>
    )
  }

  // ── Failed ─────────────────────────────────────────────────────────────────
  if (autopsy.status === 'failed') {
    return (
      <div style={{
        background: 'var(--card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
      }}>
        <div style={{ padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>FINANCIAL AUTOPSY</p>
        </div>
        <div style={{ padding: '24px 20px', textAlign: 'center' }}>
          <p style={{ margin: '0 0 4px', fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>Analysis failed</p>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--muted)' }}>
            Something went wrong generating your autopsy. It will retry automatically next time.
          </p>
          <a href={`/categorize/${uploadId}`}
            style={{ fontSize: 12, color: 'var(--accent)', textDecoration: 'underline' }}>
            Continue categorizing →
          </a>
        </div>
      </div>
    )
  }

  // ── Pending / threshold not met ────────────────────────────────────────────
  return (
    <div style={{
      background: 'var(--card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)',
      overflow: 'hidden', position: 'relative',
    }}>
      <div style={{
        padding: '12px 18px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
      }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
          FINANCIAL AUTOPSY
        </p>
        {headerBadge('Auto-generates after categorize', 'var(--accent)', 'var(--accent-muted)')}
      </div>

      {/* blurred preview rows */}
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { label: 'Biggest category', value: 'Housing · 42%', color: '#818cf8' },
          { label: 'Hidden subscriptions', value: '$67/mo found', color: '#fb923c' },
          { label: 'Daily coffee spend', value: '$4.20/day avg', color: '#fbbf24' },
          { label: 'Savings rate', value: '23% of income', color: '#34d399' },
        ].map((row, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '10px 14px', borderRadius: 10,
            background: 'var(--card2)', border: '1px solid var(--border)',
            filter: 'blur(3.5px)', userSelect: 'none', pointerEvents: 'none',
          }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{row.label}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: row.color }}>{row.value}</span>
          </div>
        ))}
      </div>

      {/* overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(0,0,0,0.08)',
      }}>
        <div style={{
          background: 'rgba(15,15,25,0.88)',
          border: '1px solid rgba(99,102,241,0.35)',
          borderRadius: 16, padding: '20px 28px', textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          backdropFilter: 'blur(12px)', maxWidth: 260,
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔬</div>
          <p style={{ margin: '0 0 4px', fontSize: 14, fontWeight: 700, color: '#fff' }}>
            Auto-generates after categorizing
          </p>
          <p style={{ margin: '0 0 16px', fontSize: 12, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>
            Categorize {Math.round((1 - autopsy.progress) * 100)}% more transactions to unlock.
          </p>
          <a
            href={`/categorize/${uploadId}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '9px 18px', borderRadius: 999,
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              color: '#fff', fontSize: 13, fontWeight: 700,
              textDecoration: 'none', boxShadow: '0 4px 16px rgba(99,102,241,0.5)',
            }}
          >
            Start categorizing →
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ScanReportPage() {
  const params = useParams()
  const router = useRouter()
  const uploadId = params?.uploadId as string
  const token = useAuthStore(s => s.token)
  const user = useAuthStore(s => s.user)

  const [report, setReport] = useState<ScanReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [errorStatus, setErrorStatus] = useState<number | null>(null)
  const [showAllMerchants, setShowAllMerchants] = useState(false)
  const [unlockStatus, setUnlockStatus] = useState<UnlockStatus | null>(null)
  const [autopsy, setAutopsy] = useState<AutopsyState | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const autopsyPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setAuthChecked(true), 50)
    return () => clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!authChecked) return
    if (!user) router.push('/login')
  }, [authChecked, user, router])

  useEffect(() => {
    if (!uploadId || !token) return
    const controller = new AbortController()

    async function fetchReport() {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/uploads/${uploadId}/scan-report`, {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          setErrorStatus(res.status)
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        setReport(await res.json() as ScanReport)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setError((e as Error).message ?? 'Failed to load report')
      } finally {
        setLoading(false)
      }
    }

    void fetchReport()
    return () => controller.abort()
  }, [uploadId, token])

  // Fetch unlock/categorize progress
  useEffect(() => {
    if (!token) return
    void fetch('/api/insights/unlock-status', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then((data: UnlockStatus | null) => { if (data) setUnlockStatus(data) })
      .catch(() => {})
  }, [token])

  // Fetch autopsy state for this upload
  const fetchAutopsy = (tok: string, uid: string) =>
    fetch(`/api/uploads/${uid}/autopsy`, { headers: { Authorization: `Bearer ${tok}` } })
      .then(r => r.ok ? r.json() as Promise<AutopsyState> : null)
      .then(data => { if (data) setAutopsy(data); return data })
      .catch(() => null)

  useEffect(() => {
    if (!token || !uploadId) return
    void fetchAutopsy(token, uploadId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, uploadId])

  // Poll while generating
  useEffect(() => {
    if (!token || !uploadId) return
    if (autopsy?.status === 'generating') {
      autopsyPollRef.current = setInterval(async () => {
        const data = await fetchAutopsy(token, uploadId)
        if (data && data.status !== 'generating') {
          if (autopsyPollRef.current) clearInterval(autopsyPollRef.current)
        }
      }, 3000)
    } else {
      if (autopsyPollRef.current) clearInterval(autopsyPollRef.current)
    }
    return () => { if (autopsyPollRef.current) clearInterval(autopsyPollRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autopsy?.status, token, uploadId])

  if (!authChecked) return null
  if (!user) return null

  if (loading) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '0 16px' }}>
      <Spinner />
    </div>
  )

  if (error) return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <p style={{ color: 'var(--danger)', fontWeight: 600, fontSize: 15 }}>Failed to load report</p>
      <p style={{ color: 'var(--muted)', fontSize: 13 }}>{error}</p>
      <p style={{ color: 'var(--subtle)', fontSize: 11, fontFamily: 'monospace' }}>
        upload: {uploadId} · status: {errorStatus ?? '—'}
      </p>
      <button
        onClick={() => router.back()}
        style={{ marginTop: 8, padding: '8px 18px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text)', cursor: 'pointer', fontSize: 13 }}
      >
        Go back
      </button>
    </div>
  )

  if (!report) return null

  const { totals, findings } = report
  const netColor = totals.net >= 0 ? 'var(--success)' : 'var(--danger)'
  const netPrefix = totals.net >= 0 ? '+' : '-'
  const genDate = new Date(report.generatedAt).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })

  const MERCHANT_COLORS = ['#818cf8','#fb923c','#34d399','#f472b6','#fbbf24','#22d3ee','#c084fc','#4ade80']
  const pieData = findings.topMerchants.slice(0, 8).map((m, i) => ({
    name: m.merchant, value: m.total,
    color: MERCHANT_COLORS[i % MERCHANT_COLORS.length], count: m.count,
  }))
  const totalMerchantSpend = findings.topMerchants.reduce((s, m) => s + m.total, 0)
  const displayList = showAllMerchants ? findings.topMerchants : findings.topMerchants.slice(0, 8)

  // Progress bar
  const categorizeTotal = unlockStatus?.total ?? totals.transactionCount
  const categorized = unlockStatus?.categorized ?? 0
  const progressPct = categorizeTotal > 0 ? Math.round((categorized / categorizeTotal) * 100) : 0
  const unlocked = unlockStatus?.unlocked ?? false

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '0 0 80px' }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0% { background-position: -200% center; }
          100% { background-position: 200% center; }
        }
        .scan-grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
        @media (max-width: 640px) { .scan-grid-4 { grid-template-columns: repeat(2, 1fr); } }
        .locked-row { display: flex; gap: 14px; }
        @media (max-width: 720px) { .locked-row { flex-direction: column; } }
        .bottom-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 720px) { .bottom-grid { grid-template-columns: 1fr; } }
        .diag-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        @media (max-width: 720px) { .diag-grid { grid-template-columns: 1fr; } }
      `}</style>

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.07)',
        padding: '24px 28px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 16,
      }}>
        <div>
          <button
            onClick={() => router.push(`/upload/${uploadId}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'rgba(255,255,255,0.38)', fontSize: 13, cursor: 'pointer', padding: '0 0 12px' }}
          >
            ← Back to upload
          </button>
          <div style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', padding: '3px 12px', fontSize: 11, letterSpacing: '0.2em', color: 'rgba(148,196,255,0.8)', marginBottom: 10 }}>
            Statement Analysis
          </div>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', color: '#fff' }}>
            Statement Scan Report
          </h1>
          <p style={{ margin: '5px 0 0', fontSize: 12, color: 'rgba(255,255,255,0.35)' }}>
            Generated {genDate}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={`/api/uploads/${uploadId}/scan-report/pdf`}
            download
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', borderRadius: 14,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: 600,
              textDecoration: 'none', cursor: 'pointer',
            }}
          >
            ↓ Download PDF
          </a>
          <span style={{
            display: 'inline-flex', alignItems: 'center', padding: '6px 14px',
            borderRadius: 14, fontSize: 12, fontWeight: 700,
            background: 'linear-gradient(135deg,rgba(108,124,255,0.85),rgba(135,148,255,0.8))',
            color: '#fff',
          }}>
            BudgetLens AI
          </span>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* ── WHAT'S NEXT banner ────────────────────────────────────────────── */}
        <div style={{
          borderRadius: 'var(--radius-lg)',
          background: 'linear-gradient(135deg, rgba(99,102,241,0.18) 0%, rgba(168,85,247,0.10) 60%, rgba(59,130,246,0.06) 100%)',
          border: '1px solid rgba(99,102,241,0.35)',
          boxShadow: '0 0 40px rgba(99,102,241,0.08), inset 0 1px 0 rgba(255,255,255,0.05)',
          padding: '20px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 16,
        }}>
          <div>
            <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--accent)' }}>
              What&apos;s next
            </p>
            <p style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.4 }}>
              Categorize your transactions to unlock full financial insights
            </p>
            <p style={{ margin: '5px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              Your Money Personality, Financial Autopsy, and spending breakdown are waiting.
            </p>
          </div>
          <a
            href={`/categorize/${uploadId}`}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '12px 24px', borderRadius: 999,
              background: 'linear-gradient(135deg, #6366f1, #818cf8)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              textDecoration: 'none', whiteSpace: 'nowrap',
              boxShadow: '0 4px 20px rgba(99,102,241,0.45)',
              letterSpacing: '-0.01em',
            }}
          >
            Unlock your insights →
          </a>
        </div>

        {/* ── Totals row ───────────────────────────────────────────────────── */}
        <div className="scan-grid-4">
          <StatCard label="Income" value={fmt(totals.income)} color="var(--success)" />
          <StatCard label="Spending" value={fmt(totals.spending)} color="var(--danger)" />
          <StatCard label="Net" value={`${netPrefix}${fmt(Math.abs(totals.net))}`} color={netColor} />
          <StatCard label="Transactions" value={String(totals.transactionCount)} />
        </div>

        {/* ── Locked features row ───────────────────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
              Financial Insights
            </span>
            <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: 'var(--muted)', padding: '2px 8px', borderRadius: 999,
              background: 'var(--card2)', border: '1px solid var(--border)',
            }}>
              <LockIcon size={9} /> Requires categorization
            </span>
          </div>

          <div className="locked-row">
            <LockedFeatureCard
              icon={<Microscope size={22} />}
              iconColor="#a78bfa"
              iconBg="rgba(167,139,250,0.15)"
              title="Financial Autopsy"
              description="A brutally honest breakdown of exactly what happened to your money this month."
              bullets={['Cash flow pressure detected', 'Largest outflows identified', 'Month-over-month context hidden']}
            />
            <LockedFeatureCard
              icon={<Brain size={22} />}
              iconColor="#34d399"
              iconBg="rgba(52,211,153,0.15)"
              title="Money Personality"
              description="Discover your financial archetype based on real spending patterns, not a quiz."
              bullets={['Pattern recognition ready', 'Trait scoring complete', 'Card art waiting to unlock']}
            />
            <LockedFeatureCard
              icon={<Sparkles size={22} />}
              iconColor="#60a5fa"
              iconBg="rgba(96,165,250,0.15)"
              title="Smart Insights"
              description="Personalized observations and flags based on your actual transaction data."
              bullets={['Trend shifts detected', 'Merchant clustering hidden', 'Priority flags locked']}
            />
          </div>
        </div>

        {/* ── Categorize progress banner ────────────────────────────────────── */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-soft)',
          padding: '18px 22px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                {unlocked ? '✓ Insights unlocked!' : 'Categorization progress'}
              </p>
              <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)' }}>
                {unlocked
                  ? 'Your categories are good to go. Head to the dashboard to see your insights.'
                  : `${categorized} of ${categorizeTotal} transactions categorized — categorize 100% to unlock insights`}
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {unlocked ? (
                <a
                  href="/dashboard"
                  style={{
                    padding: '8px 18px', borderRadius: 999,
                    background: 'var(--success)', color: '#fff',
                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                    boxShadow: '0 2px 10px rgba(34,197,94,0.3)',
                  }}
                >
                  View dashboard →
                </a>
              ) : (
                <a
                  href={`/categorize/${uploadId}`}
                  style={{
                    padding: '8px 18px', borderRadius: 999,
                    background: 'var(--accent)', color: '#fff',
                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                    boxShadow: '0 2px 10px rgba(99,102,241,0.3)',
                  }}
                >
                  Categorize now →
                </a>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 6, borderRadius: 999, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              borderRadius: 999,
              width: `${progressPct}%`,
              background: unlocked
                ? 'linear-gradient(90deg, var(--success), #4ade80)'
                : progressPct >= 50
                  ? 'linear-gradient(90deg, var(--accent), #818cf8)'
                  : 'linear-gradient(90deg, #f59e0b, #fbbf24)',
              transition: 'width 0.4s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5 }}>
            <span style={{ fontSize: 10, color: 'var(--subtle)' }}>{progressPct}% complete</span>
            <span style={{ fontSize: 10, color: 'var(--subtle)' }}>100% required to unlock</span>
          </div>
        </div>

        {/* ── Preview section header ────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
            Statement Preview
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
            color: '#f59e0b', padding: '2px 8px', borderRadius: 999,
            background: 'rgba(245,158,11,0.10)', border: '1px solid rgba(245,158,11,0.25)',
          }}>
            Preview only
          </span>
        </div>

        {/* ── Bottom two-column: merchant chart + locked autopsy ─────────────── */}
        <div className="bottom-grid">

          {/* Top Merchants — pie chart */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 18px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                Top Merchants by Spend
              </p>
              {findings.topMerchants.length > 8 && (
                <button
                  onClick={() => setShowAllMerchants(s => !s)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                    background: 'var(--accent-muted)', border: '1px solid rgba(124,137,255,0.25)',
                    borderRadius: 999, padding: '3px 9px', cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {showAllMerchants ? 'Show top 8' : `View all ${findings.topMerchants.length}`}
                </button>
              )}
            </div>
            <div style={{ padding: '8px 18px 16px' }}>
              {findings.topMerchants.length === 0 ? (
                <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--subtle)', fontStyle: 'italic' }}>
                  No merchant data available.
                </p>
              ) : (
                <div>
                  <div style={{ position: 'relative' }}>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                          {pieData.map((entry, i) => (
                            <Cell key={i} fill={entry.color} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [fmt(value), name]}
                          contentStyle={{
                            background: 'var(--card)', border: '1px solid var(--border)',
                            borderRadius: 8, fontSize: 12, color: 'var(--text)',
                          }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>Total</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{fmt(totalMerchantSpend)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {displayList.map((m, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: MERCHANT_COLORS[i % MERCHANT_COLORS.length], flexShrink: 0 }} />
                        <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.merchant}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--subtle)', whiteSpace: 'nowrap' }}>{m.count}×</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(m.total)}</span>
                      </div>
                    ))}
                  </div>
                  {findings.topMerchants.length > 8 && (
                    <button
                      onClick={() => setShowAllMerchants(s => !s)}
                      style={{ marginTop: 10, fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', width: '100%', textAlign: 'center' }}
                    >
                      {showAllMerchants ? 'Show top 8' : `View all ${findings.topMerchants.length} merchants`}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Financial Autopsy — live state */}
          <AutopsyPanel autopsy={autopsy} uploadId={uploadId} />
        </div>

        {/* ── Diagnostics section header ────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
            Diagnostics
          </span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        {/* ── Diagnostics grid ──────────────────────────────────────────────── */}
        <div className="diag-grid">

          {/* Subscriptions */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 18px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                Recurring Subscriptions
              </p>
              <span style={{
                display: 'inline-flex', alignItems: 'center', padding: '3px 9px',
                borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: findings.subscriptions.count > 0 ? 'var(--accent-muted)' : 'var(--card2)',
                color: findings.subscriptions.count > 0 ? 'var(--accent)' : 'var(--muted)',
              }}>
                {findings.subscriptions.count}
              </span>
            </div>
            <div style={{ padding: '12px 18px' }}>
              {findings.subscriptions.monthlyTotal > 0 && (
                <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--muted)' }}>
                  Est. <strong style={{ color: 'var(--text)' }}>{fmt(findings.subscriptions.monthlyTotal)}</strong>/month total
                </p>
              )}
              {findings.subscriptions.items.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--subtle)', fontStyle: 'italic' }}>No recurring subscriptions detected.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {findings.subscriptions.items.map((sub, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 10px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {sub.merchant}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(sub.amount)}/mo</span>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', padding: '2px 6px', borderRadius: 999,
                        fontSize: 10, fontWeight: 600,
                        background: sub.confidence === 'high' ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)',
                        color: sub.confidence === 'high' ? 'var(--success)' : 'var(--warn)',
                      }}>
                        {sub.confidence}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Duplicates */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 18px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                Duplicate Transactions
              </p>
              <span style={{
                display: 'inline-flex', alignItems: 'center', padding: '3px 9px',
                borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: 'var(--card2)', color: 'var(--muted)',
              }}>
                {findings.duplicates.count} flagged
              </span>
            </div>
            <div style={{ padding: '12px 18px' }}>
              {findings.duplicates.items.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--subtle)', fontStyle: 'italic' }}>No duplicate transactions detected.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {findings.duplicates.items.map((dup, i) => (
                    <div key={i} style={{
                      padding: '11px 13px', borderRadius: 10,
                      background: 'var(--card2)', border: '1px solid var(--border)',
                      borderLeft: i === 0 ? '3px solid var(--accent)' : '3px solid var(--border)',
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 3 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {dup.merchant}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>{fmt(dup.amount)}</span>
                      </div>
                      <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--muted)' }}>{dup.dates.join(' · ')}</p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--subtle)', fontStyle: 'italic' }}>
                        These transactions appear similar — confirm both are intentional.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Anomalies */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 18px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                Unusual Activity
              </p>
              <span style={{
                display: 'inline-flex', alignItems: 'center', padding: '3px 9px',
                borderRadius: 999, fontSize: 11, fontWeight: 600,
                background: 'var(--card2)', color: 'var(--muted)',
              }}>
                {findings.anomalies.count} noticed
              </span>
            </div>
            <div style={{ padding: '12px 18px' }}>
              {findings.anomalies.items.length === 0 ? (
                <p style={{ margin: 0, fontSize: 13, color: 'var(--subtle)', fontStyle: 'italic' }}>No unusual activity detected.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {findings.anomalies.items.slice(0, 8).map((a, i) => (
                    <div key={i} style={{
                      padding: '11px 13px', borderRadius: 10,
                      background: 'var(--card2)', border: '1px solid var(--border)',
                      borderLeft: i === 0 ? '3px solid var(--accent)' : '3px solid var(--border)',
                    }}>
                      <p style={{ margin: '0 0 3px', fontSize: 13, fontWeight: 600, color: 'var(--text)', lineHeight: 1.45 }}>{a.message}</p>
                      <p style={{ margin: '0 0 4px', fontSize: 11, color: 'var(--muted)', textTransform: 'capitalize' }}>{a.type}</p>
                      <p style={{ margin: 0, fontSize: 11, color: 'var(--subtle)', fontStyle: 'italic' }}>
                        This may be intentional — or worth a closer look.
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Statement Quality */}
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden',
          }}>
            <div style={{
              padding: '12px 18px', borderBottom: '1px solid var(--border)',
              background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
            }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                Statement Quality
              </p>
            </div>
            <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--border)' }}>
                <div>
                  <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>Balance continuity</span>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--subtle)', fontStyle: 'italic' }}>
                    {findings.balanceIssues === 0 ? 'All running balances check out.' : 'Some gaps — may indicate missing transactions.'}
                  </p>
                </div>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', padding: '3px 9px',
                  borderRadius: 999, fontSize: 11, fontWeight: 600,
                  background: findings.balanceIssues > 0 ? 'var(--accent-muted)' : 'rgba(34,197,94,0.12)',
                  color: findings.balanceIssues > 0 ? 'var(--accent)' : 'var(--success)',
                }}>
                  {findings.balanceIssues === 0 ? 'Clean' : findings.balanceIssues}
                </span>
              </div>
              {[
                { label: 'High impact', sublabel: 'Rows that may affect your totals', count: findings.ingestionIssues.high, color: 'var(--accent)', bg: 'var(--accent-muted)' },
                { label: 'Medium impact', sublabel: 'Minor formatting or parsing issues', count: findings.ingestionIssues.medium, color: 'var(--warn)', bg: 'rgba(245,158,11,0.10)' },
                { label: 'Low impact', sublabel: 'Informational notes only', count: findings.ingestionIssues.low, color: 'var(--muted)', bg: 'var(--card2)' },
              ].map(({ label, sublabel, count, color, bg }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--border)' }}>
                  <div>
                    <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{label}</span>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: 'var(--subtle)', fontStyle: 'italic' }}>{sublabel}</p>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 9px', borderRadius: 999, fontSize: 11, fontWeight: 600, flexShrink: 0, background: bg, color }}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', paddingTop: 4 }}>
          <a
            href="/dashboard"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '10px 22px', borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--card)', color: 'var(--muted)',
              fontSize: 13, fontWeight: 500, textDecoration: 'none',
            }}
          >
            View full dashboard →
          </a>
        </div>

      </div>
    </div>
  )
}
