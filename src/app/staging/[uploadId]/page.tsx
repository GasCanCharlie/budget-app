'use client'

import {
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter, useParams } from 'next/navigation'
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  MoreHorizontal,
  Zap,
  Trash2,
  ArrowRight,
  X,
  Search,
  CheckSquare,
  Square,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RefreshCw,
  Tag,
  Repeat2,
  MinusCircle,
  CornerDownRight,
  TrendingUp,
  RotateCcw,
} from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { useApi } from '@/hooks/useApi'
import { InitialAnalysis } from '@/components/InitialAnalysis'
import { scrubTransactions, type ScrubFilter } from '@/lib/scrubbing'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Category {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
}

type TxStatus =
  | 'uncategorized'
  | 'categorized'
  | 'needs_review'
  | 'excluded'
  | 'transfer'

interface StagingTransaction {
  id: string
  stagingUploadId: string
  date: string | null
  vendorRaw: string
  vendorKey: string
  amountCents: number
  description: string
  bankCategoryRaw: string | null
  suggestionCategory: string | null
  suggestionConfidence: string | null
  suggestionSource: string | null
  isRecurring: boolean
  categoryId: string | null
  categorySource: 'none' | 'manual' | 'rule' | 'bank'
  ruleId: string | null
  ruleReason: string | null
  status: TxStatus
  committedAt: string | null
  category: { id: string; name: string; color: string; icon: string } | null
}

interface StagingUpload {
  id: string
  uploadId: string
  status: 'ready' | 'committed' | 'discarded'
  rowCount: number
  autoCount: number
  reviewCount: number
  newVendors: number
  createdAt: string
  updatedAt: string
  upload: {
    id: string
    filename: string
    formatDetected: string
    rowCountAccepted: number
  }
}

interface StagingCounts {
  total: number
  uncategorized: number
  categorized: number
  auto: number
  needsReview: number
  excluded: number
  transfer: number
}

interface StagingData {
  stagingUpload: StagingUpload
  transactions: StagingTransaction[]
  counts: StagingCounts
}

type SortKey = 'date' | 'amount' | 'vendor'
type SortDir = 'asc' | 'desc'
type FilterMode = 'all' | 'uncategorized' | 'needs_review' | 'auto'

interface RulePromptState {
  txId: string
  vendorRaw: string
  vendorKey: string
  categoryId: string
  categoryName: string
  amountCents: number
  saved: boolean
  dismissed: boolean
  expanded: boolean
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmt(cents: number) {
  const dollars = cents / 100
  const abs = Math.abs(dollars).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
  return cents < 0 ? `-${abs}` : abs
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

// ─── Toast ───────────────────────────────────────────────────────────────────

interface ToastMsg {
  id: number
  text: string
  type: 'success' | 'error' | 'info'
}

function useToast() {
  const [toasts, setToasts] = useState<ToastMsg[]>([])
  const counter = useRef(0)

  const addToast = useCallback(
    (text: string, type: ToastMsg['type'] = 'info') => {
      const id = ++counter.current
      setToasts(prev => [...prev, { id, text, type }])
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500)
    },
    []
  )

  return { toasts, addToast }
}

function ToastContainer({ toasts }: { toasts: ToastMsg[] }) {
  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map(t => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-2.5 rounded-xl px-4 py-3 text-sm font-medium shadow-xl"
          style={{
            background:
              t.type === 'success'
                ? 'var(--success-muted)'
                : t.type === 'error'
                  ? 'var(--danger-muted, rgba(248,113,113,0.15))'
                  : 'var(--accent-muted)',
            border:
              t.type === 'success'
                ? '1px solid var(--success-muted)'
                : t.type === 'error'
                  ? '1px solid var(--danger-muted, rgba(248,113,113,0.30))'
                  : '1px solid var(--accent-muted)',
            color:
              t.type === 'success'
                ? 'var(--success)'
                : t.type === 'error'
                  ? 'var(--danger)'
                  : 'var(--accent)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {t.type === 'success' ? (
            <CheckCircle2 size={15} />
          ) : t.type === 'error' ? (
            <AlertCircle size={15} />
          ) : (
            <Zap size={15} />
          )}
          {t.text}
        </div>
      ))}
    </div>
  )
}

