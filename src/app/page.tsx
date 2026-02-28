'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-gradient-to-r from-accent-500 via-purple-500 to-pink-500 text-white py-16 px-4 text-center relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-20 -right-20 w-96 h-96 bg-white/10 rounded-full" />
          <div className="absolute -bottom-32 -left-10 w-80 h-80 bg-white/5 rounded-full" />
        </div>
        <div className="relative">
          <div className="text-5xl mb-4">📊</div>
          <h1 className="text-4xl md:text-5xl font-black mb-3 tracking-tight">BudgetLens</h1>
          <p className="text-xl text-white/85 font-medium max-w-lg mx-auto">
            Upload your bank statements. See exactly where your money goes — categorized, explained, and summarized.
          </p>
          <div className="flex flex-wrap justify-center gap-3 mt-6">
            {['100% Private', 'No Bank Login Needed', 'AI-Powered Categories', 'Instant Dashboard'].map(f => (
              <span key={f} className="bg-white/15 backdrop-blur px-3 py-1 rounded-full text-sm font-medium">{f}</span>
            ))}
          </div>
        </div>
      </header>

      {/* Auth form */}
      <main className="flex-1 flex items-start justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="card">
            <div className="flex rounded-xl bg-slate-100 p-1 mb-6">
              {(['login', 'register'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-all ${
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
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-4 py-3 rounded-xl">
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
                {loading ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <p className="text-xs text-slate-400 text-center mt-4">
              Your data is encrypted and never sold. You can delete your account at any time.
            </p>
          </div>

          {/* Features */}
          <div className="grid grid-cols-2 gap-3 mt-6">
            {[
              { icon: '🔒', title: 'Private by Design', desc: 'No bank OAuth. CSV only. Data never leaves your account.' },
              { icon: '🤖', title: 'AI Categorization', desc: 'Auto-categorizes 85%+ of transactions using GPT-4.' },
              { icon: '📈', title: 'Smart Insights', desc: 'Spending trends, anomalies, and monthly comparisons.' },
              { icon: '📄', title: 'Export Reports', desc: 'Download a clean PDF summary of any month.' },
            ].map(f => (
              <div key={f.title} className="card p-4">
                <div className="text-2xl mb-2">{f.icon}</div>
                <div className="font-semibold text-sm text-slate-800">{f.title}</div>
                <div className="text-xs text-slate-500 mt-1">{f.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
