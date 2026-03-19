import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'

export const runtime = 'edge'

// ─── Visual system ────────────────────────────────────────────────────────────

interface PersonalityTheme {
  accent:   string
  gradient: string  // per-personality background direction + palette
  blob: {
    top:    number
    left:   number  // negative = bleeds left, >700 = bleeds right
    width:  number
    height: number
    br:     string  // asymmetric border-radius — the signature blob shape
  }
}

const THEMES: Record<string, PersonalityTheme> = {
  'The Subscription Collector': {
    accent:   '#818CF8',
    gradient: 'linear-gradient(145deg, #070d22 0%, #0d1040 55%, #0e0c2c 100%)',
    blob: { top: 100, left: -60, width: 540, height: 430, br: '60% 40% 65% 35% / 40% 55% 45% 60%' },
  },
  'The Low-Key Saver': {
    accent:   '#4ADE80',
    gradient: 'linear-gradient(160deg, #061710 0%, #0a1e14 55%, #071520 100%)',
    blob: { top: 65, left: 730, width: 510, height: 480, br: '50% 50% 38% 62% / 62% 38% 55% 45%' },
  },
  'The Big Ticket Player': {
    accent:   '#FBBF24',
    gradient: 'linear-gradient(128deg, #1a0d03 0%, #1e1406 55%, #0f091a 100%)',
    blob: { top: 130, left: 20, width: 570, height: 420, br: '55% 45% 60% 40% / 44% 60% 40% 56%' },
  },
  'The Flow Master': {
    accent:   '#22D3EE',
    gradient: 'linear-gradient(152deg, #040f1b 0%, #061720 55%, #03121a 100%)',
    blob: { top: 50, left: 670, width: 530, height: 500, br: '44% 56% 34% 66% / 56% 44% 66% 34%' },
  },
  'The Smooth Operator': {
    accent:   '#A78BFA',
    gradient: 'linear-gradient(140deg, #0c0717 0%, #12092a 55%, #090614 100%)',
    blob: { top: 90, left: -50, width: 560, height: 455, br: '66% 34% 50% 50% / 34% 66% 50% 50%' },
  },
  'The Smart Spender': {
    accent:   '#818CF8',
    gradient: 'linear-gradient(135deg, #07081e 0%, #0b0f2a 55%, #090c1e 100%)',
    blob: { top: 105, left: 720, width: 510, height: 465, br: '48% 52% 56% 44% / 60% 40% 48% 52%' },
  },
  'The Steady Builder': {
    accent:   '#6366F1',
    gradient: 'linear-gradient(140deg, #07101f 0%, #0d1832 55%, #0a0e24 100%)',
    blob: { top: 85, left: -10, width: 525, height: 460, br: '58% 42% 52% 48% / 42% 58% 48% 52%' },
  },
}

const FALLBACK = THEMES['The Steady Builder']

