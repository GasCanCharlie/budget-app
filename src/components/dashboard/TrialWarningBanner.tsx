'use client'

import { AlertCircle, X } from 'lucide-react'

interface TrialWarningBannerProps {
  trials: Array<{ merchant: string; amount: string }>
  onDismiss: () => void
}

export function TrialWarningBanner({ trials, onDismiss }: TrialWarningBannerProps) {
  const n = trials.length
  const merchantList = trials.map(t => t.merchant).join(', ')
  const plural = n !== 1 ? 's' : ''

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        background: 'rgba(251,191,36,0.08)',
        border: '1px solid rgba(251,191,36,0.20)',
        borderRadius: 12,
        padding: '12px 16px',
        marginBottom: 12,
      }}
    >
      {/* Left: icon + text */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flex: 1, minWidth: 0 }}>
        <AlertCircle
          size={18}
          style={{ color: '#fbbf24', flexShrink: 0, marginTop: 1 }}
        />
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#fde68a', margin: 0, lineHeight: 1.4 }}>
            {`\u26a0 ${n} possible trial charge${plural} detected: ${merchantList}`}
          </p>
          <p style={{ fontSize: 12, color: '#fcd34d', margin: '3px 0 0', lineHeight: 1.4, opacity: 0.85 }}>
            Review these recurring charges before they auto-renew.
          </p>
        </div>
      </div>

      {/* Right: dismiss button */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss trial warning"
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fbbf24',
          cursor: 'pointer',
          padding: 2,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 4,
          opacity: 0.75,
        }}
      >
        <X size={16} />
      </button>
    </div>
  )
}
