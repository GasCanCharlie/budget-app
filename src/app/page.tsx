'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { LogoMark } from '@/components/LogoMark'

const CSS = `
.lp {
  --bg: #0b1020;
  --bg2: #070a14;
  --text: #eaf0ff;
  --muted: #a8b3d6;
  --muted2: #8b97c3;
  --brand: #6ea8ff;
  --brand2: #8a7dff;
  --good: #2ee59d;
  --warn: #ffcc66;
  --shadow: 0 20px 60px rgba(0,0,0,.55);
  --shadow2: 0 10px 30px rgba(0,0,0,.35);
  --radius-xl: 28px;
  --max: 1120px;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
  color: var(--text);
  background:
    radial-gradient(1200px 800px at 20% 10%, rgba(110,168,255,.26), transparent 55%),
    radial-gradient(900px 700px at 80% 15%, rgba(138,125,255,.22), transparent 55%),
    radial-gradient(900px 700px at 50% 90%, rgba(46,229,157,.10), transparent 55%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
  overflow-x: hidden;
  min-height: 100vh;
}
.lp a { color: inherit; text-decoration: none; }
.lp button { font: inherit; color: inherit; }
.lp .wrap { width: min(var(--max), calc(100% - 40px)); margin: 0 auto; }

.lp .nav {
  position: sticky; top: 0; z-index: 50;
  backdrop-filter: blur(10px);
  background: linear-gradient(180deg, rgba(11,16,32,.82), rgba(11,16,32,.52));
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.lp .nav-inner {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0;
}
.lp .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; letter-spacing: .2px; }
.lp .logo {
  width: 34px; height: 34px; border-radius: 12px;
  background:
    radial-gradient(12px 12px at 30% 30%, rgba(255,255,255,.35), transparent 65%),
    linear-gradient(135deg, rgba(110,168,255,.9), rgba(138,125,255,.9));
  box-shadow: 0 10px 25px rgba(110,168,255,.20);
  border: 1px solid rgba(255,255,255,.18);
  position: relative; overflow: hidden; flex-shrink: 0;
}
.lp .logo:after {
  content: ""; position: absolute; inset: -40%;
  background: linear-gradient(120deg, transparent 35%, rgba(255,255,255,.26) 50%, transparent 65%);
  transform: rotate(12deg) translateX(-60%);
  animation: lp-sweep 5.8s ease-in-out infinite; opacity: .85;
}
@keyframes lp-sweep {
  0%,55% { transform: rotate(12deg) translateX(-65%); opacity: 0; }
  60% { opacity: .85; }
  100% { transform: rotate(12deg) translateX(65%); opacity: 0; }
}
.lp .nav-links { display: flex; align-items: center; gap: 18px; color: var(--muted); font-weight: 550; font-size: 14px; }
.lp .nav-links a { padding: 8px 10px; border-radius: 10px; }
.lp .nav-links a:hover { background: rgba(255,255,255,.06); color: var(--text); }
.lp .nav-cta { display: flex; align-items: center; gap: 10px; }
.lp .btn {
  border: 1px solid rgba(255,255,255,.14);
  background: rgba(255,255,255,.06);
  padding: 10px 14px; border-radius: 12px; cursor: pointer;
  transition: transform .15s ease, background .15s ease, border-color .15s ease;
  font-weight: 650; font-size: 14px; display: inline-flex; align-items: center; gap: 6px;
}
.lp .btn:hover { transform: translateY(-1px); background: rgba(255,255,255,.09); border-color: rgba(255,255,255,.22); }
.lp .btn-primary {
  background: linear-gradient(135deg, rgba(110,168,255,.95), rgba(138,125,255,.92));
  border-color: rgba(255,255,255,.18);
  box-shadow: 0 18px 40px rgba(110,168,255,.22);
}
.lp .btn-primary:hover { background: linear-gradient(135deg, rgba(110,168,255,1), rgba(138,125,255,1)); }

.lp .hero { padding: 56px 0 34px; position: relative; }
.lp .hero-grid { display: grid; grid-template-columns: 1.05fr .95fr; gap: 26px; align-items: center; }
.lp .kicker {
  display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06);
  color: var(--muted); font-weight: 650; font-size: 13px;
}
.lp .dot { width: 9px; height: 9px; border-radius: 999px; background: var(--good); box-shadow: 0 0 0 6px rgba(46,229,157,.14); }
.lp h1 { margin: 14px 0 12px; font-size: clamp(34px, 4.1vw, 54px); line-height: 1.05; letter-spacing: -.8px; }
.lp .sub { margin: 0 0 18px; color: var(--muted); font-size: 16px; line-height: 1.55; max-width: 56ch; }
.lp .hero-actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 10px; }
.lp .hero-actions .btn { padding: 12px 16px; border-radius: 14px; }
.lp .mini { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 18px; color: var(--muted2); font-size: 13px; align-items: center; }
.lp .mini .pill { display: inline-flex; gap: 8px; align-items: center; padding: 8px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.05); }
.lp .mini .icon { width: 18px; height: 18px; border-radius: 6px; background: rgba(255,255,255,.10); display: grid; place-items: center; border: 1px solid rgba(255,255,255,.12); font-size: 12px; color: rgba(255,255,255,.85); }

.lp .demo {
  border-radius: var(--radius-xl);
  background: linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.04));
  border: 1px solid rgba(255,255,255,.12); box-shadow: var(--shadow); overflow: hidden; position: relative;
}
.lp .demo:before {
  content: ""; position: absolute; inset: -1px;
  background: radial-gradient(600px 300px at 30% 10%, rgba(110,168,255,.22), transparent 60%),
              radial-gradient(500px 250px at 80% 20%, rgba(138,125,255,.20), transparent 60%);
  pointer-events: none;
}
.lp .demo-head {
  position: relative; padding: 16px 16px 12px;
  display: flex; justify-content: space-between; align-items: center;
  border-bottom: 1px solid rgba(255,255,255,.08);
  background: rgba(10,14,28,.35); backdrop-filter: blur(8px);
}
.lp .demo-title { display: flex; align-items: center; gap: 10px; font-weight: 750; letter-spacing: .2px; }
.lp .demo-badges { display: flex; gap: 8px; }
.lp .badge { font-size: 12px; font-weight: 750; color: rgba(255,255,255,.88); padding: 7px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); }
.lp .badge.good { border-color: rgba(46,229,157,.25); background: rgba(46,229,157,.10); }
.lp .badge.warn { border-color: rgba(255,204,102,.28); background: rgba(255,204,102,.10); }
.lp .demo-body { position: relative; padding: 16px; display: grid; gap: 12px; }

.lp .drop {
  border-radius: 18px; border: 1px dashed rgba(255,255,255,.22); background: rgba(255,255,255,.05);
  padding: 14px; display: flex; gap: 12px; align-items: center;
  transition: background .15s ease, border-color .15s ease, transform .15s ease;
  cursor: pointer; user-select: none;
}
.lp .drop:hover { background: rgba(255,255,255,.07); border-color: rgba(255,255,255,.30); transform: translateY(-1px); }
.lp .drop .upicon {
  width: 44px; height: 44px; border-radius: 16px; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.14);
  background: linear-gradient(135deg, rgba(110,168,255,.25), rgba(138,125,255,.20));
  display: grid; place-items: center; box-shadow: 0 12px 28px rgba(110,168,255,.12); font-weight: 900;
}
.lp .drop strong { display: block; font-size: 14px; }
.lp .drop span { display: block; font-size: 12px; color: var(--muted); margin-top: 2px; }

.lp .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.lp .col { border-radius: 18px; border: 1px solid rgba(255,255,255,.10); background: rgba(10,14,28,.35); padding: 12px; min-height: 220px; }
.lp .col h3 { margin: 0 0 10px; font-size: 12px; letter-spacing: .7px; text-transform: uppercase; color: rgba(255,255,255,.70); display: flex; justify-content: space-between; align-items: center; font-weight: 800; }
.lp .count { font-size: 12px; color: rgba(255,255,255,.78); padding: 4px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); }
.lp .tx {
  border-radius: 14px; padding: 10px; border: 1px solid rgba(255,255,255,.10); background: rgba(255,255,255,.05);
  display: flex; justify-content: space-between; align-items: flex-start; gap: 10px;
  margin-bottom: 8px; cursor: grab;
  transition: transform .12s ease, border-color .12s ease, background .12s ease;
}
.lp .tx:hover { transform: translateY(-1px); border-color: rgba(255,255,255,.18); background: rgba(255,255,255,.07); }
.lp .tx:active { cursor: grabbing; transform: scale(.99); }
.lp .tx .left { min-width: 0; }
.lp .tx .vendor { font-weight: 750; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lp .tx .meta { font-size: 12px; color: var(--muted); margin-top: 2px; }
.lp .tx .amt { font-weight: 850; font-size: 13px; color: rgba(255,255,255,.92); white-space: nowrap; }
.lp .amt.neg { color: #ff8397; }
.lp .amt.pos { color: #66f0b7; }
.lp .hint { margin-top: 8px; color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
.lp .hint kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 11px; padding: 4px 6px; border-radius: 8px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: rgba(255,255,255,.85); }

.lp .section { padding: 34px 0; }
.lp .section h2 { margin: 0 0 10px; font-size: clamp(22px, 2.5vw, 30px); letter-spacing: -.4px; }
.lp .section p.lead { margin: 0 0 18px; color: var(--muted); line-height: 1.6; max-width: 70ch; }
.lp .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.lp .card {
  border-radius: var(--radius-xl); border: 1px solid rgba(255,255,255,.10);
  background: rgba(255,255,255,.05); box-shadow: var(--shadow2);
  padding: 16px; overflow: hidden; position: relative;
}
.lp .card:before { content: ""; position: absolute; inset: -1px; background: radial-gradient(320px 180px at 20% 10%, rgba(110,168,255,.14), transparent 65%); pointer-events: none; opacity: .9; }
.lp .card .top { display: flex; align-items: center; gap: 10px; position: relative; }
.lp .card .ic { width: 40px; height: 40px; border-radius: 14px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.07); display: grid; place-items: center; font-weight: 900; flex-shrink: 0; }
.lp .card h3 { margin: 0; font-size: 15px; font-weight: 850; letter-spacing: .1px; }
.lp .card p { position: relative; margin: 10px 0 0; color: var(--muted); line-height: 1.6; font-size: 14px; }

.lp .trust {
  border-radius: var(--radius-xl); border: 1px solid rgba(255,255,255,.10);
  background: linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  padding: 18px; display: flex; gap: 14px; align-items: flex-start; justify-content: space-between; flex-wrap: wrap;
}
.lp .trust .left { min-width: 260px; max-width: 70ch; }
.lp .trust .right { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.lp .trust .chip { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-radius: 999px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: rgba(255,255,255,.86); font-weight: 750; font-size: 13px; }
.lp .trust .chip .b { width: 10px; height: 10px; border-radius: 999px; background: var(--brand); box-shadow: 0 0 0 6px rgba(110,168,255,.10); }

.lp .cta {
  border-radius: 34px; border: 1px solid rgba(255,255,255,.12);
  background:
    radial-gradient(900px 420px at 20% 10%, rgba(110,168,255,.22), transparent 55%),
    radial-gradient(900px 420px at 80% 30%, rgba(138,125,255,.18), transparent 55%),
    linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03));
  padding: 22px; box-shadow: var(--shadow);
  display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap;
}
.lp .cta h3 { margin: 0; font-size: 18px; font-weight: 900; }
.lp .cta p { margin: 6px 0 0; color: var(--muted); line-height: 1.55; max-width: 62ch; }
.lp .cta .btn { padding: 12px 16px; border-radius: 14px; }

.lp footer { padding: 26px 0 36px; color: var(--muted2); font-size: 13px; }
.lp .foot { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; align-items: center; border-top: 1px solid rgba(255,255,255,.08); padding-top: 16px; }
.lp .foot a { color: rgba(255,255,255,.75); }
.lp .foot a:hover { color: var(--text); }

@media (max-width: 980px) {
  .lp .hero-grid { grid-template-columns: 1fr; }
  .lp .grid3 { grid-template-columns: 1fr; }
  .lp .columns { grid-template-columns: 1fr; }
  .lp .nav-links { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .lp .logo:after { animation: none; }
  .lp .btn, .lp .drop, .lp .tx { transition: none; }
}
`