// ─── Helper ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const type   = searchParams.get('type')   ?? 'The Steady Builder'
  const vibe   = searchParams.get('vibe')   ?? ''
  const income = Number(searchParams.get('income') ?? 0)
  const spend  = Number(searchParams.get('spend')  ?? 0)
  const net    = Number(searchParams.get('net')    ?? 0)
  const topCat = searchParams.get('topCat') ?? ''

  const { accent, gradient, blob } = THEMES[type] ?? FALLBACK

  // Typography: split "The" from the name for hierarchy
  const name = type.startsWith('The ') ? type.slice(4) : type

  // Net display
  const netColor  = net >= 0 ? '#4ADE80' : '#F87171'
  const netPrefix = net >= 0 ? '+' : '−'
  const netFmt    = `${netPrefix}${fmt(Math.abs(net))}`

  // 3-layer glow — strong / soft / ambient — built from hex accent
  const g1 = `${accent}30`  // ~19% — concentrated
  const g2 = `${accent}16`  // ~9%  — soft spread
  const g3 = `${accent}09`  // ~4%  — ambient wash

  return new ImageResponse(
    (
      <div style={{
        width: 1200, height: 630,
        display: 'flex', flexDirection: 'column',
        background: gradient,
        position: 'relative', overflow: 'hidden',
        fontFamily: 'sans-serif',
      }}>

        {/* ── Glow system (3 layers) ─────────────────────────────────────── */}

        {/* L1 — strong, concentrated top-right */}
        <div style={{
          position: 'absolute', top: -180, right: -130,
          width: 600, height: 600, borderRadius: '50%',
          background: `radial-gradient(circle, ${g1} 0%, transparent 62%)`,
          display: 'flex',
        }} />

        {/* L2 — soft spread, wider, drifts center-right */}
        <div style={{
          position: 'absolute', top: -80, right: -220,
          width: 860, height: 740, borderRadius: '50%',
          background: `radial-gradient(circle, ${g2} 0%, transparent 62%)`,
          display: 'flex',
        }} />

        {/* L3 — ambient, bottom-left bleed, indigo-tinted */}
        <div style={{
          position: 'absolute', bottom: -200, left: -120,
          width: 720, height: 720, borderRadius: '50%',
          background: `radial-gradient(circle, ${g3} 0%, transparent 65%)`,
          display: 'flex',
        }} />

        {/* ── Signature blob ─────────────────────────────────────────────── */}
        {/* Each personality has a unique organic shape and position.        */}
        {/* Gradient fades outward so it blends naturally into the bg.       */}
        <div style={{
          position: 'absolute',
          top: blob.top, left: blob.left,
          width: blob.width, height: blob.height,
          borderRadius: blob.br,
          background: `radial-gradient(ellipse at 42% 38%, ${accent}22 0%, ${accent}0c 52%, transparent 78%)`,
          display: 'flex',
        }} />

        {/* ── Watermark — same name at 4% opacity behind the title ─────── */}
        <div style={{
          position: 'absolute', top: 146, left: 76,
          display: 'flex', opacity: 0.04,
        }}>
          <span style={{
            fontSize: 120, fontWeight: 900, color: '#ffffff',
            letterSpacing: '-0.05em', lineHeight: 1,
            whiteSpace: 'nowrap',
          }}>
            {name}
          </span>
        </div>

        {/* ── Content layer ─────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', flexDirection: 'column',
          flex: 1, padding: '52px 72px 42px 80px',
          position: 'relative',
        }}>

          {/* Top bar: logo + pill */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 40 }}>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 38, height: 38, borderRadius: 10,
                background: 'linear-gradient(135deg, #5b6bff 0%, #8b96ff 100%)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{ width: 20, height: 20, borderRadius: '50%', border: '2.5px solid rgba(255,255,255,0.90)', display: 'flex' }} />
              </div>
              <span style={{ fontSize: 20, fontWeight: 700, color: '#ffffff', letterSpacing: '-0.025em' }}>
                BudgetLens
              </span>
            </div>

            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: `${accent}18`,
              border: `1.5px solid ${accent}40`,
              borderRadius: 999, padding: '8px 18px',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: accent, display: 'flex' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: accent, letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                Money Personality
              </span>
            </div>
          </div>

          {/* ── Hero ──────────────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'center' }}>

            {/* "THE" — accent color, small caps above */}
            <span style={{
              fontSize: 13, fontWeight: 700, color: accent,
              letterSpacing: '0.16em', textTransform: 'uppercase',
              marginBottom: 8, display: 'flex',
            }}>
              The
            </span>

            {/* Personality name — artwork scale */}
            <span style={{
              fontSize: 80, fontWeight: 800, color: '#ffffff',
              letterSpacing: '-0.05em', lineHeight: 0.92,
              display: 'flex',
            }}>
              {name}
            </span>

            {/* Vibe — italic, muted */}
            {vibe ? (
              <span style={{
                fontSize: 18, color: 'rgba(255,255,255,0.45)',
                marginTop: 24, fontStyle: 'italic',
                display: 'flex', letterSpacing: '-0.01em',
              }}>
                &ldquo;{vibe}&rdquo;
              </span>
            ) : null}
          </div>

          {/* ── Metrics — editorial inline, no boxes ──────────────────────── */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 24 }}>

            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>
              Income
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.82)', letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>
              {fmt(income)}
            </span>

            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.15)', margin: '0 18px', display: 'flex' }}>·</span>

            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>
              Spending
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.82)', letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>
              {fmt(spend)}
            </span>

            <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.15)', margin: '0 18px', display: 'flex' }}>·</span>

            <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>
              Net
            </span>
            <span style={{ fontSize: 20, fontWeight: 700, color: netColor, letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>
              {netFmt}
            </span>

            {topCat ? (
              <>
                <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.15)', margin: '0 18px', display: 'flex' }}>·</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>
                  Top
                </span>
                <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.82)', letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>
                  {topCat}
                </span>
              </>
            ) : null}
          </div>

          {/* ── Footer ────────────────────────────────────────────────────── */}
          <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            borderTop: '1px solid rgba(255,255,255,0.07)',
            paddingTop: 18,
          }}>
            <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.18)', display: 'flex' }}>
              budgetlens.app
            </span>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.20)', letterSpacing: '0.01em', display: 'flex' }}>
              Statement Intelligence
            </span>
          </div>

        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  )
}
