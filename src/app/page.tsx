'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

const DIFFERENTIATORS = [
  {
    icon: '🔒',
    title: 'Zero Bank Credentials',
    desc: 'CSV-only ingestion. No OAuth, no API keys, no data-sharing agreements. Your credentials never touch our system.',
  },
  {
    icon: '🛡',
    title: 'Automated Reconciliation',
    desc: 'Every statement is verified against its own declared totals. Discrepancies surface immediately with exact figures.',
  },
  {
    icon: '🔍',
    title: 'Full Pipeline Transparency',
    desc: 'Watch the 4-stage ingestion pipeline process each file. SHA-256 fingerprinted before any data is stored.',
  },
  {
    icon: '📊',
    title: 'Audit-Grade Precision',
    desc: 'Statistical anomaly detection, transformation lineage, and deduplication across every upload.',
  },
]

export default function HomePage() {
  const router   = useRouter()
  const setAuth  = useAuthStore(s => s.setAuth)
  const user     = useAuthStore(s => s.user)
  const { apiFetch } = useApi()

  const [mode,     setMode]     = useState<'login' | 'register'>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  if (user) {
    router.replace('/dashboard')
    return null
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
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-50">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="bg-navy-900 text-white py-14 px-4 text-center border-b border-navy-700">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center gap-3 mb-5">
            <div className="w-10 h-10 rounded-lg bg-accent-500 flex items-center justify-center flex-shrink-0">
              <span className="text-sm font-black text-white tracking-tight select-none">BL</span>
            </div>
            <span className="text-2xl font-bold tracking-tight">BudgetLens</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold mb-3 tracking-tight leading-tight">
            Financial Statement Intelligence
          </h1>
          <p className="text-lg text-white/70 font-normal max-w-lg mx-auto leading-relaxed">
            Ingest, reconcile, and audit your bank statements.
            Statement-level verification with full transformation lineage.
          </p>
          <div className="flex flex-wrap justify-center gap-2 mt-5">
            {['Statement Reconciliation', 'No Bank OAuth', 'SHA-256 Deduplication', 'Anomaly Detection'].map(f => (
              <span key={f} className="bg-white/10 border border-white/15 px-3 py-1 rounded-full text-xs font-medium text-white/80">
                {f}
              </span>
            ))}
          </div>
        </div>
      </header>

      {/* ── Auth form ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex items-start justify-center px-4 py-10">
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

          {/* ── Differentiators ──────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-3 mt-4">
            {DIFFERENTIATORS.map(f => (
              <div key={f.title} className="card">
                <div className="text-xl mb-2">{f.icon}</div>
                <div className="font-semibold text-sm text-slate-800 mb-1">{f.title}</div>
                <div className="text-xs text-slate-500 leading-relaxed">{f.desc}</div>
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-slate-400 mt-4">
            Supported formats: Chase · BofA · Wells Fargo · Capital One · Discover ·{' '}
            <span className="text-accent-500 font-medium">40+ banks</span>
          </p>
        </div>
      </main>
    </div>
  )
}
