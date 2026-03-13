import Link from 'next/link'
import type { Metadata } from 'next'
import { LogoMark } from '@/components/LogoMark'

export const metadata: Metadata = {
  title: 'Terms of Service — BudgetLens',
  description: 'Terms governing your use of BudgetLens, a personal finance and bank statement analysis tool.',
}

const CSS = `
.terms-shell {
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

.terms-shell a { color: var(--brand); text-decoration: none; }
.terms-shell a:hover { text-decoration: underline; }

.terms-nav {
  position: sticky; top: 0; z-index: 50;
  backdrop-filter: blur(10px);
  background: linear-gradient(180deg, rgba(11,16,32,.82), rgba(11,16,32,.52));
  border-bottom: 1px solid rgba(255,255,255,.06);
}
.terms-nav-inner {
  width: min(var(--max), calc(100% - 40px));
  margin: 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 0;
}
.terms-brand {
  display: flex; align-items: center; gap: 10px;
  font-weight: 700; letter-spacing: .2px; color: var(--text);
  text-decoration: none !important;
}

.terms-wrap {
  width: min(var(--max), calc(100% - 40px));
  margin: 0 auto;
  padding: 52px 0 80px;
}

.terms-back {
  display: inline-flex; align-items: center; gap: 8px;
  color: var(--muted2); font-size: 14px; font-weight: 600;
  padding: 8px 12px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,.09);
  background: rgba(255,255,255,.04);
  margin-bottom: 36px;
  transition: background .14s, border-color .14s, color .14s;
  text-decoration: none !important;
}
.terms-back:hover {
  background: rgba(255,255,255,.07);
  border-color: rgba(255,255,255,.16);
  color: var(--text);
  text-decoration: none !important;
}

.terms-header { margin-bottom: 40px; }
.terms-header .kicker {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 7px 12px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,.11); background: rgba(255,255,255,.05);
  color: var(--muted); font-weight: 650; font-size: 12px;
  margin-bottom: 16px;
}
.terms-header .dot {
  width: 8px; height: 8px; border-radius: 999px;
  background: var(--brand); box-shadow: 0 0 0 5px rgba(110,168,255,.12);
}
.terms-header h1 {
  margin: 0 0 12px; font-size: clamp(26px, 3.5vw, 38px);
  line-height: 1.1; letter-spacing: -.5px;
}
.terms-header p {
  margin: 0; color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 62ch;
}

.terms-card {
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
.terms-card::before {
  content: "";
  position: absolute; inset: -1px;
  background: radial-gradient(340px 180px at 20% 0%, rgba(110,168,255,.10), transparent 65%);
  pointer-events: none; border-radius: inherit;
}

.terms-card h2 {
  margin: 0 0 14px; font-size: 17px; font-weight: 800; letter-spacing: -.2px;
  color: var(--text); position: relative;
  display: flex; align-items: center; gap: 10px;
}
.terms-card h2 .sec-icon {
  width: 32px; height: 32px; border-radius: 10px; flex-shrink: 0;
  border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.07);
  display: grid; place-items: center; font-size: 16px;
}

.terms-card p,
.terms-card ul,
.terms-card li {
  color: var(--muted); font-size: 14px; line-height: 1.7;
  position: relative; margin: 0;
}
.terms-card p + p { margin-top: 10px; }
.terms-card ul { padding-left: 0; list-style: none; display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.terms-card li {
  display: flex; align-items: flex-start; gap: 10px;
}
.terms-card li::before {
  content: "";
  width: 6px; height: 6px; border-radius: 999px;
  background: rgba(110,168,255,.60);
  flex-shrink: 0; margin-top: 8px;
}

.terms-card .highlight {
  margin-top: 14px; padding: 12px 14px; border-radius: 13px;
  border: 1px solid rgba(46,229,157,.20); background: rgba(46,229,157,.07);
  color: #66f0b7; font-size: 13px; font-weight: 650; line-height: 1.55;
  display: flex; align-items: flex-start; gap: 10px;
}
.terms-card .highlight::before { content: "✓"; flex-shrink: 0; margin-top: 1px; }

.terms-card .warn-box {
  margin-top: 14px; padding: 12px 14px; border-radius: 13px;
  border: 1px solid rgba(255,204,102,.22); background: rgba(255,204,102,.07);
  color: rgba(255,220,140,.90); font-size: 13px; line-height: 1.55;
  display: flex; align-items: flex-start; gap: 10px;
}
.terms-card .warn-box::before { content: "⚠"; flex-shrink: 0; margin-top: 1px; }

.terms-card .info-box {
  margin-top: 14px; padding: 12px 14px; border-radius: 13px;
  border: 1px solid rgba(110,168,255,.22); background: rgba(110,168,255,.07);
  color: rgba(168,210,255,.90); font-size: 13px; line-height: 1.55;
  display: flex; align-items: flex-start; gap: 10px;
}
.terms-card .info-box::before { content: "ℹ"; flex-shrink: 0; margin-top: 1px; }

.terms-updated {
  color: var(--muted2); font-size: 13px; margin-bottom: 24px;
}

.terms-footer {
  margin-top: 48px;
  padding-top: 20px;
  border-top: 1px solid rgba(255,255,255,.08);
  display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap;
  color: var(--muted2); font-size: 13px;
}
.terms-footer a { color: rgba(255,255,255,.65); }
.terms-footer a:hover { color: var(--text); text-decoration: none; }

@media (max-width: 640px) {
  .terms-card { padding: 22px 20px; }
  .terms-wrap { padding: 36px 0 60px; }
}
@media (prefers-reduced-motion: reduce) {
  .terms-back { transition: none; }
}
`

