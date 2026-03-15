'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ─── Shared style tokens ──────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-soft)',
  overflow: 'hidden',
}

const cardHdr: React.CSSProperties = {
  padding: '12px 18px',
  borderBottom: '1px solid var(--border)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
}

const hdrTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text)',
  margin: 0,
  letterSpacing: '-0.01em',
}

const badge: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
}

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

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{
      ...card,
      padding: '18px 20px',
      textAlign: 'center',
    }}>
      <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)' }}>
        {label}
      </p>
      <p style={{ margin: '6px 0 0', fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: color ?? 'var(--text)' }}>
        {value}
      </p>
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <p style={{ margin: '14px 0 0', fontSize: 13, color: 'var(--subtle)', fontStyle: 'italic' }}>
      {text}
    </p>
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
  const [showAllMerchants, setShowAllMerchants] = useState(false)

  useEffect(() => {
    if (!user) {
      router.push('/login')
      return
    }
  }, [user, router])

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
          throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`)
        }
        const data = await res.json() as ScanReport
        setReport(data)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setError((e as Error).message ?? 'Failed to load report')
        }
      } finally {
        setLoading(false)
      }
    }

    void fetchReport()
    return () => controller.abort()
  }, [uploadId, token])

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

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '0 0 60px' }}>

      {/* ── Header bar ─────────────────────────────────────────────────────── */}
      <div style={{
        background: 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)',
        borderBottom: '1px solid var(--border)',
        padding: '20px 24px',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 12,
      }}>
        <div>
          <button
            onClick={() => router.push(`/upload/${uploadId}`)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', padding: '0 0 10px', transition: 'color 0.15s' }}
            onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
            onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
          >
            ← Back to upload
          </button>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' }}>
            Statement Scan Report
          </h1>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--muted)' }}>
            Generated {genDate}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <a
            href={`/api/uploads/${uploadId}/scan-report/pdf`}
            download
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 999,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              cursor: 'pointer',
            }}
          >
            ↓ Download PDF
          </a>
          <span style={{
            ...badge,
            background: 'var(--accent-muted)',
            color: 'var(--accent)',
            border: '1px solid rgba(124,137,255,0.25)',
          }}>
            BudgetLens AI
          </span>
        </div>
      </div>

      {/* ── Content ────────────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* ── Summary card ─────────────────────────────────────────────────── */}
        <div style={{
          ...card,
          background: 'radial-gradient(ellipse at 0% 0%, rgba(124,137,255,0.12), transparent 60%), var(--card)',
          padding: '20px 22px',
        }}>
          <p style={{ margin: 0, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', marginBottom: 10 }}>
            AI Summary
          </p>
          <p style={{ margin: 0, fontSize: 15, lineHeight: 1.65, color: 'var(--text)' }}>
            {report.summary}
          </p>
        </div>

        {/* ── Next step banner ─────────────────────────────────────────────── */}
        <div style={{
          ...card,
          background: 'linear-gradient(135deg, rgba(124,137,255,0.12) 0%, rgba(99,102,241,0.06) 100%)',
          border: '1px solid rgba(124,137,255,0.3)',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--accent)', marginBottom: 4 }}>
              What&apos;s next
            </p>
            <p style={{ margin: 0, fontSize: 14, color: 'var(--text)', lineHeight: 1.5 }}>
              Review and categorize your transactions to get accurate spending insights on the dashboard.
            </p>
          </div>
          <a
            href="/categorize"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 20px',
              borderRadius: 999,
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 12px rgba(124,137,255,0.35)',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Categorize transactions →
          </a>
        </div>

        {/* ── Totals row ───────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}
          className="max-[640px]:!grid-cols-2">
          <StatCard label="Income" value={fmt(totals.income)} color="var(--success)" />
          <StatCard label="Spending" value={fmt(totals.spending)} color="var(--danger)" />
          <StatCard label="Net" value={`${netPrefix}${fmt(Math.abs(totals.net))}`} color={netColor} />
          <StatCard label="Transactions" value={String(totals.transactionCount)} />
        </div>

        {/* ── Findings grid ────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}
          className="max-[720px]:!grid-cols-1">

          {/* Duplicates */}
          <div style={card}>
            <div style={{ ...cardHdr, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={hdrTitle}>Possible Duplicates</p>
              <span style={{
                ...badge,
                background: findings.duplicates.count > 0 ? 'rgba(248,113,113,0.15)' : 'var(--surface2)',
                color: findings.duplicates.count > 0 ? 'var(--danger)' : 'var(--muted)',
              }}>
                {findings.duplicates.count}
              </span>
            </div>
            <div style={{ padding: '12px 18px' }}>
              {findings.duplicates.items.length === 0 ? (
                <EmptyState text="No possible duplicates detected." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {findings.duplicates.items.map((dup, i) => (
                    <div key={i} style={{ padding: '10px 12px', borderRadius: 'var(--radius-sm)', background: 'rgba(248,113,113,0.06)', border: '1px solid rgba(248,113,113,0.15)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {dup.merchant}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--danger)', whiteSpace: 'nowrap' }}>
                          {fmt(dup.amount)}
                        </span>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--muted)' }}>
                        {dup.dates.join(' · ')}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Subscriptions */}
          <div style={card}>
            <div style={{ ...cardHdr, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={hdrTitle}>Recurring Subscriptions</p>
              <span style={{
                ...badge,
                background: findings.subscriptions.count > 0 ? 'var(--accent-muted)' : 'var(--surface2)',
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
                <EmptyState text="No recurring subscriptions detected." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {findings.subscriptions.items.map((sub, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '7px 10px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--border)' }}>
                      <span style={{ fontSize: 13, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                        {sub.merchant}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                        {fmt(sub.amount)}/mo
                      </span>
                      <span style={{
                        ...badge,
                        background: sub.confidence === 'high' ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)',
                        color: sub.confidence === 'high' ? 'var(--success)' : 'var(--warn)',
                        fontSize: 10,
                        padding: '2px 6px',
                      }}>
                        {sub.confidence}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Top Merchants — pie chart */}
          <div style={card}>
            <div style={{ ...cardHdr, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={hdrTitle}>Top Merchants by Spend</p>
              {findings.topMerchants.length > 8 && (
                <button
                  onClick={() => setShowAllMerchants(s => !s)}
                  style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--accent)',
                    background: 'var(--accent-muted)', border: '1px solid rgba(124,137,255,0.25)',
                    borderRadius: 999, padding: '3px 9px', cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {showAllMerchants ? 'Show top 8' : `View all ${findings.topMerchants.length}`}
                </button>
              )}
            </div>
            <div style={{ padding: '8px 18px 16px' }}>
              {findings.topMerchants.length === 0 ? (
                <EmptyState text="No merchant data available." />
              ) : (() => {
                const MERCHANT_COLORS = ['#7c89ff','#f97316','#22c55e','#ec4899','#f59e0b','#06b6d4','#a78bfa','#10b981']
                const pieData = findings.topMerchants.slice(0, 8).map((m, i) => ({
                  name:  m.merchant,
                  value: m.total,
                  color: MERCHANT_COLORS[i % MERCHANT_COLORS.length],
                  count: m.count,
                }))
                const totalMerchantSpend = findings.topMerchants.reduce((s, m) => s + m.total, 0)
                const displayList = showAllMerchants ? findings.topMerchants : findings.topMerchants.slice(0, 8)
                return (
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
                )
              })()}
            </div>
          </div>

          {/* Anomalies */}
          <div style={card}>
            <div style={{ ...cardHdr, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <p style={hdrTitle}>Anomaly Alerts</p>
              <span style={{
                ...badge,
                background: findings.anomalies.count > 0 ? 'rgba(251,191,36,0.15)' : 'var(--surface2)',
                color: findings.anomalies.count > 0 ? 'var(--warn)' : 'var(--muted)',
              }}>
                {findings.anomalies.count}
              </span>
            </div>
            <div style={{ padding: '12px 18px' }}>
              {findings.anomalies.items.length === 0 ? (
                <EmptyState text="No anomalies detected." />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {findings.anomalies.items.slice(0, 8).map((a, i) => (
                    <div key={i} style={{ padding: '9px 11px', borderRadius: 10, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.18)' }}>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text)', lineHeight: 1.5 }}>{a.message}</p>
                      <p style={{ margin: '3px 0 0', fontSize: 11, color: 'var(--subtle)' }}>{a.type}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Balance & Ingestion Issues */}
          <div style={card}>
            <div style={cardHdr}>
              <p style={hdrTitle}>Balance &amp; Ingestion Issues</p>
            </div>
            <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {/* Balance chain */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--border)' }}>
                <span style={{ fontSize: 13, color: 'var(--text)' }}>Balance chain breaks</span>
                <span style={{
                  ...badge,
                  background: findings.balanceIssues > 0 ? 'rgba(248,113,113,0.12)' : 'rgba(34,197,94,0.12)',
                  color: findings.balanceIssues > 0 ? 'var(--danger)' : 'var(--success)',
                }}>
                  {findings.balanceIssues}
                </span>
              </div>

              {/* Ingestion issues breakdown */}
              {[
                { label: 'High severity', count: findings.ingestionIssues.high, color: 'var(--danger)', bg: 'rgba(248,113,113,0.12)' },
                { label: 'Medium severity', count: findings.ingestionIssues.medium, color: 'var(--warn)', bg: 'rgba(251,191,36,0.12)' },
                { label: 'Low severity', count: findings.ingestionIssues.low, color: 'var(--muted)', bg: 'var(--surface2)' },
              ].map(({ label, count, color, bg }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 10, background: 'var(--card2)', border: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
                  <span style={{ ...badge, background: bg, color }}>
                    {count}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div style={{ textAlign: 'center', paddingTop: 8 }}>
          <a
            href="/dashboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 22px',
              borderRadius: 999,
              border: '1px solid var(--border)',
              background: 'var(--card)',
              color: 'var(--muted)',
              fontSize: 13,
              fontWeight: 500,
              textDecoration: 'none',
              transition: 'background 0.15s',
            }}
          >
            View full dashboard →
          </a>
        </div>

      </div>
    </div>
  )
}
