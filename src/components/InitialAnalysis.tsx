'use client'

import { useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { ImportSummary } from '@/lib/scrubbing'

// ─── Props ────────────────────────────────────────────────────────────────────

interface Tx {
  id: string
  amountCents: number
  status: string
  category: { name: string } | null
}

interface Counts {
  total: number
  uncategorized: number
  needsReview: number
}

interface StagingUploadMeta {
  upload: { formatDetected: string }
}

interface InitialAnalysisProps {
  summary: ImportSummary
  transactions: Tx[]
  counts: Counts
  stagingUpload: StagingUploadMeta | null
  onStartCategorizing: () => void
  onViewTransactions: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDollars(cents: number): string {
  return (cents / 100).toLocaleString('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0,
  })
}

interface CategoryRow {
  category: string
  amount: number   // absolute cents
  count: number
  isIncome: boolean
  isTransfer: boolean
  isUncategorized: boolean
}

function useCategoryBreakdown(transactions: Tx[], summary: ImportSummary): CategoryRow[] {
  return useMemo(() => {
    const map = new Map<string, CategoryRow>()
    for (const tx of transactions) {
      if (tx.status === 'excluded') continue
      const suggestion = summary.suggestions.get(tx.id)
      let category = 'Uncategorized'
      let isIncome = false
      let isTransfer = false
      if (tx.status === 'categorized' && tx.category?.name) {
        category = tx.category.name
      } else if (suggestion) {
        category = suggestion.category
        isIncome = suggestion.isIncome
        isTransfer = suggestion.isTransfer
      }
      const existing = map.get(category)
      if (existing) {
        existing.amount += Math.abs(tx.amountCents)
        existing.count++
      } else {
        map.set(category, {
          category, amount: Math.abs(tx.amountCents), count: 1,
          isIncome, isTransfer, isUncategorized: category === 'Uncategorized',
        })
      }
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount)
  }, [transactions, summary.suggestions])
}

// ─── Colour palette ───────────────────────────────────────────────────────────

const PALETTE = [
  '#6f80ff','#39d07f','#f0b544','#ff7aac','#59c7ff','#a78bfa',
  '#fb923c','#34d399','#f472b6','#38bdf8','#facc15','#4ade80',
  '#e879f9','#22d3ee','#fb7185','#a3e635','#818cf8','#fbbf24',
  '#2dd4bf','#f97316','#c084fc','#86efac','#fca5a5','#67e8f9',
  '#d946ef','#84cc16','#60a5fa','#fdba74','#4fd1c5','#f9a8d4','#a8a29e',
]

function sliceColor(row: CategoryRow, index: number): string {
  if (row.isIncome) return '#39d07f'
  if (row.isUncategorized) return '#f0b544'
  if (row.isTransfer) return '#94a3b8'
  return PALETTE[index % PALETTE.length]
}

// ─── Main component ───────────────────────────────────────────────────────────

export function InitialAnalysis({
  summary,
  transactions,
  counts,
  stagingUpload,
  onStartCategorizing,
  onViewTransactions,
}: InitialAnalysisProps) {
  const rows = useCategoryBreakdown(transactions, summary)
  const top = rows[0]

  const bankCatCount = useMemo(() => {
    let n = 0
    for (const s of summary.suggestions.values()) {
      if (s.categorySource === 'bank') n++
    }
    return n
  }, [summary.suggestions])

  const format = stagingUpload?.upload.formatDetected || 'CSV'

  return (
    <>
      {/* ── Animations ──────────────────────────────────────────────────────── */}
      <style>{`
        @keyframes ia-shimmer {
          0%   { left: -120%; }
          100% { left: 140%; }
        }
        @keyframes ia-pulse {
          0%, 100% {
            box-shadow: 0 12px 28px rgba(111,128,255,0.32), 0 0 0 0 rgba(127,140,255,0.18);
          }
          50% {
            box-shadow: 0 14px 30px rgba(111,128,255,0.38), 0 0 0 8px rgba(127,140,255,0.05);
          }
        }
        .ia-btn-primary {
          border-color: transparent !important;
          background: linear-gradient(180deg, #9aa5ff, #6f80ff) !important;
          box-shadow: 0 12px 28px rgba(111,128,255,0.32), 0 0 0 1px rgba(255,255,255,0.08) inset !important;
          animation: ia-pulse 2.4s ease-in-out infinite;
          position: relative;
          overflow: hidden;
        }
        .ia-btn-primary::before {
          content: "";
          position: absolute;
          top: 0;
          left: -120%;
          width: 60%;
          height: 100%;
          background: linear-gradient(90deg, transparent, rgba(255,255,255,0.28), transparent);
          transform: skewX(-20deg);
          animation: ia-shimmer 2.8s linear infinite;
        }
        .ia-btn-primary:hover {
          transform: translateY(-2px) scale(1.01) !important;
          box-shadow: 0 16px 34px rgba(111,128,255,0.38), 0 0 18px rgba(127,140,255,0.24) !important;
        }
        .ia-btn:hover { transform: translateY(-1px); }
      `}</style>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>

        {/* ── Hero ────────────────────────────────────────────────────────── */}
        <section style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 18,
          padding: '16px 20px',
          boxShadow: '0 8px 24px rgba(0,0,0,0.22)',
          marginBottom: 16,
          position: 'relative',
          overflow: 'hidden',
        }}>
          {/* Glow orb */}
          <div style={{
            position: 'absolute', right: -60, top: -50, width: 180, height: 180,
            background: 'radial-gradient(circle, rgba(127,140,255,0.14), transparent 70%)',
            pointerEvents: 'none',
          }} />

          {/* Top row: label + CTAs + tags all inline */}
          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px 16px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a6b5d8', marginBottom: 3 }}>
                Initial analysis ready
              </div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.03em', color: 'var(--text)' }}>
                Here&apos;s your first money snapshot.
              </h1>
            </div>

            {/* CTAs */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginLeft: 'auto', flexShrink: 0 }}>
              <button
                onClick={onStartCategorizing}
                className="ia-btn ia-btn-primary"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
                  color: '#fff', padding: '8px 14px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', transition: 'transform 0.18s ease, box-shadow 0.18s ease',
                }}
              >
                Start Categorizing
              </button>
              <button
                onClick={onViewTransactions}
                className="ia-btn"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.04)',
                  color: '#fff', padding: '8px 14px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', transition: 'transform 0.18s ease',
                }}
              >
                View Transactions
              </button>
            </div>
          </div>

          {/* Tags */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
            {[
              `${counts.total} transactions imported`,
              format + ' detected',
              ...(bankCatCount > 0 ? ['Bank categories used where available'] : []),
              ...(summary.recurringCount > 0 ? [`${summary.recurringCount} recurring detected`] : []),
            ].map(tag => (
              <div key={tag} style={{
                padding: '5px 8px', borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
                color: '#dbe4ff', fontSize: 11, fontWeight: 700,
              }}>
                {tag}
              </div>
            ))}
          </div>
        </section>

        {/* ── Initial Spending Analysis panel ───────────────────────────── */}
        <section style={{
          background: 'rgba(13,25,48,0.96)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 22,
          boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
          overflow: 'hidden',
          marginBottom: 22,
        }}>
          <div style={{ padding: '22px 22px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>
              Initial Spending Analysis
            </h2>
            <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.55, maxWidth: 900 }}>
              We grouped your imported transactions into likely spending categories and estimated where the most money is going. Dollar totals drive this first-pass analysis, while transaction counts provide supporting context.
            </p>
          </div>

          <div style={{ padding: '20px 22px 24px' }}>
            {/* Top-category highlight */}
            {top && (
              <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16,
                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 18, padding: 20, marginBottom: 24, flexWrap: 'wrap',
              }}>
                <div>
                  <div style={{ color: 'var(--muted)', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, marginBottom: 6 }}>
                    Top detected spending group
                  </div>
                  <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, marginBottom: 6, color: 'var(--text)' }}>
                    {top.category} — {fmtDollars(top.amount)}
                  </div>
                  <div style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.45 }}>
                    {top.count} transaction{top.count !== 1 ? 's' : ''} in the first pass
                  </div>
                </div>
                <div style={{
                  padding: '10px 12px', borderRadius: 999,
                  background: 'rgba(127,140,255,0.14)', border: '1px solid rgba(127,140,255,0.3)',
                  color: '#eef2ff', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
                }}>
                  Amount-based first result
                </div>
              </div>
            )}

            {/* Pie chart + legend */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              {/* Donut */}
              <div style={{ width: 160, height: 160, flexShrink: 0 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={rows}
                      dataKey="amount"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={82}
                      paddingAngle={2}
                      strokeWidth={0}
                    >
                      {rows.map((row, i) => (
                        <Cell key={row.category} fill={sliceColor(row, i)} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number) => [fmtDollars(value), 'Amount']}
                      contentStyle={{
                        background: 'rgba(13,25,48,0.97)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10,
                        color: '#f0f4ff',
                        fontSize: 13,
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Legend */}
              <div style={{ flex: 1, minWidth: 0, maxHeight: 400, overflowY: 'auto' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', columnGap: 16, rowGap: 7, alignItems: 'center' }}>
                  {rows.map((row, i) => (
                    <>
                      {/* Name */}
                      <div key={`n-${row.category}`} style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                        <div style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, background: sliceColor(row, i) }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: '#d8e1ff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {row.category}
                        </span>
                      </div>
                      {/* Amount */}
                      <div key={`a-${row.category}`} style={{ fontSize: 13, fontWeight: 800, color: '#f4f7ff', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        {fmtDollars(row.amount)}
                      </div>
                      {/* Count */}
                      <div key={`c-${row.category}`} style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', whiteSpace: 'nowrap', minWidth: 24 }}>
                        {row.count}
                      </div>
                    </>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Below grid ──────────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 22, alignItems: 'start' }}>

          {/* Why categorize? */}
          <section style={{
            background: 'rgba(13,25,48,0.96)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 22,
            boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: '22px 22px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>
                Why categorize next?
              </h2>
              <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.55, maxWidth: 900 }}>
                This first-pass analysis is useful, but confirming categories is what turns it into an exact result you can trust and reuse.
              </p>
            </div>
            <div style={{ padding: '20px 22px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              {[
                { n: 1, bg: 'rgba(89,199,255,0.16)', color: '#9adeff', title: 'Improve accuracy', body: 'Confirming categories helps separate true spending from transfers, income, refunds, and noisy merchant strings.' },
                { n: 2, bg: 'rgba(63,214,131,0.16)', color: '#a7efc8', title: 'Unlock deeper analysis', body: 'Once categories are confirmed, BudgetLens can show cleaner breakdowns, trends, and recurring payment analysis.' },
                { n: 3, bg: 'rgba(242,187,72,0.16)', color: '#ffd98f', title: 'Make future imports faster', body: 'Confirmed categories help the system organize similar transactions better next time instead of starting from scratch.' },
                { n: 4, bg: 'rgba(255,127,127,0.16)', color: '#ffb0b0', title: 'Catch what needs attention', body: 'Low-confidence merchants, unusual items, and unclear transactions can be reviewed before they distort your results.' },
              ].map(item => (
                <div key={item.n} style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr', gap: 14, alignItems: 'start',
                  padding: 14, borderRadius: 16,
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
                }}>
                  <div style={{
                    width: 40, height: 40, borderRadius: 12,
                    display: 'grid', placeItems: 'center',
                    fontWeight: 800, fontSize: 15,
                    background: item.bg, color: item.color,
                  }}>
                    {item.n}
                  </div>
                  <div>
                    <h4 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 800, color: 'var(--text)' }}>{item.title}</h4>
                    <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>{item.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Recommended action */}
          <aside style={{
            background: 'linear-gradient(180deg, rgba(127,140,255,0.11), rgba(127,140,255,0.04))',
            border: '1px solid rgba(127,140,255,0.20)',
            borderRadius: 22,
            boxShadow: '0 16px 40px rgba(0,0,0,0.28)',
            padding: 22,
            alignSelf: 'start',
          }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 800, marginBottom: 10 }}>
              Recommended action
            </div>
            <h3 style={{ margin: '0 0 10px', fontSize: 24, fontWeight: 800, lineHeight: 1.15, color: 'var(--text)' }}>
              Start with uncategorized transactions
            </h3>
            <p style={{ margin: '0 0 16px', color: '#d3dcf7', fontSize: 14, lineHeight: 1.6 }}>
              Review the {counts.uncategorized} uncategorized item{counts.uncategorized !== 1 ? 's' : ''} first.
              Then confirm flagged or recurring transactions to strengthen the final analysis.
            </p>
            <button
              onClick={onStartCategorizing}
              className="ia-btn ia-btn-primary"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '100%', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)',
                color: '#fff', padding: '13px 18px', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', marginBottom: 10,
                transition: 'transform 0.18s ease, box-shadow 0.18s ease',
              }}
            >
              Start Categorizing
            </button>
            <button
              onClick={onViewTransactions}
              className="ia-btn"
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: '100%', borderRadius: 14, border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
                color: '#fff', padding: '13px 18px', fontSize: 14, fontWeight: 700,
                cursor: 'pointer', marginBottom: 0,
                transition: 'transform 0.18s ease',
              }}
            >
              Review Needs Attention First
            </button>
          </aside>
        </div>

      </div>
    </>
  )
}