export default function HomePage() {
  const user   = useAuthStore(s => s.user)
  const router = useRouter()

  useEffect(() => {
    if (user) router.replace('/dashboard')
  }, [user, router])

  useEffect(() => {
    // Footer year
    const yearEl = document.getElementById('lp-year')
    if (yearEl) yearEl.textContent = String(new Date().getFullYear())

    // Demo interactions
    const fileInput   = document.getElementById('lp-file') as HTMLInputElement | null
    const dropZone    = document.getElementById('lp-drop')
    const demo        = document.getElementById('lp-demo')
    const uncatCountEl = document.getElementById('lp-uncat-count')
    const uncatBadge  = document.getElementById('lp-uncat-badge')

    const txEls      = Array.from(document.querySelectorAll<HTMLElement>('.lp .tx[draggable="true"]'))
    const dropTargets = Array.from(document.querySelectorAll<HTMLElement>('.lp .tx[data-drop="true"]'))

    let dragged: HTMLElement | null = null

    txEls.forEach(el => {
      el.addEventListener('dragstart', (e) => {
        dragged = el
        ;(e as DragEvent).dataTransfer!.effectAllowed = 'move'
        setTimeout(() => { el.style.opacity = '0.55' }, 0)
      })
      el.addEventListener('dragend', () => {
        el.style.opacity = '1'
        dragged = null
      })
    })

    dropTargets.forEach(t => {
      t.addEventListener('dragover', (e) => {
        e.preventDefault()
        t.style.borderColor = 'rgba(110,168,255,.45)'
        t.style.background  = 'rgba(110,168,255,.10)'
      })
      t.addEventListener('dragleave', () => {
        t.style.borderColor = 'rgba(255,255,255,.10)'
        t.style.background  = 'rgba(255,255,255,.05)'
        if (t.dataset.cat === 'Needs Review') {
          t.style.borderColor = 'rgba(255,204,102,.28)'
          t.style.background  = 'rgba(255,204,102,.08)'
        }
      })
      t.addEventListener('drop', (e) => {
        e.preventDefault()
        if (!dragged || !uncatCountEl || !uncatBadge || !demo) return

        const cat    = t.dataset.cat || 'Category'
        const metaEl = dragged.querySelector('.meta')
        if (metaEl) metaEl.textContent = `Assigned → ${cat}`

        const colUncat = document.getElementById('lp-col-uncat')
        if (colUncat && colUncat.contains(dragged)) colUncat.removeChild(dragged)

        const current = Math.max(0, parseInt(uncatCountEl.textContent || '0', 10) - 1)
        uncatCountEl.textContent = String(current)
        uncatBadge.textContent   = `Uncategorized: ${current}`

        t.dispatchEvent(new Event('dragleave'))

        const flashColor = cat === 'Needs Review' ? 'rgba(255,204,102,.28)' : 'rgba(46,229,157,.28)'
        demo.animate([
          { boxShadow: '0 0 0 rgba(0,0,0,0)' },
          { boxShadow: `0 0 0 8px ${flashColor}` },
          { boxShadow: '0 0 0 rgba(0,0,0,0)' },
        ], { duration: 520, easing: 'ease-out' })

        if (current === 0) {
          uncatBadge.classList.remove('warn')
          uncatBadge.classList.add('good')
          uncatBadge.textContent = 'Ready for insights'
        }
      })
    })

    // Drop zone click → open file picker
    const openFilePicker = () => fileInput?.click()
    dropZone?.addEventListener('click', openFilePicker)
    dropZone?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') openFilePicker()
    })

    // File input feedback
    fileInput?.addEventListener('change', () => {
      const f = fileInput.files?.[0]
      if (!f || !dropZone) return
      const strong = dropZone.querySelector('strong')
      const span   = dropZone.querySelector('span')
      if (strong) strong.textContent = `Loaded: ${f.name}`
      if (span)   span.textContent   = 'Nice — now categorize and confirm what should be remembered.'
    })

    // Prevent default browser drop-to-open
    const stopDefault = (e: Event) => e.preventDefault()
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

      {/* ── Nav ──────────────────────────────────────────────────────────────── */}
      <div className="nav">
        <div className="wrap nav-inner">
          <div className="brand">
            <div className="bl-logo-container" style={{ width: 34, height: 34, borderRadius: 10 }}><LogoMark size={20} /></div>
            <div>
              <div style={{ fontSize: '14px', lineHeight: '1' }}>BudgetLens</div>
              <div style={{ fontSize: '12px', color: 'var(--muted)', fontWeight: 650, marginTop: '2px' }}>Statement Intelligence</div>
            </div>
          </div>

          <nav className="nav-links" aria-label="Primary">
            <a href="#how">How it works</a>
            <a href="#features">Features</a>
            <a href="#privacy">Privacy</a>
            <a href="#pricing">Pricing</a>
          </nav>

          <div className="nav-cta">
            <Link href="/login" className="btn">Sign in</Link>
            <Link href="/login?mode=register" className="btn btn-primary">Start free</Link>
          </div>
        </div>
      </div>

      <main>
        {/* ── Hero ─────────────────────────────────────────────────────────── */}
        <section className="hero">
          <div className="wrap hero-grid">
            <div>
              <div className="kicker">
                <span className="dot" aria-hidden="true" />
                Privacy-first • No bank login • Local-first
              </div>

              <h1>Drop in your bank statement.<br />Organize once. It gets easier every month.</h1>

              <p className="sub">
                Upload transactions, drag-and-drop to your categories, and get clear explanations of where your money went.
                The system remembers what you confirm so each new statement takes less time.
              </p>

              <div className="hero-actions">
                <Link href="/login?mode=register" className="btn btn-primary">Upload a statement</Link>
                <a href="#demo" className="btn">See the organizer</a>
              </div>

              <div className="mini">
                <span className="pill"><span className="icon">✓</span>Rule-based memory (only what you confirm)</span>
                <span className="pill"><span className="icon">⚡</span>Fast drag + multi-select</span>
                <span className="pill"><span className="icon">🛡</span>Unusual transaction callouts</span>
              </div>
            </div>

            {/* ── Interactive demo card ───────────────────────────────────── */}
            <div className="demo" id="lp-demo">
              <div className="demo-head">
                <div className="demo-title">
                  <span style={{ opacity: .85 }}>Organizer</span>
                  <span style={{ color: 'var(--muted)', fontWeight: 700, fontSize: '12px' }}>(interactive mock)</span>
                </div>
                <div className="demo-badges">
                  <span className="badge warn" id="lp-uncat-badge">Uncategorized: 5</span>
                  <span className="badge good">Remembering: On</span>
                </div>
              </div>

              <div className="demo-body">
                {/* Drop zone */}
                <div className="drop" id="lp-drop" role="button" tabIndex={0} aria-label="Upload dropzone">
                  <div className="upicon">⇪</div>
                  <div style={{ minWidth: 0 }}>
                    <strong>Drop your CSV / OFX / QFX / QBO here</strong>
                    <span>We'll import transactions. You organize them your way.</span>
                  </div>
                  <input id="lp-file" type="file" accept=".csv,.ofx,.qfx,.qbo" style={{ display: 'none' }} />
                </div>

                {/* Two-column organizer */}
                <div className="columns" aria-label="Organizer columns">
                  {/* Uncategorized column */}
                  <div className="col" id="lp-col-uncat">
                    <h3>Uncategorized <span className="count" id="lp-uncat-count">5</span></h3>

                    <div className="tx" draggable="true" data-id="t1" data-vendor="Costco" data-amt="-244.27">
                      <div className="left">
                        <div className="vendor">Costco</div>
                        <div className="meta">Jan 13 • Card</div>
                      </div>
                      <div className="amt neg">-$244.27</div>
                    </div>

                    <div className="tx" draggable="true" data-id="t2" data-vendor="Amazon" data-amt="-105.78">
                      <div className="left">
                        <div className="vendor">Amazon</div>
                        <div className="meta">Jan 15 • Card</div>
                      </div>
                      <div className="amt neg">-$105.78</div>
                    </div>

                    <div className="tx" draggable="true" data-id="t3" data-vendor="Texaco" data-amt="-46.21">
                      <div className="left">
                        <div className="vendor">Texaco</div>
                        <div className="meta">Jan 12 • Fuel</div>
                      </div>
                      <div className="amt neg">-$46.21</div>
                    </div>

                    <div className="tx" draggable="true" data-id="t4" data-vendor="Netflix" data-amt="-15.49">
                      <div className="left">
                        <div className="vendor">Netflix</div>
                        <div className="meta">Jan 10 • Recurring</div>
                      </div>
                      <div className="amt neg">-$15.49</div>
                    </div>

                    <div className="tx" draggable="true" data-id="t5" data-vendor="Payroll" data-amt="+6659.00">
                      <div className="left">
                        <div className="vendor">Payroll</div>
                        <div className="meta">Jan 1 • Deposit</div>
                      </div>
                      <div className="amt pos">+$6,659.00</div>
                    </div>

                    <div className="hint">
                      <div>Tip: drag cards to categories.</div>
                      <div><kbd>Shift</kbd> + click (in-app) for multi-select.</div>
                    </div>
                  </div>

                  {/* Categories column */}
                  <div className="col" id="lp-col-cats">
                    <h3>Categories <span className="count">6</span></h3>

                    {[
                      { cat: 'Groceries', style: {} },
                      { cat: 'Shopping', style: {} },
                      { cat: 'Gasoline/Fuel', style: {} },
                      { cat: 'Subscriptions', style: {} },
                      { cat: 'Income', style: {} },
                      { cat: 'Needs Review', style: { borderColor: 'rgba(255,204,102,.28)', background: 'rgba(255,204,102,.08)' } },
                    ].map(({ cat, style }) => (
                      <div
                        key={cat}
                        className="tx"
                        data-drop="true"
                        data-cat={cat}
                        style={{ cursor: 'default', ...style }}
                      >
                        <div className="left">
                          <div className="vendor">{cat}</div>
                          <div className="meta">{cat === 'Needs Review' ? 'Conflicts / unusual' : 'Drop here'}</div>
                        </div>
                        <div className="amt" style={{ color: 'rgba(255,255,255,.70)' }}>0</div>
                      </div>
                    ))}

                    <div className="hint">
                      <div>When you confirm a match, we can remember it.</div>
                      <div style={{ opacity: .9 }}>No guessing. You stay in control.</div>
                    </div>
                  </div>
                </div>

                {/* Callouts card */}
                <div className="card" style={{ marginTop: '2px' }}>
                  <div className="top">
                    <div className="ic">✦</div>
                    <div>
                      <h3>Smart callouts (after you categorize)</h3>
                      <div style={{ color: 'var(--muted)', fontSize: '13px', marginTop: '2px' }}>
                        "Unusual: 650 Industries is 3× your normal amount."
                      </div>
                    </div>
                  </div>
                  <p>
                    The system summarizes where your money went and flags odd spikes, duplicates, and new merchants —
                    grounded in your confirmed categories.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────────── */}
        <section className="section" id="how">
          <div className="wrap">
            <h2>How it works</h2>
            <p className="lead">
              A simple loop: <b>upload</b> → <b>organize</b> → <b>understand</b> → <b>repeat</b>. The app gets faster because it remembers what you confirm.
            </p>
            <div className="grid3">
              <div className="card">
                <div className="top"><div className="ic">1</div><h3>Upload your statement</h3></div>
                <p>Drop in CSV/OFX/QFX/QBO. We import transactions without requiring bank logins.</p>
              </div>
              <div className="card">
                <div className="top"><div className="ic">2</div><h3>Organize with drag + multi-select</h3></div>
                <p>Assign transactions quickly. Keyboard shortcuts and filters help you fly through a month.</p>
              </div>
              <div className="card">
                <div className="top"><div className="ic">3</div><h3>Get clarity and callouts</h3></div>
                <p>Once categorized, you get grounded insights, unusual transaction flags, and clean breakdowns.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Features ─────────────────────────────────────────────────────── */}
        <section className="section" id="features">
          <div className="wrap">
            <h2>Built for control, not guesswork</h2>
            <p className="lead">
              You define categories. The app learns your rules over time — and only auto-applies what you've confirmed.
            </p>
            <div className="grid3">
              <div className="card">
                <div className="top"><div className="ic">⇄</div><h3>Remembers vendor → category</h3></div>
                <p>Confirm "Always" once, and future statements get easier. Keep "Ask me" for anything ambiguous.</p>
              </div>
              <div className="card">
                <div className="top"><div className="ic">⟲</div><h3>Recurring detection</h3></div>
                <p>Find subscriptions and repeating bills. Spot increases and new recurring charges.</p>
              </div>
              <div className="card">
                <div className="top"><div className="ic">!</div><h3>Unusual transaction callouts</h3></div>
                <p>Flags spikes, duplicates, and new merchants — with clear "why" explanations.</p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Privacy ──────────────────────────────────────────────────────── */}
        <section className="section" id="privacy">
          <div className="wrap">
            <div className="trust">
              <div className="left">
                <h2 style={{ margin: '0 0 8px' }}>Privacy-first by design</h2>
                <p className="lead" style={{ margin: 0 }}>
                  No bank login. Local-first workflow. Your organization system stays under your control —
                  and insights are based on the data you upload and the rules you confirm.
                </p>
              </div>
              <div className="right">
                <div className="chip"><span className="b" />&nbsp;No bank credentials</div>
                <div className="chip"><span className="b" style={{ background: 'var(--good)', boxShadow: '0 0 0 6px rgba(46,229,157,.10)' }} />&nbsp;Rule-based accuracy</div>
                <div className="chip"><span className="b" style={{ background: 'var(--warn)', boxShadow: '0 0 0 6px rgba(255,204,102,.10)' }} />&nbsp;Needs-review safeguards</div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Pricing / CTA ────────────────────────────────────────────────── */}
        <section className="section" id="pricing">
          <div className="wrap">
            <div className="cta">
              <div>
                <h3>Want the clean "upload → organize" experience?</h3>
                <p>Start with the organizer. Once your statement is fully categorized, unlock insights and unusual-transaction callouts.</p>
              </div>
              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <Link href="/login?mode=register" className="btn btn-primary">Upload a statement</Link>
                <a href="#lp-demo" className="btn">See the organizer</a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────────── */}
      <footer>
        <div className="wrap">
          <div className="foot">
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <div className="bl-logo-container" style={{ width: 28, height: 28, borderRadius: 8 }}><LogoMark size={17} /></div>
              <div>
                <div style={{ fontWeight: 800, color: 'rgba(255,255,255,.90)' }}>BudgetLens</div>
                <div style={{ color: 'var(--muted2)', fontSize: '12px' }}>© <span id="lp-year" /> · Privacy-first budgeting</div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap' }}>
              <a href="#how">How it works</a>
              <a href="#privacy">Privacy</a>
              <a href="#pricing">Pricing</a>
              <a href="#lp-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>Back to top</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
