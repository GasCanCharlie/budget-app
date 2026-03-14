'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FileText, Upload, Trash2, Loader2, AlertCircle, ChevronRight, Tags, ArrowRight } from 'lucide-react'
import { ReconciliationShield } from '@/components/ReconciliationShield'
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface Account  { id: string; name: string; institution: string; accountType: string }
interface UploadRow { id: string; filename: string; createdAt: string; status: string; rowCountAccepted: number; reconciliationStatus: string; account: { name: string } }

const S = {
  card:   { background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-soft)', overflow: 'hidden' } as React.CSSProperties,
  hdr:    { padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid var(--border)' } as React.CSSProperties,
  input:  { width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 14, boxSizing: 'border-box' } as React.CSSProperties,
  ghost:  { background: 'none', border: 'none', cursor: 'pointer' } as React.CSSProperties,
  flex:   (gap = 8) => ({ display: 'flex', alignItems: 'center', gap } as React.CSSProperties),
  col:    (gap = 8) => ({ display: 'flex', flexDirection: 'column', gap } as React.CSSProperties),
  muted:  (size = 13) => ({ fontSize: size, color: 'var(--muted)' } as React.CSSProperties),
}

export default function StatementsPage() {
  const router = useRouter()
  const token  = useAuthStore(s => s.token)
  const { apiFetch, apiUpload } = useApi()
  const qc = useQueryClient()

  const now   = new Date()
  const year  = now.getFullYear()
  const month = now.getMonth() + 1

  const [showForm,     setShowForm]     = useState(false)
  const [accountId,    setAccountId]    = useState('')
  const [showNewAcct,  setShowNewAcct]  = useState(false)
  const [newName,      setNewName]      = useState('')
  const [newType,      setNewType]      = useState('checking')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [dragOver,     setDragOver]     = useState(false)
  const [successMsg,   setSuccessMsg]   = useState('')
  const [errorMsg,     setErrorMsg]     = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: accountsData } = useQuery({ queryKey: ['accounts'], queryFn: () => apiFetch('/api/accounts'), enabled: !!token })
  const { data: uploadsData, isLoading: uploadsLoading } = useQuery({ queryKey: ['uploads'], queryFn: () => apiFetch('/api/uploads'), enabled: !!token })
  const { data: summaryData } = useQuery({ queryKey: ['summary', year, month], queryFn: () => apiFetch(`/api/summaries/${year}/${month}`), enabled: !!token, staleTime: 60_000 })

  const accounts: Account[]   = accountsData?.accounts ?? []
  const uploads:  UploadRow[] = uploadsData?.uploads   ?? []

  const uncategorizedCount: number = summaryData?.uncategorizedCount ?? 0
  const categoryTotals: { categoryName: string; categoryColor: string; total: number; isIncome: boolean }[] =
    (summaryData?.summary?.categoryTotals ?? []).filter((c: { isIncome: boolean }) => !c.isIncome)
  const hasData = categoryTotals.length > 0

  useEffect(() => { if (accounts.length > 0 && !accountId) setAccountId(accounts[0].id) }, [accounts, accountId])
  useEffect(() => { if (accountsData && accounts.length === 0) { setShowForm(true); setShowNewAcct(true) } }, [accountsData, accounts.length])

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('Select a file first')
      let finalId = accountId
      if (showNewAcct) {
        const d: { account?: Account } = await apiFetch('/api/accounts', {
          method: 'POST',
          body: JSON.stringify({ name: newName.trim(), institution: newName.trim(), accountType: newType }),
        })
        qc.invalidateQueries({ queryKey: ['accounts'] })
        finalId = d.account?.id ?? ''
        if (!finalId) throw new Error('Failed to create account')
        setAccountId(finalId)
        setShowNewAcct(false)
      }
      if (!finalId) throw new Error('Select an account first')
      const fd = new FormData()
      fd.append('file', selectedFile)
      fd.append('accountId', finalId)
      return apiUpload('/api/uploads', fd)
    },
    onSuccess: (data: { rowsImported?: number }) => {
      qc.invalidateQueries({ queryKey: ['uploads'] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
      setSuccessMsg(`${data.rowsImported ?? 0} transactions imported`)
      setSelectedFile(null)
      setErrorMsg('')
      setTimeout(() => { setSuccessMsg(''); setShowForm(false) }, 2000)
    },
    onError: (err: Error) => setErrorMsg(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/uploads/${id}`, { method: 'DELETE' }),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['uploads'] }),
  })

  function handleDrop(e: React.DragEvent) {
    e.preventDefault(); setDragOver(false)
    const f = e.dataTransfer.files[0]; if (f) setSelectedFile(f)
  }

  function handleDelete(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    if (window.confirm('Delete this statement and all its transactions? This cannot be undone.')) deleteMutation.mutate(id)
  }

  const canUpload = !!selectedFile && (showNewAcct ? newName.trim().length > 0 : !!accountId)
  const fmtDate   = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const closeForm = () => { setShowForm(false); setErrorMsg(''); setSuccessMsg(''); setSelectedFile(null) }

  return (
    <AppShell>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px', ...S.col(20) }}>

        {/* Header */}
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text)' }}>Statements</h1>
          <p style={{ margin: '4px 0 0', ...S.muted(14) }}>Upload bank statements to analyze your spending.</p>
        </div>

        {/* Upload card */}
        <div style={S.card}>
          {!showForm ? (
            <button onClick={() => setShowForm(true)} style={{ width: '100%', padding: '14px 18px', ...S.ghost, ...S.flex(8), justifyContent: 'center', color: 'var(--accent)', fontWeight: 600, fontSize: 14 }}>
              <Upload size={16} /> Upload a Statement
            </button>
          ) : (
            <div style={{ padding: 18, ...S.col(14) }}>
              <div style={S.flex(0)}>
                <span style={{ flex: 1, fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>Upload a Statement</span>
                <button onClick={closeForm} style={{ ...S.ghost, color: 'var(--muted)', fontSize: 20, lineHeight: 1 }}>×</button>
              </div>

              {/* Account */}
              {!showNewAcct && accounts.length > 0 ? (
                <div style={S.col(6)}>
                  <label style={S.muted(13)}>Account</label>
                  <div style={S.flex(8)}>
                    <select value={accountId} onChange={e => setAccountId(e.target.value)} style={{ ...S.input, flex: 1 }}>
                      {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                    <button onClick={() => setShowNewAcct(true)} style={{ ...S.ghost, whiteSpace: 'nowrap', fontSize: 13, color: 'var(--accent)' }}>+ New account</button>
                  </div>
                </div>
              ) : (
                <div style={S.col(8)}>
                  <label style={S.muted(13)}>New Account</label>
                  <input placeholder="Account name (e.g. Chase Checking)" value={newName} onChange={e => setNewName(e.target.value)} style={S.input} />
                  <select value={newType} onChange={e => setNewType(e.target.value)} style={S.input}>
                    <option value="checking">Checking</option>
                    <option value="savings">Savings</option>
                    <option value="credit">Credit Card</option>
                  </select>
                  {accounts.length > 0 && <button onClick={() => setShowNewAcct(false)} style={{ ...S.ghost, alignSelf: 'flex-start', fontSize: 13, color: 'var(--muted)' }}>← Use existing account</button>}
                </div>
              )}

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                style={{ border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '28px 16px', textAlign: 'center', cursor: 'pointer', background: dragOver ? 'rgba(124,137,255,0.06)' : 'transparent', transition: 'all .15s' }}
              >
                {selectedFile ? (
                  <div style={{ ...S.flex(8), justifyContent: 'center', color: 'var(--text)' }}>
                    <FileText size={18} />
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{selectedFile.name}</span>
                    <button onClick={e => { e.stopPropagation(); setSelectedFile(null) }} style={{ ...S.ghost, color: 'var(--muted)', marginLeft: 4 }}>×</button>
                  </div>
                ) : (
                  <>
                    <Upload size={24} style={{ color: 'var(--muted)', marginBottom: 8 }} />
                    <p style={{ margin: 0, ...S.muted(14) }}>Drop a CSV or OFX file here, or click to browse</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".csv,.ofx,.qfx" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) setSelectedFile(f) }} />
              </div>

              {successMsg && <div style={{ ...S.flex(8), color: 'var(--success)', fontSize: 14 }}>✓ {successMsg}</div>}
              {errorMsg   && <div style={{ ...S.flex(8), color: 'var(--danger)',  fontSize: 14 }}><AlertCircle size={15} /> {errorMsg}</div>}

              <button
                disabled={!canUpload || uploadMutation.isPending}
                onClick={() => uploadMutation.mutate()}
                style={{ padding: '11px 24px', borderRadius: 8, border: '1px solid rgba(124,137,255,0.35)', background: 'rgba(124,137,255,0.20)', color: 'var(--accent)', fontWeight: 600, fontSize: 14, cursor: (!canUpload || uploadMutation.isPending) ? 'not-allowed' : 'pointer', opacity: (!canUpload || uploadMutation.isPending) ? 0.5 : 1, ...S.flex(8), justifyContent: 'center' }}
              >
                {uploadMutation.isPending ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Uploading…</> : 'Upload'}
              </button>
            </div>
          )}
        </div>

        {/* What's next hint */}
        {uploads.length > 0 && (
          <div style={{ ...S.card, padding: '16px 20px', ...S.flex(14), flexWrap: 'wrap' as const }}>
            <div style={{ flex: 1, minWidth: 200, ...S.col(4) }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', ...S.flex(6) }}>
                <Tags size={15} style={{ color: 'var(--accent)' }} />
                {uncategorizedCount > 0 ? `Next step — categorize your transactions` : `All transactions categorized`}
              </span>
              <span style={S.muted(13)}>
                {uncategorizedCount > 0
                  ? `${uncategorizedCount} transaction${uncategorizedCount === 1 ? '' : 's'} need a category before insights unlock.`
                  : `Head to the dashboard to see your spending insights.`}
              </span>
            </div>
            <button
              onClick={() => router.push(uncategorizedCount > 0 ? '/categorize' : '/dashboard')}
              style={{ flexShrink: 0, ...S.flex(6), padding: '9px 16px', borderRadius: 8, border: '1px solid rgba(124,137,255,0.35)', background: 'rgba(124,137,255,0.15)', color: 'var(--accent)', fontWeight: 600, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' as const }}
            >
              {uncategorizedCount > 0 ? 'Categorize' : 'Dashboard'}
              <ArrowRight size={14} />
            </button>
          </div>
        )}

        {/* Spending pie chart */}
        {hasData && (
          <div style={S.card}>
            <div style={S.hdr}>
              <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>Spending This Month</span>
            </div>
            <div style={{ padding: '8px 16px 16px' }}>
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={categoryTotals.map(c => ({ name: c.categoryName, value: c.total, color: c.categoryColor }))}
                    dataKey="value" nameKey="name" innerRadius={60} outerRadius={95} paddingAngle={2}>
                    {categoryTotals.map((c, i) => <Cell key={i} fill={c.categoryColor} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => [`$${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Spent']} />
                  <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Statements list */}
        <div style={S.card}>
          <div style={S.hdr}>
            <span style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)' }}>Your Statements</span>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 99, padding: '2px 8px' }}>{uploads.length}</span>
          </div>
          {uploadsLoading ? (
            <div style={{ padding: 40, ...S.flex(0), justifyContent: 'center' }}>
              <Loader2 size={24} style={{ color: 'var(--muted)', animation: 'spin 1s linear infinite' }} />
            </div>
          ) : uploads.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', ...S.muted(14) }}>No statements yet. Upload one above.</div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {uploads.map((u, i) => (
                <StatementRow key={u.id} upload={u} isLast={i === uploads.length - 1}
                  onDelete={handleDelete}
                  onNavigate={() => router.push(`/upload/${u.id}`)}
                  onReport={e => { e.stopPropagation(); router.push(`/reports/${u.id}`) }}
                  fmtDate={fmtDate}
                />
              ))}
            </ul>
          )}
        </div>

      </div>
    </AppShell>
  )
}

