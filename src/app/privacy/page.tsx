import Link from 'next/link'
import type { Metadata } from 'next'
import { LogoMark } from '@/components/LogoMark'

export const metadata: Metadata = {
  title: 'Privacy Policy — BudgetLens',
  description: 'How BudgetLens handles your data. Privacy-first financial intelligence — no bank login, no data sold, email stored only as a SHA-256 hash.',
}

const CSS = `
.policy-shell {
  --bg:      #0b1020;
  --bg2:     #070a14;
  --text:    #eaf0ff;
  --muted:   #a8b3d6;
  --muted2:  #8b97c3;
  --brand:   #6ea8ff;
  --brand2:  #8a7dff;
  --good:    #2ee59d;
  --surface: rgba(255,255,255,.05);
  --border:  rgba(255,255,255,.10);
  --max:     780px;

  min-height: 100vh;
  background:
    radial-gradient(1100px 700px at 20% 10%, rgba(110,168,255,.22), transparent 55%),
    radial-gradient(800px 600px at 80% 15%, rgba(138,125,255,.18), transparent 55%),
    linear-gradient(180deg, var(--bg) 0%, var(--bg2) 100%);
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto,
               Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  color: var(--text);
  overflow-x: hidden;
}

.policy-shell a { color: var(--brand); text-decoration: none; }
.policy-shell a:hover { text-decoration: underline; }

.policy-nav {
  position: sticky; top: 0; z-index: 50;
  backdrop-filter: blur(10px);
  background: linear-gradient(180deg, rgba(11,16,32,.82), rgba(11,16,32,.52));
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.policy-nav-inner {
  width: min(var(--max), calc(100% - 40px));
  margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0;
}
.policy-brand {
  display: flex; align-items: center; gap: 10px;
  font-weight: 700; letter-spacing: .2px; color: var(--text);
  text-decoration: none !important;
}

.policy-wrap {
  width: min(var(--max), calc(100% - 40px));
  margin: 0 auto;
  padding: 52px 0 80px;
}

.policy-back {
  display: inline-flex; align-items: center; gap: 8px;
  color: var(--muted2); font-size: 14px; font-weight: 600;
  padding: 8px 12px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.04);
  margin-bottom: 36px;
  transition: background .14s, border-color .14s, color .14s;
  text-decoration: none !important;
}
.policy-back:hover {
  background: rgba(255,255,255,.07);
  border-color: rgba(255,255,255,.16);
  color: var(--text);
  text-decoration: none !important;
}

.policy-header { margin-bottom: 40px; }
.policy-header .kicker {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.11); background: rgba(255,255,255,.05);
  color: var(--muted); font-weight: 650; font-size: 12px;
  margin-bottom: 16px;
}
.policy-header .dot {
  width: 8px; height: 8px; border-radius: 999px;
  background: var(--good); box-shadow: 0 0 0 5px rgba(46,229,157,.12);
}
.policy-header h1 {
  margin: 0 0 12px; font-size: clamp(26px, 3.5vw, 38px);
  line-height: 1.1; letter-spacing: -.5px;
}
.policy-header p {
  margin: 0; color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 62ch;
}

.policy-card {
  border-radius: 22px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: 0 14px 45px rgba(0,0,0,.50), inset 0 1px 0 rgba(255,255,255,.07);
  backdrop-filter: blur(12px);
  padding: 28px 32px;
  margin-bottom: 16px;
  position: relative;
  overflow: hidden;
}
.policy-card::before {
  content: "";
  position: absolute; inset: -1px;
  background: radial-gradient(340px 180px at 20% 0%, rgba(110,168,255,.10), transparent 65%);
  pointer-events: none; border-radius: inherit;
}

.policy-card h2 {
  margin: 0 0 14px; font-size: 17px; font-weight: 800; letter-spacing: -.2px;
  color: var(--text); position: relative;
  display: flex; align-items: center; gap: 10px;
}
.policy-card h2 .sec-icon {
  width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.07);
  display: grid; place-items: center; font-size: 16px;
}

.policy-card p,
.policy-card ul,
.policy-card li {
  color: var(--muted); font-size: 14px; line-height: 1.7;
  position: relative; margin: 0;
}
.policy-card p + p { margin-top: 10px; }
.policy-card ul { padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.policy-card li {
  display: flex; align-items: flex-start; gap: 10px;
}
.policy-card li::before {
  content: "";
  width: 6px; height: 6px; border-radius: 999px;
  background: rgba(110,168,255,.60);
  flex-shrink: 0; margin-top: 8px;
}

.policy-card .highlight {
  margin-top: 14px; padding: 12px 14px; border-radius: 13px;
  border: 1px solid rgba(46,229,157,.20); background: rgba(46,229,157,.07);
  color: #66f0b7; font-size: 13px; font-weight: 650; line-height: 1.55;
  display: flex; align-items: flex-start; gap: 10px;
}
.policy-card .highlight::before { content: "✓"; flex-shrink: 0; margin-top: 1px; }

.policy-card .warn-box {
  margin-top: 14px; padding: 12px 14px; border-radius: 13px;
  border: 1px solid rgba(110,168,255,.22); background: rgba(110,168,255,.07);
  color: rgba(168,210,255,.90); font-size: 13px; line-height: 1.55;
  display: flex; align-items: flex-start; gap: 10px;
}
.policy-card .warn-box::before { content: "ℹ"; flex-shrink: 0; margin-top: 1px; }

.policy-updated {
  color: var(--muted2); font-size: 13px; margin-bottom: 24px;
}

.policy-footer {
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid rgba(255,255,255,.08);
  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  color: var(--muted2); font-size: 13px;
}
.policy-footer a { color: rgba(255,255,255,.65); }
.policy-footer a:hover { color: var(--text); text-decoration: none; }

@media (max-width: 640px) {
  .policy-card { padding: 22px 20px; }
  .policy-wrap { padding: 36px 0 60px; }
}
@media (prefers-reduced-motion: reduce) {
  .policy-back { transition: none; }
}
`

