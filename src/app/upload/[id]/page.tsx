'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, ChevronDown, ChevronRight, Trash2, FileText, Tags, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { format } from 'date-fns'
import { ReconciliationShield } from '@/components/ReconciliationShield'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Category colors ──────────────────────────────────────────────────────────

const CAT_COLORS: Record<string, string> = {
  'Food & Dining': '#f97316', 'Groceries': '#22c55e', 'Housing': '#f59e0b',
  'Transport': '#7aa2ff', 'Entertainment': '#ec4899', 'Shopping': '#f59e0b',
  'Health': '#10b981', 'Utilities': '#6366f1', 'Subscriptions': '#6366f1',
  'Personal Care': '#f472b6', 'Education': '#06b6d4', 'Travel': '#06b6d4',
  'Insurance': '#64748b', 'Fees & Charges': '#ef4444', 'Gifts & Charity': '#8794ff',
  'Income': '#16a34a', 'Transfer': '#64748b', 'Transfers': '#64748b',
  'Fast Food': '#f97316', 'Alcohol': '#8b5cf6', 'Restaurants': '#f97316',
  'Gas/Fuel': '#7aa2ff', 'Gasoline/Fuel': '#7aa2ff', 'Pets': '#a3e635',
  'Other': '#94a3b8', 'Uncategorized': '#94a3b8',
}
const FALLBACK_COLORS = ['#818cf8','#fb923c','#34d399','#f472b6','#fbbf24','#22d3ee','#c084fc','#4ade80']
function getCatColor(name: string, i: number) {
  return CAT_COLORS[name] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length]
}

function fmtPie(n: number) {
  return '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReconciliationSummary {
  totalCredits:      string
  totalDebits:       string
  netChange:         string
  startBalance:      string | null
  endBalance:        string | null
  computedEndBalance: string | null
}

interface ReconciliationCheck {
  name:        string
  passed:      boolean
  expected:    string | null
  actual:      string | null
  tolerance:   'EXACT' | null
  details?:    string
}

interface Discrepancy {
  type:        string
  rowIndex:    number | null
  field:       string
  expected:    string
  actual:      string
  magnitude:   string
  description: string
}

interface ReconciliationResult {
  mode:          string
  status:        string
  checks:        ReconciliationCheck[]
  discrepancies: Discrepancy[]
  summary:       ReconciliationSummary
  balanceModel?:  'AFTER' | 'BEFORE'
  needsReview?:   boolean
  deltaStats?: {
    isConstantOffset: boolean
    offsetValue:      string | null
    offsetCount:      number
    coveragePercent:  number
  }
  rowsReordered?:  number
}

interface ReconciliationReport {
  uploadId:         string
  fileName:         string
  fileHashTruncated: string
  sourceType:       string
  periodStart:      string | null
  periodEnd:        string | null
  counts: {
    totalParsed:       number
    imported:          number
    unresolved:        number
    rejected:          number
    possibleDuplicates: number
  }
  sums: {
    totalCredits: string
    totalDebits:  string
    netChange:    string
  }
  reconciliation: ReconciliationResult
}

interface IssueBreakdown {
  total:      number
  unresolved: number
  resolved:   number
  byType:     Record<string, number>
}

interface UploadDetail {
  id:                   string
  filename:             string
  fileHash:             string
  formatDetected:       string
  status:               string
  createdAt:            string
  completedAt:          string | null
  account:              { id: string; name: string; institution: string; accountType: string }
  rowCountRaw:          number
  rowCountParsed:       number
  rowCountAccepted:     number
  rowCountRejected:     number
  totalRowsUnresolved:  number
  dateRangeStart:       string | null
  dateRangeEnd:         string | null
  parserVersion:        string
  statementOpenBalance: string | null
  statementCloseBalance: string | null
  statementTotalCredits: string | null
  statementTotalDebits:  string | null
  reconciliationStatus: string
  dateOrderUsed:        string | null
  dateOrderSource:      string | null
  dateOrderConfidence:  number | null
  reconciliationReport: ReconciliationReport | null
  issueBreakdown:       IssueBreakdown
  warnings:             Array<{ rowIndex: number | null; message: string; code: string }>
  transactionCount:     number
}

interface IssueTx {
  id:                  string
  date:                string
  description:         string
  amount:              number
  dateAmbiguity:       string
  dateInterpretationA: string | null
  dateInterpretationB: string | null
}

