import { FileCheck2, Repeat2, ArrowLeftRight, AlertCircle, type LucideIcon } from 'lucide-react'
import type { ImportSummary } from '@/lib/scrubbing'

export function ImportReview({ summary }: { summary: ImportSummary }) {
  const maxCount = summary.categoryBreakdown[0]?.count ?? 1

  return (
    <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 14, padding: '18px 20px' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <FileCheck2 size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--muted)', margin: 0 }}>
          Import Review
        </p>
      </div>

      <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)', margin: '0 0 4px' }}>
        {summary.transactionCount} transactions imported
      </p>
      <p style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', margin: '0 0 16px', lineHeight: 1.5 }}>
        We import exactly what appears in your statement file. Suggestions are temporary — nothing is saved until you confirm it.
      </p>

      {/* Category breakdown */}
      {summary.categoryBreakdown.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 8px' }}>
            Detected categories
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {summary.categoryBreakdown.map(({ category, count }) => (
              <div key={category} style={{ display: 'grid', gridTemplateColumns: '140px 32px 1fr', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {category}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  {count}
                </span>
                <div style={{ height: 4, borderRadius: 99, background: 'var(--surface2)', overflow: 'hidden' }}>
                  <div style={{ height: '100%', borderRadius: 99, background: 'var(--accent)', width: `${Math.round((count / maxCount) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stats row */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', paddingTop: 12, borderTop: '1px solid var(--border)', marginBottom: 14 }}>
        <StatChip icon={Repeat2}        label="Recurring payments" value={summary.recurringCount} />
        <StatChip icon={ArrowLeftRight}  label="Possible transfers"  value={summary.transferCount} />
        <StatChip icon={AlertCircle}     label="Needs review"        value={summary.needsReview} accent={summary.needsReview > 0} />
      </div>

      {/* CTA */}
      <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>
        → Categorize transactions below to unlock deeper insights.
      </p>
    </div>
  )
}

function StatChip({ icon: Icon, label, value, accent }: {
  icon: LucideIcon
  label: string
  value: number
  accent?: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Icon size={13} style={{ color: accent && value > 0 ? 'var(--warn)' : 'var(--muted)', flexShrink: 0 }} />
      <span style={{ fontSize: 12, fontWeight: 700, color: accent && value > 0 ? 'var(--warn)' : 'var(--text)' }}>{value}</span>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
    </div>
  )
}