export default function PrivacyPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="policy-shell">

        {/* Nav */}
        <div className="policy-nav">
          <div className="policy-nav-inner">
            <Link href="/" className="policy-brand">
              <div style={{
                width: 30, height: 30, borderRadius: 9, flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(110,168,255,.9), rgba(138,125,255,.9))',
                border: '1px solid rgba(255,255,255,.18)',
                display: 'grid', placeItems: 'center',
              }}>
                <LogoMark size={18} />
              </div>
              <span style={{ fontSize: '14px' }}>BudgetLens</span>
            </Link>
            <div style={{ display: 'flex', gap: '16px', fontSize: '13px', color: 'var(--muted)' }}>
              <Link href="/terms" style={{ color: 'var(--muted)' }}>Terms</Link>
              <Link href="/login" style={{ color: 'var(--muted)' }}>Sign in</Link>
            </div>
          </div>
        </div>

        <div className="policy-wrap">

          {/* Back */}
          <Link href="/" className="policy-back">
            ← Back to BudgetLens
          </Link>

          {/* Header */}
          <div className="policy-header">
            <div className="kicker">
              <span className="dot" aria-hidden="true" />
              Legal
            </div>
            <h1>Privacy Policy</h1>
            <p>
              BudgetLens is built privacy-first. This policy explains exactly what data we
              collect, how we use it, and the steps we take to keep it safe.
            </p>
          </div>

          <p className="policy-updated">Last updated: March 2026</p>

          {/* 1 — What we collect */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">📋</span>
              1. What we collect
            </h2>
            <p>
              We collect only the minimum data needed to run the service. Here is an
              exhaustive list:
            </p>
            <ul>
              <li>
                <strong style={{ color: 'var(--text)' }}>Email address (hashed)</strong> — your
                email is immediately hashed with SHA-256 and only the hash is stored.
                We cannot reverse this to recover your original address.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Password (hashed)</strong> — bcrypt
                hashed before storage. We never store your plaintext password.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Uploaded financial files</strong> — CSV
                and OFX files you manually upload. These are processed to extract transaction
                records and then discarded. Raw file contents are not retained long-term.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Transaction records</strong> — date,
                amount, description, and category for each transaction derived from your uploads.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Categorization rules</strong> — rules
                and labels you define to auto-categorize future transactions.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>AI chat messages</strong> — messages
                you send in the AI chat feature. See section 4 for details on third-party
                processing.
              </li>
            </ul>
            <div className="highlight">
              We do not collect your name, phone number, address, bank credentials, or any
              government-issued ID number.
            </div>
          </div>

          {/* 2 — How we use it */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">⚙️</span>
              2. How we use your data
            </h2>
            <p>Your data is used solely to provide the BudgetLens service:</p>
            <ul>
              <li>Authenticating you when you sign in</li>
              <li>Displaying your transaction history, summaries, and spending charts</li>
              <li>Running automated categorization using your saved rules</li>
              <li>Powering AI chat responses about your financial data</li>
              <li>Detecting and flagging anomalies or duplicate transactions</li>
            </ul>
            <p style={{ marginTop: '12px' }}>
              We do not use your data for advertising, profiling, or any purpose beyond
              operating the features you actively use.
            </p>
          </div>

          {/* 3 — Data storage */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🔒</span>
              3. Data storage &amp; security
            </h2>
            <ul>
              <li>
                <strong style={{ color: 'var(--text)' }}>Database</strong> — Neon PostgreSQL,
                hosted on AWS infrastructure with encryption at rest and in transit (TLS 1.2+).
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Application hosting</strong> — Vercel
                edge network. All traffic is served over HTTPS.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Passwords</strong> — bcrypt with a
                cost factor of 10 or higher. Salted individually per account.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Email</strong> — stored only as a
                SHA-256 hash. There is no lookup table or reversible mapping.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Session tokens</strong> — short-lived
                JWT tokens. Stored in memory only; not written to localStorage or cookies
                outside the session.
              </li>
            </ul>
            <div className="warn-box">
              No system is perfectly secure. In the event of a breach that affects your data,
              we will notify affected users as required by applicable law.
            </div>
          </div>

          {/* 4 — Third parties */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🔗</span>
              4. Third-party services
            </h2>
            <p>
              BudgetLens uses a small number of third-party services. We do not sell your data
              to any third party, ever.
            </p>
            <ul>
              <li>
                <strong style={{ color: 'var(--text)' }}>OpenAI</strong> — when you use the AI
                chat feature, your messages and relevant transaction context are sent to
                OpenAI&apos;s API for processing. OpenAI&apos;s{' '}
                <a href="https://openai.com/policies/api-data-usage-policies" target="_blank" rel="noopener noreferrer">
                  API data usage policy
                </a>{' '}
                applies. Data sent to OpenAI is not used to train their models under the
                current enterprise API policy.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Neon</strong> — managed PostgreSQL
                database provider. Your transaction data resides on Neon-managed infrastructure.
                See{' '}
                <a href="https://neon.tech/privacy-policy" target="_blank" rel="noopener noreferrer">
                  Neon&apos;s Privacy Policy
                </a>.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Vercel</strong> — application hosting
                and CDN. Access logs may be retained by Vercel per their standard policies.
                See{' '}
                <a href="https://vercel.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer">
                  Vercel&apos;s Privacy Policy
                </a>.
              </li>
            </ul>
            <div className="highlight">
              We do not integrate with any advertising networks, analytics trackers, or
              data brokers. No third party receives your financial data for commercial purposes.
            </div>
          </div>

          {/* 5 — No bank login */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🏦</span>
              5. No bank connection
            </h2>
            <p>
              BudgetLens does not connect to your bank account. We have no integration with
              Plaid, Yodlee, or any open banking API. You upload statement files (CSV or OFX)
              manually — we never have access to your banking credentials, account numbers,
              or real-time account data.
            </p>
            <div className="highlight">
              Your bank login details are never requested, stored, or transmitted by BudgetLens.
            </div>
          </div>

          {/* 6 — Data deletion */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🗑️</span>
              6. Data deletion
            </h2>
            <p>
              You have the right to delete your account and all associated data at any time.
              To request deletion:
            </p>
            <ul>
              <li>
                Email us at{' '}
                <a href="mailto:privacy@budgetlens.app">privacy@budgetlens.app</a> with
                the subject line <em>&quot;Delete my account&quot;</em>.
              </li>
              <li>
                We will permanently delete your account, transaction records, categorization
                rules, and all other stored data within 30 days.
              </li>
              <li>
                Because your email is stored only as a hash, we will ask you to provide the
                email address you registered with so we can compute the matching hash and
                locate your account.
              </li>
            </ul>
            <p style={{ marginTop: '12px' }}>
              We do not retain backups of deleted accounts beyond standard database backup
              retention windows (typically 7 days).
            </p>
          </div>

          {/* 7 — Cookies */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🍪</span>
              7. Cookies &amp; local storage
            </h2>
            <p>
              BudgetLens does not use third-party cookies or advertising cookies. We use
              browser local storage for:
            </p>
            <ul>
              <li>Your authentication token (to keep you signed in between sessions)</li>
              <li>Your theme preference (light or dark mode)</li>
            </ul>
            <p style={{ marginTop: '12px' }}>
              Clearing your browser&apos;s local storage for this site will sign you out and
              reset your preferences. No other data is stored client-side.
            </p>
          </div>

          {/* 8 — Contact */}
          <div className="policy-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">✉️</span>
              8. Contact
            </h2>
            <p>
              If you have questions about this Privacy Policy or how your data is handled,
              please contact us:
            </p>
            <ul>
              <li>
                <strong style={{ color: 'var(--text)' }}>Email:</strong>{' '}
                <a href="mailto:privacy@budgetlens.app">privacy@budgetlens.app</a>
              </li>
            </ul>
            <p style={{ marginTop: '12px' }}>
              We aim to respond to all privacy inquiries within 5 business days.
            </p>
          </div>

          {/* Footer */}
          <div className="policy-footer">
            <span>© {new Date().getFullYear()} BudgetLens. Privacy-first budgeting.</span>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <Link href="/terms">Terms of Service</Link>
              <Link href="/">Home</Link>
              <Link href="/login">Sign in</Link>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
