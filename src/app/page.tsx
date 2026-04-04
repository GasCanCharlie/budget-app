'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { LogoMark } from '@/components/LogoMark'

const CSS = `
.lp {
  --bg: #07111f;
  --bg2: #040d18;
  --text: #f0f4ff;
  --muted: #8b97c3;
  --muted2: #6b7ab0;
  --cyan: #67e8f9;
  --cyan2: #22d3ee;
  --brand: #6ea8ff;
  --brand2: #8a7dff;
  --good: #2ee59d;
  --warn: #ffcc66;
  --shadow: 0 24px 80px rgba(0,0,0,.65);
  --shadow2: 0 10px 30px rgba(0,0,0,.40);
  --radius-xl: 28px;
  --max: 1140px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
  color: var(--text);
  background: var(--bg);
  overflow-x: hidden;
  min-height: 100vh;
}
.lp a { color: inherit; text-decoration: none; }
.lp button { font: inherit; color: inherit; }
.lp .wrap { width: min(var(--max), calc(100% - 48px)); margin: 0 auto; }

/* ── Ambient glows ── */
.lp .glows {
  pointer-events: none;
  position: fixed;
  inset: 0;
  overflow: hidden;
  z-index: 0;
}
.lp .glow-a {
  position: absolute;
  top: -120px; left: -8%;
  width: 600px; height: 600px;
  border-radius: 999px;
  background: rgba(103,232,249,.10);
  filter: blur(90px);
}
.lp .glow-b {
  position: absolute;
  top: 15%; right: -6%;
  width: 700px; height: 700px;
  border-radius: 999px;
  background: rgba(110,168,255,.12);
  filter: blur(100px);
}
.lp .glow-c {
  position: absolute;
  bottom: -8%; left: 22%;
  width: 500px; height: 500px;
  border-radius: 999px;
  background: rgba(138,125,255,.08);
  filter: blur(80px);
}
.lp .grid-overlay {
  position: absolute;
  inset: 0;
  opacity: .045;
  background-image: linear-gradient(rgba(255,255,255,.8) 1px, transparent 1px),
                    linear-gradient(90deg, rgba(255,255,255,.8) 1px, transparent 1px);
  background-size: 44px 44px;
}

/* ── Nav ── */
.lp .nav {
  position: sticky; top: 16px; z-index: 50;
  margin: 16px auto 0;
  width: min(var(--max), calc(100% - 48px));
}
.lp .nav-inner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,.10);
  background: rgba(7,17,31,.75);
  backdrop-filter: blur(16px);
}
.lp .brand { display: flex; align-items: center; gap: 10px; }
.lp .brand-name { font-size: 13px; font-weight: 700; letter-spacing: .25em; text-transform: uppercase; color: rgba(255,255,255,.60); }
.lp .brand-sub { font-size: 11px; color: var(--muted2); margin-top: 1px; }
.lp .nav-links { display: flex; align-items: center; gap: 6px; }
.lp .nav-links a {
  padding: 7px 14px; border-radius: 999px; font-size: 13px; font-weight: 550;
  color: rgba(255,255,255,.65);
  transition: color .15s, background .15s;
}
.lp .nav-links a:hover { color: var(--text); background: rgba(255,255,255,.07); }
.lp .nav-cta { display: flex; gap: 8px; }

/* ── Buttons ── */
.lp .btn {
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.07);
  padding: 10px 16px; border-radius: 14px; cursor: pointer;
  transition: transform .15s, background .15s, border-color .15s;
  font-weight: 650; font-size: 14px; display: inline-flex; align-items: center; gap: 6px;
}
.lp .btn:hover { transform: translateY(-1px); background: rgba(255,255,255,.11); border-color: rgba(255,255,255,.22); }
.lp .btn-primary {
  background: #ffffff;
  color: #07111f;
  border-color: rgba(255,255,255,.90);
  box-shadow: 0 0 40px rgba(255,255,255,.12);
}
.lp .btn-primary:hover { background: rgba(255,255,255,.92); transform: translateY(-1px); }
.lp .btn-cyan {
  background: rgba(103,232,249,.15);
  border-color: rgba(103,232,249,.30);
  color: var(--cyan);
}
.lp .btn-cyan:hover { background: rgba(103,232,249,.22); }

/* ── Hero ── */
.lp .hero { padding: 56px 0 32px; position: relative; z-index: 1; }
.lp .hero-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 32px; align-items: center; }
.lp .hero-kicker {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 14px; border-radius: 999px;
  border: 1px solid rgba(103,232,249,.22);
  background: rgba(103,232,249,.08);
  color: rgba(103,232,249,.90); font-weight: 650; font-size: 12px; letter-spacing: .3px;
  margin-bottom: 18px;
}
.lp .hero-kicker .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--cyan2); box-shadow: 0 0 0 5px rgba(34,211,238,.15); }
.lp h1 {
  font-size: clamp(36px, 4.8vw, 66px);
  line-height: .94;
  letter-spacing: -2.5px;
  font-weight: 950;
  margin: 0 0 18px;
}
.lp h1 .grad {
  background: linear-gradient(135deg, var(--cyan) 0%, #fff 50%, var(--brand) 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.lp .hero-sub { color: var(--muted); font-size: 17px; line-height: 1.6; max-width: 52ch; margin: 0 0 28px; }
.lp .hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.lp .hero-actions .btn { padding: 13px 20px; border-radius: 16px; font-size: 15px; }
.lp .hero-proof { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 22px; }
.lp .hero-proof .pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.09); background: rgba(255,255,255,.04);
  font-size: 12px; color: rgba(255,255,255,.58);
}

/* ── Personality hero card ── */
.lp .p-hero-card {
  border-radius: 28px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(7,17,31,.85);
  overflow: hidden;
  box-shadow: 0 40px 140px rgba(0,0,0,.55), 0 0 0 1px rgba(103,232,249,.10);
  position: relative;
}
.lp .p-hero-card:before {
  content: "";
  position: absolute; inset: -1px;
  background: radial-gradient(500px 300px at 30% 0%, rgba(103,232,249,.15), transparent 60%);
  pointer-events: none; z-index: 1;
}
.lp .p-hero-img { width: 100%; height: 280px; object-fit: cover; display: block; }
.lp .p-hero-body { padding: 20px; position: relative; }
.lp .p-hero-eyebrow {
  font-size: 10px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase;
  color: var(--cyan2); margin-bottom: 8px;
}
.lp .p-hero-name { font-size: 26px; font-weight: 950; letter-spacing: -.5px; margin: 0 0 6px; }
.lp .p-hero-line { font-size: 13px; color: var(--muted); line-height: 1.5; margin: 0 0 14px; }
.lp .p-hero-tags {
  display: flex; gap: 6px; flex-wrap: wrap;
}
.lp .p-hero-tag {
  font-size: 11px; color: rgba(255,255,255,.55);
  border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.05);
  border-radius: 999px; padding: 4px 10px;
}

/* ── Sections ── */
.lp .section { padding: 40px 0; position: relative; z-index: 1; }
.lp .eyebrow {
  font-size: 11px; font-weight: 800; letter-spacing: .7px; text-transform: uppercase;
  color: rgba(103,232,249,.65); margin-bottom: 10px;
}
.lp .section h2 { font-size: clamp(24px, 2.8vw, 36px); letter-spacing: -.5px; font-weight: 950; margin: 0 0 10px; }
.lp .section p.lead { color: var(--muted); font-size: 15px; line-height: 1.65; max-width: 66ch; margin: 0 0 28px; }

/* ── Why this works ── */
.lp .why-grid {
  display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 14px;
  border-radius: 28px; border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.035); padding: 28px; backdrop-filter: blur(8px);
}
.lp .why-grid h2 { font-size: clamp(22px, 2.4vw, 30px); margin: 12px 0 0; }
.lp .why-col { color: rgba(255,255,255,.68); font-size: 14px; line-height: 1.75; }

/* ── Steps ── */
.lp .steps-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.lp .step-card {
  border-radius: 24px; border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.035); padding: 22px;
  transition: transform .18s, background .18s;
}
.lp .step-card:hover { transform: translateY(-3px); background: rgba(255,255,255,.06); }
.lp .step-num { font-size: 11px; font-weight: 800; letter-spacing: .7px; color: rgba(103,232,249,.60); }
.lp .step-title { font-size: 22px; font-weight: 900; margin: 14px 0 10px; }
.lp .step-text { font-size: 14px; color: var(--muted); line-height: 1.7; }

/* ── Personalities grid ── */
.lp .p-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
.lp .p-card {
  border-radius: 26px; border: 1px solid rgba(255,255,255,.09);
  background: linear-gradient(160deg, rgba(255,255,255,.07), rgba(255,255,255,.02));
  overflow: hidden;
  transition: transform .18s, border-color .18s;
}
.lp .p-card:hover { transform: translateY(-3px); border-color: rgba(103,232,249,.20); }
.lp .p-card-img { width: 100%; height: 200px; object-fit: cover; display: block; }
.lp .p-card-body { padding: 20px; }
.lp .p-card-num {
  display: inline-block; font-size: 10px; font-weight: 800; letter-spacing: .6px;
  border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.05);
  border-radius: 999px; padding: 3px 9px; color: rgba(255,255,255,.45); margin-bottom: 14px;
}
.lp .p-card-name { font-size: 26px; font-weight: 950; letter-spacing: -.5px; margin: 0 0 8px; }
.lp .p-card-line { font-size: 15px; font-weight: 600; color: rgba(255,255,255,.82); margin: 0 0 8px; }
.lp .p-card-detail { font-size: 13px; color: var(--muted); line-height: 1.65; margin: 0 0 16px; }
.lp .p-card-cta {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 12px; font-weight: 700; color: var(--cyan);
  opacity: .75; transition: opacity .15s;
}
.lp .p-card:hover .p-card-cta { opacity: 1; }

/* ── Proof panel ── */
.lp .proof-grid { display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 14px; }
.lp .proof-left {
  border-radius: 28px; border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.035); padding: 28px;
}
.lp .proof-right {
  border-radius: 28px; border: 1px solid rgba(103,232,249,.15);
  background: linear-gradient(160deg, rgba(103,232,249,.09), rgba(110,168,255,.06));
  padding: 28px;
}
.lp .proof-lines { display: flex; flex-direction: column; gap: 10px; margin-top: 20px; }
.lp .proof-line {
  border-radius: 16px; border: 1px solid rgba(255,255,255,.09);
  background: rgba(7,17,31,.30); padding: 13px 16px;
  font-size: 13px; color: rgba(255,255,255,.75); line-height: 1.4;
}
.lp .proof-verdict {
  margin-top: 14px; border-radius: 16px; border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05); padding: 16px;
  font-size: 15px; font-weight: 650; color: rgba(255,255,255,.88); line-height: 1.45;
}
.lp .proof-verdict span { color: var(--cyan); }

/* ── Privacy ── */
.lp .trust-box {
  border-radius: 28px; border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.035); padding: 28px 32px;
  display: flex; gap: 32px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap;
}
.lp .trust-chips { display: flex; gap: 10px; flex-wrap: wrap; }
.lp .trust-chip {
  display: flex; gap: 8px; align-items: center;
  padding: 10px 14px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.05);
  font-size: 13px; font-weight: 650; color: rgba(255,255,255,.80);
}
.lp .tdot { width: 9px; height: 9px; border-radius: 999px; }

/* ── Pricing ── */
.lp .pricing-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; max-width: 840px; margin: 0 auto; }
.lp .pricing-card {
  border-radius: 26px; border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.045); padding: 28px;
  display: flex; flex-direction: column; position: relative; overflow: hidden;
}
.lp .pricing-card:before {
  content: ""; position: absolute; inset: -1px;
  background: radial-gradient(340px 180px at 20% 0%, rgba(103,232,249,.10), transparent 60%);
  pointer-events: none;
}
.lp .pricing-card.pro {
  border-color: rgba(103,232,249,.20);
  background: linear-gradient(170deg, rgba(103,232,249,.07), rgba(110,168,255,.05), rgba(255,255,255,.03));
}
.lp .pricing-badge {
  display: inline-flex; align-items: center; gap: 6px; width: fit-content;
  padding: 5px 12px; border-radius: 999px; margin-bottom: 16px;
  background: rgba(103,232,249,.15); border: 1px solid rgba(103,232,249,.25);
  font-size: 11px; font-weight: 800; letter-spacing: .3px; color: var(--cyan);
}
.lp .pricing-tier { font-size: 12px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; color: var(--muted); margin-bottom: 8px; position: relative; }
.lp .pricing-amount { font-size: 48px; font-weight: 950; letter-spacing: -2px; line-height: 1; color: var(--text); position: relative; }
.lp .pricing-period { font-size: 14px; color: var(--muted); margin-left: 3px; }
.lp .pricing-tagline { font-size: 13px; color: var(--muted2); margin: 4px 0 20px; position: relative; }
.lp .pricing-divider { border: none; border-top: 1px solid rgba(255,255,255,.07); margin: 0 0 16px; }
.lp .pricing-features { list-style: none; margin: 0 0 24px; padding: 0; display: flex; flex-direction: column; gap: 9px; position: relative; }
.lp .pricing-features li { display: flex; align-items: flex-start; gap: 9px; font-size: 13px; color: var(--muted); line-height: 1.4; }
.lp .fcheck {
  flex-shrink: 0; width: 17px; height: 17px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06);
  display: grid; place-items: center; font-size: 10px; margin-top: 1px;
}
.lp .pricing-card.pro .fcheck { background: rgba(103,232,249,.15); border-color: rgba(103,232,249,.30); color: var(--cyan); }
.lp .pricing-cta { margin-top: auto; position: relative; }
.lp .pricing-cta .btn { width: 100%; justify-content: center; padding: 13px; border-radius: 14px; font-size: 14px; }

/* ── Final CTA ── */
.lp .final-cta {
  border-radius: 36px;
  border: 1px solid rgba(103,232,249,.18);
  background: linear-gradient(160deg, rgba(103,232,249,.12), rgba(255,255,255,.04), rgba(110,168,255,.10));
  padding: 52px 48px;
  box-shadow: 0 0 80px rgba(103,232,249,.08);
}
.lp .final-cta h2 { font-size: clamp(28px, 3.5vw, 48px); letter-spacing: -1.5px; font-weight: 950; margin: 12px 0 16px; max-width: 18ch; }
.lp .final-cta p { color: var(--muted); font-size: 15px; line-height: 1.65; max-width: 58ch; margin: 0 0 28px; }
.lp .final-cta-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.lp .final-cta-actions .btn { padding: 13px 22px; border-radius: 16px; font-size: 15px; }

/* ── Footer ── */
.lp footer { padding: 28px 0 40px; position: relative; z-index: 1; }
.lp .foot {
  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center;
  border-top: 1px solid rgba(255,255,255,.07); padding-top: 20px;
  font-size: 13px; color: var(--muted2);
}
.lp .foot a { color: rgba(255,255,255,.65); }
.lp .foot a:hover { color: var(--text); }

@media (max-width: 980px) {
  .lp .hero-grid { grid-template-columns: 1fr; }
  .lp .steps-grid { grid-template-columns: 1fr; }
  .lp .p-grid { grid-template-columns: 1fr; }
  .lp .why-grid { grid-template-columns: 1fr; }
  .lp .proof-grid { grid-template-columns: 1fr; }
  .lp .trust-box { flex-direction: column; }
  .lp .pricing-grid { grid-template-columns: 1fr; max-width: 460px; }
  .lp .nav-links { display: none; }
  .lp .final-cta { padding: 36px 28px; }
}
`