// ─── Status pill ──────────────────────────────────────────────────────────────

function StatusPill({
  tx,
  categories,
}: {
  tx: StagingTransaction
  categories: Category[]
}) {
  if (tx.status === 'excluded') {
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium line-through"
        style={{
          background: 'var(--card)',
          color: 'var(--muted)',
          border: '1px solid var(--border)',
        }}
      >
        Excluded
      </span>
    )
  }
  if (tx.status === 'transfer') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
        style={{
          background: 'var(--card)',
          color: 'var(--text2)',
          border: '1px solid var(--border)',
        }}
      >
        ↔ Transfer
      </span>
    )
  }
  if (tx.status === 'needs_review') {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold"
        style={{
          background: 'var(--warn-muted)',
          color: 'var(--warn)',
          border: '1px solid var(--warn-muted)',
        }}
      >
        ⚠ Review
      </span>
    )
  }
  if (tx.status === 'categorized') {
    if (tx.categorySource === 'rule' && tx.ruleReason) {
      return (
        <span
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            background: 'var(--accent-muted)',
            color: 'var(--accent)',
            border: '1px solid var(--accent-muted)',
          }}
        >
          🔵 Rule: {tx.ruleReason}
        </span>
      )
    }
    if (tx.category) {
      const cat = categories.find(c => c.id === tx.category?.id)
      const color = cat?.color ?? 'var(--accent)'
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
          style={{
            background: `${color}1a`,
            color,
            border: `1px solid ${color}33`,
          }}
        >
          <span
            className="block w-1.5 h-1.5 rounded-full flex-shrink-0"
            style={{ background: color }}
          />
          {tx.category.name}
        </span>
      )
    }
  }
  // uncategorized
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
      style={{
        background: 'var(--card2)',
        color: 'var(--muted)',
        border: '1px solid var(--border)',
      }}
    >
      —
    </span>
  )
}

// ─── Category Dropdown ────────────────────────────────────────────────────────

