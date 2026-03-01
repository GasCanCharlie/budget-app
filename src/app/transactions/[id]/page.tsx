'use client'

import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, CheckCircle2, AlertCircle, AlertTriangle, Info, Loader2, ExternalLink } from 'lucide-react'
import { CategoryIcon } from '@/components/CategoryIcon'
import { format } from 'date-fns'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

// ─── Types ────────────────────────────────────────────────────────────────────

interface TransformationStep {
  field:     string
  rule:      string
  before:    string
  after:     string
  timestamp: string
}

interface IngestionIssue {
  id:              string
  issueType:       string
  severity:        string
  description:     string
  suggestedAction: string | null
  resolved:        boolean
  resolvedBy:      string | null
  resolvedAt:      string | null
}

interface HistoryEntry {
  oldCategory: { name: string; icon: string } | null
  newCategory: { name: string; icon: string }
  changedBy:   string
  changedAt:   string
}

interface TxDetail {
  id:                   string
  date:                 string
  description:          string
  merchantNormalized:   string
  amount:               number
  isTransfer:           boolean
  isExcluded:           boolean
  isForeignCurrency:    boolean
  foreignAmount:        string | null
  foreignCurrency:      string | null
  reviewedByUser:       boolean
  categorizationSource: string
  confidenceScore:      number
  category:             { id: string; name: string; color: string; icon: string } | null
  // Date lineage
  postedDate:           string | null
  transactionDate:      string | null
  dateRaw:              string | null
  dateAmbiguity:        string
  dateInterpretationA:  string | null
  dateInterpretationB:  string | null
  // Amount lineage
  amountRaw:            string | null
  currencyCode:         string
  currencyDetected:     boolean
  // Description lineage
  descriptionRaw:       string
  descriptionNormalized: string | null
  // Ingestion
  ingestionStatus:      string
  isPossibleDuplicate:  boolean
  bankFingerprint:      string
  // Balance chain
  runningBalance:       string | null
  runningBalanceRaw:    string | null
  balanceChainValid:    boolean | null
  balanceChainExpected: string | null
  balanceChainActual:   string | null
  // Metadata
  checkNumber:          string | null
  bankTransactionId:    string | null
  pendingFlag:          boolean
  createdAt:            string
  updatedAt:            string
  // Relations
  account: { id: string; name: string; accountType: string }
  upload:  { id: string; filename: string; formatDetected: string } | null
  // Pipeline lineage
  transformations: TransformationStep[]
  sourceLocator:   Record<string, unknown> | null
  rawFields:       Record<string, string>
  raw: {
    id:             string
    rawDate:        string
    rawDescription: string
    rawAmount:      string
    rawBalance:     string
    rawLine:        string | null
    parseOrder:     number
  } | null
  history:         HistoryEntry[]
  ingestionIssues: IngestionIssue[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n))
}

function fmtDate(s: string | null | undefined) {
  if (!s) return '—'
  try { return format(new Date(s), 'MMM d, yyyy') } catch { return s }
}

function fmtDateTime(s: string | null | undefined) {
  if (!s) return '—'
  try { return format(new Date(s), 'MMM d, yyyy h:mm a') } catch { return s }
}

const SOURCE_LABELS: Record<string, string> = {
  rule: '⚙️ Rule',
  ai:   '🤖 AI',
  user: '✏️ You',
}

const RULE_LABELS: Record<string, string> = {
  STRIP_BOM:                   'Strip BOM',
  TRIM_WHITESPACE:             'Trim whitespace',
  COLLAPSE_WHITESPACE:         'Collapse whitespace',
  NORMALIZE_LINEBREAK:         'Normalize line breaks',
  STRIP_CURRENCY_SYMBOL:       'Strip currency symbol',
  STRIP_THOUSANDS_SEPARATOR:   'Strip thousands separator',
  PARSE_PARENTHETICAL_NEGATIVE: 'Parse parenthetical negative',
  PARSE_TRAILING_MINUS:        'Parse trailing minus',
  PARSE_EUROPEAN_DECIMAL:      'Parse European decimal',
  SPLIT_DEBIT_CREDIT_COLUMNS:  'Split debit/credit columns',
  DATE_RESOLVED_MM_DD:         'Date resolved as MM/DD',
  DATE_RESOLVED_DD_MM:         'Date resolved as DD/MM',
  DATE_RESOLVED_ISO:           'Date resolved as ISO',
  DATE_RESOLVED_YYYY_MM_DD:    'Date resolved as YYYY-MM-DD',
  MERGE_LINE_WRAP:             'Merge line wrap',
  STRIP_PENDING_FLAG:          'Strip pending flag',
}

