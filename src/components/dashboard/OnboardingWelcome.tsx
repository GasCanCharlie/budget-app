'use client'

import Link from 'next/link'
import { UploadCloud, Tags, BarChart2, Check } from 'lucide-react'

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
      'Export a CSV or OFX file from your bank\'s website and upload it here.',
    href: '/upload',
  },
  {
    number: 2,
    icon: Tags,
    title: 'Categorize transactions',
    description:
      'Drag transactions into categories. Create rules to auto-categorize future imports.',
    href: '/categorize',
  },
  {
    number: 3,
    icon: BarChart2,
    title: 'See your dashboard',
    description:
      'Get a full breakdown of spending, income, trends, and financial health score.',
    href: '/dashboard',
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
    <><UploadCloud size={18} />Upload your first statement &rarr;</>
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
      {/* Header */}
      <div style={{ textAlign: 'center', maxWidth: 520 }}>
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
            margin: '0 0 10px',
            letterSpacing: '-0.5px',
          }}
        >
          Welcome to BudgetLens
        </h1>
        <p
          style={{
            fontSize: 16,
            color: 'var(--muted)',
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          You&apos;re 3 steps away from understanding your finances
        </p>
      </div>

      {/* Steps */}
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
              {/* Step number + icon */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
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
                      style={{
                        color: isActive ? 'var(--accent)' : 'var(--muted)',
                      }}
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

              {/* Text */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <p
                  style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: 600,
                    color: 'var(--text)',
                    lineHeight: 1.3,
                  }}
                >
                  {step.title}
                </p>
                <p
                  style={{
                    margin: 0,
                    fontSize: 13,
                    color: 'var(--muted)',
                    lineHeight: 1.55,
                  }}
                >
                  {step.description}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {/* CTA */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
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

        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: 'var(--subtle)',
            textAlign: 'center',
          }}
        >
          Supports CSV, OFX, QFX, and QBO formats from any bank
        </p>
      </div>
    </div>
  )
}
