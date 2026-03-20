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
  // ── Core Universal additions ─────────────────────────────────────
  'The Full Send': {
    accent: '#F97316',
    gradient: 'linear-gradient(135deg, #1a0800 0%, #221000 55%, #150500 100%)',
    blob: { top: 80, left: -40, width: 550, height: 440, br: '62% 38% 58% 42% / 45% 58% 42% 55%' },
  },
  'The Wire Dancer': {
    accent: '#2DD4BF',
    gradient: 'linear-gradient(148deg, #031414 0%, #041c1c 55%, #021010 100%)',
    blob: { top: 60, left: 700, width: 520, height: 460, br: '44% 56% 38% 62% / 60% 40% 62% 38%' },
  },
  'The Breakeven Poet': {
    accent: '#C084FC',
    gradient: 'linear-gradient(142deg, #0e0818 0%, #150e24 55%, #0b0714 100%)',
    blob: { top: 110, left: -30, width: 540, height: 450, br: '50% 50% 60% 40% / 38% 62% 50% 50%' },
  },
  'The Adrenaline Accountant': {
    accent: '#F43F5E',
    gradient: 'linear-gradient(138deg, #1a0308 0%, #220510 55%, #14020a 100%)',
    blob: { top: 90, left: 710, width: 530, height: 470, br: '56% 44% 42% 58% / 44% 56% 58% 42%' },
  },
  'The Chaos Controller': {
    accent: '#FB923C',
    gradient: 'linear-gradient(130deg, #180900 0%, #201200 55%, #130700 100%)',
    blob: { top: 120, left: 10, width: 560, height: 430, br: '48% 52% 66% 34% / 52% 48% 34% 66%' },
  },
  'The Savvy Spender': {
    accent: '#818CF8',
    gradient: 'linear-gradient(135deg, #07081e 0%, #0b0f2a 55%, #090c1e 100%)',
    blob: { top: 105, left: 720, width: 510, height: 465, br: '48% 52% 56% 44% / 60% 40% 48% 52%' },
  },
  'The Safety Buffer': {
    accent: '#60A5FA',
    gradient: 'linear-gradient(145deg, #050d1a 0%, #091528 55%, #060e1c 100%)',
    blob: { top: 75, left: -20, width: 530, height: 455, br: '54% 46% 48% 52% / 46% 54% 52% 48%' },
  },
  // ── Bank specific ────────────────────────────────────────────────
  'The Overdraft Artist': {
    accent: '#FB923C',
    gradient: 'linear-gradient(140deg, #160800 0%, #1c1000 55%, #110600 100%)',
    blob: { top: 95, left: 680, width: 515, height: 460, br: '60% 40% 44% 56% / 40% 60% 56% 44%' },
  },
  'The Cash Keeper': {
    accent: '#34D399',
    gradient: 'linear-gradient(155deg, #031408 0%, #061c0c 55%, #041008 100%)',
    blob: { top: 70, left: -50, width: 545, height: 470, br: '52% 48% 62% 38% / 58% 42% 46% 54%' },
  },
  'The Direct Depositor': {
    accent: '#38BDF8',
    gradient: 'linear-gradient(148deg, #030f18 0%, #06161e 55%, #030c14 100%)',
    blob: { top: 100, left: 730, width: 505, height: 450, br: '46% 54% 52% 48% / 62% 38% 50% 50%' },
  },
  // ── Credit specific ──────────────────────────────────────────────
  'The Revolving Door': {
    accent: '#FB923C',
    gradient: 'linear-gradient(135deg, #160a00 0%, #1e1200 55%, #120800 100%)',
    blob: { top: 85, left: -35, width: 535, height: 445, br: '58% 42% 56% 44% / 42% 58% 44% 56%' },
  },
  'The Points Chaser': {
    accent: '#FBBF24',
    gradient: 'linear-gradient(128deg, #181000 0%, #1e1600 55%, #120e00 100%)',
    blob: { top: 65, left: 720, width: 520, height: 480, br: '44% 56% 36% 64% / 64% 36% 58% 42%' },
  },
  'The Minimum Payer': {
    accent: '#FB923C',
    gradient: 'linear-gradient(140deg, #160a00 0%, #1c1000 55%, #110800 100%)',
    blob: { top: 115, left: -25, width: 550, height: 435, br: '56% 44% 62% 38% / 44% 56% 38% 62%' },
  },
  'The Cashback Architect': {
    accent: '#818CF8',
    gradient: 'linear-gradient(145deg, #070a1e 0%, #0c1030 55%, #080c20 100%)',
    blob: { top: 80, left: 740, width: 510, height: 460, br: '50% 50% 44% 56% / 56% 44% 60% 40%' },
  },
  'The One Card Wonder': {
    accent: '#94A3B8',
    gradient: 'linear-gradient(138deg, #090c12 0%, #0e1420 55%, #070a10 100%)',
    blob: { top: 100, left: -15, width: 525, height: 450, br: '52% 48% 58% 42% / 48% 52% 42% 58%' },
  },
  'The Utilization King': {
    accent: '#FB923C',
    gradient: 'linear-gradient(132deg, #180900 0%, #201200 55%, #140700 100%)',
    blob: { top: 70, left: 710, width: 530, height: 470, br: '60% 40% 48% 52% / 40% 60% 54% 46%' },
  },
  'The Balance Transfer': {
    accent: '#FBBF24',
    gradient: 'linear-gradient(142deg, #160e00 0%, #1e1600 55%, #120a00 100%)',
    blob: { top: 90, left: -45, width: 540, height: 455, br: '46% 54% 60% 40% / 54% 46% 40% 60%' },
  },
  // ── Premium ──────────────────────────────────────────────────────
  'The Quiet Millionaire': {
    accent: '#F59E0B',
    gradient: 'linear-gradient(145deg, #0f0a00 0%, #181200 55%, #0c0800 100%)',
    blob: { top: 60, left: -60, width: 580, height: 490, br: '55% 45% 50% 50% / 45% 55% 50% 50%' },
  },
  'The Strategic Deployer': {
    accent: '#818CF8',
    gradient: 'linear-gradient(140deg, #06081c 0%, #0a0e2c 55%, #070920 100%)',
    blob: { top: 95, left: 730, width: 515, height: 465, br: '48% 52% 54% 46% / 58% 42% 46% 54%' },
  },
  'The Compounding Machine': {
    accent: '#34D399',
    gradient: 'linear-gradient(155deg, #031208 0%, #051a0e 55%, #030e08 100%)',
    blob: { top: 75, left: -30, width: 535, height: 460, br: '54% 46% 44% 56% / 44% 56% 58% 42%' },
  },
}