interface Issue {
  id:              string
  uploadId:        string
  transactionId:   string | null
  issueType:       string
  severity:        string
  description:     string
  suggestedAction: string | null
  resolved:        boolean
  resolvedBy:      string | null
  resolvedAt:      string | null
  resolution:      string | null
  transaction:     IssueTx | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtAmt(s: string | number | null | undefined) {
  if (s == null) return '—'
  const n = typeof s === 'number' ? s : parseFloat(s)
  if (isNaN(n)) return String(s)
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  try { return format(new Date(s), 'MMM d, yyyy') } catch { return s }
}

function fmtCheckValue(s: string | null | undefined): string {
  if (s == null) return '—'
  const n = Number(s)
  if (!isNaN(n) && s.trim() !== '') return fmtAmt(n)
  return s
}

const ISSUE_SEVERITY: Record<string, { cls: string; icon: React.ReactNode }> = {
  ERROR:   { cls: 'bg-red-500/20 text-red-300 border border-red-500/30',    icon: <AlertCircle size={12}/> },
  WARNING: { cls: 'bg-amber-500/20 text-amber-300 border border-amber-500/30', icon: <AlertTriangle size={12}/> },
  INFO:    { cls: 'bg-blue-500/20 text-blue-300 border border-blue-500/30',   icon: <Info size={12}/> },
}

const ISSUE_TYPE_LABEL: Record<string, string> = {
  DATE_AMBIGUOUS:                   'Ambiguous Date',
  DATE_FORMAT_CONFIRMATION_NEEDED:  'Date Format Required',
  AMOUNT_PARSE_FAIL:       'Amount Parse Fail',
  BALANCE_CHAIN_BREAK:     'Balance Mismatch',
  POSSIBLE_DUPLICATE:      'Possible Duplicate',
  MERGED_CELL:             'Merged Cell',
  HEADER_AMBIGUOUS:        'Ambiguous Header',
  TRUNCATED_FILE:          'Truncated File',
  OCR_CONFIDENCE_LOW:      'Low OCR Confidence',
  COLUMN_COUNT_MISMATCH:   'Column Count Mismatch',
  AMOUNT_CONTRADICTION:    'Amount Contradiction',
  UNRESOLVABLE_DATE:       'Unresolvable Date',
  MISSING_REQUIRED_FIELD:  'Missing Required Field',
}

const MODE_LABEL: Record<string, string> = {
  STATEMENT_TOTALS: 'Statement Totals',
  RUNNING_BALANCE:  'Running Balance Chain',
  UNVERIFIABLE:     'Unverifiable',
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReconciliationPanel({ report, status }: { report: ReconciliationReport | null; status: string }) {
  const [open, setOpen]             = useState(true)
  const [showAllBreaks, setShowAll] = useState(false)

  const recon   = report?.reconciliation
  const delta   = recon?.deltaStats
  const breaks  = recon?.discrepancies.filter(d => d.type === 'BALANCE_CHAIN_BREAK') ?? []
  const PREVIEW = 5

  return (
    <section style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', padding: '20px 24px' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between"
      >
        <h2 style={{ fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.9)', display: 'flex', alignItems: 'center', gap: 8 }}>
          Statement Integrity
          <ReconciliationShield status={status} size="sm" />
        </h2>
        {open
          ? <ChevronDown size={16} style={{ color: 'rgba(255,255,255,0.4)' }}/>
          : <ChevronRight size={16} style={{ color: 'rgba(255,255,255,0.4)' }}/>}
      </button>

      {open && report && recon && (
        <div className="space-y-4 mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 12px' }}>
              <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.12em' }}>Mode</p>
              <p style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>{MODE_LABEL[recon.mode] ?? recon.mode}</p>
            </div>
            {recon.balanceModel && (
              <div style={{ background: recon.needsReview ? 'rgba(251,191,36,0.1)' : 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 12px' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.12em' }}>Balance Model</p>
                <p style={{ fontWeight: 700, color: recon.needsReview ? '#fbbf24' : 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                  {recon.balanceModel === 'AFTER' ? 'After transaction' : 'Before transaction'}
                  {recon.needsReview && ' ⚠'}
                </p>
              </div>
            )}
            {typeof recon.rowsReordered === 'number' && (
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 12px' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.12em' }}>Reordered</p>
                <p style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>
                  {recon.rowsReordered === 0 ? 'No (already sorted)' : `${recon.rowsReordered} rows`}
                </p>
              </div>
            )}
            {report.periodStart && report.periodEnd && (
              <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: '8px 12px', gridColumn: 'span 2 / span 2' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.12em' }}>Period</p>
                <p style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>{fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}</p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 text-sm">
            {([
              ['Credits', report.sums.totalCredits,  '#34d399'],
              ['Debits',  report.sums.totalDebits,   '#f87171'],
              ['Net',     report.sums.netChange,      'rgba(255,255,255,0.85)'],
            ] as [string, string, string][]).map(([label, val, color]) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 12 }}>
                <p style={{ fontSize: 10, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontWeight: 600, letterSpacing: '0.12em' }}>{label}</p>
                <p style={{ fontWeight: 700, marginTop: 2, color }}>{fmtAmt(val)}</p>
              </div>
            ))}
          </div>

          {(recon.summary.startBalance || recon.summary.endBalance) && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Opening Balance', recon.summary.startBalance],
                ['Closing Balance', recon.summary.endBalance],
              ].map(([label, val]) => val && (
                <div key={label} style={{ background: 'rgba(255,255,255,0.05)', borderRadius: 10, padding: 12 }}>
                  <p style={{ fontSize: 10, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', fontWeight: 600, letterSpacing: '0.12em' }}>{label}</p>
                  <p style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>{fmtAmt(val)}</p>
                </div>
              ))}
            </div>
          )}

          {recon.checks.length > 0 && (
            <div className="space-y-1.5">
              <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)' }}>Checks</p>
              {recon.checks.map((chk, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: `1px solid ${chk.passed ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}` }}>
                  <span style={{ fontSize: 13, marginTop: 1 }}>{chk.passed ? '✓' : '✗'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: chk.passed ? '#34d399' : '#f87171' }}>{chk.name}</p>
                    {(!chk.passed && (chk.expected || chk.actual)) && (
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 2 }}>
                        Expected {fmtCheckValue(chk.expected)} · Got {fmtCheckValue(chk.actual)}
                      </p>
                    )}
                    {chk.details && (
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 2, fontStyle: 'italic' }}>{chk.details}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {breaks.length > 0 && (
            <div className="space-y-1.5">
              <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.14em', color: 'rgba(255,255,255,0.4)' }}>
                Balance Chain Breaks ({breaks.length})
              </p>
              {(showAllBreaks ? breaks : breaks.slice(0, PREVIEW)).map((b, i) => (
                <div key={i} style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>
                  {b.description}
                  {b.rowIndex != null && <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 8 }}>Row {b.rowIndex}</span>}
                </div>
              ))}
              {breaks.length > PREVIEW && (
                <button
                  onClick={() => setShowAll(s => !s)}
                  style={{ fontSize: 12, color: 'rgba(108,124,255,0.9)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  {showAllBreaks ? 'Show fewer' : `Show all ${breaks.length} breaks`}
                </button>
              )}
            </div>
          )}

          {delta && (
            <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', fontSize: 12, color: 'rgba(255,255,255,0.55)' }}>
              Coverage: <strong style={{ color: 'rgba(255,255,255,0.8)' }}>{delta.coveragePercent}%</strong>
              {delta.isConstantOffset && delta.offsetValue && (
                <> · Constant offset: <strong style={{ color: '#fbbf24' }}>{fmtAmt(delta.offsetValue)}</strong> ({delta.offsetCount} rows)</>
              )}
            </div>
          )}
        </div>
      )}

      {open && !report && (
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', marginTop: 12 }}>No reconciliation report available.</p>
      )}
    </section>
  )
}

