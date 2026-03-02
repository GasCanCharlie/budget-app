'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Upload, CheckCircle, AlertCircle, Loader2, Building2, PlusCircle, MoreHorizontal, RefreshCw, Trash2, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { ReconciliationShield } from '@/components/ReconciliationShield'

// ─── Pipeline stages ─────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { label: 'File received',          detail: 'SHA-256 fingerprint computed' },
  { label: 'Format detection',       detail: 'Identifying bank and schema' },
  { label: 'Parsing & normalizing',  detail: 'Extracting transaction records' },
  { label: 'Deduplication',          detail: 'Cross-upload hash check' },
  { label: 'Reconciliation',         detail: 'Verifying statement totals' },
]

export default function UploadPage() {
  const router     = useRouter()
  const user       = useAuthStore(s => s.user)
  const { apiFetch, apiUpload } = useApi()
  const qc         = useQueryClient()

  const [dragOver,      setDragOver]      = useState(false)
  const [selectedFile,  setSelectedFile]  = useState<File | null>(null)
  const [accountId,     setAccountId]     = useState<string>('')
  const [newAcctName,   setNewAcctName]   = useState('')
  const [newAcctType,   setNewAcctType]   = useState('checking')
  const [showNewAcct,   setShowNewAcct]   = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [result,        setResult]        = useState<null | { success: true; data: Record<string, unknown> } | { success: false; error: string }>(null)
  const [menuOpenId,    setMenuOpenId]    = useState<string | null>(null)
  const [confirmState,  setConfirmState]  = useState<{ id: string; action: 'reset' | 'delete' } | null>(null)
  const [confirmReady,  setConfirmReady]  = useState(false)
  const [pipelineStage, setPipelineStage] = useState(-1)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!user) router.replace('/') }, [user, router])

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch('/api/accounts'),
    enabled: !!user,
  })
  const accounts = accountsData?.accounts ?? []

  // Auto-select first account; auto-open new account form if no accounts exist
  useEffect(() => {
    if (accountsData === undefined) return // still loading
    if (!accountsLoaded) {
      setAccountsLoaded(true)
      if (accounts.length === 0) {
        setShowNewAcct(true) // automatically open "new account" form for first-time users
      }
    }
    if (accounts.length > 0 && !accountId) setAccountId(accounts[0].id)
  }, [accounts, accountId, accountsData, accountsLoaded])

  // 600ms safety delay before confirm button becomes clickable
  useEffect(() => {
    if (!confirmState) { setConfirmReady(false); return }
    setConfirmReady(false)
    const t = setTimeout(() => setConfirmReady(true), 600)
    return () => clearTimeout(t)
  }, [confirmState])

  const resetMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/accounts/${id}/reset`, { method: 'POST' }),
    onSuccess: () => {
      setConfirmState(null)
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['uploads'] })
    },
  })

  const deleteAccountMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: (_: unknown, id: string) => {
      setConfirmState(null)
      if (accountId === id) setAccountId('')
      qc.invalidateQueries({ queryKey: ['accounts'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['uploads'] })
    },
  })

  const createAccountMutation = useMutation({
    mutationFn: () => apiFetch('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ name: newAcctName, accountType: newAcctType }),
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setAccountId(data.account.id)
      setShowNewAcct(false)
      setNewAcctName('')
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile || !accountId) throw new Error('Select a file and account first')
      const fd = new FormData()
      fd.append('file', selectedFile)
      fd.append('accountId', accountId)
      return apiUpload('/api/uploads', fd)
    },
    onSuccess: (data) => {
      setResult({ success: true, data })
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['uploads'] })
    },
    onError: (e: Error) => {
      setResult({ success: false, error: e.message })
    },
  })

  // Advance pipeline stages while upload is in flight
  useEffect(() => {
    if (!uploadMutation.isPending) { setPipelineStage(-1); return }
    setPipelineStage(0)
    const timings = [350, 1050, 1950, 3050, 4250]
    const timeouts = timings.map((delay, i) => setTimeout(() => setPipelineStage(i + 1), delay))
    return () => timeouts.forEach(clearTimeout)
  }, [uploadMutation.isPending])

  const handleFile = useCallback((file: File) => {
    const nameLower = file.name.toLowerCase()
    if (!nameLower.endsWith('.csv') && !nameLower.endsWith('.ofx') && !nameLower.endsWith('.qfx')) {
      setResult({ success: false, error: 'Supported formats: CSV (.csv), OFX/QFX (.ofx, .qfx)' })
      return
    }
    setSelectedFile(file)
    setResult(null)
  }, [])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  if (!user) return null

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-4 py-8 pb-24 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Upload Statement</h1>
          <p className="text-slate-500 text-sm mt-1">BudgetLens normalizes and reconciles your statement against detected format rules. 40+ bank formats supported.</p>
        </div>

        {/* Account selector */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700 flex items-center gap-2"><Building2 size={16}/> Account</h2>
            <button onClick={() => setShowNewAcct(!showNewAcct)} className="text-sm text-accent-500 font-semibold flex items-center gap-1 hover:underline">
              <PlusCircle size={14}/> New account
            </button>
          </div>

          {showNewAcct && (
            <div className="bg-slate-50 rounded-lg p-4 space-y-3">
              <input
                className="input"
                placeholder="Account name (e.g. Chase Checking)"
                value={newAcctName}
                onChange={e => setNewAcctName(e.target.value)}
              />
              <select
                className="input"
                value={newAcctType}
                onChange={e => setNewAcctType(e.target.value)}
              >
                <option value="checking">Checking</option>
                <option value="savings">Savings</option>
                <option value="credit_card">Credit Card</option>
                <option value="other">Other</option>
              </select>
              <button
                onClick={() => createAccountMutation.mutate()}
                disabled={!newAcctName || createAccountMutation.isPending}
                className="btn-primary"
              >
                {createAccountMutation.isPending ? 'Creating…' : 'Create Account'}
              </button>
            </div>
          )}

          {/* Click-outside overlay to close dropdown */}
          {menuOpenId && (
            <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
          )}

          {accounts.length > 0 ? (
            <div className="space-y-2">
              {accounts.map((acct: { id: string; name: string; institution: string; accountType: string; _count: { transactions: number } }) => {
                const isConfirming = confirmState?.id === acct.id
                const confirmAction = confirmState?.action
                return (
                  <div
                    key={acct.id}
                    className={clsx(
                      'rounded-xl border-2 transition',
                      isConfirming && confirmAction === 'delete' ? 'border-red-300' :
                      isConfirming && confirmAction === 'reset'  ? 'border-amber-300' :
                      accountId === acct.id ? 'border-accent-500' : 'border-slate-200'
                    )}
                  >
                    {/* Selectable row */}
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => { setAccountId(acct.id); setMenuOpenId(null) }}
                      onKeyDown={e => e.key === 'Enter' && setAccountId(acct.id)}
                      className={clsx(
                        'flex items-center gap-3 p-3 cursor-pointer transition rounded-t-xl',
                        isConfirming ? '' : 'rounded-b-xl',
                        accountId === acct.id ? 'bg-accent-50' : 'hover:bg-slate-50'
                      )}
                    >
                      <span className="text-xl">{acct.accountType === 'credit_card' ? '💳' : '🏦'}</span>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-slate-800">{acct.name}</p>
                        <p className="text-xs text-slate-400">{acct.accountType} · {acct._count.transactions} transactions</p>
                      </div>
                      {accountId === acct.id && <CheckCircle size={18} className="text-accent-500 flex-shrink-0" />}

                      {/* ⋯ menu */}
                      <div className="relative flex-shrink-0 z-20">
                        <button
                          onClick={e => {
                            e.stopPropagation()
                            setMenuOpenId(menuOpenId === acct.id ? null : acct.id)
                            setConfirmState(null)
                          }}
                          className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-200/60 transition"
                          aria-label="Account options"
                        >
                          <MoreHorizontal size={16} />
                        </button>
                        {menuOpenId === acct.id && (
                          <div className="absolute right-0 top-8 z-30 bg-white border border-slate-200 rounded-xl shadow-lg py-1 w-44">
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                setMenuOpenId(null)
                                setConfirmState({ id: acct.id, action: 'reset' })
                              }}
                              disabled={acct._count.transactions === 0}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                              <RefreshCw size={14} /> Reset data
                            </button>
                            <button
                              onClick={e => {
                                e.stopPropagation()
                                setMenuOpenId(null)
                                setConfirmState({ id: acct.id, action: 'delete' })
                              }}
                              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                            >
                              <Trash2 size={14} /> Delete account
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Inline confirm banner */}
                    {isConfirming && (
                      <div className={clsx(
                        'px-4 py-3 text-sm border-t rounded-b-xl',
                        confirmAction === 'delete' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                      )}>
                        <p className={clsx('font-semibold mb-2.5', confirmAction === 'delete' ? 'text-red-800' : 'text-amber-800')}>
                          {confirmAction === 'delete'
                            ? `Delete "${acct.name}"? This cannot be undone.`
                            : `Reset "${acct.name}"? All transactions and uploads will be wiped.`}
                        </p>
                        <div className="flex gap-2">
                          <button
                            onClick={() => setConfirmState(null)}
                            className="flex-1 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-600 text-xs font-medium hover:bg-slate-50 transition"
                          >
                            Cancel
                          </button>
                          <button
                            disabled={!confirmReady || resetMutation.isPending || deleteAccountMutation.isPending}
                            onClick={() => {
                              if (confirmAction === 'reset') resetMutation.mutate(acct.id)
                              else deleteAccountMutation.mutate(acct.id)
                            }}
                            className={clsx(
                              'flex-1 py-1.5 rounded-lg text-xs font-medium transition flex items-center justify-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed',
                              confirmAction === 'delete' ? 'bg-red-600 text-white hover:bg-red-700' : 'bg-amber-600 text-white hover:bg-amber-700'
                            )}
                          >
                            {(resetMutation.isPending || deleteAccountMutation.isPending) ? (
                              <><Loader2 size={12} className="animate-spin" /> Working…</>
                            ) : !confirmReady ? (
                              'Hold on…'
                            ) : confirmAction === 'delete' ? (
                              'Yes, delete'
                            ) : (
                              'Yes, reset'
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              No accounts yet — fill in the form above to create one, then upload your CSV.
            </p>
          )}
        </div>

        {/* Drop zone */}
        <div
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => fileRef.current?.click()}
          className={clsx(
            'card border-2 border-dashed cursor-pointer text-center py-12 transition-all select-none',
            dragOver ? 'border-accent-500 bg-accent-50 scale-[1.01]' : 'border-slate-200 hover:border-accent-400 hover:bg-slate-50',
            selectedFile ? 'border-green-400 bg-green-50' : ''
          )}
        >
          <input ref={fileRef} type="file" accept=".csv,.CSV,.ofx,.OFX,.qfx,.QFX,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
          {selectedFile ? (
            <div className="space-y-2">
              <div className="text-4xl">📄</div>
              <p className="font-bold text-slate-800">{selectedFile.name}</p>
              <p className="text-sm text-slate-500">{(selectedFile.size / 1024).toFixed(1)} KB · Click to change</p>
            </div>
          ) : (
            <div className="space-y-3">
              <Upload size={40} className="mx-auto text-slate-300" />
              <div>
                <p className="font-bold text-slate-700">Drop your CSV here</p>
                <p className="text-sm text-slate-400 mt-1">or click to browse files</p>
              </div>
              <p className="text-xs text-slate-400">
                Chase · BofA · Wells Fargo · Capital One · Discover · <span className="text-accent-500 font-medium">40+ formats</span>
              </p>
            </div>
          )}
        </div>

        {/* Bank category info */}
        <p className="text-sm text-slate-500 text-center">
          If your bank provides categories, BudgetLens imports them automatically.
        </p>

        {/* Privacy commitment */}
        <p className="text-xs text-center text-slate-400">
          Parsed in-session · SHA-256 fingerprinted · Raw file not retained
        </p>

        {/* Upload button — always visible once a file is chosen */}
        {selectedFile && (
          <>
            {!accountId && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                Please select or create an account above before uploading.
              </p>
            )}
            <button
              onClick={() => uploadMutation.mutate()}
              disabled={!accountId || uploadMutation.isPending}
              className="btn-primary w-full justify-center py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploadMutation.isPending ? (
                <><Loader2 size={18} className="animate-spin" /> Processing statement…</>
              ) : (
                <><Upload size={18} /> Upload Statement</>
              )}
            </button>
            {!uploadMutation.isPending && (
              <p className="text-xs text-center text-slate-400">Estimated processing time: 8–15 seconds</p>
            )}
          </>
        )}

        {/* Pipeline stages — visible while upload is in flight */}
        {uploadMutation.isPending && pipelineStage >= 0 && (
          <div className="rounded-lg border border-navy-700 bg-navy-900 px-4 py-4 font-mono text-xs space-y-2.5">
            {PIPELINE_STAGES.map((stage, i) => {
              const done   = pipelineStage > i
              const active = pipelineStage === i
              return (
                <div key={i} className={clsx('flex items-start gap-2.5', done || active ? 'opacity-100' : 'opacity-25')}>
                  {done ? (
                    <CheckCircle size={12} className="text-green-400 mt-0.5 flex-shrink-0" />
                  ) : active ? (
                    <Loader2 size={12} className="animate-spin text-accent-300 mt-0.5 flex-shrink-0" />
                  ) : (
                    <div className="w-3 h-3 border border-white/20 rounded-full mt-0.5 flex-shrink-0" />
                  )}
                  <span className={done ? 'text-white/40' : active ? 'text-white' : 'text-white/25'}>
                    {stage.label}
                    {(done || active) && (
                      <span className={clsx('ml-2', done ? 'text-white/25' : 'text-white/50')}>
                        · {stage.detail}
                      </span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Result */}
        {result && (
          <div className={clsx(
            'card border-2',
            result.success ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
          )}>
            {result.success ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <CheckCircle size={20} className="text-green-600" />
                  <h3 className="font-bold text-green-800">Upload complete</h3>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  {([
                    ['Transactions imported', String((result.data as Record<string, unknown>).accepted)],
                    ['Format detected',       String((result.data as Record<string, unknown>).formatDetected)],
                    ...(Number((result.data as Record<string, unknown>).possibleDuplicates) > 0
                      ? [['Possible duplicates', String((result.data as Record<string, unknown>).possibleDuplicates)] as [string, string]]
                      : []),
                  ] as [string, string][]).map(([label, val]) => (
                    <div key={label} className="bg-white/70 rounded-lg p-3">
                      <p className="text-green-600 font-semibold text-xs uppercase">{label}</p>
                      <p className="font-bold text-green-900 mt-0.5">{val}</p>
                    </div>
                  ))}
                  {(() => {
                    const reconStatus = String((result.data as Record<string, unknown>).reconciliationStatus ?? 'UNVERIFIABLE')
                    return (
                      <div className="bg-white/70 rounded-lg p-3 col-span-2 flex items-center gap-2">
                        <ReconciliationShield status={reconStatus} size="md" />
                        {reconStatus === 'PASS' && <p className="text-xs text-green-700">All totals verified against bank statement</p>}
                        {reconStatus === 'PASS_WITH_WARNINGS' && <p className="text-xs text-amber-700">Minor issues found — see statement detail</p>}
                        {reconStatus === 'FAIL' && <p className="text-xs text-red-700">Totals don&apos;t match — review the statement detail</p>}
                        {reconStatus === 'UNVERIFIABLE' && <p className="text-xs text-slate-500">Bank format doesn&apos;t include statement totals</p>}
                      </div>
                    )
                  })()}
                </div>
                {/* File integrity footer */}
                {Boolean((result.data as Record<string, unknown>).fileHashTruncated) && (
                  <div className="flex items-center gap-2 pt-1 border-t border-green-200/60">
                    <span className="text-xs text-green-600/70 font-mono">SHA-256</span>
                    <code className="text-xs font-mono text-green-700/80 flex-1 truncate">
                      {String((result.data as Record<string, unknown>).fileHashTruncated)}
                    </code>
                    <span className="text-xs text-green-600/50 font-mono flex-shrink-0">
                      {String((result.data as Record<string, unknown>).parserVersion ?? '')}
                    </span>
                  </div>
                )}
                {/* Import report */}
                {(() => {
                  const d = result.data as Record<string, unknown>
                  const accepted = Number(d.accepted ?? 0)
                  const rejected = Number(d.rejected ?? 0)
                  const total = accepted + rejected
                  const unresolved = Number(d.totalUnresolved ?? 0)
                  const bankDetected = Boolean(d.bankDetected)
                  const bankKey = d.bankKey ? String(d.bankKey) : null
                  const dateOrderUsed = d.dateOrderUsed ? String(d.dateOrderUsed) : null
                  const dateOrderSource = d.dateOrderSource ? String(d.dateOrderSource) : null
                  return (
                    <div className="bg-white/60 border border-green-200/60 rounded-lg p-3 space-y-2">
                      <p className="text-xs font-semibold text-green-700 uppercase tracking-wide">Import Report</p>
                      <div className="space-y-1 text-xs text-slate-700">
                        <div className="flex items-center justify-between">
                          <span className="text-slate-500">Rows committed / total</span>
                          <span className="font-semibold">{accepted} / {total > 0 ? total : accepted}</span>
                        </div>
                        {bankDetected && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Bank category preserved</span>
                            <span className="font-semibold text-blue-700">Yes{bankKey ? ` (${bankKey})` : ''}</span>
                          </div>
                        )}
                        {!bankDetected && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Bank category</span>
                            <span className="font-semibold text-slate-400">Not detected</span>
                          </div>
                        )}
                        {dateOrderUsed && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Date format detected</span>
                            <span className="font-semibold">
                              {dateOrderUsed === 'MDY' ? 'MM/DD/YYYY' : dateOrderUsed === 'DMY' ? 'DD/MM/YYYY' : dateOrderUsed === 'YMD' ? 'YYYY-MM-DD' : dateOrderUsed}
                              {dateOrderSource ? ` · ${dateOrderSource}` : ''}
                            </span>
                          </div>
                        )}
                        {unresolved > 0 && (
                          <div className="flex items-center justify-between">
                            <span className="text-slate-500">Issues to review</span>
                            <span className="font-semibold text-amber-700">{unresolved} unresolved</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })()}
                {Boolean((result.data as Record<string, unknown>).dateAmbiguous) && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
                    ⚠️ Date format was ambiguous (MM/DD vs DD/MM). Please verify your transaction dates.
                  </div>
                )}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => router.push(`/upload/${String(result.data.uploadId)}`)}
                    className="btn-secondary w-full justify-center text-sm"
                  >
                    View reconciliation report →
                  </button>
                  <button onClick={() => router.push('/dashboard')} className="btn-primary w-full justify-center">
                    View Dashboard →
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-3">
                <AlertCircle size={20} className="text-red-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-red-800">Upload failed</h3>
                  <p className="text-red-700 text-sm mt-1">{result.error}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Sample data */}
        <SampleDataLoader onLoaded={() => router.push('/dashboard')} />

        {/* Previous uploads */}
        <UploadHistory />
      </main>
    </AppShell>
  )
}

function SampleDataLoader({ onLoaded }: { onLoaded: () => void }) {
  const { apiFetch } = useApi()
  const [loading, setLoading] = useState(false)
  const [done,    setDone]    = useState(false)
  const qc = useQueryClient()

  async function load() {
    setLoading(true)
    try {
      await apiFetch('/api/sample-data', { method: 'POST' })
      qc.invalidateQueries({ queryKey: ['summary'] })
      setDone(true)
      setTimeout(onLoaded, 1000)
    } catch(e) {
      alert((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card border border-dashed border-slate-200 bg-slate-50/50 text-center py-6">
      <p className="text-sm text-slate-500 mb-3">No CSV? Try with realistic demo data first.</p>
      <button onClick={load} disabled={loading || done} className="btn-secondary">
        {done ? '✅ Sample data loaded!' : loading ? <><Loader2 size={14} className="animate-spin" /> Loading sample data…</> : '🧪 Load Sample Data'}
      </button>
    </div>
  )
}


interface UploadRow {
  id: string
  filename: string
  account: { name: string }
  rowCountAccepted: number
  createdAt: string
  status: string
  reconciliationStatus: string
  totalRowsUnresolved: number
}

function UploadHistory() {
  const { apiFetch } = useApi()
  const router = useRouter()
  const qc = useQueryClient()
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const { data } = useQuery({ queryKey: ['uploads'], queryFn: () => apiFetch('/api/uploads') })
  const uploads: UploadRow[] = data?.uploads ?? []

  const deleteUploadMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/uploads/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setConfirmDeleteId(null)
      qc.invalidateQueries({ queryKey: ['uploads'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
    },
  })

  if (uploads.length === 0) return null

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
        <h3 className="font-semibold text-slate-800 text-sm">Statement History</h3>
        <span className="text-xs text-slate-400">{uploads.length} statement{uploads.length !== 1 ? 's' : ''}</span>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Statement</th>
            <th>Account</th>
            <th>Date</th>
            <th className="text-right">Rows</th>
            <th>Reconciliation</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {uploads.slice(0, 8).map((u) =>
            confirmDeleteId === u.id ? (
              <tr key={u.id} className="bg-red-50">
                <td colSpan={7}>
                  <div className="flex items-center gap-3 py-0.5">
                    <span className="text-sm text-red-800 font-medium flex-1 truncate">Delete &quot;{u.filename}&quot;?</span>
                    <button
                      onClick={() => setConfirmDeleteId(null)}
                      className="text-xs px-3 py-1 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 transition flex-shrink-0"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => deleteUploadMutation.mutate(u.id)}
                      disabled={deleteUploadMutation.isPending}
                      className="text-xs px-3 py-1 rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-1 flex-shrink-0 transition"
                    >
                      {deleteUploadMutation.isPending
                        ? <><Loader2 size={10} className="animate-spin" /> Deleting…</>
                        : 'Yes, delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={u.id} onClick={() => router.push(`/upload/${u.id}`)}>
                <td>
                  <p className="font-medium text-slate-800 max-w-[180px] truncate">{u.filename}</p>
                  {u.totalRowsUnresolved > 0 && (
                    <p className="text-xs text-amber-600 mt-0.5">{u.totalRowsUnresolved} unresolved</p>
                  )}
                </td>
                <td className="text-slate-500 whitespace-nowrap">{u.account?.name}</td>
                <td className="num text-slate-500 whitespace-nowrap">
                  {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                </td>
                <td className="num text-right text-slate-700">{u.rowCountAccepted}</td>
                <td>
                  {u.reconciliationStatus && u.status === 'complete' && (
                    <ReconciliationShield status={u.reconciliationStatus} size="sm" />
                  )}
                </td>
                <td>
                  <span className={clsx('badge text-xs', u.status === 'complete' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700')}>
                    {u.status}
                  </span>
                </td>
                <td>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(u.id) }}
                      className="p-1 rounded text-slate-300 hover:text-red-500 hover:bg-red-50 transition"
                      title="Delete statement"
                    >
                      <Trash2 size={13} />
                    </button>
                    <ChevronRight size={14} className="text-slate-300" />
                  </div>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  )
}
