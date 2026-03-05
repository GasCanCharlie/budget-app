'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { format } from 'date-fns'
import Link from 'next/link'
import { Search, ChevronDown, RotateCcw, Check, AlertTriangle, Copy, Calendar, Download, Loader2, ArrowUp, ArrowDown, ArrowUpDown, X, Equal } from 'lucide-react'
import clsx from 'clsx'
import { CategoryIcon } from '@/components/CategoryIcon'

// ─── Constants ────────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  rule: '⚙️ Rule',
  ai:   '🤖 AI',
  user: '✏️ You',
}

type IngestionFilter = '' | 'flagged' | 'duplicate' | 'same-price'
type SortBy  = 'date' | 'vendor' | 'amount'
type SortDir = 'asc' | 'desc'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n))
}

function fmtDate(s: string | Date | null | undefined) {
  if (!s) return '—'
  try { return format(new Date(s as string), 'MMM d, yyyy') } catch { return String(s) }
}

// ─── Sort button ─────────────────────────────────────────────────────────────

function SortBtn({
  label, field, active, dir,
  onClick,
}: {
  label: string
  field: SortBy
  active: boolean
  dir: SortDir
  onClick: (f: SortBy) => void
}) {
  const Icon = active ? (dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
  return (
    <button
      onClick={() => onClick(field)}
      style={active ? {
        background: 'var(--accent-muted)',
        border: '1px solid var(--accent)',
        color: 'var(--accent)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        transition: 'all .15s',
      } : {
        background: 'var(--card2)',
        border: '1px solid var(--border)',
        color: 'var(--muted)',
        borderRadius: 'var(--radius-sm)',
        padding: '4px 10px',
        fontSize: 12,
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        transition: 'all .15s',
      }}
    >
      {label}
      <Icon size={11} />
    </button>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface TxCategory {
  id:    string
  name:  string
  color: string
  icon:  string
}

interface Transaction {
  id:                   string
  date:                 string
  description:          string
  merchantNormalized:   string
  descriptionDisplay:   string
  amount:               number
  isTransfer:           boolean
  isForeignCurrency:    boolean
  categorizationSource: string
  confidenceScore:      number
  reviewedByUser:       boolean
  category:             TxCategory | null
  bankCategoryRaw?:     string | null
  appCategory?:         string | null
  // Ingestion fields
  ingestionStatus:      string
  isPossibleDuplicate:  boolean
  dateAmbiguity:        string
  dateInterpretationA:  string | null
  dateInterpretationB:  string | null
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TransactionsPage() {
  return <Suspense><TransactionsPageInner /></Suspense>
}

function TransactionsPageInner() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const user         = useAuthStore(s => s.user)
  const { apiFetch, apiDownload } = useApi()
  const qc           = useQueryClient()

  const [search,           setSearch]           = useState('')
  const [category,         setCategory]         = useState(searchParams.get('category') || '')
  const [displayCategory,  setDisplayCategory]  = useState(searchParams.get('displayCategory') || '')
  const [yearFilter,       setYearFilter]        = useState(searchParams.get('year') || '')
  const [monthFilter,      setMonthFilter]       = useState(searchParams.get('month') || '')
  const [ingestionFilter,  setIngestionFilter]  = useState<IngestionFilter>('')
  const [sortBy,           setSortBy]           = useState<SortBy>('date')
  const [sortDir,          setSortDir]          = useState<SortDir>('desc')
  const [page,            setPage]            = useState(1)
  const [editing,         setEditing]         = useState<string | null>(null)
  const [appCatEditing,   setAppCatEditing]   = useState<string | null>(null)
  const [toast,           setToast]           = useState<string | null>(null)
  const [undoStack,       setUndoStack]       = useState<{ id: string; oldCatId: string }[]>([])
  const [downloading,     setDownloading]     = useState(false)

  useEffect(() => { if (!user) router.replace('/login') }, [user, router])

  const { data: catData } = useQuery({
    queryKey: ['categories'],
    queryFn:  () => apiFetch('/api/categories'),
    enabled:  !!user,
  })
  const categories = catData?.categories ?? []

  const { data, isLoading } = useQuery({
    queryKey: ['transactions', search, category, displayCategory, yearFilter, monthFilter, ingestionFilter, sortBy, sortDir, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (search)           params.set('search',          search)
      if (category)         params.set('category',        category)
      if (displayCategory)  params.set('displayCategory', displayCategory)
      if (yearFilter)       params.set('year',            yearFilter)
      if (monthFilter)      params.set('month',           monthFilter)
      if (ingestionFilter)  params.set('ingestionFilter', ingestionFilter)
      params.set('sortBy',  sortBy)
      params.set('sortDir', sortDir)
      return apiFetch(`/api/transactions?${params}`)
    },
    enabled: !!user,
  })
  const transactions: Transaction[] = data?.transactions ?? []
  const total         = data?.total         ?? 0
  const pages         = data?.pages         ?? 1
  const flaggedCount   = data?.flaggedCount   ?? 0
  const duplicateCount = data?.duplicateCount ?? 0
  const samePriceCount = data?.samePriceCount ?? 0

  // ── Category update mutation ───────────────────────────────────────────────

  const updateMutation = useMutation({
    mutationFn: ({ id, categoryId, applyToAll }: { id: string; categoryId: string; applyToAll?: boolean }) =>
      apiFetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ categoryId, applyToAll: applyToAll ?? false }),
      }),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      setEditing(null)
      showToast(vars.applyToAll && data.updated > 1 ? `Updated ${data.updated} transactions` : 'Category updated')
    },
  })

  // ── App-category (free-text) mutation ─────────────────────────────────────

  const appCategoryMutation = useMutation({
    mutationFn: ({ id, appCategory, applyToAll }: { id: string; appCategory: string | null; applyToAll: boolean }) =>
      apiFetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ appCategory, applyToAll }),
      }),
    onSuccess: (data, vars) => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      setAppCatEditing(null)
      showToast(vars.applyToAll && (data.updated ?? 1) > 1 ? `Updated ${data.updated} transactions` : 'Category updated')
    },
  })

  // ── Ingestion resolution mutation ──────────────────────────────────────────

  const resolveMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      apiFetch(`/api/transactions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      showToast('Transaction updated')
    },
  })

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 5000)
  }

  const doUpdate = useCallback((id: string, oldCatId: string, newCatId: string, applyToAll = false) => {
    setUndoStack(prev => [{ id, oldCatId }, ...prev.slice(0, 9)])
    updateMutation.mutate({ id, categoryId: newCatId, applyToAll })
  }, [updateMutation])

  async function handleUndo() {
    const last = undoStack[0]
    if (!last) return
    setUndoStack(prev => prev.slice(1))
    await apiFetch(`/api/transactions/${last.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ categoryId: last.oldCatId }),
    })
    qc.invalidateQueries({ queryKey: ['transactions'] })
    qc.invalidateQueries({ queryKey: ['summary'] })
    showToast('Undo successful')
  }

  async function handleExport() {
    setDownloading(true)
    try {
      const params = new URLSearchParams()
      if (search)          params.set('search',          search)
      if (category)        params.set('category',        category)
      if (ingestionFilter) params.set('ingestionFilter', ingestionFilter)
      await apiDownload(`/api/transactions/export?${params}`)
    } catch (e) {
      showToast((e as Error).message || 'Export failed')
    } finally {
      setDownloading(false)
    }
  }

  function switchFilter(f: IngestionFilter) {
    setIngestionFilter(f)
    setPage(1)
    setEditing(null)
  }

  function handleSort(field: SortBy) {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir(field === 'amount' ? 'desc' : field === 'vendor' ? 'asc' : 'desc')
    }
    setPage(1)
  }

  if (!user) return null

  return (
    <AppShell>
      <main className="max-w-4xl mx-auto px-4 py-6 pb-24 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Transactions</h1>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium" style={{ color: 'var(--muted)' }}>{total.toLocaleString()} total</span>
            <button
              onClick={handleExport}
              disabled={downloading || total === 0}
              title="Export to CSV"
              className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {downloading
                ? <><Loader2 size={12} className="animate-spin"/> Exporting…</>
                : <><Download size={12}/> CSV</>
              }
            </button>
          </div>
        </div>

        {/* ── Search + category filter ─────────────────────────────────── */}
        <div className="flex gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-8 py-2"
              placeholder="Search transactions…"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <select
            className="input py-2 w-auto"
            value={category}
            onChange={e => { setCategory(e.target.value); setPage(1) }}
          >
            <option value="">All categories</option>
            {categories.map((c: { id: string; name: string; icon: string }) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* ── Sort controls ────────────────────────────────────────────── */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium" style={{ color: 'var(--muted)' }}>Sort:</span>
          <SortBtn label="Date"   field="date"   active={sortBy === 'date'}   dir={sortDir} onClick={handleSort} />
          <SortBtn label="Vendor" field="vendor" active={sortBy === 'vendor'} dir={sortDir} onClick={handleSort} />
          <SortBtn label="Amount" field="amount" active={sortBy === 'amount'} dir={sortDir} onClick={handleSort} />
        </div>

        {/* ── Active month filter pill ─────────────────────────────────── */}
        {yearFilter && monthFilter && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Month:</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-indigo-100 text-indigo-800 border border-indigo-200">
              {new Date(Number(yearFilter), Number(monthFilter) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
              <button
                onClick={() => { setYearFilter(''); setMonthFilter(''); setPage(1) }}
                className="ml-0.5 hover:text-indigo-900 leading-none"
                aria-label="Clear month filter"
              >
                ×
              </button>
            </span>
          </div>
        )}

        {/* ── Active display-category filter pill ──────────────────────── */}
        {displayCategory && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">Category filter:</span>
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg bg-blue-100 text-blue-800 border border-blue-200">
              {displayCategory}
              <button
                onClick={() => { setDisplayCategory(''); setPage(1) }}
                className="ml-0.5 hover:text-blue-900 leading-none"
                aria-label="Clear category filter"
              >
                ×
              </button>
            </span>
          </div>
        )}

        {/* ── Ingestion filter tabs ────────────────────────────────────── */}
        {(flaggedCount > 0 || duplicateCount > 0 || samePriceCount > 0 || ingestionFilter !== '') && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => switchFilter('')}
              style={ingestionFilter === '' ? {
                background: 'var(--text)', color: 'var(--surface)', border: '1px solid transparent',
                borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 12, fontWeight: 600,
              } : {
                background: 'var(--card2)', color: 'var(--muted)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)', padding: '4px 12px', fontSize: 12, fontWeight: 600,
              }}
            >
              All
            </button>
            {(flaggedCount > 0 || ingestionFilter === 'flagged') && (
              <button
                onClick={() => switchFilter('flagged')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition border flex items-center gap-1.5',
                  ingestionFilter === 'flagged'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-amber-50 text-amber-700 border-amber-200 hover:border-amber-400'
                )}
              >
                <AlertTriangle size={11}/>
                Flagged{flaggedCount > 0 && ` (${flaggedCount})`}
              </button>
            )}
            {(duplicateCount > 0 || ingestionFilter === 'duplicate') && (
              <button
                onClick={() => switchFilter('duplicate')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition border flex items-center gap-1.5',
                  ingestionFilter === 'duplicate'
                    ? 'bg-purple-500 text-white border-purple-500'
                    : 'bg-purple-50 text-purple-700 border-purple-200 hover:border-purple-400'
                )}
              >
                <Copy size={11}/>
                Duplicates{duplicateCount > 0 && ` (${duplicateCount})`}
              </button>
            )}
            {(samePriceCount > 0 || ingestionFilter === 'same-price') && (
              <button
                onClick={() => switchFilter('same-price')}
                className={clsx(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition border flex items-center gap-1.5',
                  ingestionFilter === 'same-price'
                    ? 'bg-teal-500 text-white border-teal-500'
                    : 'bg-teal-50 text-teal-700 border-teal-200 hover:border-teal-400'
                )}
              >
                <Equal size={11}/>
                Same Price{samePriceCount > 0 && ` (${samePriceCount})`}
              </button>
            )}
          </div>
        )}

        {/* ── Transaction list ─────────────────────────────────────────── */}
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-16 bg-slate-100 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-4xl mb-3">{ingestionFilter ? '✅' : '🔍'}</p>
            <p className="font-bold text-slate-700">
              {ingestionFilter === 'flagged'     ? 'No flagged transactions'        :
               ingestionFilter === 'duplicate'   ? 'No possible duplicates'         :
               ingestionFilter === 'same-price'  ? 'No repeated amounts'            :
               'No transactions found'}
            </p>
            <p className="text-sm text-slate-400 mt-1">
              {ingestionFilter === 'same-price'
                ? 'No transactions share an identical amount.'
                : ingestionFilter
                ? 'All ingestion issues have been resolved.'
                : 'Try adjusting your search or filters'}
            </p>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden divide-y divide-slate-100">
            {transactions.map((tx) => (
              <TransactionRow
                key={tx.id}
                tx={tx}
                categories={categories}
                isEditing={editing === tx.id}
                onEdit={() => { setAppCatEditing(null); setEditing(editing === tx.id ? null : tx.id) }}
                onUpdate={(newCatId, applyToAll) => doUpdate(tx.id, tx.category?.id ?? '', newCatId, applyToAll)}
                isPending={updateMutation.isPending && updateMutation.variables?.id === tx.id}
                isAppCatEditing={appCatEditing === tx.id}
                onAppCatEdit={() => { setEditing(null); setAppCatEditing(appCatEditing === tx.id ? null : tx.id) }}
                onAppCatUpdate={(newName, applyToAll) => appCategoryMutation.mutate({ id: tx.id, appCategory: newName, applyToAll })}
                isAppCatPending={appCategoryMutation.isPending && appCategoryMutation.variables?.id === tx.id}
                onResolveDate={(resolvedDate) => resolveMutation.mutate({ id: tx.id, payload: { resolvedDate } })}
                onDismissDuplicate={() => resolveMutation.mutate({ id: tx.id, payload: { dismissDuplicate: true } })}
                isResolvePending={resolveMutation.isPending && resolveMutation.variables?.id === tx.id}
              />
            ))}
          </div>
        )}

        {/* ── Pagination ───────────────────────────────────────────────── */}
        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 pt-2">
            <button disabled={page === 1}     onClick={() => setPage(p => p - 1)} className="btn-secondary py-2 px-4 disabled:opacity-40">← Prev</button>
            <span className="text-sm text-slate-500 font-medium">Page {page} of {pages}</span>
            <button disabled={page === pages} onClick={() => setPage(p => p + 1)} className="btn-secondary py-2 px-4 disabled:opacity-40">Next →</button>
          </div>
        )}
      </main>

      {/* ── Toast ────────────────────────────────────────────────────────── */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-sm font-medium px-4 py-3 rounded-xl shadow-lg flex items-center gap-3 z-50 animate-fade-in">
          <Check size={16} className="text-green-400" />
          {toast}
          {undoStack.length > 0 && (
            <button onClick={handleUndo} className="text-accent-300 hover:text-white font-semibold flex items-center gap-1">
              <RotateCcw size={14} /> Undo
            </button>
          )}
        </div>
      )}
    </AppShell>
  )
}

