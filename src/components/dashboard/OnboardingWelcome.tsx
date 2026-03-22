'use client'

import Link from 'next/link'
import { UploadCloud, Tags, BarChart2, Check, Brain, BarChart3, FlaskConical } from 'lucide-react'

interface Props {
  uploadsDone?: boolean
  uncategorizedCount?: number
}

const stepDefs = [
  {
    number: 1,
    icon: UploadCloud,
    title: 'Upload your statement',
    description:
      'Export a CSV or OFX file from your bank and upload it here. Takes about 30 seconds.',
    href: '/upload',
  },
  {
    number: 2,
    icon: Tags,
    title: 'Categorize transactions',
    description:
      'Drag transactions into categories. We use this to map your spending behavior.',
    href: '/categorize',
  },
  {
    number: 3,
    icon: BarChart2,
    title: 'Unlock your results',
    description:
      'See your Money Personality, spending patterns, and full Financial Autopsy.',
    href: '/dashboard',
  },
]

const howItWorks = [
  {
    icon: Brain,
    title: 'Get your Money Personality',
    description: 'Understand your unique spending behavior — are you a Wire Dancer or Glowing Broke?',
    color: '#8b6fff',
  },
  {
    icon: BarChart3,
    title: 'See what\'s driving it',
    description: 'We analyze your categories to reveal the patterns behind your habits.',
    color: '#6c7cff',
  },
  {
    icon: FlaskConical,
    title: 'Run a Financial Autopsy',
    description: 'Get a clear breakdown of where your money is going — and how to fix it.',
    color: '#2dd4bf',
  },
]

