'use client'

import { computeHealthScore, type HealthInput } from '@/lib/health-score'

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

// SVG arc for the score dial
function ScoreArc({ score, color }: { score: number; color: string }) {
  const r = 52
  const cx = 64
  const cy = 64
  const strokeWidth = 8
  const circumference = 2 * Math.PI * r
  // Arc spans 270° (from 135° to 405°), so offset = circumference * (1 - score/100) * 0.75 + circumference*0.25
  const pct = score / 100
  const arcLength = circumference * 0.75
  const dashOffset = arcLength * (1 - pct)

  return (
    <svg width={128} height={128} style={{ display: 'block' }}>
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke="rgba(255,255,255,0.07)"
        strokeWidth={strokeWidth}
        strokeDasharray={`${arcLength} ${circumference}`}
        strokeDashoffset={0}
        strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`}
      />
      {/* Progress */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={`${arcLength} ${circumference}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        transform={`rotate(135 ${cx} ${cy})`}
        style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.3s ease', filter: `drop-shadow(0 0 6px ${color}66)` }}
      />
      {/* Score number */}
      <text
        x={cx} y={cy - 4}
        textAnchor="middle" dominantBaseline="middle"
        fontSize={28} fontWeight={800}
        fill="var(--text)"
        style={{ fontFamily: 'inherit' }}
      >
        {score}
      </text>
      <text
        x={cx} y={cy + 18}
        textAnchor="middle"
        fontSize={11} fontWeight={600}
        fill="var(--muted)"
        style={{ fontFamily: 'inherit' }}
      >
        / 100
      </text>
    </svg>
  )
}

export function HealthScoreCard(props: HealthInput) {
  const { score, color, label, factors } = computeHealthScore(props)

  // Pick top 2 driving factors (biggest gap from 100) as talking points
  const notes = [...factors]
    .sort((a, b) => (a.points * a.weight) - (b.points * b.weight))
    .slice(0, 2)
    .map(f => f.note)

  return (
    <div style={{
      background: 'var(--card2)',
      border: '1px solid var(--border-soft)',
      borderRadius: 16,
      padding: '20px 24px',
      display: 'flex',
      alignItems: 'center',
      gap: 24,
      flexWrap: 'wrap',
    }}>
      {/* Left: dial */}
      <div style={{ flexShrink: 0 }}>
        <ScoreArc score={score} color={color} />
      </div>

      {/* Middle: label + notes */}
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ marginBottom: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
            Financial Health
          </span>
          <div style={{ fontSize: 22, fontWeight: 800, color, lineHeight: 1.1, marginTop: 2 }}>
            {label}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {notes.map((note, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--muted)', flexShrink: 0, display: 'inline-block' }} />
              {note}
            </div>
          ))}
        </div>
      </div>

      {/* Right: factor breakdown */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 180 }}>
        {factors.map(f => {
          const pts = f.points
          const barColor = pts >= 80 ? '#39d07f' : pts >= 50 ? '#f0b544' : '#ef4444'
          return (
            <div key={f.name}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{f.name}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: barColor }}>{pts}</span>
              </div>
              <div style={{ height: 4, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 999,
                  width: `${pts}%`,
                  background: barColor,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
