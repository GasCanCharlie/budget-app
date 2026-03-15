'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'
import '@/styles/auth.css'

export default function ForgotPasswordPage() {
  const [email,     setEmail]     = useState('')
  const [loading,   setLoading]   = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error,     setError]     = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Something went wrong')
      }
      setSubmitted(true)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">

      <Link href="/login" style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}>
        <div className="bl-logo-container" style={{ width: 36, height: 36, borderRadius: 10 }}><LogoMark size={22} /></div>
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#e5e7eb', letterSpacing: '.2px', lineHeight: '1' }}>BudgetLens</div>
          <div style={{ fontSize: '12px', color: '#9ca3af', fontWeight: 600, marginTop: '3px' }}>Statement Intelligence</div>
        </div>
      </Link>

      <div className="glass-card" style={{ maxWidth: '480px' }}>

        {submitted ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>📬</div>
            <h2 style={{ margin: '0 0 12px', fontSize: '20px', fontWeight: 800, color: '#e5e7eb' }}>Check your inbox</h2>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#9ca3af', lineHeight: '1.6' }}>
              If <strong style={{ color: '#e5e7eb' }}>{email}</strong> has an account, you&apos;ll receive a reset link shortly. It expires in 1 hour.
            </p>
            <Link href="/login" style={{ fontSize: '14px', color: '#6c7cff', fontWeight: 600 }}>
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '24px' }}>
              <h1 style={{ margin: '0 0 7px', fontSize: '22px', fontWeight: 800, letterSpacing: '-.3px', color: '#e5e7eb' }}>
                Forgot your password?
              </h1>
              <p style={{ margin: 0, fontSize: '14px', color: '#9ca3af', lineHeight: '1.5' }}>
                Enter your email and we&apos;ll send you a reset link.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="auth-label" htmlFor="fp-email">Email address</label>
                <input
                  id="fp-email"
                  className="auth-input"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  required
                />
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button type="submit" className="auth-btn-primary" disabled={loading} style={{ marginTop: '4px' }}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <Link href="/login" style={{ fontSize: '13px', color: '#8b97c3' }}>
                ← Back to sign in
              </Link>
            </div>
          </>
        )}

      </div>
    </div>
  )
}
