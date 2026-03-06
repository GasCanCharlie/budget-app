'use client'

import Link from 'next/link'
import { ArrowRight } from 'lucide-react'

interface Props {
  uncategorizedCount: number
  totalCount:         number
  categorizedCount:   number
  dateRangeStart:     string | null
  dateRangeEnd:       string | null
  accountNames:       string[]
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const UNLOCK_ITEMS = [
  'Income vs Spending',
  'Category Breakdown',
  'Largest Expenses',
  'Monthly Trends',
  'Unusual Transactions',
  'Auto-Learning Rules',
]

export function CategorizationGate({
  uncategorizedCount,
  totalCount,
  categorizedCount,
  dateRangeStart,
  dateRangeEnd,
  accountNames,
}: Props) {
  const pct = totalCount > 0 ? Math.round((categorizedCount / totalCount) * 100) : 0

  const headlineText = pct === 0
    ? "Let's get started"
    : pct < 50
    ? 'Good start'
    : pct < 80
    ? 'Nice progress'
    : 'Almost there'

  return (
    <div className="space-y-6 pb-24">

      {/* ── Hero glass card ─────────────────────────────────────────────────── */}
      <div style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 28,
        padding: 28,
        boxShadow: 'var(--shadow)',
      }}>
        <p style={{ fontSize: 12, letterSpacing: 1, fontWeight: 700, opacity: .6, textTransform: 'uppercase', color: 'var(--muted)' }}>
          Step 2 of 3
        </p>
        <h1 style={{ fontSize: 34, marginTop: 6, fontWeight: 800, color: 'var(--text)' }}>
          Organize your transactions
        </h1>
        <p style={{ opacity: .7, marginTop: 12, fontSize: 15, color: 'var(--text)' }}>
          Your statement is imported. Assign a category to each transaction to unlock insights and reports.
        </p>
      </div>

      {/* ── Two-column grid ──────────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)',
        gap: 24,
      }} className="max-[700px]:!grid-cols-1">

        {/* Left: Progress card */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 24,
          padding: 24,
        }}>
          <p style={{ fontSize: 13, opacity: .6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, color: 'var(--muted)' }}>
            Progress
          </p>
          <h2 style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
            {headlineText}
          </h2>
          <p style={{ opacity: .7, marginTop: 6, fontSize: 14, color: 'var(--text)' }}>
            {pct === 0 ? 'Start assigning categories below.' : "You're building structure fast."}
          </p>

          {/* Big stat boxes */}
          <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
            {[
              { label: 'Categorized', value: categorizedCount, color: 'var(--text)' },
              { label: 'Remaining',   value: uncategorizedCount, color: 'var(--warn)' },
              { label: 'Total',       value: totalCount, color: 'var(--text)' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                flex: 1,
                background: 'var(--surface2)',
                padding: 16,
                borderRadius: 18,
                fontSize: 13,
                color: 'var(--muted)',
              }}>
                {label}
                <strong style={{ fontSize: 22, display: 'block', marginTop: 4, color }}>{value}</strong>
              </div>
            ))}
          </div>

          {/* Progress bar */}
          <div style={{
            marginTop: 20,
            height: 14,
            borderRadius: 999,
            background: 'var(--track)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${pct}%`,
              background: 'linear-gradient(to right, #6ea8ff, #8a7dff)',
              borderRadius: 999,
              transition: 'width 0.5s ease',
            }} />
          </div>
          <p style={{ marginTop: 8, fontSize: 12, opacity: .7, color: 'var(--muted)' }}>
            {pct}% complete — {uncategorizedCount} remaining
          </p>

          {/* CTA buttons */}
          <div style={{ marginTop: 26, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Link
              href="/categorize"
              className="inline-flex items-center gap-2"
              style={{
                padding: '14px 24px',
                borderRadius: 18,
                background: 'linear-gradient(to right, #6ea8ff, #8a7dff)',
                color: 'white',
                fontWeight: 700,
                fontSize: 14,
                textDecoration: 'none',
                boxShadow: '0 18px 40px rgba(110,168,255,0.25)',
              }}
            >
              Continue Categorizing
              <ArrowRight size={16} />
            </Link>
            <Link
              href="/transactions"
              style={{
                padding: '14px 24px',
                borderRadius: 18,
                border: '1px solid var(--border2)',
                background: 'transparent',
                color: 'var(--text)',
                fontWeight: 600,
                fontSize: 14,
                textDecoration: 'none',
              }}
            >
              Review Imported Data
            </Link>
          </div>
        </div>

        {/* Right: Unlock preview card */}
        <div style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 24,
          padding: 24,
        }}>
          <p style={{ fontSize: 13, opacity: .6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700, color: 'var(--muted)' }}>
            Unlock Next
          </p>
          <h2 style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>
            Insights after categorizing
          </h2>

          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 12,
            marginTop: 18,
          }}>
            {UNLOCK_ITEMS.map(item => (
              <div key={item} style={{
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                padding: 16,
                borderRadius: 14,
                fontSize: 13,
                color: 'var(--text2)',
                fontWeight: 500,
              }}>
                {item}
              </div>
            ))}
          </div>

          {/* Statement info */}
          {(dateRangeStart || accountNames.length > 0) && (
            <div style={{ marginTop: 24, fontSize: 14, opacity: .85, color: 'var(--muted)', lineHeight: 1.8 }}>
              {dateRangeStart && dateRangeEnd && (
                <div>{fmtDate(dateRangeStart)} — {fmtDate(dateRangeEnd)}</div>
              )}
              <div>{totalCount} transactions imported</div>
              {accountNames.length > 0 && (
                <div>Account: {accountNames.join(', ')}</div>
              )}
            </div>
          )}
        </div>

      </div>

      {/* ── Footer tip ───────────────────────────────────────────────────────── */}
      <p style={{ opacity: .75, fontSize: 13, color: 'var(--muted)' }}>
        Tip: Categorizing now makes future uploads faster — the system remembers your assignments.
      </p>

    </div>
  )
}