export function OnboardingWelcome({ uploadsDone, uncategorizedCount }: Props) {
  // Determine which step is active (1-indexed)
  let activeStep: 1 | 2 | 3 = 1
  if (uploadsDone && (uncategorizedCount ?? 0) > 0) activeStep = 2
  if (uploadsDone && (uncategorizedCount ?? 0) === 0) activeStep = 3

  // CTA config
  let ctaHref = '/upload'
  let ctaLabel: React.ReactNode = (
    <><UploadCloud size={18} />Upload &amp; Reveal My Money Personality &rarr;</>
  )
  if (activeStep === 2) {
    ctaHref = '/categorize'
    ctaLabel = <><Tags size={18} />Categorize {uncategorizedCount} transaction{uncategorizedCount === 1 ? '' : 's'} &rarr;</>
  } else if (activeStep === 3) {
    ctaHref = '/dashboard'
    ctaLabel = <><BarChart2 size={18} />Go to Dashboard &rarr;</>
  }

  return (
    <div
      style={{
        width: '100%',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '48px 40px 40px',
        boxShadow:
          '0 1px 2px rgba(0,0,0,0.08), 0 12px 40px rgba(0,0,0,0.18)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 40,
      }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', maxWidth: 540 }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '50%',
            background:
              'linear-gradient(135deg, rgba(124,137,255,0.22) 0%, rgba(139,111,255,0.18) 100%)',
            border: '1px solid rgba(124,137,255,0.30)',
            marginBottom: 20,
          }}
        >
          <BarChart2 size={26} style={{ color: 'var(--accent)' }} />
        </div>

        <h1
          style={{
            fontSize: 28,
            fontWeight: 700,
            color: 'var(--text)',
            margin: '0 0 12px',
            letterSpacing: '-0.5px',
          }}
        >
          Welcome to BudgetLens
        </h1>
        <p
          style={{
            fontSize: 16,
            color: 'var(--muted)',
            margin: '0 0 14px',
            lineHeight: 1.6,
          }}
        >
          Discover your Money Personality, uncover what&apos;s really driving your spending, and run a full Financial Autopsy on your habits.
        </p>
        <p
          style={{
            fontSize: 13,
            color: 'rgba(255,255,255,0.32)',
            margin: 0,
            fontStyle: 'italic',
            letterSpacing: '0.01em',
          }}
        >
          Your bank statement tells a story. We translate it.
        </p>
      </div>

      {/* ── Steps ──────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 16,
          width: '100%',
          maxWidth: 860,
        }}
      >
        {stepDefs.map((step) => {
          const Icon = step.icon
          const isActive = step.number === activeStep
          const isDone   = step.number < activeStep

          return (
            <div
              key={step.number}
              style={{
                background: isActive
                  ? 'linear-gradient(135deg, rgba(124,137,255,0.12) 0%, rgba(139,111,255,0.08) 100%)'
                  : isDone
                  ? 'rgba(22,163,74,0.06)'
                  : 'var(--card)',
                border: isActive
                  ? '1px solid rgba(124,137,255,0.38)'
                  : isDone
                  ? '1px solid rgba(22,163,74,0.30)'
                  : '1px solid var(--border)',
                borderRadius: 16,
                padding: '24px 22px',
                display: 'flex',
                flexDirection: 'column',
                gap: 14,
                opacity: isActive || isDone ? 1 : 0.55,
                boxShadow: isActive
                  ? '0 0 0 1px rgba(124,137,255,0.12), 0 8px 32px rgba(124,137,255,0.10)'
                  : isDone
                  ? '0 0 0 1px rgba(22,163,74,0.08)'
                  : 'none',
                transition: 'box-shadow 200ms ease',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: isDone
                      ? 'rgba(22,163,74,0.18)'
                      : isActive
                      ? 'rgba(124,137,255,0.22)'
                      : 'var(--surface2)',
                    border: isDone
                      ? '1px solid rgba(22,163,74,0.32)'
                      : isActive
                      ? '1px solid rgba(124,137,255,0.32)'
                      : '1px solid var(--border)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {isDone ? (
                    <Check size={18} style={{ color: 'rgb(22,163,74)' }} />
                  ) : (
                    <Icon
                      size={18}
                      style={{ color: isActive ? 'var(--accent)' : 'var(--muted)' }}
                    />
                  )}
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: isDone
                      ? 'rgb(22,163,74)'
                      : isActive
                      ? 'var(--accent)'
                      : 'var(--muted)',
                  }}
                >
                  Step {step.number}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>
                  {step.title}
                </p>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)', lineHeight: 1.55 }}>
                  {step.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <div style={{ width: '100%', maxWidth: 860 }}>
        <p style={{
          margin: '0 0 14px',
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.10em',
          color: 'rgba(255,255,255,0.30)',
          textAlign: 'center',
        }}>
          How it works
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}>
          {howItWorks.map((item) => {
            const Icon = item.icon
            return (
              <div key={item.title} style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '18px 18px',
                borderRadius: 14,
                background: `${item.color}0a`,
                border: `1px solid ${item.color}22`,
              }}>
                <div style={{
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  background: `${item.color}18`,
                  border: `1px solid ${item.color}30`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={16} color={item.color} strokeWidth={1.8} />
                </div>
                <div>
                  <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--text)', lineHeight: 1.2 }}>
                    {item.title}
                  </p>
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)', lineHeight: 1.55 }}>
                    {item.description}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 }}>
        <Link
          href={ctaHref}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 10,
            padding: '14px 32px',
            borderRadius: 12,
            background: 'linear-gradient(135deg, #6c7cff 0%, #8b6fff 100%)',
            color: '#ffffff',
            fontWeight: 700,
            fontSize: 15,
            textDecoration: 'none',
            boxShadow:
              '0 4px 20px rgba(124,137,255,0.38), 0 1px 4px rgba(0,0,0,0.18)',
            transition: 'transform 150ms ease, box-shadow 150ms ease',
          }}
        >
          {ctaLabel}
        </Link>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--subtle)', textAlign: 'center' }}>
          Supports CSV, OFX, QFX, and QBO formats from any bank
        </p>
      </div>
    </div>
  )
}
