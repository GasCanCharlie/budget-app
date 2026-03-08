'use client'

import { useMemo } from 'react'
import { PlayCircle, ArrowRight } from 'lucide-react'
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
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
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
          category,
          amount: Math.abs(tx.amountCents),
          count: 1,
          isIncome,
          isTransfer,
          isUncategorized: category === 'Uncategorized',
        })
      }
    }

    return Array.from(map.values())
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 7)
  }, [transactions, summary.suggestions])
}

// ─── Bar fill color ───────────────────────────────────────────────────────────

function fillStyle(row: CategoryRow): React.CSSProperties {
  if (row.isUncategorized) {
    return { background: 'linear-gradient(90deg, var(--warn), #ffd780)', height: '100%', borderRadius: 999 }
  }
  if (row.isIncome) {
    return { background: 'linear-gradient(90deg, var(--success), #7be5ad)', height: '100%', borderRadius: 999 }
  }
  return { background: 'linear-gradient(90deg, var(--accent), #6578ff)', height: '100%', borderRadius: 999 }
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
  const maxAmount = rows[0]?.amount ?? 1
  const top = rows[0]

  // Count how many suggestions came from the bank CSV column
  const bankCatCount = useMemo(() => {
    let n = 0
    for (const s of summary.suggestions.values()) {
      if (s.categorySource === 'bank') n++
    }
    return n
  }, [summary.suggestions])

  const format = stagingUpload?.upload.formatDetected || 'CSV'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          background: 'linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))',
          border: '1px solid var(--border)',
          borderRadius: 22,
          padding: '28px 30px',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* Glow orb */}
        <div style={{
          position: 'absolute', right: -100, top: -80, width: 280, height: 280,
          background: 'radial-gradient(circle, rgba(127,140,255,0.18), transparent 70%)',
          pointerEvents: 'none',
        }} />

        <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 10px' }}>
          Initial analysis ready
        </p>

        <h1 style={{ margin: '0 0 12px', fontSize: 36, fontWeight: 800, lineHeight: 1.08, letterSpacing: '-0.03em', color: 'var(--text)' }}>
          Here&apos;s your first money snapshot.
        </h1>

        <p style={{ margin: 0, color: 'var(--muted)', fontSize: 15, lineHeight: 1.65, maxWidth: 780 }}>
          We analyzed your imported statement and grouped the transactions into likely categories.
          This first-pass view estimates where your money is going. Confirm categories next to make this analysis exact and improve future imports.
        </p>

        {/* CTAs */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 22 }}>
          <button
            onClick={onStartCategorizing}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              borderRadius: 14, border: '1px solid transparent',
              background: 'linear-gradient(180deg, var(--accent-2, #9aa5ff), var(--accent))',
              boxShadow: '0 10px 28px rgba(111,128,255,0.32)',
              color: '#fff', padding: '13px 20px', fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            <PlayCircle size={15} />
            Start Categorizing
          </button>
          <button
            onClick={onViewTransactions}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7,
              borderRadius: 14, border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--text)', padding: '13px 20px', fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            View Imported Transactions
            <ArrowRight size={14} />
          </button>
        </div>

        {/* Tags */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 16 }}>
          {[
            `${counts.total} transactions imported`,
            format,
            ...(bankCatCount > 0 ? [`Bank categories used (${bankCatCount})`] : []),
            ...(summary.recurringCount > 0 ? [`${summary.recurringCount} recurring detected`] : []),
          ].map(tag => (
            <span
              key={tag}
              style={{
                padding: '7px 11px', borderRadius: 999,
                border: '1px solid var(--border)',
                background: 'rgba(255,255,255,0.04)',
                color: 'var(--text2)', fontSize: 12, fontWeight: 700,
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* ── Spending Analysis panel ───────────────────────────────────────── */}
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, overflow: 'hidden' }}>
        {/* Head */}
        <div style={{ padding: '20px 22px 16px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>
            Initial Spending Analysis
          </h2>
          <p style={{ margin: '7px 0 0', color: 'var(--muted)', fontSize: 14, lineHeight: 1.55 }}>
            Transactions grouped by likely category using merchant data and bank-provided labels.
            Dollar totals drive this first-pass ranking — confirm categories to make it exact.
          </p>
        </div>

        <div style={{ padding: '22px 22px 26px' }}>
          {/* Top-category highlight */}
          {top && (
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 14,
              background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)',
              borderRadius: 16, padding: 18, marginBottom: 22,
              flexWrap: 'wrap',
            }}>
              <div>
                <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 6px' }}>
                  Top detected spending group
                </p>
                <p style={{ fontSize: 30, fontWeight: 800, lineHeight: 1, margin: '0 0 6px', color: 'var(--text)' }}>
                  {top.category} — {fmtDollars(top.amount)}
                </p>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13 }}>
                  {top.count} transaction{top.count !== 1 ? 's' : ''} detected in the first pass
                </p>
              </div>
              <span style={{
                padding: '9px 13px', borderRadius: 999,
                background: 'rgba(127,140,255,0.14)', border: '1px solid rgba(127,140,255,0.3)',
                color: '#eef2ff', fontSize: 12, fontWeight: 800, whiteSpace: 'nowrap',
              }}>
                Amount-based first result
              </span>
            </div>
          )}

          {/* Bar chart */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {rows.map(row => (
              <div
                key={row.category}
                style={{ display: 'grid', gridTemplateColumns: '200px 1fr 160px', alignItems: 'center', gap: 16 }}
              >
                <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {row.category}
                </span>
                <div style={{ height: 14, background: 'rgba(255,255,255,0.07)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ ...fillStyle(row), width: `${Math.round((row.amount / maxAmount) * 100)}%` }} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{fmtDollars(row.amount)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginTop: 1 }}>{row.count} tx</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Below grid ────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 20, alignItems: 'start' }}>

        {/* Why categorize? */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 22, overflow: 'hidden' }}>
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <h2 style={{ margin: 0, fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text)' }}>Why categorize next?</h2>
            <p style={{ margin: '7px 0 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
              This first-pass analysis is useful, but confirming categories turns it into an exact result you can trust and reuse.
            </p>
          </div>
          <div style={{ padding: '18px 18px 22px', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {[
              { n: 1, color: 'rgba(89,199,255,0.16)', textColor: '#9adeff', title: 'Improve accuracy', body: 'Confirming categories separates true spending from transfers, income, refunds, and noisy merchant strings.' },
              { n: 2, color: 'rgba(63,214,131,0.16)', textColor: '#a7efc8', title: 'Unlock deeper analysis', body: 'Once categories are confirmed, BudgetLens can show cleaner breakdowns, trends, and recurring payment analysis.' },
              { n: 3, color: 'rgba(242,187,72,0.16)', textColor: '#ffd98f', title: 'Make future imports faster', body: 'Confirmed categories help the system organize similar transactions better next time instead of starting from scratch.' },
              { n: 4, color: 'rgba(255,127,127,0.16)', textColor: '#ffb0b0', title: 'Catch what needs attention', body: 'Low-confidence merchants, unusual items, and unclear transactions can be reviewed before they distort your results.' },
            ].map(item => (
              <div key={item.n} style={{
                display: 'grid', gridTemplateColumns: '38px 1fr', gap: 12, alignItems: 'start',
                padding: 13, borderRadius: 14,
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)',
              }}>
                <div style={{
                  width: 38, height: 38, borderRadius: 11,
                  display: 'grid', placeItems: 'center',
                  fontWeight: 800, fontSize: 14,
                  background: item.color, color: item.textColor,
                }}>
                  {item.n}
                </div>
                <div>
                  <p style={{ margin: '0 0 5px', fontSize: 14, fontWeight: 800, color: 'var(--text)' }}>{item.title}</p>
                  <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Recommended action card */}
        <div style={{
          background: 'linear-gradient(180deg, rgba(127,140,255,0.11), rgba(127,140,255,0.04))',
          border: '1px solid rgba(127,140,255,0.20)',
          borderRadius: 22, padding: 22,
        }}>
          <p style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: '0 0 10px' }}>
            Recommended action
          </p>
          <h3 style={{ margin: '0 0 10px', fontSize: 22, fontWeight: 800, lineHeight: 1.15, color: 'var(--text)' }}>
            Start with uncategorized transactions
          </h3>
          <p style={{ margin: '0 0 16px', color: 'var(--text2)', fontSize: 14, lineHeight: 1.6 }}>
            Review the {counts.uncategorized} uncategorized item{counts.uncategorized !== 1 ? 's' : ''} first.
            These are the highest-priority rows — confirming them will have the biggest impact on your spending picture.
          </p>
          <button
            onClick={onStartCategorizing}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              width: '100%', padding: '13px 18px', borderRadius: 14,
              border: '1px solid transparent',
              background: 'linear-gradient(180deg, var(--accent-2, #9aa5ff), var(--accent))',
              boxShadow: '0 10px 24px rgba(111,128,255,0.28)',
              color: '#fff', fontSize: 14, fontWeight: 700,
              cursor: 'pointer', marginBottom: 10,
            }}
          >
            <PlayCircle size={14} />
            Start Categorizing
          </button>
          <button
            onClick={onViewTransactions}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
              width: '100%', padding: '13px 18px', borderRadius: 14,
              border: '1px solid var(--border)',
              background: 'rgba(255,255,255,0.04)',
              color: 'var(--text)', fontSize: 14, fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            View All Transactions
          </button>
          {counts.needsReview > 0 && (
            <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--warn)', textAlign: 'center' }}>
              ⚠ {counts.needsReview} item{counts.needsReview !== 1 ? 's' : ''} flagged for review
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