const FALLBACK = THEMES['The Steady Builder']

// ─── Helper ───────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url)

  const type   = searchParams.get('type')   ?? 'The Steady Builder'
  const vibe   = searchParams.get('vibe')   ?? ''
  const income = Number(searchParams.get('income') ?? 0)
  const spend  = Number(searchParams.get('spend')  ?? 0)
  const net    = Number(searchParams.get('net')    ?? 0)
  const topCat = searchParams.get('topCat') ?? ''
  const trait  = searchParams.get('trait')  ?? ''

  // ── Subscription Collector — illustration-based share card ────────────────
  if (type === 'The Subscription Collector') {
    const netColor  = net >= 0 ? '#4ADE80' : '#F87171'
    const netPrefix = net >= 0 ? '+' : '−'
    const netFmt    = `${netPrefix}${fmt(Math.abs(net))}`
    const imgSrc    = `${origin}/personalities/subscription-collector.webp`

    return new ImageResponse(
      (
        <div style={{
          width: 1200, height: 630,
          display: 'flex', position: 'relative', overflow: 'hidden',
          fontFamily: 'sans-serif',
        }}>
          {/* Illustration — fills card */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imgSrc} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />

          {/* Top scrim */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: 140,
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.72) 0%, transparent 100%)',
            display: 'flex',
          }} />

          {/* Bottom scrim */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0, height: 200,
            background: 'linear-gradient(to top, rgba(0,0,0,0.88) 0%, rgba(0,0,0,0.55) 55%, transparent 100%)',
            display: 'flex',
          }} />

          {/* Top bar: BudgetLens logo + pill */}
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '42px 60px 0',
          }}>
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
              background: 'rgba(251,191,36,0.18)',
              border: '1.5px solid rgba(251,191,36,0.45)',
              borderRadius: 999, padding: '8px 18px',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#FBBF24', display: 'flex' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#FBBF24', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                Money Personality
              </span>
            </div>
          </div>

          {/* Bottom content: vibe + metrics + footer */}
          <div style={{
            position: 'absolute', bottom: 0, left: 0, right: 0,
            display: 'flex', flexDirection: 'column',
            padding: '0 60px 36px',
          }}>
            {/* Vibe */}
            {vibe ? (
              <span style={{
                fontSize: 18, color: 'rgba(255,255,255,0.60)',
                fontStyle: 'italic', marginBottom: 18, display: 'flex',
                letterSpacing: '-0.01em',
              }}>
                &ldquo;{vibe}&rdquo;
              </span>
            ) : null}

            {/* Metrics */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 20 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>Income</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.82)', letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>{fmt(income)}</span>
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.15)', margin: '0 18px', display: 'flex' }}>·</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>Spending</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.82)', letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>{fmt(spend)}</span>
              <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.15)', margin: '0 18px', display: 'flex' }}>·</span>
              <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>Net</span>
              <span style={{ fontSize: 20, fontWeight: 700, color: netColor, letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>{netFmt}</span>
              {topCat ? (
                <>
                  <span style={{ fontSize: 16, color: 'rgba(255,255,255,0.15)', margin: '0 18px', display: 'flex' }}>·</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.32)', letterSpacing: '0.10em', textTransform: 'uppercase', display: 'flex' }}>Top</span>
                  <span style={{ fontSize: 20, fontWeight: 700, color: 'rgba(255,255,255,0.82)', letterSpacing: '-0.02em', marginLeft: 9, display: 'flex' }}>{topCat}</span>
                </>
              ) : null}
            </div>

            {/* Footer */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              borderTop: '1px solid rgba(255,255,255,0.10)',
              paddingTop: 16,
            }}>
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,0.22)', display: 'flex' }}>budgetlens.app</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.01em', display: 'flex' }}>Statement Intelligence</span>
            </div>
          </div>
        </div>
      ),
      { width: 1200, height: 630 }
    )
  }

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

            {trait ? (
              <span style={{
                fontSize: 28, fontWeight: 700, color: `${accent}99`,
                letterSpacing: '-0.03em', lineHeight: 1.1,
                marginTop: 8, display: 'flex',
              }}>
                · {trait}
              </span>
            ) : null}

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