function IssueCard({
  issue,
  onResolve,
  resolving,
}: {
  issue: Issue
  onResolve: (id: string, resolved: boolean) => void
  resolving: boolean
}) {
  const sevCfg   = ISSUE_SEVERITY[issue.severity] ?? ISSUE_SEVERITY.INFO
  const typeLabel = ISSUE_TYPE_LABEL[issue.issueType] ?? issue.issueType

  return (
    <div style={{
      borderRadius: 14,
      padding: '14px 16px',
      background: issue.resolved ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.05)',
      border: `1px solid ${issue.resolved ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.1)'}`,
      opacity: issue.resolved ? 0.65 : 1,
    }}>
      <div className="flex items-start gap-2 flex-wrap">
        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0', sevCfg.cls)}>
          {sevCfg.icon}{issue.severity}
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.6)', fontSize: 11, fontWeight: 600 }}>
          {typeLabel}
        </span>
        <div style={{ flex: 1 }} />
        <button
          disabled={resolving}
          onClick={() => onResolve(issue.id, !issue.resolved)}
          style={{
            fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 8, cursor: 'pointer',
            background: issue.resolved ? 'rgba(255,255,255,0.08)' : 'rgba(108,124,255,0.85)',
            color: issue.resolved ? 'rgba(255,255,255,0.6)' : '#fff',
            border: 'none', display: 'inline-flex', alignItems: 'center', gap: 4,
          }}
        >
          {resolving ? <Loader2 size={12} className="animate-spin"/> : null}
          {issue.resolved ? 'Re-open' : 'Mark resolved'}
        </button>
      </div>

      <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.75)', marginTop: 8 }}>{issue.description}</p>

      {issue.suggestedAction && (
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 4, fontStyle: 'italic' }}>{issue.suggestedAction}</p>
      )}

      {issue.transaction && (
        <div style={{ marginTop: 8, background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '8px 12px', fontSize: 11, color: 'rgba(255,255,255,0.5)', display: 'flex', flexWrap: 'wrap', gap: '2px 16px' }}>
          <span><strong style={{ color: 'rgba(255,255,255,0.7)' }}>Date:</strong> {fmtDate(issue.transaction.date)}</span>
          <span><strong style={{ color: 'rgba(255,255,255,0.7)' }}>Desc:</strong> {issue.transaction.description}</span>
          <span style={{ color: issue.transaction.amount < 0 ? '#f87171' : '#34d399', fontFamily: 'monospace' }}>
            {fmtAmt(issue.transaction.amount)}
          </span>
          {issue.transaction.dateAmbiguity === 'AMBIGUOUS_MMDD_DDMM' && (
            <span style={{ color: '#fbbf24' }}>
              MM/DD: {fmtDate(issue.transaction.dateInterpretationA)} · DD/MM: {fmtDate(issue.transaction.dateInterpretationB)}
            </span>
          )}
        </div>
      )}

      {issue.resolved && issue.resolvedAt && (
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6 }}>
          Resolved {issue.resolvedBy === 'USER' ? 'by you' : 'automatically'} on {fmtDate(issue.resolvedAt)}
        </p>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UploadDetailPage() {
  const { id }       = useParams<{ id: string }>()
  const router       = useRouter()
  const user         = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc           = useQueryClient()

  const [tab, setTab]               = useState<'open' | 'resolved'>('open')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingOrder, setPendingOrder]   = useState<'MDY' | 'DMY' | null>(null)
  const [showAllCats, setShowAllCats]     = useState(false)
  const [showParserDetails, setShowParserDetails] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/api/uploads/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['uploads'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      router.push('/upload')
    },
  })

  const { data: uploadData, isLoading: loadingUpload } = useQuery({
    queryKey: ['upload', id],
    queryFn:  () => apiFetch(`/api/uploads/${id}`),
    enabled:  !!user && !!id,
  })
  const upload: UploadDetail | undefined = uploadData?.upload

  const { data: issuesData, isLoading: loadingIssues } = useQuery({
    queryKey: ['upload-issues', id],
    queryFn:  () => apiFetch(`/api/uploads/${id}/issues`),
    enabled:  !!user && !!id,
  })
  const allIssues: Issue[] = issuesData?.issues ?? []

  const { data: scanData } = useQuery({
    queryKey: ['scan-report', id],
    queryFn:  () => apiFetch(`/api/uploads/${id}/scan-report`),
    enabled:  !!user && !!id,
  })
  const catBreakdown: Array<{ category: string; total: number; pct: number }> =
    scanData?.findings?.categoryBreakdown ?? []
  const spendingBreakdown = catBreakdown.filter(c => c.category !== 'Income')
  const incomeTotal   = catBreakdown.filter(c => c.category === 'Income').reduce((s, c) => s + Math.abs(c.total), 0)
  const spendingTotal = spendingBreakdown.reduce((s, c) => s + Math.abs(c.total), 0)
  const netTotal      = incomeTotal - spendingTotal

  const openIssues     = allIssues.filter(i => !i.resolved)
  const resolvedIssues = allIssues.filter(i =>  i.resolved)
  const displayIssues  = tab === 'open' ? openIssues : resolvedIssues

  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const resolveMutation = useMutation({
    mutationFn: ({ issueId, resolved }: { issueId: string; resolved: boolean }) =>
      apiFetch(`/api/uploads/${id}/issues/${issueId}`, {
        method: 'PATCH',
        body:   JSON.stringify({ resolved }),
      }),
    onMutate: ({ issueId }) => setResolvingId(issueId),
    onSettled: () => {
      setResolvingId(null)
      qc.invalidateQueries({ queryKey: ['upload-issues', id] })
      qc.invalidateQueries({ queryKey: ['upload', id] })
      qc.invalidateQueries({ queryKey: ['uploads'] })
    },
  })

  const confirmDateOrderMutation = useMutation({
    mutationFn: (dateOrder: 'MDY' | 'DMY') =>
      apiFetch(`/api/uploads/${id}/reprocess`, {
        method: 'POST',
        body: JSON.stringify({ dateOrder }),
      }),
    onSuccess: () => {
      setPendingOrder(null)
      qc.invalidateQueries({ queryKey: ['upload-issues', id] })
      qc.invalidateQueries({ queryKey: ['upload', id] })
      qc.invalidateQueries({ queryKey: ['uploads'] })
    },
    onError: () => { setPendingOrder(null) },
  })

  const resolvePerRowAmbiguousMutation = useMutation({
    mutationFn: (dateFormat: 'MM/DD' | 'DD/MM') =>
      apiFetch(`/api/uploads/${id}/issues/resolve-all`, {
        method: 'POST',
        body: JSON.stringify({ issueType: 'DATE_AMBIGUOUS', dateFormat }),
      }),
    onSuccess: () => {
      setPendingOrder(null)
      qc.invalidateQueries({ queryKey: ['upload-issues', id] })
      qc.invalidateQueries({ queryKey: ['upload', id] })
      qc.invalidateQueries({ queryKey: ['uploads'] })
    },
    onError: () => { setPendingOrder(null) },
  })

  if (!user) return null

  if (loadingUpload) {
    return (
      <AppShell>
        <main className="flex justify-center py-16">
          <Loader2 size={32} className="animate-spin" style={{ color: 'rgba(255,255,255,0.3)' }}/>
        </main>
      </AppShell>
    )
  }

  if (!upload) {
    return (
      <AppShell>
        <main className="max-w-2xl mx-auto px-4 py-8">
          <p style={{ color: 'rgba(255,255,255,0.4)' }}>Upload not found.</p>
        </main>
      </AppShell>
    )
  }

  const reconStatus    = upload.reconciliationStatus
  const hasIssues      = openIssues.length > 0
  const categorizedPct = upload.rowCountAccepted > 0
    ? Math.round(((upload.rowCountAccepted - upload.totalRowsUnresolved) / upload.rowCountAccepted) * 100)
    : 0

  return (
    <AppShell>
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px 80px' }}>

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div style={{ marginBottom: 28 }}>
          <button
            onClick={() => router.push('/upload')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'rgba(255,255,255,0.45)', marginBottom: 16, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            <ArrowLeft size={14}/> Back to uploads
          </button>

          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', borderRadius: 999, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', padding: '3px 12px', fontSize: 11, letterSpacing: '0.2em', color: 'rgba(148,196,255,0.8)', marginBottom: 10 }}>
                Statement Analysis
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color: '#fff', margin: 0 }}>
                  {upload.filename}
                </h1>
                <ReconciliationShield status={reconStatus} size="md" />
              </div>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 6 }}>
                {upload.account.name}
                {upload.account.institution ? ` · ${upload.account.institution}` : ''}
                {' · '}Uploaded {fmtDate(upload.createdAt)}
                {upload.formatDetected ? ` · ${upload.formatDetected}` : ''}
              </p>
              {upload.dateRangeStart && upload.dateRangeEnd && (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.3)', marginTop: 3 }}>
                  {fmtDate(upload.dateRangeStart)} – {fmtDate(upload.dateRangeEnd)}
                </p>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                onClick={() => router.push('/upload')}
                style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.05)', padding: '10px 18px', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}
              >
                All uploads
              </button>
              <button
                onClick={() => router.push(`/reports/${id}`)}
                style={{ borderRadius: 14, border: '1px solid rgba(108,124,255,0.3)', background: 'linear-gradient(135deg,rgba(108,124,255,0.9),rgba(135,148,255,0.85))', padding: '10px 20px', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8 }}
              >
                <FileText size={15}/> Scan Report
              </button>
            </div>
          </div>
        </div>

        {/* ── Two-column layout ────────────────────────────────────────────── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 20 }} className="lg:grid-cols-[1.4fr_1fr] xl:grid-cols-[1.5fr_.9fr]">

          {/* ── LEFT column ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Stat cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }} className="sm:grid-cols-4">
              {[
                { label: 'Imported',   value: upload.rowCountAccepted,    color: '#34d399', Icon: TrendingUp },
                { label: 'Rejected',   value: upload.rowCountRejected,    color: upload.rowCountRejected > 0 ? '#f87171' : 'rgba(255,255,255,0.5)', Icon: TrendingDown },
                { label: 'Unresolved', value: upload.totalRowsUnresolved, color: upload.totalRowsUnresolved > 0 ? '#fbbf24' : 'rgba(255,255,255,0.5)', Icon: AlertTriangle },
                { label: 'Transactions', value: upload.transactionCount,  color: 'rgba(255,255,255,0.85)', Icon: Minus },
              ].map(({ label, value, color, Icon }) => (
                <div key={label} style={{ borderRadius: 18, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', padding: '18px 20px' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.4)', margin: 0 }}>{label}</p>
                  <p style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', color, marginTop: 10, marginBottom: 0 }}>{value}</p>
                </div>
              ))}
            </div>

            {/* Income / Spending / Net — only if scan data available */}
            {catBreakdown.length > 0 && (
              <div style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', overflow: 'hidden' }}>
                <div style={{ padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(148,196,255,0.7)', margin: 0 }}>Overview</p>
                  <h2 style={{ fontSize: 18, fontWeight: 700, color: '#fff', margin: '6px 0 0' }}>Month at a glance</h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 0 }}>
                  {[
                    { label: 'Income',   value: fmtPie(incomeTotal),   color: '#34d399' },
                    { label: 'Spending', value: fmtPie(spendingTotal), color: '#f87171' },
                    { label: 'Net',      value: (netTotal >= 0 ? '+' : '') + fmtPie(netTotal), color: netTotal >= 0 ? '#34d399' : '#f87171' },
                  ].map(({ label, value, color }, i) => (
                    <div key={label} style={{ padding: '18px 20px', borderRight: i < 2 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', margin: 0 }}>{label}</p>
                      <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.02em', color, marginTop: 8, marginBottom: 0 }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reconciliation */}
            <ReconciliationPanel report={upload.reconciliationReport} status={reconStatus} />

            {/* Issues */}
            {allIssues.length > 0 || loadingIssues ? (
              <section style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h2 style={{ fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.9)', margin: 0 }}>Issues</h2>
                  <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 10, padding: 3 }}>
                    {(['open', 'resolved'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => setTab(t)}
                        style={{
                          padding: '4px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: 'none',
                          background: tab === t ? 'rgba(108,124,255,0.85)' : 'transparent',
                          color: tab === t ? '#fff' : 'rgba(255,255,255,0.45)',
                        }}
                      >
                        {t === 'open' ? `Open${openIssues.length > 0 ? ` (${openIssues.length})` : ''}` : `Resolved${resolvedIssues.length > 0 ? ` (${resolvedIssues.length})` : ''}`}
                      </button>
                    ))}
                  </div>
                </div>
                {loadingIssues ? (
                  <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
                    <Loader2 size={24} className="animate-spin" style={{ color: 'rgba(255,255,255,0.3)' }}/>
                  </div>
                ) : displayIssues.length === 0 ? (
                  <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.35)', textAlign: 'center', padding: '16px 0' }}>
                    {tab === 'open' ? 'No open issues — all clear!' : 'No resolved issues yet.'}
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {displayIssues.map(issue => (
                      <IssueCard
                        key={issue.id}
                        issue={issue}
                        onResolve={(issueId, resolved) => resolveMutation.mutate({ issueId, resolved })}
                        resolving={resolvingId === issue.id}
                      />
                    ))}
                  </div>
                )}
              </section>
            ) : (
              <div style={{ borderRadius: 20, border: '1px solid rgba(52,211,153,0.2)', background: 'rgba(52,211,153,0.06)', padding: '20px 24px', display: 'flex', alignItems: 'center', gap: 12 }}>
                <CheckCircle2 size={22} style={{ color: '#34d399', flexShrink: 0 }}/>
                <div>
                  <p style={{ fontWeight: 700, color: '#34d399', fontSize: 14, margin: 0 }}>No issues found</p>
                  <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '3px 0 0' }}>Clean upload — no ambiguous dates, duplicates, or balance breaks.</p>
                </div>
              </div>
            )}

            {/* Spending pie chart */}
            {spendingBreakdown.length > 0 && (() => {
              const totalSpend = spendingBreakdown.reduce((s, c) => s + Math.abs(c.total), 0)
              const visibleData = (showAllCats ? spendingBreakdown : spendingBreakdown.slice(0, 8)).map((c, i) => ({
                name: c.category, value: Math.abs(c.total), color: getCatColor(c.category, i), pct: c.pct, total: c.total,
              }))
              const pieData = spendingBreakdown.slice(0, 8).map((c, i) => ({
                name: c.category, value: Math.abs(c.total), color: getCatColor(c.category, i),
              }))
              return (
                <section style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', padding: '20px 24px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div>
                      <h2 style={{ fontWeight: 700, fontSize: 15, color: 'rgba(255,255,255,0.9)', margin: 0 }}>Spending by Category</h2>
                      <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 3 }}>
                        Total spend: <strong style={{ color: 'rgba(255,255,255,0.6)' }}>{fmtPie(totalSpend)}</strong>
                      </p>
                    </div>
                    <button
                      onClick={() => router.push(`/categorize/${id}`)}
                      style={{ fontSize: 12, fontWeight: 700, color: 'rgba(108,124,255,0.9)', background: 'none', border: 'none', cursor: 'pointer' }}
                    >
                      Categorize →
                    </button>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <ResponsiveContainer width="100%" height={200}>
                      <PieChart>
                        <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                          {pieData.map((entry, i) => <Cell key={i} fill={entry.color} stroke="transparent" />)}
                        </Pie>
                        <Tooltip
                          formatter={(value: number, name: string) => [fmtPie(value), name]}
                          contentStyle={{ background: 'rgba(10,15,30,0.95)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, fontSize: 12, color: '#fff' }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>Spend</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{fmtPie(totalSpend)}</span>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                    {visibleData.map((c, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, background: c.color }} />
                        <span style={{ flex: 1, color: 'rgba(255,255,255,0.7)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
                        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 12 }}>{fmtPie(c.total)}</span>
                        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, width: 30, textAlign: 'right' }}>{c.pct}%</span>
                      </div>
                    ))}
                  </div>
                  {spendingBreakdown.length > 8 && (
                    <button
                      onClick={() => setShowAllCats(s => !s)}
                      style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', background: 'none', border: 'none', cursor: 'pointer', marginTop: 8, width: '100%', textAlign: 'center' }}
                    >
                      {showAllCats ? 'Show fewer' : `View all ${spendingBreakdown.length} categories`}
                    </button>
                  )}
                </section>
              )
            })()}
          </div>

          {/* ── RIGHT sidebar ───────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Categorize CTA */}
            <section style={{ borderRadius: 20, border: '1px solid rgba(108,124,255,0.25)', background: 'linear-gradient(135deg,rgba(108,124,255,0.12),rgba(135,148,255,0.08))', padding: '22px 24px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 14 }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(148,196,255,0.7)', margin: 0 }}>Categorization</p>
                  <h3 style={{ fontSize: 17, fontWeight: 700, color: '#fff', margin: '6px 0 0' }}>
                    {upload.totalRowsUnresolved === 0 ? 'All categorized' : `${upload.rowCountAccepted - upload.totalRowsUnresolved} of ${upload.rowCountAccepted}`}
                  </h3>
                </div>
                <div style={{
                  borderRadius: 10, padding: '6px 12px', fontSize: 14, fontWeight: 700,
                  background: upload.totalRowsUnresolved === 0 ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)',
                  color: upload.totalRowsUnresolved === 0 ? '#34d399' : '#fbbf24',
                  border: `1px solid ${upload.totalRowsUnresolved === 0 ? 'rgba(52,211,153,0.25)' : 'rgba(251,191,36,0.25)'}`,
                }}>
                  {categorizedPct}%
                </div>
              </div>

              <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.08)', overflow: 'hidden', marginBottom: 14 }}>
                <div style={{
                  height: '100%', borderRadius: 999,
                  width: `${categorizedPct}%`,
                  background: categorizedPct === 100
                    ? 'linear-gradient(90deg,#34d399,#10b981)'
                    : 'linear-gradient(90deg,#6c7cff,#8794ff)',
                  transition: 'width 0.5s ease',
                }} />
              </div>

              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 16, lineHeight: 1.5 }}>
                {upload.totalRowsUnresolved === 0
                  ? 'Ready to generate full insights and Financial Autopsy.'
                  : 'Categorize to unlock Money Personality, Financial Autopsy, and anomaly detection.'}
              </p>

              <button
                onClick={() => router.push(`/categorize/${id}`)}
                style={{
                  width: '100%', borderRadius: 14, padding: '12px 0', fontSize: 14, fontWeight: 700,
                  background: 'linear-gradient(135deg,#6c7cff,#8794ff)',
                  color: '#fff', border: 'none', cursor: 'pointer',
                  boxShadow: '0 12px 32px rgba(108,124,255,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <Tags size={16}/>
                {upload.totalRowsUnresolved === 0 ? 'Review categories' : 'Categorize now →'}
              </button>
            </section>

            {/* Scan Report CTA */}
            <section style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.04)', padding: '22px 24px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.2em', color: 'rgba(255,255,255,0.35)', margin: '0 0 8px' }}>Full Report</p>
              <h3 style={{ fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.9)', margin: '0 0 8px' }}>Statement Scan Report</h3>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '0 0 16px', lineHeight: 1.5 }}>
                Full parse diagnostics, integrity checks, and pipeline lineage for this upload.
              </p>
              <button
                onClick={() => router.push(`/reports/${id}`)}
                style={{
                  width: '100%', borderRadius: 12, padding: '10px 0', fontSize: 13, fontWeight: 700,
                  background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.8)',
                  border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}
              >
                <FileText size={15}/> View Scan Report
              </button>
            </section>

            {/* Parser details */}
            <section style={{ borderRadius: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.02)', overflow: 'hidden' }}>
              <button
                onClick={() => setShowParserDetails(s => !s)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                <p style={{ fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Parser details</p>
                {showParserDetails
                  ? <ChevronDown size={14} style={{ color: 'rgba(255,255,255,0.3)' }}/>
                  : <ChevronRight size={14} style={{ color: 'rgba(255,255,255,0.3)' }}/>}
              </button>
              {showParserDetails && (
                <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
                  <p>Parser: <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{upload.parserVersion}</strong></p>
                  <p>Raw rows: <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{upload.rowCountRaw}</strong> · Parsed: <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{upload.rowCountParsed}</strong></p>
                  {upload.statementOpenBalance  && <p>Open balance:  <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtAmt(upload.statementOpenBalance)}</strong></p>}
                  {upload.statementCloseBalance && <p>Close balance: <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtAmt(upload.statementCloseBalance)}</strong></p>}
                  {upload.statementTotalCredits && <p>Credits:  <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtAmt(upload.statementTotalCredits)}</strong></p>}
                  {upload.statementTotalDebits  && <p>Debits:   <strong style={{ color: 'rgba(255,255,255,0.7)' }}>{fmtAmt(upload.statementTotalDebits)}</strong></p>}
                  {upload.warnings.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <p style={{ fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>Parser warnings ({upload.warnings.length})</p>
                      {upload.warnings.slice(0, 10).map((w, i) => (
                        <p key={i} style={{ color: 'rgba(251,191,36,0.7)', fontSize: 11 }}>Row {w.rowIndex ?? '—'}: {w.message}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* Danger Zone */}
            <section style={{ borderRadius: 20, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.04)', padding: '18px 22px' }}>
              <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.18em', color: 'rgba(239,68,68,0.7)', margin: '0 0 10px' }}>Danger Zone</p>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,0.8)', margin: 0 }}>Delete this upload</p>
                  <p style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)', marginTop: 4 }}>
                    Removes {upload.transactionCount} transactions permanently.
                  </p>
                </div>
                <button
                  onClick={() => setConfirmDelete(true)}
                  style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.1)', color: '#f87171', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  <Trash2 size={13}/> Delete
                </button>
              </div>
            </section>

          </div>
        </div>
      </main>

      {/* ── Delete confirmation modal ────────────────────────────────────── */}
      {confirmDelete && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)', padding: 16 }}>
          <div style={{ borderRadius: 24, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(10,15,28,0.97)', maxWidth: 420, width: '100%', padding: '28px 28px 24px', boxShadow: '0 32px 80px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
              <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Trash2 size={18} style={{ color: '#f87171' }} />
              </div>
              <div>
                <h3 style={{ fontWeight: 700, color: '#fff', margin: 0, fontSize: 16 }}>Delete upload?</h3>
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', margin: '3px 0 0' }}>{upload.filename}</p>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, marginBottom: 20 }}>
              This will permanently delete <strong style={{ color: 'rgba(255,255,255,0.85)' }}>{upload.transactionCount} transactions</strong> and all associated reconciliation data. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
                style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.06)', fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.7)', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: '#dc2626', fontSize: 13, fontWeight: 700, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, opacity: deleteMutation.isPending ? 0.6 : 1 }}
              >
                {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
            {deleteMutation.isError && (
              <p style={{ fontSize: 12, color: '#f87171', textAlign: 'center', marginTop: 10 }}>Delete failed — please try again.</p>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}