const PERSONALITIES = [
  {
    name: 'Glowing Broke',
    line: "You're moisturized, exfoliated, and financially exposed.",
    detail: 'Luxury self-care meets zero restraint. You invest heavily in feeling good — regardless of the aftermath.',
    image: '/personalities/glowing-broke.webp',
    tags: ['Skincare & beauty', 'High-frequency', 'Emotion-driven'],
  },
  {
    name: 'The Full Send',
    line: 'Your spending has main-character energy.',
    detail: 'Big swipes, fast decisions, unforgettable months. You live large and you know it.',
    image: '/personalities/full-send.webp',
    tags: ['Overspend pattern', 'Lifestyle-first'],
  },
  {
    name: 'The Subscription Collector',
    line: 'Tiny charges. Silent chaos.',
    detail: 'Your money leaks in elegant little monthly drips — Netflix, Spotify, and twelve others you forgot existed.',
    image: '/personalities/subscription-collector.webp',
    tags: ['Recurring drain', 'Easy audit wins'],
  },
  {
    name: 'The Wire Dancer',
    line: 'You cleared the month by the skin of your teeth.',
    detail: 'Tight margin, clean finish. You balance on the edge every month and somehow always land it.',
    image: '/personalities/wire-dancer.webp',
    tags: ['Breakeven', 'High tension'],
  },
]