const SEVERITY_CFG: Record<string, { cls: string; icon: React.ReactNode }> = {
  ERROR:   { cls: 'bg-red-50 border-red-200 text-red-800',       icon: <AlertCircle  size={14} className="text-red-500 flex-shrink-0 mt-0.5"/> },
  WARNING: { cls: 'bg-yellow-50 border-yellow-200 text-yellow-800', icon: <AlertTriangle size={14} className="text-yellow-500 flex-shrink-0 mt-0.5"/> },
  INFO:    { cls: 'bg-blue-50 border-blue-200 text-blue-800',     icon: <Info         size={14} className="text-blue-500 flex-shrink-0 mt-0.5"/> },
}

const STATUS_CFG: Record<string, { cls: string; label: string }> = {
  VALID:      { cls: 'bg-green-100 text-green-800',  label: 'Valid' },
  WARNING:    { cls: 'bg-yellow-100 text-yellow-800', label: 'Warning' },
  UNRESOLVED: { cls: 'bg-red-100 text-red-800',      label: 'Unresolved' },
  REJECTED:   { cls: 'bg-slate-100 text-slate-600',  label: 'Rejected' },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3">
      <h2 className="font-bold text-slate-700 text-sm uppercase tracking-wide">{title}</h2>
      {children}
    </section>
  )
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-slate-400 w-40 flex-shrink-0">{label}</span>
      <span className={clsx('text-slate-800 flex-1 min-w-0 break-all', mono && 'font-mono text-xs')}>{value ?? '—'}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransactionDetailPage() {
  const { id }       = useParams<{ id: string }>()
  const router       = useRouter()
  const user         = useAuthStore(s => s.user)
  const { apiFetch } = useApi()

  const { data, isLoading } = useQuery({
    queryKey: ['transaction', id],
    queryFn:  () => apiFetch(`/api/transactions/${id}`),
    enabled:  !!user && !!id,
  })
  const tx: TxDetail | undefined = data?.transaction

  if (!user) return null

  if (isLoading) {
    return (
      <AppShell>
        <main className="max-w-2xl mx-auto px-4 py-8 flex justify-center">
          <Loader2 size={32} className="animate-spin text-slate-400" />
        </main>
      </AppShell>
    )
  }

  if (!tx) {
    return (
      <AppShell>
        <main className="max-w-2xl mx-auto px-4 py-8">
          <p className="text-slate-500">Transaction not found.</p>
        </main>
      </AppShell>
    )
  }

  const statusCfg = STATUS_CFG[tx.ingestionStatus] ?? STATUS_CFG.VALID

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-4 py-8 pb-24 space-y-4">

        {/* ── Header ───────────────────────────────────────────────────── */}
        <div>
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-3 transition"
          >
            <ArrowLeft size={14}/> Back
          </button>

          <div className="flex items-start gap-3">
            <CategoryIcon name={tx.category?.icon ?? 'Package'} color={tx.category?.color} size={32} />
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-black text-slate-800 truncate">
                {tx.merchantNormalized?.trim() || tx.description?.trim() || <span className="text-slate-400 italic font-normal">No description</span>}
              </h1>
              <p className="text-sm text-slate-500 mt-0.5">
                {tx.account.name} · {fmtDate(tx.date)}
              </p>
            </div>
            <span className={clsx(
              'text-2xl font-black flex-shrink-0',
              tx.amount >= 0 ? 'text-green-600' : 'text-red-600'
            )}>
              {tx.amount >= 0 ? '+' : '−'}{fmtAmt(tx.amount)}
            </span>
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-1.5 mt-3">
            <span className={clsx('badge text-xs', statusCfg.cls)}>{statusCfg.label}</span>
            {tx.category && (
              <span className="badge bg-slate-100 text-slate-600 text-xs flex items-center gap-1">
                <CategoryIcon name={tx.category.icon} color={tx.category.color} size={12} />
                {tx.category.name}
              </span>
            )}
            {tx.isPossibleDuplicate && (
              <span className="badge bg-purple-100 text-purple-700 text-xs">Possible duplicate</span>
            )}
            {tx.pendingFlag   && <span className="badge bg-amber-100 text-amber-700 text-xs">Pending</span>}
            {tx.isTransfer    && <span className="badge bg-slate-100 text-slate-500 text-xs">Transfer</span>}
            {tx.isExcluded    && <span className="badge bg-slate-100 text-slate-400 text-xs">Excluded</span>}
            {tx.isForeignCurrency && (
              <span className="badge bg-blue-100 text-blue-700 text-xs">
                Foreign {tx.foreignCurrency && `(${tx.foreignCurrency})`}
              </span>
            )}
          </div>
        </div>

        {/* ── Source CSV row ────────────────────────────────────────────── */}
        {tx.raw && (
          <Section title="Source Data">
            {tx.raw.rawLine && (
              <div className="bg-slate-900 rounded-lg px-3 py-2 overflow-x-auto">
                <p className="text-xs text-slate-400 mb-1">Raw CSV row (line {tx.raw.parseOrder + 1})</p>
                <code className="text-xs text-green-300 whitespace-pre font-mono">{tx.raw.rawLine}</code>
              </div>
            )}

            {Object.keys(tx.rawFields).length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-1.5 pr-4 text-slate-500 font-semibold">Column</th>
                      <th className="text-left py-1.5 text-slate-500 font-semibold">Raw value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {Object.entries(tx.rawFields).map(([col, val]) => (
                      <tr key={col}>
                        <td className="py-1.5 pr-4 text-slate-500 font-medium whitespace-nowrap">{col}</td>
                        <td className="py-1.5 font-mono text-slate-800 break-all">{val || <span className="text-slate-300 italic">empty</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tx.upload && (
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>From:</span>
                <Link
                  href={`/upload/${tx.upload.id}`}
                  className="flex items-center gap-1 text-accent-600 hover:underline font-medium"
                >
                  {tx.upload.filename}
                  <ExternalLink size={10}/>
                </Link>
                {tx.upload.formatDetected && <span className="badge bg-slate-100 text-slate-500">{tx.upload.formatDetected}</span>}
              </div>
            )}

            {tx.sourceLocator && (
              <KV label="Source locator" value={JSON.stringify(tx.sourceLocator)} mono />
            )}
          </Section>
        )}

        {/* ── Transformation log ───────────────────────────────────────── */}
        {tx.transformations.length > 0 && (
          <Section title={`Transformations (${tx.transformations.length})`}>
            <div className="space-y-1.5">
              {tx.transformations.map((step, i) => (
                <div key={i} className="flex items-start gap-3 text-xs bg-slate-50 rounded-lg px-3 py-2">
                  <span className="font-mono text-slate-400 flex-shrink-0 pt-0.5">{i + 1}</span>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="badge bg-slate-200 text-slate-600 text-xs">{step.field}</span>
                      <span className="font-semibold text-slate-700">
                        {RULE_LABELS[step.rule] ?? step.rule}
                      </span>
                    </div>
                    {step.before !== step.after && (
                      <div className="flex items-center gap-2 mt-1">
                        <code className="bg-red-50 text-red-700 px-1.5 py-0.5 rounded break-all max-w-[40%]">{step.before || <span className="italic opacity-60">empty</span>}</code>
                        <span className="text-slate-400">→</span>
                        <code className="bg-green-50 text-green-700 px-1.5 py-0.5 rounded break-all max-w-[40%]">{step.after || <span className="italic opacity-60">empty</span>}</code>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* ── Date details ─────────────────────────────────────────────── */}
        <Section title="Date">
          <KV label="Resolved date"     value={fmtDate(tx.date)} />
          {tx.dateRaw && <KV label="Raw value" value={tx.dateRaw} mono />}
          {tx.postedDate && tx.postedDate !== tx.date && (
            <KV label="Posted date" value={fmtDate(tx.postedDate)} />
          )}
          {tx.transactionDate && tx.transactionDate !== tx.date && (
            <KV label="Transaction date" value={fmtDate(tx.transactionDate)} />
          )}
          <KV label="Ambiguity" value={tx.dateAmbiguity} />
          {tx.dateInterpretationA && (
            <KV label="MM/DD reading" value={fmtDate(tx.dateInterpretationA)} />
          )}
          {tx.dateInterpretationB && (
            <KV label="DD/MM reading" value={fmtDate(tx.dateInterpretationB)} />
          )}
        </Section>

        {/* ── Amount details ────────────────────────────────────────────── */}
        <Section title="Amount">
          <KV label="Parsed amount"   value={`${tx.amount >= 0 ? '+' : ''}${tx.amount}`} />
          {tx.amountRaw && <KV label="Raw value" value={tx.amountRaw} mono />}
          <KV label="Currency"        value={tx.currencyCode} />
          {tx.currencyDetected && tx.foreignCurrency && (
            <KV label="Foreign currency" value={`${tx.foreignCurrency}${tx.foreignAmount ? ` · ${tx.foreignAmount}` : ''}`} />
          )}
        </Section>

        {/* ── Description details ───────────────────────────────────────── */}
        {(tx.descriptionRaw || tx.descriptionNormalized) && (
          <Section title="Description">
            <KV label="Raw"        value={tx.descriptionRaw || '—'} />
            {tx.descriptionNormalized && tx.descriptionNormalized !== tx.descriptionRaw && (
              <KV label="Normalized" value={tx.descriptionNormalized} />
            )}
          </Section>
        )}

        {/* ── Balance chain ─────────────────────────────────────────────── */}
        {tx.runningBalance != null && (
          <Section title="Balance Chain">
            <KV label="Running balance"  value={tx.runningBalance} mono />
            {tx.runningBalanceRaw && tx.runningBalanceRaw !== tx.runningBalance && (
              <KV label="Raw balance" value={tx.runningBalanceRaw} mono />
            )}
            {tx.balanceChainValid != null && (
              <div className="flex items-center gap-2 text-sm mt-1">
                {tx.balanceChainValid
                  ? <><CheckCircle2 size={14} className="text-green-500"/> <span className="text-green-700 font-medium">Balance chain valid</span></>
                  : <><AlertCircle  size={14} className="text-red-500"/>   <span className="text-red-700 font-medium">Balance chain break</span></>
                }
              </div>
            )}
            {tx.balanceChainExpected && !tx.balanceChainValid && (
              <KV label="Expected" value={tx.balanceChainExpected} mono />
            )}
            {tx.balanceChainActual && !tx.balanceChainValid && (
              <KV label="Actual" value={tx.balanceChainActual} mono />
            )}
          </Section>
        )}

        {/* ── Categorization ────────────────────────────────────────────── */}
        <Section title="Categorization">
          <KV label="Category"   value={tx.category
            ? <span className="flex items-center gap-1.5"><CategoryIcon name={tx.category.icon} color={tx.category.color} size={14} />{tx.category.name}</span>
            : 'Uncategorized'
          } />
          <KV label="Source"     value={SOURCE_LABELS[tx.categorizationSource] ?? tx.categorizationSource} />
          <KV label="Confidence" value={`${(tx.confidenceScore * 100).toFixed(0)}%`} />
          <KV label="Reviewed"   value={tx.reviewedByUser ? 'Yes' : 'No'} />

          {tx.history.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs font-semibold text-slate-500 uppercase">Category history</p>
              {tx.history.map((h, i) => (
                <div key={i} className="text-xs text-slate-600 flex items-center gap-2">
                  <span className="text-slate-400">{fmtDateTime(h.changedAt)}</span>
                  {h.oldCategory && (
                    <>
                      <span className="flex items-center gap-1">
                        <CategoryIcon name={h.oldCategory.icon} color="#94a3b8" size={12} />
                        {h.oldCategory.name}
                      </span>
                      <span className="text-slate-400">→</span>
                    </>
                  )}
                  <span className="font-medium flex items-center gap-1">
                    <CategoryIcon name={h.newCategory.icon} color="#64748b" size={12} />
                    {h.newCategory.name}
                  </span>
                  <span className="badge bg-slate-100 text-slate-500">{h.changedBy}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Ingestion issues ──────────────────────────────────────────── */}
        {tx.ingestionIssues.length > 0 && (
          <Section title={`Ingestion Issues (${tx.ingestionIssues.length})`}>
            <div className="space-y-2">
              {tx.ingestionIssues.map(issue => {
                const cfg = SEVERITY_CFG[issue.severity] ?? SEVERITY_CFG.INFO
                return (
                  <div key={issue.id} className={clsx('border rounded-lg px-3 py-2.5 flex items-start gap-2', cfg.cls)}>
                    {cfg.icon}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">{issue.issueType.replace(/_/g, ' ')}</p>
                      <p className="text-xs mt-0.5">{issue.description}</p>
                      {issue.suggestedAction && (
                        <p className="text-xs italic opacity-75 mt-0.5">{issue.suggestedAction}</p>
                      )}
                      {issue.resolved && (
                        <p className="text-xs opacity-60 mt-1">
                          Resolved {issue.resolvedBy === 'USER' ? 'by you' : 'automatically'}
                          {issue.resolvedAt ? ` · ${fmtDate(issue.resolvedAt)}` : ''}
                        </p>
                      )}
                    </div>
                    {issue.resolved && <CheckCircle2 size={14} className="text-green-500 flex-shrink-0 mt-0.5"/>}
                  </div>
                )
              })}
            </div>
          </Section>
        )}

        {/* ── Metadata ─────────────────────────────────────────────────── */}
        <Section title="Metadata">
          <KV label="Transaction ID"     value={tx.id}               mono />
          {tx.bankTransactionId && <KV label="Bank TX ID"    value={tx.bankTransactionId} mono />}
          {tx.checkNumber       && <KV label="Check number"  value={tx.checkNumber}       mono />}
          <KV label="Bank fingerprint"   value={tx.bankFingerprint}  mono />
          <KV label="Imported"           value={fmtDateTime(tx.createdAt)} />
          <KV label="Last updated"       value={fmtDateTime(tx.updatedAt)} />
        </Section>

      </main>
    </AppShell>
  )
}
