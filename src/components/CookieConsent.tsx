'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

const STORAGE_KEY = 'bl-consent-v1'

export function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true)
    } catch {
      // localStorage blocked (private mode etc.) — show banner
      setVisible(true)
    }
  }, [])

  function accept() {
    try { localStorage.setItem(STORAGE_KEY, 'accepted') } catch { /* ignore */ }
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      padding: '16px 20px',
      background: 'rgba(11,16,32,0.97)',
      backdropFilter: 'blur(16px)',
      borderTop: '1px solid rgba(255,255,255,0.10)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexWrap: 'wrap',
      gap: '12px 24px',
    }}>
      <p style={{
        margin: 0,
        fontSize: 13,
        color: '#9ca3af',
        lineHeight: 1.5,
        maxWidth: 640,
        flex: '1 1 280px',
      }}>
        BudgetLens uses essential cookies to keep you signed in. Your uploaded
        statements are processed privately on our servers — we never sell, share,
        or train on your financial data.{' '}
        <Link href="/privacy" style={{ color: '#6c7cff', textDecoration: 'underline' }}>
          Privacy Policy
        </Link>
        {' '}·{' '}
        <Link href="/terms" style={{ color: '#6c7cff', textDecoration: 'underline' }}>
          Terms
        </Link>
      </p>

      <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
        <button
          onClick={accept}
          style={{
            padding: '8px 22px',
            borderRadius: 999,
            background: 'linear-gradient(135deg,#6c7cff,#8794ff)',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  )
}
