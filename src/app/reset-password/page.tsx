'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { LogoMark } from '@/components/LogoMark'
import '@/styles/auth.css'

function ResetPasswordForm() {
  const params   = useSearchParams()
  const router   = useRouter()
  const token    = params.get('token') ?? ''

  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [loading,   setLoading]   = useState(false)
  const [success,   setSuccess]   = useState(false)
  const [error,     setError]     = useState('')

  useEffect(() => {
    if (!token) setError('Missing or invalid reset link. Please request a new one.')
  }, [token])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (password !== confirm) { setError('Passwords do not match'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')
      setSuccess(true)
      setTimeout(() => router.push('/login'), 3000)
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
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#eaf0ff', letterSpacing: '.2px', lineHeight: '1' }}>BudgetLens</div>
          <div style={{ fontSize: '12px', color: '#a8b3d6', fontWeight: 600, marginTop: '3px' }}>Statement Intelligence</div>
        </div>
      </Link>

      <div className="glass-card" style={{ maxWidth: '480px' }}>

        {success ? (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: '40px', marginBottom: '16px' }}>✅</div>
            <h2 style={{ margin: '0 0 12px', fontSize: '20px', fontWeight: 800, color: '#eaf0ff' }}>Password updated</h2>
            <p style={{ margin: '0 0 24px', fontSize: '14px', color: '#a8b3d6', lineHeight: '1.6' }}>
              Your password has been changed. Redirecting you to sign in…
            </p>
            <Link href="/login" style={{ fontSize: '14px', color: '#7c91ff', fontWeight: 600 }}>
              Sign in now →
            </Link>
          </div>
        ) : (
          <>
            <div style={{ marginBottom: '24px' }}>
              <h1 style={{ margin: '0 0 7px', fontSize: '22px', fontWeight: 800, letterSpacing: '-.3px', color: '#eaf0ff' }}>
                Set a new password
              </h1>
              <p style={{ margin: 0, fontSize: '14px', color: '#a8b3d6', lineHeight: '1.5' }}>
                Choose a new password for your account.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div>
                <label className="auth-label" htmlFor="rp-password">New password</label>
                <input
                  id="rp-password"
                  className="auth-input"
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={!token}
                />
              </div>
              <div>
                <label className="auth-label" htmlFor="rp-confirm">Confirm new password</label>
                <input
                  id="rp-confirm"
                  className="auth-input"
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Repeat your new password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={!token}
                />
              </div>

              {error && <div className="auth-error">{error}</div>}

              <button type="submit" className="auth-btn-primary" disabled={loading || !token} style={{ marginTop: '4px' }}>
                {loading ? 'Updating…' : 'Update password'}
              </button>
            </form>

            <div style={{ marginTop: '20px', textAlign: 'center' }}>
              <Link href="/forgot-password" style={{ fontSize: '13px', color: '#8b97c3' }}>
                Request a new reset link
              </Link>
            </div>
          </>
        )}

      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  )
}