// ─── TransactionRow ───────────────────────────────────────────────────────────

function TransactionRow({
  tx, categories, isEditing, onEdit, onUpdate, isPending,
  isAppCatEditing, onAppCatEdit, onAppCatUpdate, isAppCatPending,
  onResolveDate, onDismissDuplicate, isResolvePending,
}: {
  tx:                  Transaction
  categories:          TxCategory[]
  isEditing:           boolean
  onEdit:              () => void
  onUpdate:            (catId: string, applyToAll: boolean) => void
  isPending:           boolean
  isAppCatEditing:     boolean
  onAppCatEdit:        () => void
  onAppCatUpdate:      (catName: string | null, applyToAll: boolean) => void
  isAppCatPending:     boolean
  onResolveDate:       (resolvedDate: string) => void
  onDismissDuplicate:  () => void
  isResolvePending:    boolean
}) {
  const [applyAll,       setApplyAll]       = useState(false)
  const [appCatApplyAll, setAppCatApplyAll] = useState(false)
  const cat = tx.category

  const needsReview   = tx.categorizationSource === 'ai' && tx.confidenceScore < 0.85 && !tx.reviewedByUser
  const isAmbigDate   = tx.dateAmbiguity === 'AMBIGUOUS_MMDD_DDMM'
  const isFlagged     = tx.ingestionStatus === 'UNRESOLVED' || tx.ingestionStatus === 'WARNING'

  return (
    <div className="px-4 py-3 transition-colors" style={{ ['--hover-bg' as string]: 'var(--surface2)' }}
      onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
    >
      <div className="flex items-center gap-3">
        {/* Category icon */}
        <div className="w-8 flex-shrink-0 flex items-center justify-center">
          <CategoryIcon name={cat?.icon ?? 'Package'} color={cat?.color} size={20} />
        </div>

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            {(() => {
              const displayName = tx.merchantNormalized?.trim() || tx.description?.trim() || null
              const showSubtitle = displayName && tx.merchantNormalized?.trim() &&
                                   tx.description?.trim() &&
                                   tx.merchantNormalized.trim() !== tx.description.trim()
              return (
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/transactions/${tx.id}`}
                    className="font-semibold text-sm text-slate-800 truncate hover:text-accent-600 transition-colors block"
                  >
                    {displayName ?? <span className="text-slate-400 italic">No description</span>}
                  </Link>
                  {showSubtitle && (
                    <p className="text-xs text-slate-400 truncate mt-0.5">{tx.description}</p>
                  )}
                </div>
              )
            })()}
            <span className={clsx('font-bold text-sm flex-shrink-0 num', tx.amount >= 0 ? 'text-green-700' : 'text-red-700')}>
              {tx.amount >= 0 ? '+' : '-'}{fmtAmt(tx.amount)}
            </span>
          </div>

          {/* Badge row */}
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-xs text-slate-400">{fmtDate(tx.date)}</span>
            {cat && (
              <button
                onClick={onEdit}
                className={clsx(
                  'badge gap-1 transition',
                  needsReview ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                )}
              >
                {cat.name}
                <ChevronDown size={10} />
              </button>
            )}
            {needsReview        && <span className="badge bg-amber-50 text-amber-600 text-xs">Confirm?</span>}
            {tx.isTransfer      && <span className="badge bg-slate-100 text-slate-500 text-xs">Transfer</span>}
            {tx.isForeignCurrency && <span className="badge bg-blue-100 text-blue-600 text-xs">Foreign</span>}
            {/* Ingestion badges */}
            {isAmbigDate && (
              <span className="badge bg-orange-100 text-orange-700 text-xs flex items-center gap-1">
                <Calendar size={10}/> Date?
              </span>
            )}
            {tx.isPossibleDuplicate && (
              <span className="badge bg-purple-100 text-purple-700 text-xs flex items-center gap-1">
                <Copy size={10}/> Duplicate?
              </span>
            )}
            {isFlagged && !isAmbigDate && !tx.isPossibleDuplicate && (
              <span className="badge bg-red-100 text-red-600 text-xs flex items-center gap-1">
                <AlertTriangle size={10}/> {tx.ingestionStatus}
              </span>
            )}
            <span className="text-xs text-slate-300">{SOURCE_LABELS[tx.categorizationSource]}</span>
            {tx.bankCategoryRaw && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded">
                <span className="text-[10px] font-medium text-blue-500 uppercase tracking-wide">Bank:</span>
                <span className="text-blue-600">{tx.bankCategoryRaw}</span>
              </span>
            )}
            <button
              onClick={onAppCatEdit}
              className={clsx(
                'inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5 transition',
                tx.appCategory
                  ? 'bg-green-50 text-green-700 border border-green-200 hover:bg-green-100'
                  : 'bg-slate-50 text-slate-400 border border-dashed border-slate-300 hover:border-slate-400 hover:text-slate-600'
              )}
            >
              {tx.appCategory ?? 'Assign'}
              <ChevronDown size={9} />
            </button>
          </div>

          {/* ── Date ambiguity resolver ──────────────────────────────── */}
          {isAmbigDate && tx.dateInterpretationA && tx.dateInterpretationB && (
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="text-xs text-slate-500 flex items-center gap-1">
                <Calendar size={11}/> Which date?
              </span>
              <button
                disabled={isResolvePending}
                onClick={() => onResolveDate(tx.dateInterpretationA!)}
                className="text-xs px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 font-semibold hover:bg-orange-100 transition disabled:opacity-50"
              >
                {fmtDate(tx.dateInterpretationA)} (MM/DD)
              </button>
              <span className="text-xs text-slate-400">or</span>
              <button
                disabled={isResolvePending}
                onClick={() => onResolveDate(tx.dateInterpretationB!)}
                className="text-xs px-2.5 py-1 rounded-lg bg-orange-50 border border-orange-200 text-orange-800 font-semibold hover:bg-orange-100 transition disabled:opacity-50"
              >
                {fmtDate(tx.dateInterpretationB)} (DD/MM)
              </button>
              {isResolvePending && <span className="text-xs text-slate-400 animate-pulse">Saving…</span>}
            </div>
          )}

          {/* ── Duplicate dismiss ────────────────────────────────────── */}
          {tx.isPossibleDuplicate && (
            <div className="mt-1.5 flex items-center gap-2">
              <span className="text-xs text-slate-500">Flagged as a possible duplicate.</span>
              <button
                disabled={isResolvePending}
                onClick={onDismissDuplicate}
                className="text-xs px-2.5 py-1 rounded-lg bg-purple-50 border border-purple-200 text-purple-800 font-semibold hover:bg-purple-100 transition disabled:opacity-50"
              >
                {isResolvePending ? 'Saving…' : 'Dismiss'}
              </button>
            </div>
          )}
        </div>

        {(isPending || isAppCatPending) && <div className="w-4 h-4 border-2 border-accent-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />}
      </div>

      {/* ── App-category picker ───────────────────────────────────────── */}
      {isAppCatEditing && (
        <div className="mt-3 ml-11 space-y-2">
          <div className="flex items-center gap-2">
            <input type="checkbox" id={`appCatApplyAll-${tx.id}`} checked={appCatApplyAll} onChange={e => setAppCatApplyAll(e.target.checked)} className="rounded" />
            <label htmlFor={`appCatApplyAll-${tx.id}`} className="text-xs font-medium text-slate-600">
              Apply to all &quot;{tx.merchantNormalized}&quot; transactions
            </label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto p-1 rounded-lg" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => onAppCatUpdate(c.name, appCatApplyAll)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition text-left',
                  tx.appCategory === c.name
                    ? 'bg-green-500 text-white'
                    : 'hover:shadow-sm'
                )}
                style={tx.appCategory !== c.name ? { color: 'var(--text)' } : undefined}
              >
                <CategoryIcon name={c.icon} color={tx.appCategory === c.name ? '#ffffff' : c.color} size={14} />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
            {tx.appCategory && (
              <button
                onClick={() => onAppCatUpdate(null, appCatApplyAll)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition text-left text-red-500 hover:bg-red-50"
              >
                <X size={14} />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Category picker ──────────────────────────────────────────── */}
      {isEditing && (
        <div className="mt-3 ml-11 space-y-2">
          <div className="flex items-center gap-2">
            <input type="checkbox" id={`applyAll-${tx.id}`} checked={applyAll} onChange={e => setApplyAll(e.target.checked)} className="rounded" />
            <label htmlFor={`applyAll-${tx.id}`} className="text-xs font-medium text-slate-600">
              Apply to all &quot;{tx.merchantNormalized}&quot; transactions
            </label>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto p-1 rounded-lg" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
            {categories.map((c) => (
              <button
                key={c.id}
                onClick={() => onUpdate(c.id, applyAll)}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition text-left',
                  cat?.id === c.id
                    ? 'bg-accent-500 text-white'
                    : 'hover:shadow-sm'
                )}
                style={cat?.id !== c.id ? { color: 'var(--text)' } : undefined}
              >
                <CategoryIcon name={c.icon} color={cat?.id === c.id ? '#ffffff' : c.color} size={14} />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
