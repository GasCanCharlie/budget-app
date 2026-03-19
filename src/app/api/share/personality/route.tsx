import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

const ACCENT_MAP: Record<string, { accent: string; glow: string }> = {
  'The Subscription Collector': { accent: '#818CF8', glow: 'rgba(129,140,248,0.22)' },
  'The Low-Key Saver':          { accent: '#4ADE80', glow: 'rgba(74,222,128,0.18)'  },
  'The Big Ticket Player':      { accent: '#FBBF24', glow: 'rgba(251,191,36,0.20)'  },
  'The Flow Master':            { accent: '#22D3EE', glow: 'rgba(34,211,238,0.20)'  },
  'The Smooth Operator':        { accent: '#A78BFA', glow: 'rgba(167,139,250,0.22)' },
  'The Smart Spender':          { accent: '#818CF8', glow: 'rgba(129,140,248,0.22)' },
  'The Steady Builder':         { accent: '#6366F1', glow: 'rgba(99,102,241,0.22)'  },
}
const FALLBACK = { accent: '#6366F1', glow: 'rgba(99,102,241,0.22)' }

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const type   = searchParams.get('type')   ?? 'The Steady Builder'
  const vibe   = searchParams.get('vibe')   ?? ''
  const income = Number(searchParams.get('income') ?? 0)
  const spend  = Number(searchParams.get('spend')  ?? 0)
  const net    = Number(searchParams.get('net')    ?? 0)
  const topCat = searchParams.get('topCat') ?? ''

  const { accent, glow } = ACCENT_MAP[type] ?? FALLBACK
  const netColor  = net >= 0 ? '#4ADE80' : '#F87171'
  const netPrefix = net >= 0 ? '+' : '−'

  const stats = [
    { label: 'Income',   value: fmtMoney(income),           color: '#e2e8f0' },
    { label: 'Spending', value: fmtMoney(spend),            color: '#e2e8f0' },
    { label: 'Net',      value: `${netPrefix}${fmtMoney(Math.abs(net))}`, color: netColor },
    ...(topCat ? [{ label: 'Top Category', value: topCat, color: '#e2e8f0' }] : []),
  ]

  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: 'flex',
          flexDirection: 'column',
          background: 'linear-gradient(140deg, #07101f 0%, #0d1630 50%, #11092e 100%)',
          position: 'relative',
          overflow: 'hidden',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Ambient glow — top-right, personality accent */}
        <div style={{
          position: 'absolute', top: -140, right: -100,
          width: 600, height: 600, borderRadius: '50%',
          background: `radial-gradient(circle, ${glow} 0%, transparent 68%)`,
          display: 'flex',
        }} />

        {/* Ambient glow — bottom-left, indigo */}
        <div style={{
          position: 'absolute', bottom: -110, left: -80,
          width: 440, height: 440, borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(99,102,241,0.11) 0%, transparent 70%)',
          display: 'flex',
        }} />

        {/* Accent stripe along left edge */}
        <div style={{
          position: 'absolute', left: 0, top: 60, bottom: 60,
          width: 3, borderRadius: 999,
          background: `linear-gradient(180deg, transparent, ${accent}, transparent)`,
          display: 'flex',
        }} />

        {/* ── Inner layout ──────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          flex: 1, padding: '52px 68px 44px 80px',
          position: 'relative',
        }}>

          {/* Top bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 48 }}>

            {/* Logo wordmark */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: 11,
                background: 'linear-gradient(135deg, #5b6bff 0%, #8794ff 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                boxShadow: '0 4px 16px rgba(99,102,241,0.40)',
              }}>
                <div style={{
                  width: 22, height: 22, borderRadius: '50%',
                  border: '2.5px solid rgba(255,255,255,0.92)',
                  display: 'flex',
                }} />
              </div>
              <span style={{ fontSize: 22, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.02em' }}>
                BudgetLens
              </span>
            </div>

            {/* Pill badge */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: glow,
              border: `1.5px solid ${accent}55`,
              borderRadius: 999, padding: '9px 20px',
            }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: accent, display: 'flex' }} />
              <span style={{ fontSize: 12, fontWeight: 700, color: accent, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                Money Personality
              </span>
            </div>
          </div>

          {/* ── Hero ──────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>
            <span style={{
              fontSize: 15, fontWeight: 600,
              color: 'rgba(255,255,255,0.42)',
              letterSpacing: '0.04em', textTransform: 'uppercase',
              marginBottom: 12, display: 'flex',
            }}>
              You&apos;re a
            </span>

            <span style={{
              fontSize: 64, fontWeight: 800, color: '#ffffff',
              letterSpacing: '-0.04em', lineHeight: 1.0,
              display: 'flex',
            }}>
              {type}
            </span>

            {vibe ? (
              <span style={{
                fontSize: 19, color: 'rgba(255,255,255,0.52)',
                marginTop: 18, fontStyle: 'italic',
                display: 'flex', letterSpacing: '-0.01em',
              }}>
                &ldquo;{vibe}&rdquo;
              </span>
            ) : null}
          </div>

          {/* ── Stats row ──────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 28 }}>
            {stats.map(({ label, value, color }) => (
              <div key={label} style={{
                display: 'flex', flexDirection: 'column', flex: 1,
                background: 'rgba(255,255,255,0.05)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 14, padding: '16px 20px',
              }}>
                <span style={{
                  fontSize: 10, fontWeight: 700,
                  color: 'rgba(255,255,255,0.35)',
                  textTransform: 'uppercase', letterSpacing: '0.10em',
                  marginBottom: 8, display: 'flex',
                }}>
                  {label}
                </span>
                <span style={{
                  fontSize: 26, fontWeight: 700, color,
                  letterSpacing: '-0.03em', display: 'flex',
                }}>
                  {value}
                </span>
              </div>
            ))}
          </div>

          {/* ── Footer ─────────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            paddingTop: 18,
          }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.22)', display: 'flex' }}>
              budgetlens.app
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.25)', display: 'flex', letterSpacing: '0.01em' }}>
              Statement Intelligence
            </span>
          </div>

        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