export default function HomePage() {
  const user   = useAuthStore(s => s.user)
  const router = useRouter()

  useEffect(() => {
    if (user) router.replace('/dashboard')
  }, [user, router])

  useEffect(() => {
    const yearEl = document.getElementById('lp-year')
    if (yearEl) yearEl.textContent = String(new Date().getFullYear())

    const stopDefault = (e: Event) => { e.preventDefault() }
    window.addEventListener('dragover', stopDefault)
    window.addEventListener('drop', stopDefault)
    return () => {
      window.removeEventListener('dragover', stopDefault)
      window.removeEventListener('drop', stopDefault)
    }
  }, [])

  if (user) return null

  return (
    <div className="lp" id="lp-top">
      <style>{CSS}</style>

      {/* ── Ambient ── */}
      <div className="glows">
        <div className="glow-a" />
        <div className="glow-b" />
        <div className="glow-c" />
        <div className="grid-overlay" />
      </div>

      {/* ── Nav ── */}
      <div className="nav">
        <div className="nav-inner">
          <div className="brand">
            <div className="bl-logo-container" style={{ width: 36, height: 36, borderRadius: 12 }}><LogoMark size={20} /></div>
            <div>
              <div className="brand-name">BudgetLens</div>
              <div className="brand-sub">Financial personality, revealed</div>
            </div>
          </div>

          <nav className="nav-links">
            <a href="#how">How it works</a>
            <a href="#personalities">Personalities</a>
            <a href="#privacy">Privacy</a>
            <a href="#pricing">Pricing</a>
          </nav>

          <div className="nav-cta">
            <Link href="/login" className="btn">Sign in</Link>
            <Link href="/login?mode=register" className="btn btn-cyan">Get started</Link>
          </div>
        </div>
      </div>

      <main style={{ position: 'relative', zIndex: 1 }}>

        {/* ── Hero ── */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <div className="hero-kicker">
                <span className="dot" />
                New: Shareable Money Personality cards
              </div>

              <h1>
                The first finance app<br />
                people want to{' '}
                <span className="grad">show off</span>.
              </h1>

              <p className="hero-sub">
                Upload a bank statement and uncover the spending identity hiding inside your transactions.
                Not a boring budget. A sharp, cinematic, almost-uncomfortably-accurate personality reveal.
              </p>

              <div className="hero-actions">
                <Link href="/login?mode=register" className="btn btn-primary">Discover your personality</Link>
                <a href="#personalities" className="btn">See examples</a>
              </div>

              <div className="hero-proof">
                {['No bank login required', 'CSV / OFX / QFX upload', 'Private by design', 'Results in seconds'].map(p => (
                  <div key={p} className="pill">{p}</div>
                ))}
              </div>
            </div>

            {/* ── Hero card: The Quiet Millionaire ── */}
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', inset: -40, borderRadius: 999, background: 'radial-gradient(circle, rgba(110,168,255,.18), transparent 65%)', filter: 'blur(30px)', pointerEvents: 'none' }} />
              <div className="p-hero-card">
                <img
                  src="/personalities/quiet_millionaire.webp"
                  alt="The Quiet Millionaire personality card"
                  className="p-hero-img"
                />
                <div className="p-hero-body">
                  <div className="p-hero-eyebrow">Money Personality</div>
                  <div className="p-hero-name">The Quiet Millionaire</div>
                  <div className="p-hero-line">High income, low spend, says nothing. The most dangerous kind of wealthy.</div>
                  <div className="p-hero-tags">
                    <span className="p-hero-tag">High income</span>
                    <span className="p-hero-tag">Disciplined spend</span>
                    <span className="p-hero-tag">Quietly winning</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Why this works ── */}
        <section className="section">
          <div className="wrap">
            <div className="why-grid">
              <div>
                <div className="eyebrow">Why this hits</div>
                <h2>It starts with identity, not accounting.</h2>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div className="why-col">
                  Most finance tools demand discipline before they give you anything interesting.
                  BudgetLens flips that — the reward comes first. A result you want to react to,
                  argue with, and send to someone else.
                </div>
                <div className="why-col">
                  33 archetypes detected automatically from your real spending data.
                  No quiz. No self-reporting. No guessing. Just your statement and the truth.
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="section" id="how">
          <div className="wrap">
            <div className="eyebrow">How it works</div>
            <h2>Fast, clean, and dangerously satisfying.</h2>
            <p className="lead">A simple loop: upload → analyze → reveal. Three steps to a result you&apos;ll actually want to share.</p>
            <div className="steps-grid">
              {[
                { num: '01', title: 'Upload', text: 'Drop in a CSV, OFX, or QFX statement. No bank linking. No OAuth friction. No anxiety.' },
                { num: '02', title: 'Analyze', text: 'We map spending habits, merchant patterns, recurring charges, spikes, and behavioral signals.' },
                { num: '03', title: 'Reveal', text: 'You get a Money Personality that feels weirdly accurate — and a full financial breakdown to back it up.' },
              ].map(s => (
                <div key={s.num} className="step-card">
                  <div className="step-num">{s.num}</div>
                  <div className="step-title">{s.title}</div>
                  <p className="step-text">{s.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Personalities ── */}
        <section className="section" id="personalities">
          <div className="wrap">
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 28 }}>
              <div>
                <div className="eyebrow">The hook</div>
                <h2 style={{ margin: 0 }}>Personalities people will want to screenshot.</h2>
              </div>
              <Link href="/login?mode=register" className="btn btn-cyan" style={{ whiteSpace: 'nowrap' }}>
                Find yours →
              </Link>
            </div>
            <div className="p-grid">
              {PERSONALITIES.map((p, i) => (
                <div key={p.name} className="p-card">
                  <img src={p.image} alt={p.name} className="p-card-img" />
                  <div className="p-card-body">
                    <div className="p-card-num">0{i + 1}</div>
                    <div className="p-card-name">{p.name}</div>
                    <div className="p-card-line">{p.line}</div>
                    <p className="p-card-detail">{p.detail}</p>
                    <div className="p-card-cta">Discover yours →</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── Believability ── */}
        <section className="section">
          <div className="wrap">
            <div className="proof-grid">
              <div className="proof-left">
                <div className="eyebrow">Believability</div>
                <h2>The result should feel earned, not random.</h2>
                <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7, marginTop: 12 }}>
                  Every personality is backed by real numbers from your statement.
                  You immediately see exactly why you got it.
                </p>
              </div>
              <div className="proof-right">
                <div className="eyebrow">Example breakdown</div>
                <div className="proof-lines">
                  {[
                    '62% of spend went to lifestyle and personal care.',
                    '14 unique beauty and wellness merchants in one month.',
                    '9 recurring self-care charges running quietly in the background.',
                    'Spending peaks between 7 PM – 11 PM on weekdays.',
                  ].map(line => (
                    <div key={line} className="proof-line">{line}</div>
                  ))}
                </div>
                <div className="proof-verdict">
                  Which is exactly why you got <span>Glowing Broke.</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Privacy ── */}
        <section className="section" id="privacy">
          <div className="wrap">
            <div className="trust-box">
              <div style={{ maxWidth: '62ch' }}>
                <div className="eyebrow">Privacy</div>
                <h2 style={{ margin: '8px 0 10px' }}>No bank connections. No creepy feeling.</h2>
                <p style={{ color: 'var(--muted)', fontSize: 14, lineHeight: 1.7, margin: 0 }}>
                  We never ask for your bank password. You upload a statement file, we analyze it locally,
                  and you stay in full control. Your financial data is never sold or shared.
                </p>
              </div>
              <div className="trust-chips">
                <div className="trust-chip"><span className="tdot" style={{ background: 'var(--cyan2)', boxShadow: '0 0 0 5px rgba(34,211,238,.12)' }} />No bank login required</div>
                <div className="trust-chip"><span className="tdot" style={{ background: 'var(--good)', boxShadow: '0 0 0 5px rgba(46,229,157,.10)' }} />You own your categories</div>
                <div className="trust-chip"><span className="tdot" style={{ background: 'var(--warn)', boxShadow: '0 0 0 5px rgba(255,204,102,.10)' }} />Delete your data anytime</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section className="section" id="pricing">
          <div className="wrap">
            <div style={{ textAlign: 'center', marginBottom: 6 }}>
              <div className="eyebrow" style={{ display: 'inline-block' }}>Pricing</div>
            </div>
            <h2 style={{ textAlign: 'center', marginBottom: 6 }}>Free during beta.</h2>
            <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 14, marginBottom: 28 }}>
              All features unlocked. No credit card. Pro tier coming soon — early users lock in a lower rate.
            </p>
            <div className="pricing-grid">
              <div className="pricing-card">
                <div className="pricing-tier">Free</div>
                <div style={{ marginBottom: 4 }}>
                  <span className="pricing-amount">$0</span>
                </div>
                <p className="pricing-tagline">Free forever — no credit card needed.</p>
                <hr className="pricing-divider" />
                <ul className="pricing-features">
                  <li><span className="fcheck">✓</span>Upload &amp; analyze statements</li>
                  <li><span className="fcheck">✓</span>Money Personality detection</li>
                  <li><span className="fcheck">✓</span>Full AI scan (subscriptions, anomalies, duplicates)</li>
                  <li><span className="fcheck">✓</span>Category management &amp; smart rules</li>
                  <li><span className="fcheck">✓</span>CSV / OFX / QFX / QBO import</li>
                </ul>
                <div className="pricing-cta">
                  <Link href="/login?mode=register" className="btn btn-primary">Get started free</Link>
                </div>
              </div>

              <div className="pricing-card pro" style={{ opacity: 0.62 }}>
                <div className="pricing-badge"><span style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--cyan)', display: 'inline-block' }} />Coming soon</div>
                <div className="pricing-tier">Pro</div>
                <div style={{ marginBottom: 4 }}>
                  <span className="pricing-amount">$9</span>
                  <span className="pricing-period">/ mo</span>
                </div>
                <p className="pricing-tagline">Everything in Free, plus unlimited power.</p>
                <hr className="pricing-divider" />
                <ul className="pricing-features">
                  <li><span className="fcheck">✓</span>Unlimited statement uploads</li>
                  <li><span className="fcheck">✓</span>AI Q&amp;A — ask questions about your finances</li>
                  <li><span className="fcheck">✓</span>Month-over-month trend insights</li>
                  <li><span className="fcheck">✓</span>Subscription tracking &amp; cost alerts</li>
                  <li><span className="fcheck">✓</span>Downloadable PDF export</li>
                  <li><span className="fcheck">✓</span>Priority support</li>
                </ul>
                <div className="pricing-cta">
                  <button disabled className="btn" style={{ width: '100%', justifyContent: 'center', opacity: 0.45, cursor: 'not-allowed' }}>Coming soon</button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Final CTA ── */}
        <section className="section">
          <div className="wrap">
            <div className="final-cta">
              <div className="eyebrow">Ready?</div>
              <h2>Find out which one you are.</h2>
              <p>
                Upload a statement and get your Money Personality in under a minute.
                No bank login. No setup. Just your file and the truth.
              </p>
              <div className="final-cta-actions">
                <Link href="/login?mode=register" className="btn btn-primary">Get my Money Personality</Link>
                <Link href="/login" className="btn">Sign in</Link>
              </div>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer>
        <div className="wrap">
          <div className="foot">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="bl-logo-container" style={{ width: 28, height: 28, borderRadius: 8 }}><LogoMark size={16} /></div>
              <div>
                <div style={{ fontWeight: 800, color: 'rgba(255,255,255,.85)', fontSize: 13 }}>BudgetLens</div>
                <div style={{ fontSize: 11, color: 'var(--muted2)' }}>© <span id="lp-year" /> · Financial Personality, Revealed</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
              <a href="#how">How it works</a>
              <a href="#personalities">Personalities</a>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <span style={{ color: 'rgba(255,255,255,.55)' }}>support@budgetlens.app</span>
              <a href="#lp-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>↑ Top</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
