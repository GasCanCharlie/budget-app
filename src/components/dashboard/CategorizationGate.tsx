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
        background: 'rgba(255,255,255,0.05)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 28,
        padding: 28,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
      }}>
        <p style={{ fontSize: 12, letterSpacing: 1, fontWeight: 700, opacity: .6, textTransform: 'uppercase' }}>
          Step 2 of 3
        </p>
        <h1 style={{ fontSize: 34, marginTop: 6, fontWeight: 800, color: '#eaf0ff' }}>
          Organize your transactions
        </h1>
        <p style={{ opacity: .7, marginTop: 12, fontSize: 15, color: '#eaf0ff' }}>
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
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 24,
          padding: 24,
        }}>
          <p style={{ fontSize: 13, opacity: .6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
            Progress
          </p>
          <h2 style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: '#eaf0ff' }}>
            {headlineText}
          </h2>
          <p style={{ opacity: .7, marginTop: 6, fontSize: 14, color: '#eaf0ff' }}>
            {pct === 0 ? 'Start assigning categories below.' : "You're building structure fast."}
          </p>

          {/* Big stat boxes */}
          <div style={{ display: 'flex', gap: 12, marginTop: 18 }}>
            {[
              { label: 'Categorized', value: categorizedCount, color: '#eaf0ff' },
              { label: 'Remaining',   value: uncategorizedCount, color: '#ffd87a' },
              { label: 'Total',       value: totalCount, color: '#eaf0ff' },
            ].map(({ label, value, color }) => (
              <div key={label} style={{
                flex: 1,
                background: 'rgba(255,255,255,0.06)',
                padding: 16,
                borderRadius: 18,
                fontSize: 13,
                color: '#8b97c3',
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
            background: 'rgba(255,255,255,0.08)',
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
          <p style={{ marginTop: 8, fontSize: 12, opacity: .55, color: '#eaf0ff' }}>
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
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'transparent',
                color: 'white',
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
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 24,
          padding: 24,
        }}>
          <p style={{ fontSize: 13, opacity: .6, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 700 }}>
            Unlock Next
          </p>
          <h2 style={{ marginTop: 6, fontSize: 22, fontWeight: 700, color: '#eaf0ff' }}>
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
                background: 'rgba(255,255,255,0.06)',
                padding: 16,
                borderRadius: 14,
                fontSize: 13,
                color: '#a8b3d6',
                fontWeight: 500,
              }}>
                {item}
              </div>
            ))}
          </div>

          {/* Statement info */}
          {(dateRangeStart || accountNames.length > 0) && (
            <div style={{ marginTop: 24, fontSize: 14, opacity: .75, color: '#8b97c3', lineHeight: 1.8 }}>
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
      <p style={{ opacity: .6, fontSize: 13, color: '#8b97c3' }}>
        Tip: Categorizing now makes future uploads faster — the system remembers your assignments.
      </p>

    </div>
  )
}