function CategorySelect({
  categories,
  value,
  onChange,
}: {
  categories: Category[]
  value: string | null
  onChange: (catId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(
    () =>
      categories.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase())
      ),
    [categories, search]
  )

  const selected = categories.find(c => c.id === value)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={e => {
          e.stopPropagation()
          setOpen(v => !v)
        }}
        className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium transition-all"
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          color: selected ? 'var(--text)' : 'var(--muted)',
        }}
      >
        {selected ? (
          <>
            <span style={{ color: selected.color }}>{selected.icon}</span>
            <span className="max-w-[100px] truncate">{selected.name}</span>
          </>
        ) : (
          'Category'
        )}
        <ChevronDown size={11} className="flex-shrink-0 opacity-60" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border2)',
            boxShadow: 'var(--shadow)',
          }}
        >
          {/* Search */}
          <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 rounded-lg px-2.5 py-1.5"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <Search size={11} className="text-[color:var(--muted)] flex-shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="flex-1 bg-transparent text-xs text-[color:var(--text)] outline-none placeholder:text-[color:var(--muted)]/60"
                onClick={e => e.stopPropagation()}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-[color:var(--muted)]">No match</p>
            ) : (
              filtered.map(cat => (
                <button
                  key={cat.id}
                  onClick={e => {
                    e.stopPropagation()
                    onChange(cat.id)
                    setOpen(false)
                    setSearch('')
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover-surface"
                  style={{ color: value === cat.id ? 'var(--accent)' : 'var(--text2)' }}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.name}</span>
                  {value === cat.id && (
                    <CheckCircle2 size={11} className="ml-auto text-[color:var(--accent)]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Row ··· menu ─────────────────────────────────────────────────────────────

function TxMenu({
  tx,
  onMarkTransfer,
  onExclude,
  onReset,
}: {
  tx: StagingTransaction
  onMarkTransfer: () => void
  onExclude: () => void
  onReset: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={e => {
          e.stopPropagation()
          setOpen(v => !v)
        }}
        className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover-surface"
        style={{ color: 'var(--muted)' }}
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl overflow-hidden"
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border2)',
            boxShadow: 'var(--shadow)',
          }}
        >
          <button
            onClick={() => { onMarkTransfer(); setOpen(false) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs text-left text-[color:var(--text2)] transition-colors hover-surface"
          >
            <Repeat2 size={13} className="text-[color:var(--muted)]" />
            Mark as Transfer
          </button>
          <button
            onClick={() => { onExclude(); setOpen(false) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs text-left text-[color:var(--text2)] transition-colors hover-surface"
          >
            <MinusCircle size={13} className="text-[color:var(--muted)]" />
            Exclude
          </button>
          <div style={{ borderTop: '1px solid var(--border)' }} />
          <button
            onClick={() => { onReset(); setOpen(false) }}
            className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-xs text-left text-[color:var(--muted)] transition-colors hover-surface"
          >
            <RefreshCw size={13} />
            Reset
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Rule Prompt ──────────────────────────────────────────────────────────────

function RulePrompt({
  prompt,
  categories,
  onSave,
  onDismiss,
}: {
  prompt: RulePromptState
  categories: Category[]
  onSave: (matchType: 'vendor_exact' | 'contains', minAmt?: number, maxAmt?: number) => void
  onDismiss: () => void
}) {
  const cat = categories.find(c => c.id === prompt.categoryId)

  if (prompt.saved) {
    return (
      <div
        className="mx-4 mb-2 flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs"
        style={{
          background: 'var(--success-muted)',
          border: '1px solid var(--success-muted)',
          color: 'var(--success)',
        }}
      >
        <CheckCircle2 size={13} />
        Rule saved.{' '}
        <a href="/rules" className="underline opacity-80 hover:opacity-100">
          Manage rules
        </a>
      </div>
    )
  }

  if (prompt.dismissed) return null

  return (
    <div
      className="mx-4 mb-2 rounded-xl p-3.5"
      style={{
        background: 'var(--accent-muted)',
        border: '1px solid var(--accent-muted)',
      }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[color:var(--text)] mb-0.5">
            Remember this for next time?
          </p>
          <p className="text-xs text-[color:var(--muted)]">
            <span className="font-medium text-[color:var(--text2)]">
              &ldquo;{prompt.vendorRaw}&rdquo;
            </span>{' '}
            →{' '}
            <span style={{ color: cat?.color ?? 'var(--accent)' }}>
              {cat?.icon} {cat?.name}
            </span>
          </p>
        </div>
        <button onClick={onDismiss} className="flex-shrink-0 text-[color:var(--muted)] hover:text-[color:var(--text2)]">
          <X size={13} />
        </button>
      </div>

      {!prompt.expanded ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onSave('vendor_exact')}
            className="rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
            style={{
              background: 'var(--accent-muted)',
              border: '1px solid var(--accent-muted)',
              color: 'var(--accent)',
            }}
          >
            Always for this vendor
          </button>
          <button
            onClick={() => onSave('vendor_exact', Math.abs(prompt.amountCents), Math.abs(prompt.amountCents))}
            className="rounded-lg px-3 py-1.5 text-xs font-medium transition-all"
            style={{
              background: 'var(--card2)',
              border: '1px solid var(--border)',
              color: 'var(--text2)',
            }}
          >
            Same amount only
          </button>
          <button
            onClick={onDismiss}
            className="text-xs text-[color:var(--muted)] hover:text-[color:var(--text2)] transition-colors"
          >
            No thanks
          </button>
        </div>
      ) : null}
    </div>
  )
}

// ─── Confirm Dialog ───────────────────────────────────────────────────────────

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
  isPending,
}: {
  title: string
  body: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="w-full max-w-sm rounded-2xl p-6 shadow-xl"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border2)',
        }}
      >
        <h3 className="mb-2 font-bold text-[color:var(--text)]">{title}</h3>
        <p className="mb-5 text-sm text-[color:var(--muted)]">{body}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[color:var(--muted)] hover-surface transition disabled:opacity-50"
            style={{ border: '1px solid var(--border)' }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50"
            style={{
              background: danger ? 'var(--danger-muted, rgba(248,113,113,0.15))' : 'var(--accent-muted)',
              border: danger
                ? '1px solid var(--danger-muted, rgba(248,113,113,0.30))'
                : '1px solid var(--accent-muted)',
              color: danger ? 'var(--danger)' : 'var(--accent)',
            }}
          >
            {isPending ? (
              <Loader2 size={14} className="inline animate-spin" />
            ) : (
              confirmLabel
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Success Banner ───────────────────────────────────────────────────────────

function SuccessBanner({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <div
      className="fixed inset-x-4 top-20 z-[100] mx-auto max-w-xl rounded-2xl px-5 py-4 shadow-xl flex items-center justify-between gap-4"
      style={{
        background: 'var(--success-muted)',
        border: '1px solid var(--success-muted)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="flex items-center gap-3">
        <CheckCircle2 size={20} className="text-[color:var(--success)] flex-shrink-0" />
        <span className="text-sm font-semibold text-[color:var(--text)]">
          {count} transaction{count !== 1 ? 's' : ''} added to your budget!
        </span>
      </div>
      <button onClick={onClose} className="text-[color:var(--muted)] hover:text-[color:var(--text2)]">
        <X size={16} />
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function StagingInboxPage() {
  const params = useParams<{ uploadId: string }>()
  const uploadId = params.uploadId
  const router = useRouter()
  const queryClient = useQueryClient()
  const { apiFetch } = useApi()
  const { toasts, addToast } = useToast()

  // ── UI state ──────────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filterMode, setFilterMode] = useState<FilterMode>('all')
  const [scrubFilter, setScrubFilter] = useState<ScrubFilter | null>(null)
  const tableRef = useRef<HTMLDivElement>(null)
  const [showCommitConfirm, setShowCommitConfirm] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showSortMenu, setShowSortMenu] = useState(false)
  const [committedCount, setCommittedCount] = useState<number | null>(null)
  const [rulePrompts, setRulePrompts] = useState<Record<string, RulePromptState>>({})
  const [dismissedVendors, setDismissedVendors] = useState<Set<string>>(new Set())
  const [bulkCatOpen, setBulkCatOpen] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const sortMenuRef = useRef<HTMLDivElement>(null)
  const bulkCatRef = useRef<HTMLDivElement>(null)

  // ── Close menus on outside click ──────────────────────────────────────────
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node))
        setShowMoreMenu(false)
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node))
        setShowSortMenu(false)
      if (bulkCatRef.current && !bulkCatRef.current.contains(e.target as Node))
        setBulkCatOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // ── Data fetch ────────────────────────────────────────────────────────────
  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<StagingData>({
    queryKey: ['staging', uploadId],
    queryFn: () => apiFetch(`/api/staging/${uploadId}`),
    refetchInterval: 15_000,
  })

  const { data: categoriesData } = useQuery<{ categories: Category[] }>({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories'),
  })

  const categories = categoriesData?.categories ?? []
  const transactions = data?.transactions ?? []
  const importSummary = useMemo(() => scrubTransactions(transactions), [transactions])
  const counts = data?.counts
  const stagingUpload = data?.stagingUpload

  // ── Vendor repeat count (for rule prompt trigger) ─────────────────────────
  const vendorCountMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of transactions) {
      map.set(tx.vendorKey, (map.get(tx.vendorKey) ?? 0) + 1)
    }
    return map
  }, [transactions])

  // ── Sort + filter ─────────────────────────────────────────────────────────
  const sorted = useMemo(() => {
    const base = [...transactions]
    base.sort((a, b) => {
      let cmp = 0
      if (sortKey === 'date') {
        cmp = (a.date ?? '').localeCompare(b.date ?? '')
      } else if (sortKey === 'amount') {
        cmp = a.amountCents - b.amountCents
      } else {
        cmp = a.vendorRaw.localeCompare(b.vendorRaw)
      }
      return sortDir === 'asc' ? cmp : -cmp
    })
    return base
  }, [transactions, sortKey, sortDir])

  const filtered = useMemo(() => {
    // ScrubFilter (from ImportReview) takes precedence over filterMode chips
    if (scrubFilter) {
      return sorted.filter(tx => {
        const s = importSummary.suggestions.get(tx.id)
        if (!s) return false
        switch (scrubFilter.kind) {
          case 'category':           return s.category === scrubFilter.value
          case 'merchant_type':      return s.merchantType === scrubFilter.value
          case 'canonical_merchant': return s.canonicalMerchant === scrubFilter.value
          case 'recurring':          return s.isRecurring
          case 'transfer':           return s.isTransfer
          case 'income':             return s.isIncome
          case 'needs_review':       return s.reviewFlags.includes('needs_manual_review')
        }
      })
    }
    if (filterMode === 'all') return sorted
    if (filterMode === 'uncategorized') return sorted.filter(t => t.status === 'uncategorized')
    if (filterMode === 'needs_review') return sorted.filter(t => t.status === 'needs_review')
    if (filterMode === 'auto')
      return sorted.filter(t => t.status === 'categorized' && t.categorySource === 'rule')
    return sorted
  }, [sorted, filterMode, scrubFilter, importSummary])

  // ── Mutations ─────────────────────────────────────────────────────────────

  // PATCH single tx
  const patchTx = useMutation({
    mutationFn: ({
      txId,
      body,
    }: {
      txId: string
      body: { categoryId?: string | null; categorySource?: string; status?: string }
    }) =>
      apiFetch(`/api/staging/${uploadId}/tx/${txId}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['staging', uploadId] })
    },
    onError: (err: Error) => {
      addToast(err.message, 'error')
    },
  })

  // Apply rules
  const applyRules = useMutation({
    mutationFn: () =>
      apiFetch(`/api/staging/${uploadId}/apply-rules`, { method: 'POST' }),
    onSuccess: (res: { applied: number; review: number; unchanged: number }) => {
      void queryClient.invalidateQueries({ queryKey: ['staging', uploadId] })
      addToast(
        `Applied ${res.applied} rule${res.applied !== 1 ? 's' : ''}${res.review ? `, ${res.review} flagged for review` : ''}`,
        'success'
      )
    },
    onError: (err: Error) => {
      addToast(err.message, 'error')
    },
  })

  // Commit
  const commitMutation = useMutation({
    mutationFn: (txIds?: string[]) =>
      apiFetch(`/api/staging/${uploadId}/commit`, {
        method: 'POST',
        body: JSON.stringify(txIds && txIds.length > 0 ? { transactionIds: txIds } : {}),
      }),
    onSuccess: (res: { committed: number }) => {
      void queryClient.invalidateQueries({ queryKey: ['staging', uploadId] })
      setCommittedCount(res.committed)
      setShowCommitConfirm(false)
      setSelectedIds(new Set())
    },
    onError: (err: Error) => {
      addToast(err.message, 'error')
      setShowCommitConfirm(false)
    },
  })

  // Discard
  const discardMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/staging/${uploadId}`, { method: 'DELETE' }),
    onSuccess: () => {
      router.push('/upload')
    },
    onError: (err: Error) => {
      addToast(err.message, 'error')
      setShowDiscardConfirm(false)
    },
  })

  // Create rule
  const createRule = useMutation({
    mutationFn: (body: {
      categoryId: string
      matchType: 'vendor_exact' | 'contains'
      matchValue: string
      mode: 'always'
      confidence: 'high'
    }) =>
      apiFetch('/api/rules', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (_, vars) => {
      addToast('Rule saved!', 'success')
      // Mark prompt as saved
      setRulePrompts(prev => {
        const next = { ...prev }
        for (const key of Object.keys(next)) {
          if (next[key].vendorKey === vars.matchValue) {
            next[key] = { ...next[key], saved: true }
          }
        }
        return next
      })
    },
    onError: (err: Error) => {
      addToast(err.message, 'error')
    },
  })

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleCategoryChange(tx: StagingTransaction, catId: string) {
    const cat = categories.find(c => c.id === catId)
    patchTx.mutate({
      txId: tx.id,
      body: {
        categoryId: catId,
        categorySource: 'manual',
        status: 'categorized',
      },
    })
    // Rule prompt: vendor appears 2+ times AND vendor not dismissed
    const vendorCount = vendorCountMap.get(tx.vendorKey) ?? 1
    if (
      vendorCount >= 2 &&
      !dismissedVendors.has(tx.vendorKey) &&
      cat
    ) {
      setRulePrompts(prev => ({
        ...prev,
        [tx.id]: {
          txId: tx.id,
          vendorRaw: tx.vendorRaw || tx.description,
          vendorKey: tx.vendorKey,
          categoryId: catId,
          categoryName: cat.name,
          amountCents: tx.amountCents,
          saved: false,
          dismissed: false,
          expanded: false,
        },
      }))
    }
  }

  function handleRuleSave(
    prompt: RulePromptState,
    matchType: 'vendor_exact' | 'contains'
  ) {
    createRule.mutate({
      categoryId: prompt.categoryId,
      matchType,
      matchValue: prompt.vendorKey,
      mode: 'always',
      confidence: 'high',
    })
  }

  function handleRuleDismiss(txId: string, vendorKey: string) {
    setDismissedVendors(prev => new Set([...prev, vendorKey]))
    setRulePrompts(prev => {
      const next = { ...prev }
      if (next[txId]) next[txId] = { ...next[txId], dismissed: true }
      return next
    })
  }

  function handleTxAction(tx: StagingTransaction, newStatus: TxStatus) {
    patchTx.mutate({
      txId: tx.id,
      body: { status: newStatus },
    })
  }

  function handleSelectAll() {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filtered.map(t => t.id)))
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
    setShowSortMenu(false)
  }

  function handleBulkCategory(catId: string) {
    const ids = [...selectedIds]
    for (const id of ids) {
      patchTx.mutate({
        txId: id,
        body: { categoryId: catId, categorySource: 'manual', status: 'categorized' },
      })
    }
    setBulkCatOpen(false)
    addToast(`${ids.length} transactions categorized`, 'success')
  }

  function handleBulkTransfer() {
    for (const id of selectedIds) {
      patchTx.mutate({ txId: id, body: { status: 'transfer' } })
    }
    setSelectedIds(new Set())
  }

  function handleBulkExclude() {
    for (const id of selectedIds) {
      patchTx.mutate({ txId: id, body: { status: 'excluded' } })
    }
    setSelectedIds(new Set())
  }

  function handleBulkCommit() {
    commitMutation.mutate([...selectedIds])
  }

  function handleBulkNeedsReview() {
    const ids = [...selectedIds]
    for (const id of ids) {
      patchTx.mutate({ txId: id, body: { status: 'needs_review' } })
    }
    setSelectedIds(new Set())
    addToast(`${ids.length} transaction${ids.length !== 1 ? 's' : ''} flagged for review`, 'info')
  }

  function handleBulkIncome() {
    const ids = [...selectedIds]
    const incomeCat = categories.find(c => c.name.toLowerCase() === 'income')
    for (const id of ids) {
      patchTx.mutate({
        txId: id,
        body: incomeCat
          ? { categoryId: incomeCat.id, categorySource: 'manual', status: 'categorized' }
          : { status: 'needs_review' },
      })
    }
    setSelectedIds(new Set())
    addToast(
      incomeCat
        ? `${ids.length} transaction${ids.length !== 1 ? 's' : ''} marked as Income`
        : `${ids.length} flagged for review — add an Income category to assign directly`,
      'success',
    )
  }

  function handleBulkReset() {
    const ids = [...selectedIds]
    for (const id of ids) {
      patchTx.mutate({
        txId: id,
        body: { status: 'uncategorized', categoryId: null, categorySource: 'none' },
      })
    }
    setSelectedIds(new Set())
    addToast(`${ids.length} suggestion${ids.length !== 1 ? 's' : ''} cleared`, 'info')
  }

  const categorizedCount = counts?.categorized ?? 0

  // Sort icon helper
  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ArrowUpDown size={13} className="text-[color:var(--muted)]" />
    return sortDir === 'asc'
      ? <ArrowUp size={13} className="text-[color:var(--accent)]" />
      : <ArrowDown size={13} className="text-[color:var(--accent)]" />
  }

  // ── Render: loading ───────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <Loader2 size={28} className="animate-spin text-[color:var(--accent)]" />
          <p className="text-sm text-[color:var(--muted)]">Loading staging inbox…</p>
        </div>
      </AppShell>
    )
  }

  // ── Render: error ─────────────────────────────────────────────────────────
  if (isError) {
    return (
      <AppShell>
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-3">
          <AlertCircle size={28} className="text-[color:var(--danger)]" />
          <p className="text-sm text-[color:var(--muted)]">
            {(error as Error)?.message ?? 'Failed to load staging inbox'}
          </p>
          <button
            onClick={() => void queryClient.invalidateQueries({ queryKey: ['staging', uploadId] })}
            className="btn-secondary text-sm"
          >
            Retry
          </button>
        </div>
      </AppShell>
    )
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <AppShell>
      {/* Success banner */}
      {committedCount !== null && (
        <SuccessBanner
          count={committedCount}
          onClose={() => {
            setCommittedCount(null)
            router.push('/transactions')
          }}
        />
      )}

      {/* Confirm: commit */}
      {showCommitConfirm && (
        <ConfirmDialog
          title="Commit to Ledger?"
          body={`This will add ${categorizedCount} categorized transaction${categorizedCount !== 1 ? 's' : ''} to your budget. Uncategorized rows stay in staging.`}
          confirmLabel={`Commit ${categorizedCount}`}
          onConfirm={() => commitMutation.mutate(undefined)}
          onCancel={() => setShowCommitConfirm(false)}
          isPending={commitMutation.isPending}
        />
      )}

      {/* Confirm: discard */}
      {showDiscardConfirm && (
        <ConfirmDialog
          title="Discard this upload?"
          body="All staging transactions will be deleted. This cannot be undone."
          confirmLabel="Discard"
          danger
          onConfirm={() => discardMutation.mutate()}
          onCancel={() => setShowDiscardConfirm(false)}
          isPending={discardMutation.isPending}
        />
      )}

      {/* Toasts */}
      <ToastContainer toasts={toasts} />

      <div className="space-y-5">

        {/* ── Initial Analysis ──────────────────────────────────────────── */}
        <InitialAnalysis
          summary={importSummary}
          transactions={transactions}
          counts={{
            total: counts?.total ?? 0,
            uncategorized: counts?.uncategorized ?? 0,
            needsReview: counts?.needsReview ?? 0,
          }}
          stagingUpload={stagingUpload ?? null}
          onStartCategorizing={() => router.push('/categorize')}
          onViewTransactions={() => router.push('/categorize')}
        />

      </div>
    </AppShell>
  )
}
