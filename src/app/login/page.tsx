'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

function LoginForm() {
  const router   = useRouter()
  const params   = useSearchParams()
  const setAuth  = useAuthStore(s => s.setAuth)
  const user     = useAuthStore(s => s.user)
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
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 px-4 py-10">
      <Link href="/" className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-blue-600 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-black text-white tracking-tight select-none">BL</span>
        </div>
        <span className="text-xl font-bold text-slate-900 tracking-tight">BudgetLens</span>
      </Link>

      <div className="w-full max-w-md">
        <div className="card">
          <div className="flex rounded-lg bg-slate-100 p-1 mb-6">
            {(['login', 'register'] as const).map(m => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-2 rounded-md text-sm font-semibold transition-all ${
                  mode === m ? 'bg-white shadow text-slate-900' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {m === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="input"
                placeholder="you@example.com"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="input"
                placeholder={mode === 'register' ? 'At least 8 characters' : '••••••••'}
                required
                minLength={mode === 'register' ? 8 : 1}
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            )}

            <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
              {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <p className="text-xs text-slate-400 text-center mt-4">
            Your data is processed locally and never sold. Delete your account at any time.
          </p>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Supported formats: Chase · BofA · Wells Fargo · Capital One · Discover ·{' '}
          <span className="text-blue-600 font-medium">40+ banks</span>
        </p>
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
