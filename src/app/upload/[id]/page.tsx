'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Calendar, CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, ChevronDown, ChevronRight, Trash2, FileText, Tags } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { format } from 'date-fns'
import { ReconciliationShield } from '@/components/ReconciliationShield'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'

// ─── Category colors (matches CATEGORY_STYLES in summaries.ts) ───────────────

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
const FALLBACK_COLORS = ['#6c7cff','#34d399','#fb923c','#8794ff','#60a5fa','#f472b6']
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
  // v2 fields
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

/** Format a check expected/actual value — only currency-format if it's a pure number string */
function fmtCheckValue(s: string | null | undefined): string {
  if (s == null) return '—'
  const n = Number(s)
  if (!isNaN(n) && s.trim() !== '') return fmtAmt(n)
  return s
}

const ISSUE_SEVERITY: Record<string, { cls: string; icon: React.ReactNode }> = {
  ERROR:   { cls: 'bg-red-100 text-red-700',    icon: <AlertCircle size={12}/> },
  WARNING: { cls: 'bg-yellow-100 text-yellow-700', icon: <AlertTriangle size={12}/> },
  INFO:    { cls: 'bg-blue-100 text-blue-700',   icon: <Info size={12}/> },
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

function StatChip({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex-1 min-w-0">
      <p className={clsx('text-xs font-semibold uppercase tracking-wide', accent ?? 'text-slate-500')}>{label}</p>
      <p className={clsx('text-xl font-black mt-0.5', accent ?? 'text-slate-800')}>{value}</p>
    </div>
  )
}

function ReconciliationPanel({ report, status }: { report: ReconciliationReport | null; status: string }) {
  const [open, setOpen]             = useState(true)
  const [showAllBreaks, setShowAll] = useState(false)

  const recon   = report?.reconciliation
  const delta   = recon?.deltaStats
  const breaks  = recon?.discrepancies.filter(d => d.type === 'BALANCE_CHAIN_BREAK') ?? []
  const PREVIEW = 5

  return (
    <section className="card space-y-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between"
      >
        <h2 className="font-bold text-slate-700 flex items-center gap-2">
          Statement Integrity
          <ReconciliationShield status={status} size="sm" />
        </h2>
        {open ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>}
      </button>

      {open && report && recon && (
        <div className="space-y-4">

          {/* ── Summary strip ───────────────────────────────────────────── */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            <div className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-slate-500 uppercase font-semibold tracking-wide text-[10px]">Mode</p>
              <p className="font-bold text-slate-700 mt-0.5">{MODE_LABEL[recon.mode] ?? recon.mode}</p>
            </div>
            {recon.balanceModel && (
              <div className={clsx('rounded-lg px-3 py-2', recon.needsReview ? 'bg-amber-50' : 'bg-slate-50')}>
                <p className="text-slate-500 uppercase font-semibold tracking-wide text-[10px]">Balance Model</p>
                <p className={clsx('font-bold mt-0.5', recon.needsReview ? 'text-amber-700' : 'text-slate-700')}>
                  {recon.balanceModel === 'AFTER' ? 'After transaction' : 'Before transaction'}
                  {recon.needsReview && ' ⚠'}
                </p>
              </div>
            )}
            {typeof recon.rowsReordered === 'number' && (
              <div className="bg-slate-50 rounded-lg px-3 py-2">
                <p className="text-slate-500 uppercase font-semibold tracking-wide text-[10px]">Reordered</p>
                <p className="font-bold text-slate-700 mt-0.5">
                  {recon.rowsReordered === 0 ? 'No (already sorted)' : `${recon.rowsReordered} rows`}
                </p>
              </div>
            )}
            {report.periodStart && report.periodEnd && (
              <div className="bg-slate-50 rounded-lg px-3 py-2 col-span-2 sm:col-span-1">
                <p className="text-slate-500 uppercase font-semibold tracking-wide text-[10px]">Period</p>
                <p className="font-bold text-slate-700 mt-0.5">{fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}</p>
              </div>
            )}
          </div>

          {/* ── Sums ────────────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-3 text-sm">
            {([
              ['Credits', report.sums.totalCredits,  'text-green-700'],
              ['Debits',  report.sums.totalDebits,   'text-red-700'],
              ['Net',     report.sums.netChange,      'text-slate-800'],
            ] as [string, string, string][]).map(([label, val, cls]) => (
              <div key={label} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs uppercase text-slate-500 font-semibold">{label}</p>
                <p className={clsx('font-bold mt-0.5', cls)}>{fmtAmt(val)}</p>
              </div>
            ))}
          </div>

          {/* ── Balance range (Mode A) ───────────────────────────────────── */}
          {(recon.summary.startBalance || recon.summary.endBalance) && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Opening Balance', recon.summary.startBalance],
                ['Closing Balance', recon.summary.endBalance],
              ].map(([label, val]) => val && (
                <div key={label} className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs uppercase text-slate-500 font-semibold">{label}</p>
                  <p className="font-bold text-slate-800 mt-0.5">{fmtAmt(val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* ── Checks ──────────────────────────────────────────────────── */}
          {recon.checks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase text-slate-500">Checks</p>
              {recon.checks.map((c, i) => (
                <div key={i} className={clsx('flex items-start gap-2 text-sm rounded-lg px-3 py-2',
                  c.passed ? 'bg-green-50' : 'bg-red-50'
                )}>
                  {c.passed
                    ? <CheckCircle2 size={14} className="text-green-600 mt-0.5 flex-shrink-0"/>
                    : <AlertCircle  size={14} className="text-red-500 mt-0.5 flex-shrink-0"/>
                  }
                  <div className="min-w-0">
                    <p className={clsx('font-medium', c.passed ? 'text-green-800' : 'text-red-800')}>{c.name}</p>
                    {!c.passed && c.expected != null && c.actual != null && (
                      <p className="text-xs text-red-600 mt-0.5">
                        Expected {fmtCheckValue(c.expected)} · Got {fmtCheckValue(c.actual)}
                      </p>
                    )}
                    {c.details && <p className="text-xs text-slate-500 mt-0.5">{c.details}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Constant-offset banner ──────────────────────────────────── */}
          {delta?.isConstantOffset && delta.offsetValue && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-600 flex-shrink-0" />
                <p className="text-sm font-semibold text-amber-800">Constant offset detected</p>
              </div>
              <p className="text-sm text-amber-700">
                All {delta.offsetCount} balance breaks share the same delta ({fmtAmt(delta.offsetValue)}).
                This usually means the statement export started mid-period — transactions before the
                export window are missing, causing a systematic offset.
              </p>
              <p className="text-xs text-amber-600 font-medium">
                To resolve: re-export starting from an earlier date, or set the opening balance below.
              </p>
            </div>
          )}

          {/* ── Discrepancy list ────────────────────────────────────────── */}
          {breaks.length > 0 && !delta?.isConstantOffset && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase text-red-500">
                {breaks.length} Balance Break{breaks.length !== 1 ? 's' : ''}
              </p>
              {(showAllBreaks ? breaks : breaks.slice(0, PREVIEW)).map((d, i) => (
                <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-800">
                  <p className="font-medium">{d.description}</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Expected {fmtAmt(d.expected)} · Got {fmtAmt(d.actual)} · delta {fmtAmt(d.magnitude)}
                    {d.rowIndex != null && ` · Position ${d.rowIndex + 1}`}
                  </p>
                </div>
              ))}
              {breaks.length > PREVIEW && (
                <button
                  onClick={() => setShowAll(s => !s)}
                  className="text-xs text-slate-500 hover:text-slate-700 underline transition"
                >
                  {showAllBreaks ? 'Show fewer' : `Show all ${breaks.length} breaks`}
                </button>
              )}
            </div>
          )}

          {/* ── All-constant-offset: collapsed discrepancy list ─────────── */}
          {breaks.length > 0 && delta?.isConstantOffset && (
            <div className="space-y-1.5">
              <button
                onClick={() => setShowAll(s => !s)}
                className="text-xs text-slate-500 hover:text-slate-700 underline transition"
              >
                {showAllBreaks ? 'Hide individual breaks' : `Show all ${breaks.length} breaks (same delta)`}
              </button>
              {showAllBreaks && (showAllBreaks ? breaks : breaks.slice(0, PREVIEW)).map((d, i) => (
                <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-800">
                  <span className="font-mono">pos {(d.rowIndex ?? 0) + 1}</span>{' '}
                  {fmtAmt(d.expected)} → {fmtAmt(d.actual)}
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      {open && !report && (
        <p className="text-sm text-slate-400">No reconciliation report available.</p>
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
  const sevCfg  = ISSUE_SEVERITY[issue.severity]  ?? ISSUE_SEVERITY.INFO
  const typeLabel = ISSUE_TYPE_LABEL[issue.issueType] ?? issue.issueType

  return (
    <div className={clsx(
      'border rounded-xl p-4 space-y-2 transition',
      issue.resolved ? 'border-slate-100 bg-slate-50/50 opacity-70' : 'border-slate-200 bg-white'
    )}>
      <div className="flex items-start gap-2">
        {/* Badges */}
        <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0', sevCfg.cls)}>
          {sevCfg.icon}{issue.severity}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs font-medium flex-shrink-0">
          {typeLabel}
        </span>
        <div className="flex-1"/>
        <button
          disabled={resolving}
          onClick={() => onResolve(issue.id, !issue.resolved)}
          className={clsx(
            'text-xs font-semibold px-3 py-1 rounded-lg transition flex items-center gap-1 flex-shrink-0',
            issue.resolved
              ? 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              : 'bg-accent-500 text-white hover:bg-accent-600'
          )}
        >
          {resolving ? <Loader2 size={12} className="animate-spin"/> : null}
          {issue.resolved ? 'Re-open' : 'Mark resolved'}
        </button>
      </div>

      <p className="text-sm text-slate-700">{issue.description}</p>

      {issue.suggestedAction && (
        <p className="text-xs text-slate-500 italic">{issue.suggestedAction}</p>
      )}

      {/* Transaction context */}
      {issue.transaction && (
        <div className="mt-1 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs text-slate-600 flex flex-wrap gap-x-4 gap-y-0.5">
          <span><strong>Date:</strong> {fmtDate(issue.transaction.date)}</span>
          <span><strong>Desc:</strong> {issue.transaction.description}</span>
          <span className={clsx('font-mono', issue.transaction.amount < 0 ? 'text-red-600' : 'text-green-700')}>
            {fmtAmt(issue.transaction.amount)}
          </span>
          {issue.transaction.dateAmbiguity === 'AMBIGUOUS_MMDD_DDMM' && (
            <span className="text-amber-600">
              MM/DD: {fmtDate(issue.transaction.dateInterpretationA)} · DD/MM: {fmtDate(issue.transaction.dateInterpretationB)}
            </span>
          )}
        </div>
      )}

      {issue.resolved && issue.resolvedAt && (
        <p className="text-xs text-slate-400">
          Resolved {issue.resolvedBy === 'USER' ? 'by you' : 'automatically'} on {fmtDate(issue.resolvedAt)}
        </p>
      )}
    </div>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function UploadDetailPage() {
  const { id }       = useParams<{ id: string }>()
  const router       = useRouter()
  const user         = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc           = useQueryClient()

  const [tab, setTab] = useState<'open' | 'resolved'>('open')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [pendingOrder, setPendingOrder] = useState<'MDY' | 'DMY' | null>(null)
  const [showAllCats, setShowAllCats] = useState(false)

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
  const openIssues     = allIssues.filter(i => !i.resolved)
  const resolvedIssues = allIssues.filter(i =>  i.resolved)

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
    onError: () => {
      setPendingOrder(null)
    },
  })

  // Legacy mutation for pre-v2 uploads that still have per-row DATE_AMBIGUOUS issues
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
    onError: () => {
      setPendingOrder(null)
    },
  })

  if (!user) return null

  if (loadingUpload) {
    return (
      <AppShell>
        <main className="max-w-2xl mx-auto px-4 py-8 flex justify-center">
          <Loader2 size={32} className="animate-spin text-slate-400"/>
        </main>
      </AppShell>
    )
  }

  if (!upload) {
    return (
      <AppShell>
        <main className="max-w-2xl mx-auto px-4 py-8">
          <p className="text-slate-500">Upload not found.</p>
        </main>
      </AppShell>
    )
  }

  const reconStatus = upload.reconciliationStatus
  const displayIssues = tab === 'open' ? openIssues : resolvedIssues

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-4 py-8 pb-24 space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div>
          <button
            onClick={() => router.push('/upload')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3 transition"
          >
            <ArrowLeft size={14}/> Back to uploads
          </button>

          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black text-slate-800 truncate">{upload.filename}</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {upload.account.name} · Uploaded {fmtDate(upload.createdAt)}
                {upload.formatDetected && <> · {upload.formatDetected}</>}
              </p>
            </div>
            <ReconciliationShield status={reconStatus} size="md" />
          </div>
        </div>

        {/* ── Stats row ──────────────────────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap">
          <StatChip label="Imported"   value={upload.rowCountAccepted}    accent="text-green-700"/>
          <StatChip label="Rejected"   value={upload.rowCountRejected}    accent={upload.rowCountRejected   > 0 ? 'text-red-600'    : undefined}/>
          <StatChip label="Unresolved" value={upload.totalRowsUnresolved} accent={upload.totalRowsUnresolved > 0 ? 'text-amber-600'  : undefined}/>
          {upload.issueBreakdown.byType['POSSIBLE_DUPLICATE'] != null && (
            <StatChip label="Duplicates" value={upload.issueBreakdown.byType['POSSIBLE_DUPLICATE']} accent="text-purple-600"/>
          )}
        </div>

        {/* ── Scan Report CTA ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => router.push(`/reports/${id}`)}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold transition"
            style={{ background: 'linear-gradient(135deg,#6c7cff,#8794ff)', color: '#fff', border: 'none', cursor: 'pointer' }}
          >
            <FileText size={16} />
            View Scan Report
          </button>
          <button
            onClick={() => router.push('/categorize')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition"
          >
            <Tags size={16} />
            Categorize
          </button>
        </div>

        {/* ── Date range ─────────────────────────────────────────────────── */}
        {upload.dateRangeStart && upload.dateRangeEnd && (
          <div className="text-sm text-slate-500">
            Statement period: <strong className="text-slate-700">{fmtDate(upload.dateRangeStart)} – {fmtDate(upload.dateRangeEnd)}</strong>
          </div>
        )}

        {/* ── Reconciliation ─────────────────────────────────────────────── */}
        <ReconciliationPanel report={upload.reconciliationReport} status={reconStatus}/>

        {/* ── Issues ─────────────────────────────────────────────────────── */}
        {allIssues.length > 0 || loadingIssues ? (
          <section className="card space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-slate-700">Issues</h2>
              <div className="flex gap-1 bg-slate-100 rounded-lg p-0.5 text-xs">
                <button
                  onClick={() => setTab('open')}
                  className={clsx('px-3 py-1 rounded-md font-semibold transition',
                    tab === 'open' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  Open{openIssues.length > 0 && ` (${openIssues.length})`}
                </button>
                <button
                  onClick={() => setTab('resolved')}
                  className={clsx('px-3 py-1 rounded-md font-semibold transition',
                    tab === 'resolved' ? 'bg-white shadow text-slate-800' : 'text-slate-500 hover:text-slate-700'
                  )}
                >
                  Resolved{resolvedIssues.length > 0 && ` (${resolvedIssues.length})`}
                </button>
              </div>
            </div>

            {loadingIssues ? (
              <div className="flex justify-center py-6">
                <Loader2 size={24} className="animate-spin text-slate-400"/>
              </div>
            ) : displayIssues.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">
                {tab === 'open' ? 'No open issues — all clear!' : 'No resolved issues yet.'}
              </p>
            ) : (
              <div className="space-y-2">
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
          <div className="card text-center py-6">
            <CheckCircle2 size={28} className="mx-auto text-green-500 mb-2"/>
            <p className="font-semibold text-green-800">No issues found</p>
            <p className="text-sm text-slate-400 mt-1">This upload was clean — no ambiguous dates, duplicates, or balance breaks.</p>
          </div>
        )}

        {/* ── Spending by category pie ────────────────────────────────────── */}
        {spendingBreakdown.length > 0 && (() => {
          const totalSpend = spendingBreakdown.reduce((s, c) => s + Math.abs(c.total), 0)
          const visibleData = (showAllCats ? spendingBreakdown : spendingBreakdown.slice(0, 8)).map((c, i) => ({
            name:  c.category,
            value: Math.abs(c.total),
            color: getCatColor(c.category, i),
            pct:   c.pct,
            total: c.total,
          }))
          // For the pie chart we always use top 8 slices; legend shows the expanded list
          const pieData = spendingBreakdown.slice(0, 8).map((c, i) => ({
            name: c.category, value: Math.abs(c.total), color: getCatColor(c.category, i),
          }))
          return (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-bold text-slate-700">Spending by Category</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Total spend: <strong className="text-slate-600">{fmtPie(totalSpend)}</strong></p>
                </div>
                <button
                  onClick={() => router.push('/categorize')}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
                >
                  Categorize →
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2} dataKey="value">
                      {pieData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} stroke="transparent" />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [fmtPie(value), name]}
                      contentStyle={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                {/* Center label */}
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
                  <span className="text-xs text-slate-400">Spend</span>
                  <span className="text-sm font-bold text-slate-700">{fmtPie(totalSpend)}</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {visibleData.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
                    <span className="flex-1 text-slate-700 truncate">{c.name}</span>
                    <span className="text-slate-500 text-xs">{fmtPie(c.total)}</span>
                    <span className="text-slate-400 text-xs w-8 text-right">{c.pct}%</span>
                  </div>
                ))}
              </div>
              {spendingBreakdown.length > 8 && (
                <button
                  onClick={() => setShowAllCats(s => !s)}
                  className="text-xs text-slate-500 hover:text-slate-700 underline transition w-full text-center"
                >
                  {showAllCats ? 'Show fewer' : `View all ${spendingBreakdown.length} categories`}
                </button>
              )}
            </div>
          )
        })()}

        {/* ── Parser metadata ─────────────────────────────────────────────── */}
        <details className="card text-sm text-slate-500">
          <summary className="font-semibold text-slate-600 cursor-pointer select-none">Parser details</summary>
          <div className="mt-3 space-y-1 pl-2">
            <p>Parser version: <strong className="text-slate-700">{upload.parserVersion}</strong></p>
            <p>Raw rows: <strong className="text-slate-700">{upload.rowCountRaw}</strong> · Parsed: <strong className="text-slate-700">{upload.rowCountParsed}</strong></p>
            {upload.statementOpenBalance  && <p>Statement open:  <strong className="text-slate-700">{fmtAmt(upload.statementOpenBalance)}</strong></p>}
            {upload.statementCloseBalance && <p>Statement close: <strong className="text-slate-700">{fmtAmt(upload.statementCloseBalance)}</strong></p>}
            {upload.statementTotalCredits && <p>Declared credits: <strong className="text-slate-700">{fmtAmt(upload.statementTotalCredits)}</strong></p>}
            {upload.statementTotalDebits  && <p>Declared debits:  <strong className="text-slate-700">{fmtAmt(upload.statementTotalDebits)}</strong></p>}
            {upload.warnings.length > 0 && (
              <div className="mt-2">
                <p className="font-semibold text-amber-600 mb-1">Parser warnings ({upload.warnings.length})</p>
                <ul className="space-y-0.5 text-xs">
                  {upload.warnings.slice(0, 10).map((w, i) => (
                    <li key={i} className="text-amber-700">Row {w.rowIndex ?? '—'}: {w.message}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </details>

        {/* ── Danger Zone ──────────────────────────────────────────────────── */}
        <section className="border border-red-200 rounded-xl p-5 space-y-3">
          <h2 className="text-sm font-semibold text-red-600 uppercase tracking-wide">Danger Zone</h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-slate-800">Delete this upload</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Permanently removes this upload and all {upload.transactionCount} associated transactions.
                Month summaries will be recomputed. This cannot be undone.
              </p>
            </div>
            <button
              onClick={() => setConfirmDelete(true)}
              className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-white border border-red-300 text-red-600 hover:bg-red-50 font-semibold rounded-lg text-sm transition"
            >
              <Trash2 size={14} /> Delete
            </button>
          </div>
        </section>

      </main>

      {/* ── Delete confirmation modal ─────────────────────────────────── */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-600" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900">Delete upload?</h3>
                <p className="text-sm text-slate-500">{upload.filename}</p>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              This will permanently delete <strong>{upload.transactionCount} transactions</strong> and all
              associated reconciliation data. Month summaries will be updated. This cannot be undone.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-sm font-semibold transition flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {deleteMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                {deleteMutation.isPending ? 'Deleting…' : 'Delete permanently'}
              </button>
            </div>
            {deleteMutation.isError && (
              <p className="text-xs text-red-600 text-center">
                Delete failed — please try again.
              </p>
            )}
          </div>
        </div>
      )}
    </AppShell>
  )
}