// ─── Statement row ─────────────────────────────────────────────────────────────

interface RowProps {
  upload: UploadRow
  isLast: boolean
  onDelete:   (e: React.MouseEvent, id: string) => void
  onNavigate: () => void
  onReport:   (e: React.MouseEvent) => void
  fmtDate:    (iso: string) => string
}

function StatementRow({ upload: u, isLast, onDelete, onNavigate, onReport, fmtDate }: RowProps) {
  const [hov, setHov] = useState(false)
  return (
    <li onClick={onNavigate} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: isLast ? 'none' : '1px solid var(--border)', cursor: 'pointer', background: hov ? 'var(--surface2)' : 'transparent', transition: 'background .12s' }}
    >
      <FileText size={18} style={{ color: 'var(--muted)', flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.filename}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.account?.name}</div>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDate(u.createdAt)}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.rowCountAccepted} rows</div>
      </div>

      {u.reconciliationStatus && u.status === 'complete' && (
        <div style={{ flexShrink: 0 }}><ReconciliationShield status={u.reconciliationStatus} size="sm" /></div>
      )}

      <button onClick={onReport} style={{ flexShrink: 0, background: 'var(--accent-muted)', border: '1px solid rgba(124,137,255,0.25)', color: 'var(--accent)', fontSize: 11, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        Scan Report
      </button>

      <button onClick={e => onDelete(e, u.id)} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: hov ? 'var(--danger)' : 'var(--border)', padding: 4, display: 'flex', alignItems: 'center', transition: 'color .12s' }}>
        <Trash2 size={15} />
      </button>

      <ChevronRight size={15} style={{ color: 'var(--muted)', flexShrink: 0 }} />
    </li>
  )
}
