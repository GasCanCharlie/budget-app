'use client'

import { useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, ChevronDown, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { format } from 'date-fns'

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

const RECON_STATUS: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  PASS:               { cls: 'bg-green-100 text-green-800 border-green-200',   label: 'Balanced',         icon: <CheckCircle2 size={14}/> },
  PASS_WITH_WARNINGS: { cls: 'bg-yellow-100 text-yellow-800 border-yellow-200', label: 'Balanced w/ warnings', icon: <AlertTriangle size={14}/> },
  FAIL:               { cls: 'bg-red-100 text-red-800 border-red-200',         label: 'Mismatch detected', icon: <AlertCircle size={14}/> },
  UNVERIFIABLE:       { cls: 'bg-slate-100 text-slate-600 border-slate-200',   label: 'Unverifiable',     icon: <Info size={14}/> },
  PENDING:            { cls: 'bg-blue-100 text-blue-800 border-blue-200',      label: 'Pending',          icon: <Loader2 size={14}/> },
}

const ISSUE_SEVERITY: Record<string, { cls: string; icon: React.ReactNode }> = {
  ERROR:   { cls: 'bg-red-100 text-red-700',    icon: <AlertCircle size={12}/> },
  WARNING: { cls: 'bg-yellow-100 text-yellow-700', icon: <AlertTriangle size={12}/> },
  INFO:    { cls: 'bg-blue-100 text-blue-700',   icon: <Info size={12}/> },
}

const ISSUE_TYPE_LABEL: Record<string, string> = {
  DATE_AMBIGUOUS:          'Ambiguous Date',
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
  const [open, setOpen] = useState(true)
  const cfg = RECON_STATUS[status] ?? RECON_STATUS.UNVERIFIABLE

  return (
    <section className="card space-y-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between"
      >
        <h2 className="font-bold text-slate-700 flex items-center gap-2">
          Reconciliation
          <span className={clsx('inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-semibold', cfg.cls)}>
            {cfg.icon}{cfg.label}
          </span>
        </h2>
        {open ? <ChevronDown size={16} className="text-slate-400"/> : <ChevronRight size={16} className="text-slate-400"/>}
      </button>

      {open && report && (
        <div className="space-y-4">
          {/* Mode + period */}
          <div className="flex flex-wrap gap-3 text-sm text-slate-500">
            <span>Mode: <strong className="text-slate-700">{MODE_LABEL[report.reconciliation.mode] ?? report.reconciliation.mode}</strong></span>
            {report.periodStart && report.periodEnd && (
              <span>Period: <strong className="text-slate-700">{fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}</strong></span>
            )}
          </div>

          {/* Sums */}
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

          {/* Balance range (Mode A) */}
          {(report.reconciliation.summary.startBalance || report.reconciliation.summary.endBalance) && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ['Opening Balance', report.reconciliation.summary.startBalance],
                ['Closing Balance', report.reconciliation.summary.endBalance],
              ].map(([label, val]) => val && (
                <div key={label} className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs uppercase text-slate-500 font-semibold">{label}</p>
                  <p className="font-bold text-slate-800 mt-0.5">{fmtAmt(val)}</p>
                </div>
              ))}
            </div>
          )}

          {/* Checks */}
          {report.reconciliation.checks.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase text-slate-500">Checks</p>
              {report.reconciliation.checks.map((c, i) => (
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
                        Expected {fmtAmt(c.expected)} · Got {fmtAmt(c.actual)}
                      </p>
                    )}
                    {c.details && <p className="text-xs text-slate-500 mt-0.5">{c.details}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Discrepancies */}
          {report.reconciliation.discrepancies.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase text-red-500">
                {report.reconciliation.discrepancies.length} Discrepanc{report.reconciliation.discrepancies.length === 1 ? 'y' : 'ies'}
              </p>
              {report.reconciliation.discrepancies.map((d, i) => (
                <div key={i} className="bg-red-50 border border-red-100 rounded-lg px-3 py-2 text-sm text-red-800">
                  <p className="font-medium">{d.description}</p>
                  <p className="text-xs text-red-600 mt-0.5">
                    Expected {fmtAmt(d.expected)} · Got {fmtAmt(d.actual)}
                    {d.rowIndex != null && ` · Row ${d.rowIndex + 1}`}
                  </p>
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
  const reconCfg    = RECON_STATUS[reconStatus] ?? RECON_STATUS.UNVERIFIABLE
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
            <span className={clsx(
              'inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-semibold flex-shrink-0',
              reconCfg.cls
            )}>
              {reconCfg.icon}{reconCfg.label}
            </span>
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

      </main>
    </AppShell>
  )
}
