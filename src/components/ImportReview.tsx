import { FileCheck2, Repeat2, ArrowLeftRight, AlertCircle, PlayCircle, type LucideIcon } from 'lucide-react'
import type { ImportSummary, TxSuggestion, ScrubFilter } from '@/lib/scrubbing'

// ─── Props ────────────────────────────────────────────────────────────────────

interface ImportReviewProps {
  summary: ImportSummary
  onFilter?: (filter: ScrubFilter | null) => void
  activeFilter?: ScrubFilter | null
  onStartCategorizing?: () => void
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterMatches(a: ScrubFilter, b: ScrubFilter | null | undefined): boolean {
  if (!b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'category' && b.kind === 'category') return a.value === b.value
  if (a.kind === 'canonical_merchant' && b.kind === 'canonical_merchant') return a.value === b.value
  return true // no-value filters (recurring, transfer, etc.)
}

function buildTopMerchants(
  summary: ImportSummary,
): Array<{ name: string; count: number; confidence: TxSuggestion['merchantConfidence'] }> {
  const map = new Map<string, { count: number; confidence: TxSuggestion['merchantConfidence'] }>()
  for (const s of summary.suggestions.values()) {
    const key = s.canonicalMerchant
    const existing = map.get(key)
    if (existing) {
      existing.count++
    } else {
      map.set(key, { count: 1, confidence: s.merchantConfidence })
    }
  }
  return Array.from(map.entries())
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 5)
    .map(([name, { count, confidence }]) => ({ name, count, confidence }))
}

// ─── Confidence pip ───────────────────────────────────────────────────────────

function ConfidencePip({ confidence }: { confidence: TxSuggestion['merchantConfidence'] }) {
  const color =
    confidence === 'high'
      ? 'var(--success)'
      : confidence === 'medium'
        ? 'var(--warn)'
        : 'var(--muted)'
  return (
    <span
      title={`Merchant confidence: ${confidence}`}
      style={{
        display: 'inline-block',
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: color,
        flexShrink: 0,
        marginLeft: 4,
      }}
    />
  )
}

// ─── Clickable row wrapper ────────────────────────────────────────────────────

function FilterRow({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 28px 52px',
        width: '100%',
        alignItems: 'center',
        gap: 6,
        padding: '5px 8px',
        borderRadius: 8,
        border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
        background: isActive ? 'var(--accent-muted)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface2)'
      }}
      onMouseLeave={e => {
        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
      }}
    >
      {children}
    </button>
  )
}

// ─── Stat chip ────────────────────────────────────────────────────────────────

function StatChip({
  icon: Icon,
  label,
  value,
  accent,
  isActive,
  onClick,
}: {
  icon: LucideIcon
  label: string
  value: number
  accent?: boolean
  isActive?: boolean
  onClick?: () => void
}) {
  const color = isActive ? 'var(--accent)' : accent && value > 0 ? 'var(--warn)' : 'var(--muted)'
  return (
    <button
      onClick={onClick}
      disabled={value === 0}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 99,
        border: `1px solid ${isActive ? 'var(--accent)' : 'transparent'}`,
        background: isActive ? 'var(--accent-muted)' : 'transparent',
        cursor: value === 0 ? 'default' : 'pointer',
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => {
        if (value > 0 && !isActive) (e.currentTarget as HTMLButtonElement).style.background = 'var(--surface2)'
      }}
      onMouseLeave={e => {
        if (!isActive) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'
      }}
    >
      <Icon size={13} style={{ color, flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: isActive ? 'var(--accent)' : accent && value > 0 ? 'var(--warn)' : 'var(--text)' }}>
        {value}
      </span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
    </button>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ImportReview({
  summary,
  onFilter,
  activeFilter,
  onStartCategorizing,
}: ImportReviewProps) {
  const maxCount = summary.categoryBreakdown[0]?.count ?? 1
  const topMerchants = buildTopMerchants(summary)
  const maxMerchantCount = topMerchants[0]?.count ?? 1

  function toggle(f: ScrubFilter) {
    if (!onFilter) return
    onFilter(filterMatches(f, activeFilter) ? null : f)
  }

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '18px 20px',
      }}
    >
      {/* ── Header + CTA ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <FileCheck2 size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: 0 }}>
            Import Review
          </p>
        </div>
        {onStartCategorizing && (
          <button
            onClick={onStartCategorizing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 14px',
              borderRadius: 99,
              border: '1px solid var(--accent)',
              background: 'var(--accent)',
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              flexShrink: 0,
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          >
            <PlayCircle size={13} />
            Start Categorizing
          </button>
        )}
      </div>

      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 3px' }}>
        {summary.transactionCount} transactions imported
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', margin: '0 0 16px', lineHeight: 1.5 }}>
        We import exactly what appears in your statement file. Suggestions are temporary — nothing is saved until you confirm it.
      </p>

      {/* ── Two-column breakdown ─────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>

        {/* Categories */}
        {summary.categoryBreakdown.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px', paddingLeft: 8 }}>
              Detected categories
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {summary.categoryBreakdown.map(({ category, count }) => {
                const f: ScrubFilter = { kind: 'category', value: category }
                const isActive = filterMatches(f, activeFilter)
                return (
                  <FilterRow key={category} isActive={isActive} onClick={() => toggle(f)}>
                    <span style={{ fontSize: 12, color: isActive ? 'var(--accent)' : 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                      {category}
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {count}
                    </span>
                    <div style={{ height: 4, borderRadius: 99, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 99, background: 'var(--accent)', opacity: isActive ? 1 : 0.5, width: `${Math.round((count / maxCount) * 100)}%` }} />
                    </div>
                  </FilterRow>
                )
              })}
            </div>
          </div>
        )}

        {/* Top merchants */}
        {topMerchants.length > 0 && (
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 4px', paddingLeft: 8 }}>
              Top merchants
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {topMerchants.map(({ name, count, confidence }) => {
                const f: ScrubFilter = { kind: 'canonical_merchant', value: name }
                const isActive = filterMatches(f, activeFilter)
                return (
                  <FilterRow key={name} isActive={isActive} onClick={() => toggle(f)}>
                    <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                      <span style={{ fontSize: 12, color: isActive ? 'var(--accent)' : 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {name}
                      </span>
                      <ConfidencePip confidence={confidence} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                      {count}
                    </span>
                    <div style={{ height: 4, borderRadius: 99, background: 'var(--surface2)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', borderRadius: 99, background: 'var(--accent)', opacity: isActive ? 1 : 0.45, width: `${Math.round((count / maxMerchantCount) * 100)}%` }} />
                    </div>
                  </FilterRow>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid var(--border)' }}>
        <StatChip
          icon={Repeat2}
          label="Recurring"
          value={summary.recurringCount}
          isActive={filterMatches({ kind: 'recurring' }, activeFilter)}
          onClick={() => toggle({ kind: 'recurring' })}
        />
        <StatChip
          icon={ArrowLeftRight}
          label="Transfers"
          value={summary.transferCount}
          isActive={filterMatches({ kind: 'transfer' }, activeFilter)}
          onClick={() => toggle({ kind: 'transfer' })}
        />
        <StatChip
          icon={AlertCircle}
          label="Needs review"
          value={summary.needsReview}
          accent={summary.needsReview > 0}
          isActive={filterMatches({ kind: 'needs_review' }, activeFilter)}
          onClick={() => toggle({ kind: 'needs_review' })}
        />
      </div>
    </div>
  )
}
