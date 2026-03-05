'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, AlertCircle, Loader2, PlusCircle, MoreHorizontal, RefreshCw, Trash2, ChevronRight, Landmark, CreditCard, FileCheck2, UploadCloud, Workflow, ShieldCheck, FlaskConical, ArrowRight } from 'lucide-react'
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

// ─── Shared card styles ───────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-soft)',
  overflow: 'hidden',
}

const cardHdr: React.CSSProperties = {
  padding: '14px 18px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  borderBottom: '1px solid var(--border)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.03), transparent)',
}

const hdrTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '-0.01em',
  color: 'var(--text)',
  margin: 0,
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UploadPage() {
  const router     = useRouter()
  const user       = useAuthStore(s => s.user)
  const { apiFetch, apiUpload } = useApi()
  const qc         = useQueryClient()

  const [dragOver,       setDragOver]       = useState(false)
  const [selectedFile,   setSelectedFile]   = useState<File | null>(null)
  const [accountId,      setAccountId]      = useState<string>('')
  const [newAcctName,    setNewAcctName]     = useState('')
  const [newAcctType,    setNewAcctType]     = useState('checking')
  const [showNewAcct,    setShowNewAcct]     = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [result,         setResult]         = useState<null | { success: true; data: Record<string, unknown> } | { success: false; error: string }>(null)
  const [menuOpenId,     setMenuOpenId]     = useState<string | null>(null)
  const [confirmState,   setConfirmState]   = useState<{ id: string; action: 'reset' | 'delete' } | null>(null)
  const [confirmReady,   setConfirmReady]   = useState(false)
  const [pipelineStage,  setPipelineStage]  = useState(-1)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (!user) router.replace('/login') }, [user, router])

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => apiFetch('/api/accounts'),
    enabled: !!user,
  })
  const accounts = accountsData?.accounts ?? []

  useEffect(() => {
    if (accountsData === undefined) return
    if (!accountsLoaded) {
      setAccountsLoaded(true)
      if (accounts.length === 0) setShowNewAcct(true)
    }
    if (accounts.length > 0 && !accountId) setAccountId(accounts[0].id)
  }, [accounts, accountId, accountsData, accountsLoaded])

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
      // Clear persisted sort/filter state so the categorize page starts fresh
      localStorage.removeItem('budgetlens:cat-sort-key')
      localStorage.removeItem('budgetlens:cat-sort-dir')
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
      // Clear persisted sort/filter state so the categorize page starts fresh
      localStorage.removeItem('budgetlens:cat-sort-key')
      localStorage.removeItem('budgetlens:cat-sort-dir')
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

  useEffect(() => {
    if (!uploadMutation.isPending) { setPipelineStage(-1); return }
    setPipelineStage(0)
    const timings = [350, 1050, 1950, 3050, 4250]
    const timeouts = timings.map((delay, i) => setTimeout(() => setPipelineStage(i + 1), delay))
    return () => timeouts.forEach(clearTimeout)
  }, [uploadMutation.isPending])

  const handleFile = useCallback((file: File) => {
    const nameLower = file.name.toLowerCase()
    if (!nameLower.endsWith('.csv') && !nameLower.endsWith('.ofx') && !nameLower.endsWith('.qfx') && !nameLower.endsWith('.qbo')) {
      setResult({ success: false, error: 'Supported formats: CSV (.csv), OFX (.ofx), QFX (.qfx), QBO (.qbo)' })
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

  const selectedAccount = accounts.find((a: { id: string }) => a.id === accountId)

  return (
    <AppShell>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '28px 18px 48px' }}>

        {/* ── Page header ────────────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.15, color: 'var(--text)', margin: 0 }}>
              Upload statement
            </h1>
            <p style={{ margin: '6px 0 0', color: 'var(--muted)', maxWidth: '64ch', lineHeight: 1.5, fontSize: 13 }}>
              Import transactions from CSV, OFX, QFX, or QBO. After import, you&apos;ll categorize with drag + multi-select.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card2)', cursor: 'pointer', fontWeight: 500, fontSize: 13, color: 'var(--muted)', transition: 'background .15s' }}
            >
              Format help
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{ padding: '8px 16px', borderRadius: 999, border: '1px solid rgba(124,137,255,0.35)', background: 'rgba(124,137,255,0.18)', cursor: 'pointer', fontWeight: 600, fontSize: 13, color: 'var(--accent)', transition: 'background .15s' }}
            >
              Browse files
            </button>
          </div>
        </div>

        {/* ── Two-column grid ───────────────────────────────────────────────── */}
        <div
          style={{ display: 'grid', gridTemplateColumns: '1.25fr 0.85fr', gap: 16, alignItems: 'start' }}
          className="max-[800px]:!grid-cols-1"
        >

          {/* ── LEFT: Account + upload card ──────────────────────────────────── */}
          <section style={{ display: 'grid', gap: 16 }}>
          <div style={card}>
            <div style={cardHdr}>
              <p style={hdrTitle}>Account + upload</p>
              <button
                onClick={() => setShowNewAcct(!showNewAcct)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card2)', cursor: 'pointer', fontWeight: 500, fontSize: 12, color: 'var(--muted)', transition: 'background .15s' }}
              >
                <PlusCircle size={12} /> New account
              </button>
            </div>

            <div style={{ padding: 16 }}>

              {/* New account form */}
              {showNewAcct && (
                <div style={{ marginBottom: 12, padding: 14, borderRadius: 18, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.04)' }} className="space-y-3">
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
                    style={{ background: 'rgba(255,255,255,.06)' }}
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

              {/* Click-outside overlay */}
              {menuOpenId && (
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpenId(null)} />
              )}

              {/* Account list */}
              {accounts.length > 0 ? (
                <div style={{ marginBottom: 12 }}>
                  <div className="space-y-2">
                    {accounts.map((acct: { id: string; name: string; institution: string; accountType: string; _count: { transactions: number } }) => {
                      const isSelected   = accountId === acct.id
                      const isConfirming = confirmState?.id === acct.id
                      const confirmAction = confirmState?.action
                      return (
                        <div key={acct.id} style={{ background: 'var(--card2)', border: `1px solid ${isConfirming && confirmAction === 'delete' ? 'rgba(248,113,113,0.40)' : isConfirming && confirmAction === 'reset' ? 'rgba(251,191,36,0.40)' : isSelected ? 'rgba(124,137,255,0.35)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', transition: 'border-color .15s, background .15s' }}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => { setAccountId(acct.id); setMenuOpenId(null) }}
                            onKeyDown={e => e.key === 'Enter' && setAccountId(acct.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, cursor: 'pointer' }}
                          >
                            <div style={{ width: 38, height: 38, borderRadius: 12, background: 'rgba(124,137,255,0.15)', border: '1px solid rgba(124,137,255,0.25)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
                              {acct.accountType === 'credit_card'
                                ? <CreditCard size={16} style={{ color: 'var(--accent)' }} />
                                : <Landmark size={16} style={{ color: 'var(--accent)' }} />}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <p style={{ margin: 0, fontWeight: 700, fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acct.name}</p>
                              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{acct.accountType} · {acct._count.transactions} transactions</p>
                            </div>
                            {isSelected && (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', color: 'var(--success)', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>
                                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                                verified
                              </span>
                            )}

                            {/* ⋯ menu */}
                            <div className="relative flex-shrink-0 z-20">
                              <button
                                onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === acct.id ? null : acct.id); setConfirmState(null) }}
                                style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card2)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'background .15s' }}
                                aria-label="Account options"
                              >
                                <MoreHorizontal size={14} style={{ color: 'var(--muted)' }} />
                              </button>
                              {menuOpenId === acct.id && (
                                <div style={{ position: 'absolute', right: 0, top: 38, zIndex: 30, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow)', padding: '4px 0', width: 168 }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); setMenuOpenId(null); setConfirmState({ id: acct.id, action: 'reset' }) }}
                                    disabled={acct._count.transactions === 0}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--text)', textAlign: 'left', fontWeight: 500 }}
                                    className="hover:bg-white/[.06] disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <RefreshCw size={13} /> Reset data
                                  </button>
                                  <button
                                    onClick={e => { e.stopPropagation(); setMenuOpenId(null); setConfirmState({ id: acct.id, action: 'delete' }) }}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--danger)', textAlign: 'left', fontWeight: 500 }}
                                    className="hover:bg-white/[.06]"
                                  >
                                    <Trash2 size={13} /> Delete account
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Inline confirm banner */}
                          {isConfirming && (
                            <div style={{ padding: '12px 14px', borderTop: `1px solid ${confirmAction === 'delete' ? 'rgba(248,113,113,0.22)' : 'rgba(251,191,36,0.22)'}`, background: confirmAction === 'delete' ? 'rgba(248,113,113,0.08)' : 'rgba(251,191,36,0.08)' }}>
                              <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 600, color: confirmAction === 'delete' ? 'var(--danger)' : 'var(--warn)' }}>
                                {confirmAction === 'delete'
                                  ? `Delete "${acct.name}"? This cannot be undone.`
                                  : `Reset "${acct.name}"? All transactions and uploads will be wiped.`}
                              </p>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => setConfirmState(null)} style={{ flex: 1, padding: '6px 0', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--text)', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>
                                  Cancel
                                </button>
                                <button
                                  disabled={!confirmReady || resetMutation.isPending || deleteAccountMutation.isPending}
                                  onClick={() => { if (confirmAction === 'reset') resetMutation.mutate(acct.id); else deleteAccountMutation.mutate(acct.id) }}
                                  style={{ flex: 1, padding: '6px 0', borderRadius: 10, border: 'none', background: confirmAction === 'delete' ? '#c0293f' : '#b07800', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: (!confirmReady || resetMutation.isPending || deleteAccountMutation.isPending) ? .5 : 1 }}
                                >
                                  {(resetMutation.isPending || deleteAccountMutation.isPending) ? (
                                    <><Loader2 size={12} className="animate-spin" /> Working…</>
                                  ) : !confirmReady ? 'Hold on…' : confirmAction === 'delete' ? 'Yes, delete' : 'Yes, reset'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)', fontSize: 13, color: 'var(--warn)', fontWeight: 500 }}>
                  No accounts yet — fill in the form above to create one.
                </div>
              )}

              {/* ── Dropzone ──────────────────────────────────────────────────── */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileRef.current?.click()}
                style={{
                  marginTop: 4,
                  borderRadius: 'var(--radius-lg)',
                  border: `1px dashed ${dragOver ? 'rgba(34,197,94,0.55)' : selectedFile ? 'rgba(34,197,94,0.45)' : 'rgba(124,137,255,0.5)'}`,
                  background: dragOver
                    ? 'rgba(34,197,94,0.06)'
                    : selectedFile
                    ? 'rgba(34,197,94,0.04)'
                    : 'radial-gradient(ellipse at 30% 20%, rgba(124,137,255,0.10), transparent 60%), radial-gradient(ellipse at 80% 80%, rgba(139,111,255,0.08), transparent 60%), var(--card2)',
                  minHeight: 200,
                  padding: 24,
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'border-color .15s, background .15s',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <input ref={fileRef} type="file" accept=".csv,.CSV,.ofx,.OFX,.qfx,.QFX,.qbo,.QBO,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

                {selectedFile ? (
                  <div>
                    <div style={{ width: 52, height: 52, margin: '0 auto 10px', borderRadius: 16, border: '1px solid rgba(34,197,94,0.35)', background: 'rgba(34,197,94,0.10)', display: 'grid', placeItems: 'center' }}>
                      <FileCheck2 size={22} style={{ color: 'var(--success)' }} />
                    </div>
                    <p style={{ margin: 0, fontWeight: 700, fontSize: 16, color: 'var(--text)', letterSpacing: '-0.02em' }}>{selectedFile.name}</p>
                    <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 13 }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB · Click to change
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{ width: 52, height: 52, margin: '0 auto 10px', borderRadius: 16, border: '1px solid var(--border)', background: 'rgba(255,255,255,0.06)', display: 'grid', placeItems: 'center' }}>
                      <UploadCloud size={22} style={{ color: 'var(--muted)' }} />
                    </div>
                    <p style={{ display: 'block', margin: '6px 0 0', fontWeight: 700, fontSize: 16, color: 'var(--text)', letterSpacing: '-0.02em' }}>Drop your statement here</p>
                    <p style={{ margin: '6px 0 0', color: 'var(--muted)', fontSize: 13, lineHeight: 1.5 }}>
                      or click to browse
                    </p>
                    <div style={{ marginTop: 12, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                      {['CSV', 'OFX', 'QFX', 'QBO'].map(fmt => (
                        <span key={fmt} style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--subtle)', fontSize: 11, fontWeight: 500 }}>
                          {fmt}
                        </span>
                      ))}
                    </div>
                    <p style={{ marginTop: 12, color: 'var(--subtle)', fontSize: 12, lineHeight: 1.5 }}>
                      <strong style={{ color: 'var(--muted)' }}>Accuracy:</strong>{' '}
                      we import exactly what&apos;s in the file. Bank categories (if present) are stored as reference metadata.<br />
                      <span>Parsed in-session · SHA-256 fingerprinted · Raw file not retained</span>
                    </p>
                  </div>
                )}
              </div>

              {/* Upload button */}
              {selectedFile && (
                <div style={{ marginTop: 14 }}>
                  {!accountId && (
                    <div style={{ marginBottom: 10, padding: '10px 14px', borderRadius: 'var(--radius-sm)', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.22)', fontSize: 13, color: 'var(--warn)', fontWeight: 500 }}>
                      Please select or create an account above before uploading.
                    </div>
                  )}
                  <button
                    onClick={() => uploadMutation.mutate()}
                    disabled={!accountId || uploadMutation.isPending}
                    style={{ width: '100%', padding: '13px 24px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(124,137,255,0.35)', background: 'rgba(124,137,255,0.20)', color: 'var(--accent)', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: (!accountId || uploadMutation.isPending) ? .5 : 1, transition: 'opacity .15s' }}
                  >
                    {uploadMutation.isPending
                      ? <><Loader2 size={18} className="animate-spin" /> Processing statement…</>
                      : <><UploadCloud size={16} /> Import statement <ArrowRight size={14} /></>}
                  </button>
                </div>
              )}

              {/* Pipeline stages */}
              {uploadMutation.isPending && pipelineStage >= 0 && (
                <div style={{ marginTop: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card2)', padding: '14px 16px', fontFamily: 'monospace', fontSize: 12 }} className="space-y-2.5">
                  {PIPELINE_STAGES.map((stage, i) => {
                    const done   = pipelineStage > i
                    const active = pipelineStage === i
                    return (
                      <div key={i} className={clsx('flex items-start gap-2.5', done || active ? 'opacity-100' : 'opacity-25')}>
                        {done ? (
                          <CheckCircle size={12} style={{ color: 'var(--success)', marginTop: 2, flexShrink: 0 }} />
                        ) : active ? (
                          <Loader2 size={12} className="animate-spin" style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1px solid var(--border)', marginTop: 2, flexShrink: 0 }} />
                        )}
                        <span style={{ color: done ? 'var(--subtle)' : active ? 'var(--text)' : 'var(--subtle)' }}>
                          {stage.label}
                          {(done || active) && (
                            <span style={{ marginLeft: 8, color: done ? 'var(--subtle)' : 'var(--muted)' }}>
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
                <div style={{ marginTop: 14, borderRadius: 'var(--radius-md)', border: `1px solid ${result.success ? 'rgba(34,197,94,0.25)' : 'rgba(248,113,113,0.25)'}`, background: result.success ? 'rgba(34,197,94,0.06)' : 'rgba(248,113,113,0.06)', padding: 16 }}>
                  {result.success ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle size={18} style={{ color: 'var(--success)' }} />
                        <h3 style={{ margin: 0, fontWeight: 700, fontSize: 15, color: 'var(--success)' }}>Upload complete</h3>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                        {([
                          ['Transactions imported', String((result.data as Record<string, unknown>).accepted)],
                          ['Format detected',       String((result.data as Record<string, unknown>).formatDetected)],
                          ...(Number((result.data as Record<string, unknown>).possibleDuplicates) > 0
                            ? [['Possible duplicates', String((result.data as Record<string, unknown>).possibleDuplicates)] as [string, string]]
                            : []),
                        ] as [string, string][]).map(([label, val]) => (
                          <div key={label} style={{ borderRadius: 'var(--radius-sm)', border: '1px solid rgba(34,197,94,0.20)', background: 'var(--card2)', padding: '10px 12px' }}>
                            <p style={{ margin: 0, color: 'var(--success)', fontWeight: 600, fontSize: 11, textTransform: 'uppercase' }}>{label}</p>
                            <p style={{ margin: '4px 0 0', fontWeight: 700, color: 'var(--text)', fontSize: 15 }}>{val}</p>
                          </div>
                        ))}
                        {(() => {
                          const reconStatus = String((result.data as Record<string, unknown>).reconciliationStatus ?? 'UNVERIFIABLE')
                          return (
                            <div style={{ borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card2)', padding: '10px 12px', gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
                              <ReconciliationShield status={reconStatus} size="md" />
                              {reconStatus === 'PASS'              && <p style={{ margin: 0, fontSize: 12, color: 'var(--success)' }}>All totals verified against bank statement</p>}
                              {reconStatus === 'PASS_WITH_WARNINGS'&& <p style={{ margin: 0, fontSize: 12, color: 'var(--warn)' }}>Minor issues found — see statement detail</p>}
                              {reconStatus === 'FAIL'              && <p style={{ margin: 0, fontSize: 12, color: 'var(--danger)' }}>Totals don&apos;t match — review the statement detail</p>}
                              {reconStatus === 'UNVERIFIABLE'      && <p style={{ margin: 0, fontSize: 12, color: 'var(--muted)' }}>Bank format doesn&apos;t include statement totals</p>}
                            </div>
                          )
                        })()}
                      </div>
                      {Boolean((result.data as Record<string, unknown>).fileHashTruncated) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(34,197,94,0.15)' }}>
                          <span style={{ fontSize: 11, color: 'var(--success)', fontFamily: 'monospace', opacity: 0.7 }}>SHA-256</span>
                          <code style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--success)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {String((result.data as Record<string, unknown>).fileHashTruncated)}
                          </code>
                        </div>
                      )}
                      {Boolean((result.data as Record<string, unknown>).formatMismatch) && (
                        <div style={{ borderRadius: 'var(--radius-sm)', border: '1px solid rgba(251,191,36,0.22)', background: 'rgba(251,191,36,0.08)', padding: '10px 12px', fontSize: 13, color: 'var(--warn)' }}>
                          File extension and content type don&apos;t match — processed as{' '}
                          <strong>{String((result.data as Record<string, unknown>).formatDetected ?? 'detected format')}</strong>.
                        </div>
                      )}
                      {Boolean((result.data as Record<string, unknown>).dateAmbiguous) && (
                        <div style={{ borderRadius: 'var(--radius-sm)', border: '1px solid rgba(251,191,36,0.22)', background: 'rgba(251,191,36,0.08)', padding: '10px 12px', fontSize: 13, color: 'var(--warn)' }}>
                          Date format was ambiguous (MM/DD vs DD/MM). Please verify your transaction dates.
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {Boolean((result.data as Record<string, unknown>).stagingUploadId) && (
                          <button
                            onClick={() => router.push(`/staging/${String((result.data as Record<string, unknown>).stagingUploadId)}`)}
                            style={{ width: '100%', padding: '12px 20px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(124,137,255,0.35)', background: 'rgba(124,137,255,0.18)', color: 'var(--accent)', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                          >
                            Review &amp; Add to Budget →
                          </button>
                        )}
                        <button
                          onClick={() => router.push(`/upload/${String(result.data.uploadId)}`)}
                          style={{ width: '100%', padding: '12px 20px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--text)', fontWeight: 500, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        >
                          View reconciliation report →
                        </button>
                        <button
                          onClick={() => router.push('/dashboard')}
                          style={{ width: '100%', padding: '12px 20px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card2)', color: 'var(--muted)', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}
                        >
                          View Dashboard →
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--danger)', fontSize: 14 }}>Upload failed</h3>
                        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>{result.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sample data */}
              <div style={{ marginTop: 14, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', background: 'var(--card2)', padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, color: 'var(--muted)', fontSize: 13, lineHeight: 1.45, maxWidth: '52ch' }}>
                  <strong style={{ color: 'var(--text)' }}>No file handy?</strong> Load realistic sample data to try the full organize + categorize flow.
                </p>
                <SampleDataLoader onLoaded={() => router.push('/dashboard')} />
              </div>
            </div>
          </div>

          {/* ── LEFT: Statement history card ─────────────────────────────────── */}
          <UploadHistoryCard />
          </section>

          {/* ── RIGHT: Steps + Privacy cards ─────────────────────────────────── */}
          <aside style={{ display: 'grid', gap: 16, alignContent: 'start' }}>

            {/* 3-step flow card */}
            <div style={card}>
              <div style={cardHdr}>
                <p style={hdrTitle}>The 3-step flow</p>
                <span style={{ padding: '4px 10px', borderRadius: 999, background: 'var(--accent-muted)', color: 'var(--accent)', fontSize: 11, fontWeight: 600 }}>
                  Simple + fast
                </span>
              </div>
              <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {[
                  { n: 1, title: 'Upload',     desc: 'Import transactions exactly as provided by the statement file.',                current: true },
                  { n: 2, title: 'Categorize', desc: 'Drag, multi-select, and use search/sort to assign categories quickly.' },
                  { n: 3, title: 'Insights',   desc: 'Once categorized, unlock breakdowns, trends, and unusual transaction flags.' },
                ].map(({ n, title, desc, current }) => (
                  <div key={n} style={{ background: 'var(--card2)', border: `1px solid ${current ? 'rgba(124,137,255,0.45)' : 'var(--border)'}`, borderRadius: 'var(--radius-md)', padding: 12, boxShadow: current ? '0 0 0 3px rgba(124,137,255,0.10)' : 'none' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 34, height: 34, borderRadius: 12, display: 'grid', placeItems: 'center', fontWeight: 700, background: 'rgba(124,137,255,0.14)', flexShrink: 0, color: 'var(--accent)', fontSize: 14 }}>
                        {n}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{title}</p>
                        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 12, lineHeight: 1.5 }}>{desc}</p>
                      </div>
                    </div>
                  </div>
                ))}
                <p style={{ marginTop: 4, color: 'var(--subtle)', fontSize: 12, lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--muted)' }}>Tip:</strong> After categorizing, you can save vendor → category rules so the next upload auto-organizes.
                </p>
              </div>
            </div>

            {/* Privacy & accuracy card */}
            <div style={card}>
              <div style={cardHdr}>
                <p style={hdrTitle}>Privacy &amp; accuracy</p>
                <span style={{ padding: '4px 10px', borderRadius: 999, background: 'rgba(34,197,94,0.12)', color: 'var(--success)', fontSize: 11, fontWeight: 600 }}>
                  Local-first
                </span>
              </div>
              <div style={{ padding: '14px 16px' }}>
                <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {[
                    'No bank logins required — upload your own export',
                    'Files processed locally or in-session only',
                    'SHA-256 fingerprint for audit trails',
                    'We never invent or modify transactions',
                    'Raw file is not retained after parsing',
                  ].map(text => (
                    <li key={text} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                      <span style={{ width: 16, height: 16, borderRadius: 6, background: 'rgba(124,137,255,0.14)', display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>
                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
                      </span>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

          </aside>
        </div>
      </div>
    </AppShell>
  )
}

// ─── Sample data loader ───────────────────────────────────────────────────────

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
    <button
      onClick={load}
      disabled={loading || done}
      style={{ padding: '7px 14px', borderRadius: 999, border: '1px solid var(--border)', background: 'var(--card2)', cursor: 'pointer', fontWeight: 500, fontSize: 13, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', opacity: (loading || done) ? .6 : 1 }}
    >
      {done ? <><CheckCircle size={13} style={{ color: 'var(--success)' }} /> Loaded!</> : loading ? <><Loader2 size={13} className="animate-spin" /> Loading…</> : <><FlaskConical size={13} /> Load sample data</>}
    </button>
  )
}

// ─── Upload history ───────────────────────────────────────────────────────────

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

  const { data, isFetching } = useQuery({
    queryKey: ['uploads'],
    queryFn: () => apiFetch('/api/uploads'),
    staleTime: 0,
    refetchOnMount: 'always',
  })
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
    <div style={{ marginTop: 16, borderRadius: 24, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.03)', overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottom: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong style={{ fontSize: 13, fontWeight: 950, color: '#eaf0ff' }}>Statement history</strong>
          {isFetching && <Loader2 size={11} className="animate-spin" style={{ color: 'rgba(255,255,255,.4)' }} />}
        </div>
        <span style={{ color: 'rgba(255,255,255,.55)', fontWeight: 800, fontSize: 12 }}>{uploads.length} statement{uploads.length !== 1 ? 's' : ''}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Statement</th>
            <th>Account</th>
            <th>Date</th>
            <th style={{ textAlign: 'right' }}>Rows</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {uploads.slice(0, 8).map((u) =>
            confirmDeleteId === u.id ? (
              <tr key={u.id} style={{ background: 'rgba(255,92,122,.08)' }}>
                <td colSpan={6}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 0' }}>
                    <span style={{ fontSize: 13, color: '#ff8397', fontWeight: 700, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Delete &quot;{u.filename}&quot;?</span>
                    <button onClick={() => setConfirmDeleteId(null)} style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.06)', color: '#c8d4f5', cursor: 'pointer', flexShrink: 0 }}>Cancel</button>
                    <button
                      onClick={() => deleteUploadMutation.mutate(u.id)}
                      disabled={deleteUploadMutation.isPending}
                      style={{ fontSize: 12, padding: '4px 10px', borderRadius: 8, background: '#c0293f', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0, opacity: deleteUploadMutation.isPending ? .6 : 1 }}
                    >
                      {deleteUploadMutation.isPending ? <><Loader2 size={10} className="animate-spin" /> Deleting…</> : 'Yes, delete'}
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={u.id} onClick={() => router.push(`/upload/${u.id}`)} style={{ cursor: 'pointer' }}>
                <td>
                  <p style={{ margin: 0, fontWeight: 700, color: '#eaf0ff', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.filename}</p>
                  {u.totalRowsUnresolved > 0 && <p style={{ margin: '2px 0 0', fontSize: 11, color: '#ffcc66' }}>{u.totalRowsUnresolved} unresolved</p>}
                </td>
                <td style={{ color: '#8b97c3', whiteSpace: 'nowrap' }}>{u.account?.name}</td>
                <td className="num" style={{ color: '#8b97c3', whiteSpace: 'nowrap' }}>
                  {new Date(u.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })}
                </td>
                <td className="num" style={{ textAlign: 'right', color: '#c8d4f5' }}>{u.rowCountAccepted}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'nowrap' }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 999, border: `1px solid ${u.status === 'complete' ? 'rgba(46,229,157,.25)' : 'rgba(255,204,102,.25)'}`, background: u.status === 'complete' ? 'rgba(46,229,157,.10)' : 'rgba(255,204,102,.10)', fontSize: 11, fontWeight: 850, color: u.status === 'complete' ? '#2ee59d' : '#ffcc66', whiteSpace: 'nowrap' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, background: u.status === 'complete' ? '#2ee59d' : '#ffcc66' }} />
                      {u.status === 'complete' ? 'done' : u.status === 'processing' ? 'proc…' : u.status}
                    </span>
                    {u.reconciliationStatus && u.status === 'complete' && (
                      <ReconciliationShield status={u.reconciliationStatus} size="sm" />
                    )}
                  </div>
                </td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                      onClick={e => { e.stopPropagation(); setConfirmDeleteId(u.id) }}
                      style={{ padding: 4, borderRadius: 6, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.30)', transition: 'color .15s' }}
                      className="hover:!text-[#ff8397]"
                      title="Delete statement"
                    >
                      <Trash2 size={13} />
                    </button>
                    <ChevronRight size={14} style={{ color: 'rgba(255,255,255,.25)' }} />
                  </div>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
      </div>
    </div>
  )
}
