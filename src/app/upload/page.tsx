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

const glassCard: React.CSSProperties = {
  borderRadius: 28,
  border: '1px solid rgba(255,255,255,.10)',
  background: 'rgba(255,255,255,.045)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 12px 32px rgba(0,0,0,.35)',
  overflow: 'hidden',
}

const cardHeader: React.CSSProperties = {
  padding: '16px 16px 12px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  borderBottom: '1px solid rgba(255,255,255,.08)',
  background: 'rgba(255,255,255,.03)',
}

const cardTitle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontWeight: 950,
  letterSpacing: '.2px',
  fontSize: 14,
  color: '#eaf0ff',
}

const tIco: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 14,
  border: '1px solid rgba(255,255,255,.10)',
  background: 'rgba(255,255,255,.06)',
  display: 'grid',
  placeItems: 'center',
  fontSize: 14,
  flexShrink: 0,
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
      <div className="pb-24">

        {/* ── Page header ────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 mb-5 flex-wrap">
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 800, letterSpacing: '-.5px', lineHeight: 1.1, color: '#eaf0ff', margin: 0 }}>
              Upload statement
            </h1>
            <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.68)', maxWidth: '72ch', lineHeight: 1.55, fontSize: 14 }}>
              Import transactions from CSV, OFX, QFX, or QBO. After import, you&apos;ll categorize with drag + multi-select.
              The system can remember what you confirm so the next upload gets faster.
            </p>
          </div>
          <div className="flex gap-2.5 flex-shrink-0 flex-wrap">
            <button
              type="button"
              style={{ padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.03)', cursor: 'pointer', fontWeight: 850, fontSize: 13, color: '#eaf0ff', transition: 'background .15s' }}
            >
              Format help
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              style={{ padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,.14)', background: 'linear-gradient(135deg, rgba(110,168,255,.95), rgba(138,125,255,.92))', cursor: 'pointer', fontWeight: 850, fontSize: 13, color: '#fff', boxShadow: '0 18px 40px rgba(110,168,255,.18)' }}
            >
              Browse files
            </button>
          </div>
        </div>

        {/* ── Two-column grid ───────────────────────────────────────────────── */}
        <div
          style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.15fr) minmax(0,.85fr)', gap: 16, alignItems: 'start' }}
          className="max-[800px]:!grid-cols-1"
        >

          {/* ── LEFT: Account + upload card ──────────────────────────────────── */}
          <section style={glassCard}>
            <div style={cardHeader}>
              <div style={cardTitle}>
                <span style={tIco}><Landmark size={16} style={{ color: '#6ea8ff' }} /></span>
                Account + upload
              </div>
              <button
                onClick={() => setShowNewAcct(!showNewAcct)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderRadius: 999, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.04)', cursor: 'pointer', fontWeight: 850, fontSize: 13, color: 'rgba(255,255,255,.86)', transition: 'background .15s' }}
              >
                <PlusCircle size={13} /> New account
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
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 12 }}>
                  <div className="space-y-2" style={{ flex: '1 1 400px' }}>
                    {accounts.map((acct: { id: string; name: string; institution: string; accountType: string; _count: { transactions: number } }) => {
                      const isSelected   = accountId === acct.id
                      const isConfirming = confirmState?.id === acct.id
                      const confirmAction = confirmState?.action
                      return (
                        <div key={acct.id} style={{ borderRadius: 18, border: `1px solid ${isConfirming && confirmAction === 'delete' ? 'rgba(255,92,122,.40)' : isConfirming && confirmAction === 'reset' ? 'rgba(255,204,102,.40)' : isSelected ? 'rgba(110,168,255,.35)' : 'rgba(255,255,255,.10)'}`, background: isSelected ? 'rgba(110,168,255,.10)' : 'rgba(255,255,255,.04)', transition: 'border-color .15s, background .15s' }}>
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => { setAccountId(acct.id); setMenuOpenId(null) }}
                            onKeyDown={e => e.key === 'Enter' && setAccountId(acct.id)}
                            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, cursor: 'pointer' }}
                          >
                            <div style={{ width: 40, height: 40, borderRadius: 16, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.12)', display: 'grid', placeItems: 'center', fontWeight: 950, fontSize: 18, flexShrink: 0 }}>
                              {acct.accountType === 'credit_card'
                                ? <CreditCard size={18} style={{ color: '#6ea8ff' }} />
                                : <Landmark size={18} style={{ color: '#6ea8ff' }} />}
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <p style={{ margin: 0, fontWeight: 950, fontSize: 14, color: '#eaf0ff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{acct.name}</p>
                              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'rgba(255,255,255,.75)', fontWeight: 750 }}>{acct.accountType} · {acct._count.transactions} transactions</p>
                            </div>
                            {isSelected && <CheckCircle size={18} style={{ color: '#6ea8ff', flexShrink: 0 }} />}

                            {/* ⋯ menu */}
                            <div className="relative flex-shrink-0 z-20">
                              <button
                                onClick={e => { e.stopPropagation(); setMenuOpenId(menuOpenId === acct.id ? null : acct.id); setConfirmState(null) }}
                                style={{ width: 38, height: 38, borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.06)', cursor: 'pointer', display: 'grid', placeItems: 'center', transition: 'background .15s' }}
                                aria-label="Account options"
                              >
                                <MoreHorizontal size={16} style={{ color: 'rgba(255,255,255,.70)' }} />
                              </button>
                              {menuOpenId === acct.id && (
                                <div style={{ position: 'absolute', right: 0, top: 44, zIndex: 30, background: 'rgba(11,16,32,.97)', border: '1px solid rgba(255,255,255,.12)', borderRadius: 16, boxShadow: '0 12px 32px rgba(0,0,0,.5)', padding: '4px 0', width: 176 }}>
                                  <button
                                    onClick={e => { e.stopPropagation(); setMenuOpenId(null); setConfirmState({ id: acct.id, action: 'reset' }) }}
                                    disabled={acct._count.transactions === 0}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,.80)', textAlign: 'left', fontWeight: 750 }}
                                    className="hover:bg-white/[.06] disabled:opacity-40 disabled:cursor-not-allowed"
                                  >
                                    <RefreshCw size={13} /> Reset data
                                  </button>
                                  <button
                                    onClick={e => { e.stopPropagation(); setMenuOpenId(null); setConfirmState({ id: acct.id, action: 'delete' }) }}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#ff8397', textAlign: 'left', fontWeight: 750 }}
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
                            <div style={{ padding: '12px 14px', borderTop: `1px solid ${confirmAction === 'delete' ? 'rgba(255,92,122,.22)' : 'rgba(255,204,102,.22)'}`, background: confirmAction === 'delete' ? 'rgba(255,92,122,.08)' : 'rgba(255,204,102,.08)' }}>
                              <p style={{ margin: '0 0 10px', fontSize: 13, fontWeight: 700, color: confirmAction === 'delete' ? '#ff8397' : '#ffcc66' }}>
                                {confirmAction === 'delete'
                                  ? `Delete "${acct.name}"? This cannot be undone.`
                                  : `Reset "${acct.name}"? All transactions and uploads will be wiped.`}
                              </p>
                              <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => setConfirmState(null)} style={{ flex: 1, padding: '6px 0', borderRadius: 10, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.06)', color: '#c8d4f5', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                  Cancel
                                </button>
                                <button
                                  disabled={!confirmReady || resetMutation.isPending || deleteAccountMutation.isPending}
                                  onClick={() => { if (confirmAction === 'reset') resetMutation.mutate(acct.id); else deleteAccountMutation.mutate(acct.id) }}
                                  style={{ flex: 1, padding: '6px 0', borderRadius: 10, border: 'none', background: confirmAction === 'delete' ? '#c0293f' : '#b07800', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, opacity: (!confirmReady || resetMutation.isPending || deleteAccountMutation.isPending) ? .5 : 1 }}
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
                <div style={{ marginBottom: 12, padding: '10px 14px', borderRadius: 14, background: 'rgba(255,204,102,.08)', border: '1px solid rgba(255,204,102,.22)', fontSize: 13, color: '#ffcc66', fontWeight: 700 }}>
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
                  borderRadius: 24,
                  border: `1px dashed ${dragOver ? 'rgba(46,229,157,.55)' : selectedFile ? 'rgba(46,229,157,.45)' : 'rgba(255,255,255,.22)'}`,
                  background: dragOver
                    ? 'rgba(46,229,157,.08)'
                    : selectedFile
                    ? 'rgba(46,229,157,.06)'
                    : 'radial-gradient(520px 240px at 28% 8%, rgba(110,168,255,.16), transparent 65%), radial-gradient(520px 240px at 82% 18%, rgba(138,125,255,.14), transparent 65%), rgba(255,255,255,.03)',
                  padding: 22,
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'border-color .15s, background .15s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <input ref={fileRef} type="file" accept=".csv,.CSV,.ofx,.OFX,.qfx,.QFX,.qbo,.QBO,text/csv" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />

                {selectedFile ? (
                  <div>
                    <div style={{ width: 58, height: 58, margin: '0 auto 10px', borderRadius: 22, border: '1px solid rgba(46,229,157,.35)', background: 'rgba(46,229,157,.10)', display: 'grid', placeItems: 'center', boxShadow: '0 18px 40px rgba(0,0,0,.25)' }}>
                      <FileCheck2 size={26} style={{ color: '#2ee59d' }} />
                    </div>
                    <p style={{ margin: 0, fontWeight: 950, fontSize: 15, color: '#eaf0ff' }}>{selectedFile.name}</p>
                    <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,.68)', fontSize: 13 }}>
                      {(selectedFile.size / 1024).toFixed(1)} KB · Click to change
                    </p>
                  </div>
                ) : (
                  <div>
                    <div style={{ width: 58, height: 58, margin: '0 auto 10px', borderRadius: 22, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.06)', display: 'grid', placeItems: 'center', boxShadow: '0 18px 40px rgba(0,0,0,.25)' }}>
                      <UploadCloud size={26} style={{ color: '#a8b3d6' }} />
                    </div>
                    <p style={{ display: 'block', margin: '6px 0 0', fontWeight: 950, fontSize: 15, color: '#eaf0ff' }}>Drop your statement here</p>
                    <p style={{ margin: '8px 0 0', color: 'rgba(255,255,255,.68)', fontSize: 13, lineHeight: 1.55 }}>
                      or click to browse. We support CSV, OFX, QFX, and QBO.
                    </p>
                    <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
                      {['CSV', 'OFX', 'QFX', 'QBO'].map(fmt => (
                        <span key={fmt} style={{ padding: '7px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.82)', fontSize: 12, fontWeight: 850 }}>
                          {fmt}
                        </span>
                      ))}
                    </div>
                    <p style={{ marginTop: 12, color: 'rgba(255,255,255,.55)', fontSize: 12, lineHeight: 1.5 }}>
                      <strong style={{ color: 'rgba(255,255,255,.85)' }}>Accuracy:</strong>{' '}
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
                    <div style={{ marginBottom: 10, padding: '10px 14px', borderRadius: 14, background: 'rgba(255,204,102,.08)', border: '1px solid rgba(255,204,102,.22)', fontSize: 13, color: '#ffcc66', fontWeight: 700 }}>
                      Please select or create an account above before uploading.
                    </div>
                  )}
                  <button
                    onClick={() => uploadMutation.mutate()}
                    disabled={!accountId || uploadMutation.isPending}
                    style={{ width: '100%', padding: '14px 24px', borderRadius: 18, border: '1px solid rgba(255,255,255,.14)', background: 'linear-gradient(135deg, rgba(110,168,255,.95), rgba(138,125,255,.92))', color: '#fff', fontWeight: 850, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, boxShadow: '0 18px 40px rgba(110,168,255,.18)', opacity: (!accountId || uploadMutation.isPending) ? .5 : 1, transition: 'opacity .15s' }}
                  >
                    {uploadMutation.isPending
                      ? <><Loader2 size={18} className="animate-spin" /> Processing statement…</>
                      : <><UploadCloud size={16} /> Import statement <ArrowRight size={14} /></>}
                  </button>
                </div>
              )}

              {/* Pipeline stages */}
              {uploadMutation.isPending && pipelineStage >= 0 && (
                <div style={{ marginTop: 14, borderRadius: 16, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(0,0,0,.30)', padding: '14px 16px', fontFamily: 'monospace', fontSize: 12 }} className="space-y-2.5">
                  {PIPELINE_STAGES.map((stage, i) => {
                    const done   = pipelineStage > i
                    const active = pipelineStage === i
                    return (
                      <div key={i} className={clsx('flex items-start gap-2.5', done || active ? 'opacity-100' : 'opacity-25')}>
                        {done ? (
                          <CheckCircle size={12} style={{ color: '#2ee59d', marginTop: 2, flexShrink: 0 }} />
                        ) : active ? (
                          <Loader2 size={12} className="animate-spin" style={{ color: '#6ea8ff', marginTop: 2, flexShrink: 0 }} />
                        ) : (
                          <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1px solid rgba(255,255,255,.20)', marginTop: 2, flexShrink: 0 }} />
                        )}
                        <span style={{ color: done ? 'rgba(255,255,255,.40)' : active ? '#eaf0ff' : 'rgba(255,255,255,.25)' }}>
                          {stage.label}
                          {(done || active) && (
                            <span style={{ marginLeft: 8, color: done ? 'rgba(255,255,255,.25)' : 'rgba(255,255,255,.50)' }}>
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
                <div style={{ marginTop: 14, borderRadius: 22, border: `1px solid ${result.success ? 'rgba(46,229,157,.25)' : 'rgba(255,92,122,.25)'}`, background: result.success ? 'rgba(46,229,157,.07)' : 'rgba(255,92,122,.07)', padding: 16 }}>
                  {result.success ? (
                    <div className="space-y-3">
                      <div className="flex items-center gap-2">
                        <CheckCircle size={18} style={{ color: '#2ee59d' }} />
                        <h3 style={{ margin: 0, fontWeight: 800, fontSize: 15, color: '#2ee59d' }}>Upload complete</h3>
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
                        {([
                          ['Transactions imported', String((result.data as Record<string, unknown>).accepted)],
                          ['Format detected',       String((result.data as Record<string, unknown>).formatDetected)],
                          ...(Number((result.data as Record<string, unknown>).possibleDuplicates) > 0
                            ? [['Possible duplicates', String((result.data as Record<string, unknown>).possibleDuplicates)] as [string, string]]
                            : []),
                        ] as [string, string][]).map(([label, val]) => (
                          <div key={label} style={{ borderRadius: 14, border: '1px solid rgba(46,229,157,.20)', background: 'rgba(255,255,255,.04)', padding: '10px 12px' }}>
                            <p style={{ margin: 0, color: '#2ee59d', fontWeight: 700, fontSize: 11, textTransform: 'uppercase' }}>{label}</p>
                            <p style={{ margin: '4px 0 0', fontWeight: 800, color: '#eaf0ff', fontSize: 15 }}>{val}</p>
                          </div>
                        ))}
                        {(() => {
                          const reconStatus = String((result.data as Record<string, unknown>).reconciliationStatus ?? 'UNVERIFIABLE')
                          return (
                            <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.04)', padding: '10px 12px', gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 10 }}>
                              <ReconciliationShield status={reconStatus} size="md" />
                              {reconStatus === 'PASS'              && <p style={{ margin: 0, fontSize: 12, color: '#2ee59d' }}>All totals verified against bank statement</p>}
                              {reconStatus === 'PASS_WITH_WARNINGS'&& <p style={{ margin: 0, fontSize: 12, color: '#ffcc66' }}>Minor issues found — see statement detail</p>}
                              {reconStatus === 'FAIL'              && <p style={{ margin: 0, fontSize: 12, color: '#ff8397' }}>Totals don&apos;t match — review the statement detail</p>}
                              {reconStatus === 'UNVERIFIABLE'      && <p style={{ margin: 0, fontSize: 12, color: '#8b97c3' }}>Bank format doesn&apos;t include statement totals</p>}
                            </div>
                          )
                        })()}
                      </div>
                      {Boolean((result.data as Record<string, unknown>).fileHashTruncated) && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, borderTop: '1px solid rgba(46,229,157,.15)' }}>
                          <span style={{ fontSize: 11, color: 'rgba(46,229,157,.70)', fontFamily: 'monospace' }}>SHA-256</span>
                          <code style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(46,229,157,.80)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {String((result.data as Record<string, unknown>).fileHashTruncated)}
                          </code>
                        </div>
                      )}
                      {Boolean((result.data as Record<string, unknown>).formatMismatch) && (
                        <div style={{ borderRadius: 12, border: '1px solid rgba(255,204,102,.22)', background: 'rgba(255,204,102,.08)', padding: '10px 12px', fontSize: 13, color: '#ffcc66' }}>
                          ⚠️ File extension and content type don&apos;t match — processed as{' '}
                          <strong>{String((result.data as Record<string, unknown>).formatDetected ?? 'detected format')}</strong>.
                        </div>
                      )}
                      {Boolean((result.data as Record<string, unknown>).dateAmbiguous) && (
                        <div style={{ borderRadius: 12, border: '1px solid rgba(255,204,102,.22)', background: 'rgba(255,204,102,.08)', padding: '10px 12px', fontSize: 13, color: '#ffcc66' }}>
                          ⚠️ Date format was ambiguous (MM/DD vs DD/MM). Please verify your transaction dates.
                        </div>
                      )}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {Boolean((result.data as Record<string, unknown>).stagingUploadId) && (
                          <button
                            onClick={() => router.push(`/staging/${String((result.data as Record<string, unknown>).stagingUploadId)}`)}
                            style={{ width: '100%', padding: '12px 20px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, rgba(99,102,241,.95), rgba(168,85,247,.90))', color: '#fff', fontWeight: 850, fontSize: 13, cursor: 'pointer', boxShadow: '0 12px 30px rgba(99,102,241,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                          >
                            Review &amp; Add to Budget →
                          </button>
                        )}
                        <button
                          onClick={() => router.push(`/upload/${String(result.data.uploadId)}`)}
                          style={{ width: '100%', padding: '12px 20px', borderRadius: 14, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.06)', color: '#eaf0ff', fontWeight: 750, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                        >
                          View reconciliation report →
                        </button>
                        <button
                          onClick={() => router.push('/dashboard')}
                          style={{ width: '100%', padding: '12px 20px', borderRadius: 14, border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.06)', color: '#8b97c3', fontWeight: 750, fontSize: 13, cursor: 'pointer' }}
                        >
                          View Dashboard →
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <AlertCircle size={18} style={{ color: '#ff8397', flexShrink: 0, marginTop: 2 }} />
                      <div>
                        <h3 style={{ margin: 0, fontWeight: 800, color: '#ff8397', fontSize: 14 }}>Upload failed</h3>
                        <p style={{ margin: '4px 0 0', color: '#c8d4f5', fontSize: 13 }}>{result.error}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Sample data */}
              <div style={{ marginTop: 14, borderRadius: 24, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.03)', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <p style={{ margin: 0, color: 'rgba(255,255,255,.68)', fontSize: 13, lineHeight: 1.45, maxWidth: '52ch' }}>
                  <strong style={{ color: '#eaf0ff' }}>No file handy?</strong> Load realistic sample data to try the full organize + categorize flow.
                </p>
                <SampleDataLoader onLoaded={() => router.push('/dashboard')} />
              </div>

              {/* Statement history */}
              <UploadHistory />
            </div>
          </section>

          {/* ── RIGHT: Steps + Privacy cards ─────────────────────────────────── */}
          <aside style={{ display: 'grid', gap: 12 }}>

            {/* 3-step flow card */}
            <section style={glassCard}>
              <div style={cardHeader}>
                <div style={cardTitle}>
                  <span style={tIco}><Workflow size={16} style={{ color: '#8a7dff' }} /></span>
                  The 3-step flow
                </div>
              </div>
              <div style={{ padding: 16 }}>
                {[
                  { n: 1, title: 'Upload',     desc: 'Import transactions exactly as provided by the statement file.',                             badge: { color: '#2ee59d', glow: 'rgba(46,229,157,.12)',  text: 'Deterministic import (no guessing)' } },
                  { n: 2, title: 'Categorize', desc: 'Drag, multi-select, and use search/sort to assign categories quickly.',                     badge: { color: '#6ea8ff', glow: 'rgba(110,168,255,.10)', text: 'Built for speed' } },
                  { n: 3, title: 'Insights',   desc: 'Once categorized, unlock breakdowns, trends, and unusual transaction flags.',               badge: { color: '#ffcc66', glow: 'rgba(255,204,102,.12)', text: 'Needs Review for conflicts' } },
                ].map(({ n, title, desc, badge }, idx) => (
                  <div key={n} style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.03)', padding: 14, marginTop: idx === 0 ? 0 : 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ width: 30, height: 30, borderRadius: 12, display: 'grid', placeItems: 'center', fontWeight: 950, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.06)', flexShrink: 0, color: '#eaf0ff' }}>
                        {n}
                      </div>
                      <div>
                        <p style={{ margin: 0, fontSize: 13, fontWeight: 950, color: '#eaf0ff' }}>{title}</p>
                        <p style={{ margin: '6px 0 0', color: 'rgba(255,255,255,.68)', fontSize: 13, lineHeight: 1.55 }}>{desc}</p>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 10px', borderRadius: 999, border: '1px solid rgba(255,255,255,.10)', background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.82)', fontSize: 12, fontWeight: 850 }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', background: badge.color, boxShadow: `0 0 0 6px ${badge.glow}`, flexShrink: 0 }} />
                          {badge.text}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                <p style={{ marginTop: 14, color: 'rgba(255,255,255,.60)', fontSize: 12, lineHeight: 1.6 }}>
                  <strong style={{ color: 'rgba(255,255,255,.78)' }}>Tip:</strong> After categorizing, you can save vendor → category rules so the next upload auto-organizes.
                </p>
              </div>
            </section>

            {/* Privacy & accuracy card */}
            <section style={glassCard}>
              <div style={cardHeader}>
                <div style={cardTitle}>
                  <span style={tIco}><ShieldCheck size={16} style={{ color: '#2ee59d' }} /></span>
                  Privacy &amp; accuracy
                </div>
              </div>
              <div style={{ padding: 16, color: 'rgba(255,255,255,.70)', fontSize: 13, lineHeight: 1.6 }}>
                We don&apos;t ask for bank logins. Files can be processed locally or in-session.
                We fingerprint imports for audit trails and never &ldquo;invent&rdquo; transactions.
              </div>
            </section>

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
      style={{ padding: '10px 14px', borderRadius: 14, border: '1px solid rgba(255,255,255,.12)', background: 'rgba(255,255,255,.05)', cursor: 'pointer', fontWeight: 850, fontSize: 13, color: '#eaf0ff', display: 'inline-flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap', opacity: (loading || done) ? .6 : 1 }}
    >
      {done ? <><CheckCircle size={13} style={{ color: '#2ee59d' }} /> Loaded!</> : loading ? <><Loader2 size={13} className="animate-spin" /> Loading…</> : <><FlaskConical size={13} /> Load sample data</>}
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
      <table className="data-table">
        <thead>
          <tr>
            <th>Statement</th>
            <th>Account</th>
            <th>Date</th>
            <th style={{ textAlign: 'right' }}>Rows</th>
            <th>Reconciliation</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {uploads.slice(0, 8).map((u) =>
            confirmDeleteId === u.id ? (
              <tr key={u.id} style={{ background: 'rgba(255,92,122,.08)' }}>
                <td colSpan={7}>
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
                  {u.reconciliationStatus && u.status === 'complete' && (
                    <ReconciliationShield status={u.reconciliationStatus} size="sm" />
                  )}
                </td>
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 999, border: `1px solid ${u.status === 'complete' ? 'rgba(46,229,157,.25)' : 'rgba(255,204,102,.25)'}`, background: u.status === 'complete' ? 'rgba(46,229,157,.10)' : 'rgba(255,204,102,.10)', fontSize: 11, fontWeight: 850, color: u.status === 'complete' ? '#2ee59d' : '#ffcc66' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: u.status === 'complete' ? '#2ee59d' : '#ffcc66' }} />
                    {u.status}
                  </span>
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
  )
}
