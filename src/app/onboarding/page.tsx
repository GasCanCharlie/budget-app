'use client'

import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Upload, Tags, Sparkles, ArrowRight, ShieldCheck, Lock } from 'lucide-react'
import { LogoMark } from '@/components/LogoMark'
import '@/styles/auth.css'

const STEPS = [
  {
    icon: Upload,
    color: '#6ea8ff',
    bg: 'rgba(110,168,255,.12)',
    border: 'rgba(110,168,255,.25)',
    num: '01',
    title: 'Upload a bank statement',
    body: 'CSV or PDF — no bank login ever required. Your data stays private.',
  },
  {
    icon: Tags,
    color: '#8a7dff',
    bg: 'rgba(138,125,255,.12)',
    border: 'rgba(138,125,255,.25)',
    num: '02',
    title: 'Categorize transactions',
    body: 'AI auto-categorizes most transactions. Review and confirm in seconds.',
  },
  {
    icon: Sparkles,
    color: '#2ee59d',
    bg: 'rgba(46,229,157,.10)',
    border: 'rgba(46,229,157,.25)',
    num: '03',
    title: 'Unlock your Financial Autopsy',
    body: 'Get your Money Personality, spending trends, and AI-powered insights.',
  },
]

export default function OnboardingPage() {
  const router = useRouter()

  return (
    <div className="auth-shell">

      {/* Logo */}
      <Link href="/" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '32px' }}>
        <div className="bl-logo-container" style={{ width: 36, height: 36, borderRadius: 10 }}>
          <LogoMark size={22} />
        </div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#e5e7eb', letterSpacing: '.2px', lineHeight: 1 }}>
            Financial Autopsy
          </div>
          <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 600, marginTop: 3 }}>
            Know Where It Went
          </div>
        </div>
      </Link>

      <div className="glass-card" style={{ maxWidth: 520, width: '100%' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 7,
            padding: '5px 14px', borderRadius: 999, marginBottom: 16,
            background: 'rgba(110,168,255,.10)', border: '1px solid rgba(110,168,255,.22)',
            fontSize: 11, fontWeight: 800, letterSpacing: '.4px', textTransform: 'uppercase',
            color: '#6ea8ff',
          }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: '#6ea8ff', display: 'block' }} />
            Account created
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 900, letterSpacing: '-.5px', margin: '0 0 10px', color: '#e5e7eb' }}>
            Welcome to Financial Autopsy
          </h1>
          <p style={{ fontSize: 14, color: '#9ca3af', lineHeight: 1.6, margin: 0 }}>
            Here&apos;s how it works — you&apos;ll be set up in under 5 minutes.
          </p>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 28 }}>
          {STEPS.map(({ icon: Icon, color, bg, border, num, title, body }) => (
            <div key={num} style={{
              display: 'flex', gap: 16, alignItems: 'flex-start',
              padding: '16px 18px', borderRadius: 16,
              background: 'rgba(255,255,255,.035)',
              border: '1px solid rgba(255,255,255,.08)',
            }}>
              <div style={{
                flexShrink: 0, width: 40, height: 40, borderRadius: 12,
                background: bg, border: `1px solid ${border}`,
                display: 'grid', placeItems: 'center',
              }}>
                <Icon size={18} color={color} />
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '.6px', color: 'rgba(255,255,255,.30)', marginBottom: 4 }}>
                  STEP {num}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e5e7eb', marginBottom: 4 }}>
                  {title}
                </div>
                <div style={{ fontSize: 13, color: '#9ca3af', lineHeight: 1.55 }}>
                  {body}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <button
          className="auth-btn-primary"
          onClick={() => router.push('/upload')}
          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          Upload my first statement
          <ArrowRight size={16} />
        </button>

        <button
          onClick={() => router.push('/dashboard')}
          style={{
            width: '100%', marginTop: 10, padding: '11px',
            background: 'transparent', border: 'none', cursor: 'pointer',
            fontSize: 13, color: '#6b7280', fontFamily: 'inherit',
          }}
        >
          Skip — take me to the dashboard
        </button>

        {/* Trust row */}
        <div style={{
          display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap',
          marginTop: 20, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,.07)',
        }}>
          {[
            { icon: ShieldCheck, label: 'No bank login' },
            { icon: Lock,        label: 'Data stays private' },
          ].map(({ icon: Icon, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#6b7280' }}>
              <Icon size={13} color="#4b5563" />
              {label}
            </div>
          ))}
        </div>

      </div>
    </div>
  )
}
