'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { LogoMark } from '@/components/LogoMark'

const PERSONALITIES = [
  { name: 'Glowing Broke', line: "You're moisturized, exfoliated, and financially exposed.", detail: 'Luxury self-care meets zero restraint. You invest heavily in feeling good, regardless of the aftermath.', image: '/personalities/glowing-broke.webp' },
  { name: 'The Full Send', line: 'Your spending has main-character energy.', detail: 'Big swipes, fast decisions, unforgettable months. You live large and you know it.', image: '/personalities/full-send.webp' },
  { name: 'The Subscription Collector', line: 'Tiny charges. Silent chaos.', detail: 'Your money leaks in elegant little monthly drips from services you may have forgotten existed.', image: '/personalities/subscription-collector.webp' },
  { name: 'The Wire Dancer', line: 'You cleared the month by the skin of your teeth.', detail: 'Tight margin, clean finish. You balance on the edge every month and somehow keep landing it.', image: '/personalities/wire-dancer.webp' },
]

const CSS = `
.lp {
  --bg: #06101d;
  --bg-deep: #030a13;
  --text: #f4f7ff;
  --muted: #96a4c8;
  --muted-2: #6f7da4;
  --line: rgba(255,255,255,.10);
  --cyan: #74efff;
  --cyan-2: #2dd4ef;
  --blue: #70a8ff;
  --green: #46e3a1;
  --orange: #ff9a44;
  --radius: 24px;
  --max: 1240px;
  --shadow: 0 30px 90px rgba(0,0,0,.45);
  min-height: 100vh;
  color: var(--text);
  background:
    radial-gradient(circle at 8% 3%, rgba(45,212,239,.13), transparent 28%),
    radial-gradient(circle at 92% 33%, rgba(112,168,255,.12), transparent 33%),
    linear-gradient(180deg, #030a13, #06101d);
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow-x: hidden;
  scroll-behavior: smooth;
  position: relative;
}
.lp *, .lp *::before, .lp *::after { box-sizing: border-box; }
.lp::before {
  content: "";
  position: fixed; inset: 0; z-index: 0;
  pointer-events: none; opacity: .055;
  background-image:
    linear-gradient(rgba(255,255,255,.65) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.65) 1px, transparent 1px);
  background-size: 46px 46px;
  -webkit-mask-image: linear-gradient(to bottom, #000, transparent 88%);
  mask-image: linear-gradient(to bottom, #000, transparent 88%);
}
.lp a { color: inherit; text-decoration: none; }
.lp button, .lp a { -webkit-tap-highlight-color: transparent; }
.lp .shell { width: min(var(--max), calc(100% - 48px)); margin: 0 auto; }

/* Nav */
.lp .nav-wrap {
  position: sticky; top: 14px; z-index: 100; padding-top: 14px;
}
.lp .nav {
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: 24px; min-height: 76px;
  padding: 10px 14px 10px 16px;
  border: 1px solid var(--line); border-radius: 26px;
  background: rgba(4,14,26,.80);
  box-shadow: 0 18px 55px rgba(0,0,0,.24);
  backdrop-filter: blur(18px);
}
.lp .brand { display: flex; align-items: center; gap: 12px; min-width: 250px; }
.lp .logo-box {
  width: 44px; height: 44px; border-radius: 15px;
  display: grid; place-items: center;
  border: 1px solid rgba(112,168,255,.3);
  background: linear-gradient(145deg, rgba(112,168,255,.18), rgba(112,168,255,.04));
  box-shadow: inset 0 0 24px rgba(112,168,255,.07), 0 0 30px rgba(112,168,255,.08);
  flex-shrink: 0;
}
.lp .brand-name { font-size: 14px; font-weight: 850; letter-spacing: .24em; text-transform: uppercase; }
.lp .brand-sub { margin-top: 3px; font-size: 11px; color: var(--muted-2); }
.lp .nav-links { display: flex; justify-content: center; gap: 3px; }
.lp .nav-links a {
  padding: 10px 13px; border-radius: 12px;
  color: rgba(255,255,255,.67); font-size: 13px; font-weight: 650;
  transition: .18s ease;
}
.lp .nav-links a:hover { color: #fff; background: rgba(255,255,255,.055); }
.lp .nav-actions {
  display: grid; grid-template-columns: repeat(2, minmax(118px, 1fr));
  gap: 8px 10px; align-items: start;
}
.lp .nav-action { display: flex; flex-direction: column; align-items: stretch; gap: 5px; }
.lp .nav-btn {
  min-height: 44px;
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0 18px;
  border: 1px solid rgba(255,255,255,.15); border-radius: 14px;
  font-size: 14px; font-weight: 800; font-family: inherit;
  background: rgba(255,255,255,.045);
  transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
  cursor: pointer;
}
.lp .nav-btn:hover { transform: none; border-color: rgba(255,255,255,.35); box-shadow: 0 0 0 1px rgba(255,255,255,.10), 0 8px 24px rgba(0,0,0,.25); }
.lp .nav-btn.primary {
  color: #03101b; border-color: transparent;
  background: linear-gradient(120deg, #52cfff, #9ff8ef);
  box-shadow: 0 9px 30px rgba(45,212,239,.16);
}
.lp .nav-beta-note {
  display: inline-flex; align-items: center; justify-content: center; gap: 5px;
  min-height: 21px; padding: 3px 8px;
  border: 1px solid rgba(70,227,161,.22); border-radius: 999px;
  background: rgba(70,227,161,.07);
  color: #7df4be; font-size: 9px; line-height: 1; font-weight: 850;
  letter-spacing: .045em; text-transform: uppercase; white-space: nowrap;
}
.lp .nav-beta-note::before {
  content: ""; width: 5px; height: 5px; border-radius: 50%;
  background: var(--green); box-shadow: 0 0 0 4px rgba(70,227,161,.09);
  flex-shrink: 0;
}

/* Beta announcement */
.lp .beta-announcement {
  margin-top: 18px;
  display: grid; grid-template-columns: auto 1fr auto;
  align-items: center; gap: 16px; min-height: 72px;
  padding: 13px 18px;
  border: 1px solid rgba(45,212,239,.25); border-radius: 22px;
  background: linear-gradient(90deg, rgba(45,212,239,.095), rgba(8,21,37,.82) 38%, rgba(112,168,255,.055));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.03);
}
.lp .beta-chip {
  min-width: 94px; min-height: 42px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: 14px; color: #04111c;
  background: linear-gradient(120deg, #43d1ff, #adfaef);
  font-size: 15px; font-weight: 950; letter-spacing: .07em;
}
.lp .beta-copy strong { display: block; color: var(--cyan); font-size: 16px; }
.lp .beta-copy span { display: block; margin-top: 3px; color: var(--muted); font-size: 13px; }
.lp .beta-mini {
  padding: 8px 12px; border-radius: 999px;
  border: 1px solid rgba(45,212,239,.22); color: var(--cyan);
  font-size: 11px; font-weight: 800; white-space: nowrap;
}

/* Hero */
.lp .hero { padding: 34px 0 30px; position: relative; z-index: 1; }
.lp .hero-grid {
  display: grid;
  grid-template-columns: minmax(0,.91fr) minmax(520px,1.09fr);
  gap: 46px; align-items: center;
}
.lp .eyebrow {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px;
  border: 1px solid rgba(45,212,239,.2); border-radius: 999px;
  background: rgba(45,212,239,.07); color: var(--cyan);
  font-size: 11px; font-weight: 800;
}
.lp .eyebrow-dot {
  width: 7px; height: 7px; border-radius: 50%;
  background: var(--cyan-2); box-shadow: 0 0 0 5px rgba(45,212,239,.10);
  flex-shrink: 0;
}
.lp h1 {
  margin: 20px 0 20px; max-width: 720px;
  font-size: clamp(44px, 5.25vw, 74px);
  line-height: .98; letter-spacing: -.055em; font-weight: 950;
}
.lp .gradient-text {
  background: linear-gradient(120deg, #8df7ff 0%, #61c8ff 46%, #7aa3ff 100%);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.lp .hero-copy { max-width: 620px; margin: 0 0 26px; color: var(--muted); font-size: 17px; line-height: 1.72; }
.lp .hero-actions { display: flex; gap: 12px; flex-wrap: wrap; }
.lp .cta {
  min-height: 54px;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  padding: 0 22px; border-radius: 15px;
  border: 1px solid rgba(255,255,255,.14);
  font-size: 15px; font-weight: 850; font-family: inherit;
  background: rgba(255,255,255,.05);
  transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
  cursor: pointer;
}
.lp .cta:hover { transform: none; box-shadow: 0 0 0 1px rgba(45,212,239,.20), 0 16px 48px rgba(0,0,0,.30); border-color: rgba(255,255,255,.22); }
.lp .cta.primary:hover { box-shadow: 0 0 0 1px rgba(45,212,239,.30), 0 16px 56px rgba(45,212,239,.22); border-color: transparent; }
.lp .cta.primary {
  color: #04111c; border-color: transparent;
  background: linear-gradient(120deg, #42c7ff, #9cf6ed);
  box-shadow: 0 14px 42px rgba(45,212,239,.18);
}
.lp .cta small { font-size: 10px; opacity: .74; font-weight: 900; text-transform: uppercase; letter-spacing: .08em; }
.lp .visual-wrap { position: relative; }
.lp .visual-wrap::before {
  content: ""; position: absolute;
  inset: 7% -4% -8% 9%; z-index: -1;
  background: radial-gradient(circle, rgba(255,145,54,.18), transparent 63%);
  filter: blur(34px);
}
.lp .hero-visual {
  position: relative; overflow: hidden; border-radius: 28px;
  border: 1px solid rgba(255,255,255,.14); background: #07111f;
  box-shadow: var(--shadow), 0 0 0 1px rgba(45,212,239,.055);
}
.lp .hero-visual img { width: 100%; min-height: 410px; display: block; object-fit: cover; }
.lp .visual-badge {
  position: absolute; left: 18px; bottom: 18px;
  padding: 10px 13px; border-radius: 12px;
  border: 1px solid rgba(255,255,255,.13);
  background: rgba(3,10,19,.76); backdrop-filter: blur(12px);
  color: #fff; font-size: 12px; font-weight: 800;
}
.lp .visual-badge span { color: var(--cyan); }
.lp .trust-row {
  grid-column: 1 / -1; margin-top: 8px;
  display: grid; grid-template-columns: repeat(5, 1fr);
  overflow: hidden;
  border: 1px solid rgba(255,255,255,.08); border-radius: 18px;
  background: rgba(255,255,255,.025);
}
.lp .trust-item {
  display: flex; align-items: center; gap: 10px;
  min-height: 72px; padding: 14px 16px;
  border-right: 1px solid rgba(255,255,255,.08);
}
.lp .trust-item:last-child { border-right: 0; }
.lp .trust-icon {
  width: 30px; height: 30px; flex: 0 0 auto;
  display: grid; place-items: center;
  border-radius: 10px; border: 1px solid rgba(45,212,239,.18);
  color: var(--cyan); background: rgba(45,212,239,.06);
  font-size: 15px; font-weight: 900;
}
.lp .trust-label { font-size: 12px; font-weight: 850; }
.lp .trust-sub { margin-top: 3px; color: var(--muted-2); font-size: 11px; }

/* Sections */
.lp section.content { padding: 52px 0; position: relative; z-index: 1; }
.lp .section-head { max-width: 720px; margin-bottom: 24px; }
.lp .section-kicker { color: var(--cyan); font-size: 11px; font-weight: 850; letter-spacing: .08em; text-transform: uppercase; }
.lp h2 { margin: 9px 0 10px; font-size: clamp(30px, 3.4vw, 46px); line-height: 1.06; letter-spacing: -.04em; }
.lp .lead { margin: 0; color: var(--muted); font-size: 15px; line-height: 1.75; }

.lp .cards-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
.lp .card {
  padding: 24px; border: 1px solid rgba(255,255,255,.09); border-radius: var(--radius);
  background: linear-gradient(155deg, rgba(255,255,255,.055), rgba(255,255,255,.025));
  box-shadow: inset 0 1px 0 rgba(255,255,255,.025);
}
.lp .card-num { color: var(--cyan); font-size: 12px; font-weight: 900; letter-spacing: .08em; }
.lp .card h3 { margin: 18px 0 9px; font-size: 22px; }
.lp .card p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.7; }

.lp .personality-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
.lp .personality-card {
  overflow: hidden; border: 1px solid rgba(255,255,255,.09);
  border-radius: 25px; background: rgba(255,255,255,.03);
  transition: border-color .18s ease, box-shadow .18s ease, filter .18s ease;
}
.lp .personality-card:hover { transform: none; border-color: rgba(45,212,239,.28); box-shadow: 0 0 0 1px rgba(45,212,239,.10), 0 20px 50px rgba(0,0,0,.35); filter: brightness(1.04); }
.lp .personality-card img { width: 100%; height: 230px; object-fit: cover; display: block; }
.lp .personality-card-body { padding: 21px; }
.lp .personality-card h3 { margin: 0 0 7px; font-size: 25px; }
.lp .personality-card strong { display: block; margin-bottom: 8px; font-size: 14px; }
.lp .personality-card p { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.65; }

.lp .privacy-panel {
  display: grid; grid-template-columns: 1.1fr .9fr; gap: 28px;
  align-items: center; padding: 32px;
  border: 1px solid rgba(45,212,239,.16); border-radius: 28px;
  background: linear-gradient(135deg, rgba(45,212,239,.075), rgba(255,255,255,.025), rgba(112,168,255,.06));
}
.lp .chips { display: flex; flex-wrap: wrap; gap: 10px; }
.lp .chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 10px 13px; border: 1px solid rgba(255,255,255,.10);
  border-radius: 999px; background: rgba(255,255,255,.04);
  font-size: 12px; font-weight: 750;
}
.lp .chip::before { content: "✓"; color: var(--green); font-weight: 950; }

/* Pricing */
.lp .pricing {
  max-width: 760px; margin: 0 auto; padding: 34px; text-align: center;
  border: 1px solid rgba(45,212,239,.22); border-radius: 30px;
  background: linear-gradient(160deg, rgba(45,212,239,.10), rgba(7,17,31,.85));
  box-shadow: 0 28px 90px rgba(0,0,0,.26);
}
.lp .pricing-mark {
  display: inline-flex; padding: 7px 13px; border-radius: 999px;
  color: var(--cyan); border: 1px solid rgba(45,212,239,.24);
  background: rgba(45,212,239,.07);
  font-size: 11px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase;
}
.lp .price { margin: 14px 0 2px; font-size: 68px; line-height: 1; font-weight: 950; letter-spacing: -.06em; }
.lp .price-note { color: var(--muted); font-size: 14px; }
.lp .pricing ul {
  max-width: 440px; margin: 26px auto; padding: 0; list-style: none;
  text-align: left; display: grid; gap: 11px;
}
.lp .pricing li { color: var(--muted); font-size: 14px; }
.lp .pricing li::before { content: "✓"; color: var(--green); margin-right: 9px; font-weight: 950; }

/* Beta bottom strip */
.lp .beta-bottom {
  display: grid; grid-template-columns: auto 1fr auto;
  gap: 28px; align-items: center; padding: 22px 24px;
  margin-top: 18px;
  border: 1px solid rgba(45,212,239,.16); border-radius: 24px;
  background: linear-gradient(135deg, rgba(45,212,239,.075), rgba(255,255,255,.025), rgba(112,168,255,.06));
}
.lp .gift {
  width: 46px; height: 46px; display: grid; place-items: center;
  border-radius: 14px; background: rgba(45,212,239,.08);
  border: 1px solid rgba(45,212,239,.18); font-size: 22px;
}
.lp .beta-bottom strong { display: block; font-size: 16px; }
.lp .beta-bottom span { display: block; margin-top: 4px; color: var(--muted); font-size: 13px; }

/* Footer */
.lp footer { padding: 30px 0 44px; color: var(--muted-2); font-size: 12px; position: relative; z-index: 1; }
.lp .footer-line {
  padding-top: 24px; border-top: 1px solid rgba(255,255,255,.07);
  display: flex; justify-content: space-between; gap: 20px; flex-wrap: wrap; align-items: center;
}
.lp .footer-line a { color: rgba(255,255,255,.65); }
.lp .footer-line a:hover { color: var(--text); }

@media (max-width: 1080px) {
  .lp .nav { grid-template-columns: auto 1fr; }
  .lp .nav-links { display: none; }
  .lp .nav-actions { justify-self: end; }
  .lp .hero-grid { grid-template-columns: 1fr; }
  .lp .visual-wrap { max-width: 820px; }
  .lp .trust-row { grid-template-columns: repeat(3, 1fr); }
  .lp .trust-item:nth-child(3) { border-right: 0; }
  .lp .trust-item:nth-child(n+4) { border-top: 1px solid rgba(255,255,255,.08); }
  .lp .privacy-panel { grid-template-columns: 1fr; }
}

@media (max-width: 720px) {
  .lp .shell { width: min(100% - 24px, var(--max)); }
  .lp .nav-wrap { top: 8px; padding-top: 8px; }
  .lp .nav { grid-template-columns: 1fr; gap: 12px; border-radius: 22px; }
  .lp .brand { min-width: 0; }
  .lp .brand-sub { display: none; }
  .lp .nav-actions { width: 100%; justify-self: stretch; grid-template-columns: 1fr 1fr; }
  .lp .nav-btn { min-height: 42px; padding: 0 12px; }
  .lp .nav-beta-note { font-size: 8px; }
  .lp .beta-announcement { grid-template-columns: auto 1fr; }
  .lp .beta-mini { display: none; }
  .lp .beta-chip { min-width: 72px; }
  .lp .hero { padding-top: 26px; }
  .lp h1 { font-size: clamp(42px, 14vw, 58px); }
  .lp .hero-copy { font-size: 15px; }
  .lp .hero-actions { flex-direction: column; }
  .lp .cta { width: 100%; }
  .lp .hero-visual img { min-height: 300px; }
  .lp .trust-row { grid-template-columns: 1fr 1fr; }
  .lp .trust-item,
  .lp .trust-item:nth-child(3) { border-right: 1px solid rgba(255,255,255,.08); border-top: 1px solid rgba(255,255,255,.08); }
  .lp .trust-item:nth-child(1),
  .lp .trust-item:nth-child(2) { border-top: 0; }
  .lp .trust-item:nth-child(even) { border-right: 0; }
  .lp .trust-item:last-child { grid-column: 1 / -1; border-right: 0; }
  .lp .cards-3, .lp .personality-grid { grid-template-columns: 1fr; }
  .lp .personality-card img { height: 210px; }
  .lp .privacy-panel, .lp .pricing { padding: 24px; }
  .lp .beta-bottom { grid-template-columns: auto 1fr; }
}
`

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
    <div className="lp">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      {/* ── Nav ── */}
      <div className="nav-wrap shell">
        <header className="nav">
          <Link href="/" className="brand" aria-label="Financial Autopsy home">
            <span className="logo-box" aria-hidden="true">
              <LogoMark size={27} />
            </span>
            <span>
              <span className="brand-name">Financial Autopsy</span>
              <span className="brand-sub">Financial personality, revealed</span>
            </span>
          </Link>

          <nav className="nav-links" aria-label="Primary navigation">
            <a href="#how">How it works</a>
            <a href="#personalities">Personalities</a>
            <a href="#privacy">Privacy</a>
            <a href="#roadmap">Roadmap</a>
            <a href="#pricing">Pricing</a>
          </nav>

          <div className="nav-actions">
            <div className="nav-action">
              <Link className="nav-btn" href="/login">Sign in</Link>
              <span className="nav-beta-note">Free in beta</span>
            </div>
            <div className="nav-action">
              <Link className="nav-btn primary" href="/login?mode=register">Get started</Link>
              <span className="nav-beta-note">No card required</span>
            </div>
          </div>
        </header>
      </div>

      {/* ── Beta announcement ── */}
      <div className="shell">
        <div className="beta-announcement" role="status">
          <div className="beta-chip">BETA</div>
          <div className="beta-copy">
            <strong>Financial Autopsy is now live in public beta.</strong>
            <span>Everything is unlocked and 100% free while we build. No credit card required.</span>
          </div>
          <div className="beta-mini">Free during beta</div>
        </div>
      </div>

      <main>

        {/* ── Hero ── */}
        <section className="hero">
          <div className="shell hero-grid">
            <div>
              <div className="eyebrow"><span className="eyebrow-dot" />New: Shareable Money Personality cards</div>
              <h1>The first finance app people want to <span className="gradient-text">show off.</span></h1>
              <p className="hero-copy">
                Upload a bank statement and uncover the spending identity hiding inside your transactions.
                Not a boring budget. A sharp, cinematic, almost-uncomfortably-accurate personality reveal.
              </p>
              <div className="hero-actions">
                <Link className="cta primary" href="/login?mode=register">Start your free analysis <small>Beta</small></Link>
                <a className="cta" href="#personalities">See examples</a>
              </div>
            </div>

            <div className="visual-wrap">
              <div className="hero-visual">
                <img src="/personalities/where_did_it_go.webp" alt="Where Did It All Go money personality preview" />
                <div className="visual-badge"><span>Free beta</span> · Results in minutes</div>
              </div>
            </div>

            <div className="trust-row">
              <div className="trust-item"><div className="trust-icon">$</div><div><div className="trust-label">100% free</div><div className="trust-sub">During public beta</div></div></div>
              <div className="trust-item"><div className="trust-icon">✓</div><div><div className="trust-label">No bank login</div><div className="trust-sub">Upload only</div></div></div>
              <div className="trust-item"><div className="trust-icon">▤</div><div><div className="trust-label">CSV / OFX / QFX</div><div className="trust-sub">Statement upload</div></div></div>
              <div className="trust-item"><div className="trust-icon">⌁</div><div><div className="trust-label">Private by design</div><div className="trust-sub">Your data stays yours</div></div></div>
              <div className="trust-item"><div className="trust-icon">◷</div><div><div className="trust-label">Fast reveal</div><div className="trust-sub">Personality in minutes</div></div></div>
            </div>
          </div>
        </section>

        {/* ── How it works ── */}
        <section className="content" id="how">
          <div className="shell">
            <div className="section-head">
              <div className="section-kicker">How it works</div>
              <h2>Upload. Analyze. Reveal.</h2>
              <p className="lead">Three clean steps to a result you will actually want to screenshot, debate, and share.</p>
            </div>
            <div className="cards-3">
              <article className="card"><div className="card-num">01</div><h3>Upload</h3><p>Drop in a CSV, OFX, QFX, or QBO statement. No bank linking, passwords, or OAuth friction.</p></article>
              <article className="card"><div className="card-num">02</div><h3>Analyze</h3><p>We map merchant patterns, recurring charges, spending spikes, habits, and behavioral signals.</p></article>
              <article className="card"><div className="card-num">03</div><h3>Reveal</h3><p>You get a Money Personality that feels weirdly accurate, plus the numbers that explain exactly why.</p></article>
            </div>
          </div>
        </section>

        {/* ── Personalities ── */}
        <section className="content" id="personalities">
          <div className="shell">
            <div className="section-head">
              <div className="section-kicker">Money personalities</div>
              <h2>Results people will want to screenshot.</h2>
              <p className="lead">Built from real spending behavior, not a quiz or self-reported answers.</p>
            </div>
            <div className="personality-grid">
              {PERSONALITIES.map(p => (
                <article key={p.name} className="personality-card">
                  <img src={p.image} alt={`${p.name} personality`} />
                  <div className="personality-card-body">
                    <h3>{p.name}</h3>
                    <strong>{p.line}</strong>
                    <p>{p.detail}</p>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Privacy ── */}
        <section className="content" id="privacy">
          <div className="shell">
            <div className="privacy-panel">
              <div>
                <div className="section-kicker">Privacy first</div>
                <h2>No bank connections. Total control.</h2>
                <p className="lead">We never ask for your bank password. You upload a statement file and stay in control of your data.</p>
              </div>
              <div className="chips">
                <span className="chip">No bank login required</span>
                <span className="chip">Delete your data anytime</span>
                <span className="chip">No credit card in beta</span>
                <span className="chip">Your data is never sold</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Roadmap ── */}
        <section className="content" id="roadmap">
          <div className="shell">
            <div className="section-head">
              <div className="section-kicker">Roadmap</div>
              <h2>Live now. Improving fast.</h2>
              <p className="lead">The beta is live today, and early users help shape what comes next.</p>
            </div>
            <div className="cards-3">
              <article className="card"><div className="card-num" style={{ color: 'var(--green)' }}>✓ LIVE</div><h3>Public beta</h3><p>The full upload, analysis, and Money Personality reveal experience is available now.</p></article>
              <article className="card"><div className="card-num">→ BUILDING</div><h3>Deeper insights</h3><p>Month-over-month trends, AI questions, subscription alerts, and richer spending explanations.</p></article>
              <article className="card"><div className="card-num" style={{ color: 'var(--muted-2)' }}>◦ PLANNED</div><h3>Mobile experience</h3><p>A faster on-the-go workflow for statement capture, review, and shareable personality cards.</p></article>
            </div>
          </div>
        </section>

        {/* ── Pricing ── */}
        <section className="content" id="pricing">
          <div className="shell">
            <div className="pricing">
              <div className="pricing-mark">Public beta pricing</div>
              <div className="price">$0</div>
              <div className="price-note">Everything is free while Financial Autopsy is in beta.</div>
              <ul>
                <li>Money Personality detection</li>
                <li>Statement analysis and categorization</li>
                <li>Subscription, anomaly, and duplicate detection</li>
                <li>CSV, OFX, QFX, and QBO imports</li>
                <li>No credit card required</li>
              </ul>
              <Link className="cta primary" href="/login?mode=register">Join the free beta</Link>
            </div>

            <div className="beta-bottom">
              <div className="gift">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--cyan)' }}>
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            </div>
              <div>
                <strong>Enjoy every feature for free while we build.</strong>
                <span>Future pricing may change, but there is no charge during the current public beta.</span>
              </div>
              <div className="beta-mini">Free during beta</div>
            </div>
          </div>
        </section>

      </main>

      {/* ── Footer ── */}
      <footer>
        <div className="shell footer-line">
          <div>© <span id="lp-year" /> Financial Autopsy</div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <Link href="/privacy">Privacy</Link>
            <span>·</span>
            <Link href="/terms">Terms</Link>
            <span>·</span>
            <span>support@financialautopsy.com</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
