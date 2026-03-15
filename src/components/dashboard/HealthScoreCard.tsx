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
  const { totalIncome, totalSpending, net, monthlySubscriptions, categories } = props
  const { score, color, label, factors } = computeHealthScore(props)

  // ── Plain-language display values (no changes to score calculation) ────────

  // 1. Income Remaining
  const incomeRemainingColor =
    totalIncome > 0 && net / totalIncome >= 0.10 ? '#22C55E' :
    net >= 0 ? '#F59E0B' : '#EF4444'

  // 2. Savings Strength
  const savingsRate = totalIncome > 0 ? (net / totalIncome) * 100 : 0
  const savingsColor =
    savingsRate >= 20 ? '#22C55E' :
    savingsRate >= 10 ? '#F59E0B' : '#EF4444'

  // 3. Positive Months (back-derive streak from factor points: pts = streak/3 × 100)
  const streakPts = factors[2].points
  const streakMonths = Math.round(streakPts * 3 / 100)
  const streakColor =
    streakMonths >= 3 ? '#22C55E' :
    streakMonths >= 1 ? '#F59E0B' : '#EF4444'

  // 4. Subscriptions
  const subPct = totalIncome > 0 ? (monthlySubscriptions / totalIncome) * 100 : 0
  const subColor =
    subPct < 5 ? '#22C55E' :
    subPct < 10 ? '#F59E0B' : '#EF4444'

  // 5. Top Category Share
  const topCat = categories[0] ?? null
  const topPct = topCat?.pctOfSpending ?? 0
  const topCatColor =
    topPct <= 30 ? '#22C55E' :
    topPct <= 50 ? '#F59E0B' : '#EF4444'

  const metrics = [
    {
      label: 'Income Remaining',
      value: fmt(Math.abs(net)),
      sub: net >= 0 ? 'left this month' : 'over budget',
      color: incomeRemainingColor,
      barPct: factors[0].points,
    },
    {
      label: 'Savings Strength',
      value: `${Math.round(Math.max(0, savingsRate))}%`,
      sub: 'of income saved',
      color: savingsColor,
      barPct: factors[1].points,
    },
    {
      label: 'Positive Months',
      value: `${streakMonths}`,
      sub: `month${streakMonths !== 1 ? 's' : ''} in a row`,
      color: streakColor,
      barPct: factors[2].points,
    },
    {
      label: 'Subscriptions',
      value: `${Math.round(subPct)}%`,
      sub: 'of income',
      color: subColor,
      barPct: factors[3].points,
    },
    {
      label: 'Top Category Share',
      value: topCat ? `${Math.round(topPct)}%` : '—',
      sub: topCat ? topCat.categoryName : 'No data',
      color: topCatColor,
      barPct: factors[4].points,
    },
  ]

  // Pick the 2 weakest metrics as talking points (lowest weighted contribution)
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

      {/* Right: plain-language metrics */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200 }}>
        {metrics.map(m => (
          <div key={m.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 3 }}>
              <span style={{ fontSize: 11, color: '#9CA3AF', fontWeight: 600 }}>{m.label}</span>
              <div style={{ textAlign: 'right' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: m.color }}>{m.value}</span>
                <span style={{ fontSize: 10, color: '#9CA3AF', marginLeft: 4 }}>{m.sub}</span>
              </div>
            </div>
            <div style={{ height: 3, borderRadius: 999, background: 'rgba(255,255,255,0.07)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 999,
                width: `${m.barPct}%`,
                background: m.color,
                transition: 'width 0.5s ease',
              }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