export default function TermsPage() {
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <div className="terms-shell">

        {/* Nav */}
        <div className="terms-nav">
          <div className="terms-nav-inner">
            <Link href="/" className="terms-brand">
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
              <Link href="/privacy" style={{ color: 'var(--muted)' }}>Privacy</Link>
              <Link href="/login" style={{ color: 'var(--muted)' }}>Sign in</Link>
            </div>
          </div>
        </div>

        <div className="terms-wrap">

          {/* Back */}
          <Link href="/" className="terms-back">
            ← Back to BudgetLens
          </Link>

          {/* Header */}
          <div className="terms-header">
            <div className="kicker">
              <span className="dot" aria-hidden="true" />
              Legal
            </div>
            <h1>Terms of Service</h1>
            <p>
              Please read these terms carefully before using BudgetLens. By creating an account
              or using the service, you agree to be bound by these terms.
            </p>
          </div>

          <p className="terms-updated">Last updated: March 2026</p>

          {/* 1 — Acceptance */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">📄</span>
              1. Acceptance of terms
            </h2>
            <p>
              By accessing or using BudgetLens (&quot;the Service&quot;, &quot;we&quot;,
              &quot;us&quot;), you agree to these Terms of Service and our{' '}
              <Link href="/privacy">Privacy Policy</Link>. If you do not agree, do not use
              the Service.
            </p>
            <p>
              These terms apply to all users of the Service, including visitors, registered
              users, and anyone who accesses or uses any part of BudgetLens.
            </p>
          </div>

          {/* 2 — Service description */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🔍</span>
              2. Service description
            </h2>
            <p>
              BudgetLens is a personal finance analysis tool that allows you to:
            </p>
            <ul>
              <li>Upload bank statement files (CSV, OFX) for transaction analysis</li>
              <li>Categorize, tag, and organize your transaction history</li>
              <li>View spending summaries, trends, and anomaly detection</li>
              <li>Define automated categorization rules for recurring transactions</li>
              <li>Use an AI-powered chat interface to query and analyze your financial data</li>
            </ul>
            <div className="highlight">
              BudgetLens does not connect to your bank account. No bank credentials are
              ever requested or stored. You upload files manually.
            </div>
          </div>

          {/* 3 — User responsibilities */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">👤</span>
              3. User responsibilities
            </h2>
            <p>You agree to:</p>
            <ul>
              <li>
                Provide a valid email address and a secure password when registering
              </li>
              <li>
                Keep your account credentials confidential and not share access with others
              </li>
              <li>
                Use the Service only for lawful personal finance management purposes
              </li>
              <li>
                Upload only files that you own or have the right to process
              </li>
              <li>
                Not attempt to reverse-engineer, scrape, or abuse the Service or its APIs
              </li>
              <li>
                Not upload files containing data that belongs to other individuals without
                their consent
              </li>
            </ul>
            <div className="warn-box">
              You are responsible for the security of your account. Notify us immediately
              at <a href="mailto:support@budgetlens.app">support@budgetlens.app</a> if you
              suspect unauthorized access.
            </div>
          </div>

          {/* 4 — Data */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🔒</span>
              4. Your data
            </h2>
            <p>
              You retain full ownership of all financial data you upload to BudgetLens.
              By uploading data, you grant us a limited, non-exclusive license to process
              that data solely for the purpose of providing the Service to you.
            </p>
            <ul>
              <li>We do not sell your data to any third party</li>
              <li>We do not use your financial data for advertising or profiling</li>
              <li>
                AI chat features transmit relevant context to OpenAI&apos;s API — see our{' '}
                <Link href="/privacy">Privacy Policy</Link> for details
              </li>
              <li>
                You may request deletion of all your data at any time — see the Privacy
                Policy for the deletion process
              </li>
            </ul>
            <div className="info-box">
              Your email address is stored only as a SHA-256 hash. We cannot recover or
              display your original email address.
            </div>
          </div>

          {/* 5 — Disclaimers */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">⚠️</span>
              5. Disclaimers
            </h2>
            <p>
              BudgetLens is provided &quot;as is&quot; and &quot;as available&quot; without
              warranties of any kind, either express or implied.
            </p>
            <ul>
              <li>
                <strong style={{ color: 'var(--text)' }}>Not financial advice</strong> — the
                Service is a data organization and analysis tool. Nothing on BudgetLens
                constitutes financial, investment, tax, or legal advice. Always consult a
                qualified professional for financial decisions.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>AI accuracy</strong> — AI-generated
                responses in the chat feature may contain errors or inaccuracies. Do not rely
                solely on AI output for financial decisions.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Data accuracy</strong> — transaction
                categorization and anomaly detection are automated and may not be 100% accurate.
                You are responsible for verifying your financial records.
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Service availability</strong> — we do
                not guarantee uninterrupted, error-free access to the Service.
              </li>
            </ul>
          </div>

          {/* 6 — Limitation of liability */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">⚖️</span>
              6. Limitation of liability
            </h2>
            <p>
              To the fullest extent permitted by applicable law, BudgetLens and its operators
              shall not be liable for any indirect, incidental, special, consequential, or
              punitive damages, including but not limited to:
            </p>
            <ul>
              <li>Loss of data or profits arising from your use or inability to use the Service</li>
              <li>Financial losses resulting from reliance on Service output or AI responses</li>
              <li>Unauthorized access to your account due to your own failure to maintain
                  credential security</li>
              <li>Any interruption or cessation of Service transmission</li>
            </ul>
            <p style={{ marginTop: '12px' }}>
              In jurisdictions that do not allow exclusion of certain warranties or limitations
              of liability, our liability is limited to the maximum extent permitted by law.
            </p>
            <p style={{ marginTop: '12px' }}>
              Our total aggregate liability for any claims arising from use of the Service
              shall not exceed the amount you paid us (if any) in the 12 months prior to
              the claim.
            </p>
          </div>

          {/* 7 — Acceptable use */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🛡️</span>
              7. Acceptable use
            </h2>
            <p>You may not use the Service to:</p>
            <ul>
              <li>Violate any applicable local, national, or international law or regulation</li>
              <li>Upload malicious files or attempt to exploit the Service</li>
              <li>Interfere with or disrupt the integrity or performance of the Service</li>
              <li>Attempt to gain unauthorized access to any portion of the Service or
                  its related systems</li>
              <li>Use automated tools to scrape or bulk-download data from the Service</li>
              <li>Impersonate any other user or person</li>
            </ul>
            <p style={{ marginTop: '12px' }}>
              We reserve the right to suspend or terminate accounts that violate these terms,
              with or without notice.
            </p>
          </div>

          {/* 8 — Changes to terms */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">📝</span>
              8. Changes to these terms
            </h2>
            <p>
              We may update these Terms of Service from time to time. When we make material
              changes, we will update the &quot;Last updated&quot; date at the top of this page.
            </p>
            <p>
              Continued use of the Service after changes become effective constitutes your
              acceptance of the revised terms. If you disagree with any changes, you should
              stop using the Service and may request account deletion.
            </p>
            <div className="info-box">
              We will make reasonable efforts to notify registered users of significant changes
              via in-app notice, but we cannot guarantee delivery given that your email is
              stored only as a hash.
            </div>
          </div>

          {/* 9 — Termination */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">🔚</span>
              9. Termination
            </h2>
            <p>
              You may stop using the Service and request account deletion at any time by
              contacting <a href="mailto:support@budgetlens.app">support@budgetlens.app</a>.
            </p>
            <p>
              We reserve the right to suspend or terminate your access to the Service at
              our discretion, including if we reasonably believe you have violated these terms.
              We will endeavor to provide notice where feasible.
            </p>
            <p>
              Upon termination, your right to use the Service ceases immediately. Provisions
              of these terms that by their nature should survive termination will continue
              to apply (including sections on data, disclaimers, and liability).
            </p>
          </div>

          {/* 10 — Contact */}
          <div className="terms-card">
            <h2>
              <span className="sec-icon" aria-hidden="true">✉️</span>
              10. Contact
            </h2>
            <p>
              If you have questions about these Terms of Service, please contact us:
            </p>
            <ul>
              <li>
                <strong style={{ color: 'var(--text)' }}>General inquiries:</strong>{' '}
                <a href="mailto:support@budgetlens.app">support@budgetlens.app</a>
              </li>
              <li>
                <strong style={{ color: 'var(--text)' }}>Privacy &amp; data requests:</strong>{' '}
                <a href="mailto:privacy@budgetlens.app">privacy@budgetlens.app</a>
              </li>
            </ul>
          </div>

          {/* Footer */}
          <div className="terms-footer">
            <span>© {new Date().getFullYear()} BudgetLens. Privacy-first budgeting.</span>
            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
              <Link href="/privacy">Privacy Policy</Link>
              <Link href="/">Home</Link>
              <Link href="/login">Sign in</Link>
            </div>
          </div>

        </div>
      </div>
    </>
  )
}
