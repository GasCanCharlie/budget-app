'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import '@/styles/auth.css'

function LoginForm() {
  const router       = useRouter()
  const params       = useSearchParams()
  const setAuth      = useAuthStore(s => s.setAuth)
  const user         = useAuthStore(s => s.user)
  const { apiFetch } = useApi()

  const [mode,     setMode]     = useState<'login' | 'register'>(
    params.get('mode') === 'register' ? 'register' : 'login'
  )
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  useEffect(() => {
    if (user) router.replace('/dashboard')
  }, [user, router])

  if (user) return null

  function switchMode(m: 'login' | 'register') {
    setMode(m)
    setError('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const path = mode === 'register' ? '/api/auth/register' : '/api/auth/login'
      const data = await apiFetch(path, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setAuth(data.user, data.token)
      router.push('/dashboard')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell">

      {/* ── Brand row ──────────────────────────────────────────────────────── */}
      <Link
        href="/"
        style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '28px' }}
      >
        <div className="auth-logo-mark" aria-hidden="true" />
        <div>
          <div style={{ fontSize: '15px', fontWeight: 700, color: '#eaf0ff', letterSpacing: '.2px', lineHeight: '1' }}>
            BudgetLens
          </div>
          <div style={{ fontSize: '12px', color: '#a8b3d6', fontWeight: 600, marginTop: '3px' }}>
            Statement Intelligence
          </div>
        </div>
      </Link>

      {/* ── Glass card ─────────────────────────────────────────────────────── */}
      <div className="glass-card" style={{ maxWidth: '480px' }}>

        {/* Headline */}
        <div style={{ marginBottom: '24px', position: 'relative' }}>
          <h1 style={{ margin: '0 0 7px', fontSize: '22px', fontWeight: 800, letterSpacing: '-.3px', color: '#eaf0ff' }}>
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p style={{ margin: 0, fontSize: '14px', color: '#a8b3d6', lineHeight: '1.5' }}>
            Privacy-first · No bank login · Local-first
          </p>
        </div>

        {/* Mode tabs */}
        <div className="auth-tab-bar" style={{ marginBottom: '24px' }}>
          <button type="button" className={`auth-tab${mode === 'login'    ? ' active' : ''}`} onClick={() => switchMode('login')}>
            Sign in
          </button>
          <button type="button" className={`auth-tab${mode === 'register' ? ' active' : ''}`} onClick={() => switchMode('register')}>
            Create account
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          <div>
            <label className="auth-label" htmlFor="au-email">Email address</label>
            <input
              id="au-email"
              className="auth-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '7px' }}>
              <label className="auth-label" htmlFor="au-password" style={{ margin: 0 }}>Password</label>
              {mode === 'login' && (
                <span style={{ fontSize: '12px', color: '#8b97c3', letterSpacing: '.1px' }}>Forgot password?</span>
              )}
            </div>
            <input
              id="au-password"
              className="auth-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              required
              minLength={mode === 'register' ? 8 : 1}
            />
          </div>

          {error && <div className="auth-error">{error}</div>}

          <button type="submit" className="auth-btn-primary" disabled={loading} style={{ marginTop: '4px' }}>
            {loading
              ? 'Please wait…'
              : mode === 'login' ? 'Sign in' : 'Create account'
            }
          </button>

        </form>

        {/* Divider + switch mode */}
        <div style={{ marginTop: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="auth-divider">or</div>
          <button
            type="button"
            className="auth-btn-secondary"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Create a new account' : 'Back to sign in'}
          </button>
        </div>

      </div>

      {/* ── Trust copy ─────────────────────────────────────────────────────── */}
      <div className="auth-trust" style={{ marginTop: '20px', maxWidth: '480px', width: '100%', padding: '0 4px' }}>
        <div className="auth-trust-row">
          <span className="auth-trust-dot" />
          We never ask for your bank credentials.
        </div>
        <div className="auth-trust-row">
          <span className="auth-trust-dot" />
          Uploads are processed safely and stay private.
        </div>
      </div>

    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
