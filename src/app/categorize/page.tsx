'use client'

import { useState, useCallback, useEffect, useRef, useMemo, useTransition } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { CheckCircle2, GripVertical, Loader2, AlertCircle, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Search, X, Save, Zap } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { CategoryIcon } from '@/components/CategoryIcon'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { sortCategorizeTransactions, type CatSortKey, type CatSortDir } from '@/lib/sort-transactions'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Category {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
}

interface Transaction {
  id: string
  date: string
  description: string
  merchantNormalized: string
  amount: number
  isTransfer: boolean
  categorizationSource: 'rule' | 'ai' | 'user' | 'bank'
  confidenceScore: number
  reviewedByUser: boolean
  category: { id: string; name: string; color: string; icon: string } | null
  bankCategoryRaw?: string | null
  appCategory?: string | null
}

type FilterMode = 'needs-review' | 'all'

interface ConfirmState {
  transaction: Transaction
  category: Category
  similarCount: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORY_ORDER = [
  'Food & Dining', 'Groceries', 'Housing', 'Transport', 'Entertainment',
  'Shopping', 'Health', 'Utilities', 'Subscriptions', 'Personal Care',
  'Education', 'Travel', 'Insurance', 'Pets', 'Gifts & Charity',
  'Fees & Charges', 'Income', 'Transfer', 'Other',
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  return n < 0 ? `-${abs}` : abs
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── Transaction Card ────────────────────────────────────────────────────────

function TxCard({
  tx,
  isSelected,
  onClick,
  onDragStart,
  onDragEnd,
  onTouchStart,
}: {
  tx: Transaction
  isSelected: boolean
  onClick: (tx: Transaction, e: React.MouseEvent) => void
  onDragStart: (tx: Transaction) => void
  onDragEnd: () => void
  onTouchStart: (tx: Transaction, e: React.TouchEvent) => void
}) {
  return (
    <div
      draggable
      onDragStart={e => { e.dataTransfer.setData('text/plain', tx.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(tx) }}
      onDragEnd={onDragEnd}
      onTouchStart={e => onTouchStart(tx, e)}
      onClick={e => onClick(tx, e)}
      tabIndex={0}
      className={clsx(
        'group relative flex cursor-grab items-start gap-3 rounded-lg border p-3 transition-all active:cursor-grabbing touch-none select-none',
        isSelected ? 'border-accent-500 ring-2 ring-accent-200 bg-accent-50' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md'
      )}
    >
      <div className="mt-0.5 flex-shrink-0 text-slate-300 group-hover:text-slate-400">
        <GripVertical size={16} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold text-slate-900">
            {tx.merchantNormalized || tx.description}
          </p>
          <p className={clsx('flex-shrink-0 text-sm font-bold', tx.amount < 0 ? 'text-red-600' : 'text-green-600')}>
            {fmtAmt(tx.amount)}
          </p>
        </div>

        <p className="mt-0.5 truncate text-xs text-slate-400">{fmtDate(tx.date)}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {/* App category (user-assigned) */}
          {tx.appCategory ? (
            <span className="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700 border border-green-200">
              ✓ {tx.appCategory}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
              Uncategorized
            </span>
          )}
          {/* Bank category (read-only) */}
          {tx.bankCategoryRaw && (
            <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium">
              🏦 {tx.bankCategoryRaw}
            </span>
          )}
        </div>
      </div>

    </div>
  )
}

// ─── Category Drop Target ────────────────────────────────────────────────────

function CategoryBucket({
  cat,
  isDragging,
  isHovered,
  hasSelected,
  isExpanded,
  isReorderDragging,
  isReorderOver,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onRegisterRef,
  onClickAssign,
  onToggleExpand,
  onReorderDragStart,
  onReorderDragOver,
  onReorderDrop,
  onReorderDragEnd,
  txCount,
}: {
  cat: Category
  isDragging: boolean
  isHovered: boolean
  hasSelected: boolean
  isExpanded: boolean
  isReorderDragging: boolean
  isReorderOver: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (id: string) => void
  onDragLeave: () => void
  onDrop: (id: string) => void
  onRegisterRef: (cat: Category, el: HTMLDivElement | null) => void
  onClickAssign: (id: string) => void
  onToggleExpand: (id: string) => void
  onReorderDragStart: (id: string) => void
  onReorderDragOver: (id: string) => void
  onReorderDrop: (id: string) => void
  onReorderDragEnd: () => void
  txCount?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onRegisterRef(cat, ref.current)
    return () => onRegisterRef(cat, null)
  }, [cat, onRegisterRef])

  return (
    <div
      ref={ref}
      onDragOver={e => {
        e.preventDefault()
        if (isReorderDragging) {
          e.dataTransfer.dropEffect = 'move'
          onReorderDragOver(cat.id)
        } else {
          e.dataTransfer.dropEffect = 'move'
          onDragOver(e)
        }
      }}
      onDragEnter={e => {
        e.preventDefault()
        if (!isReorderDragging) onDragEnter(cat.id)
      }}
      onDragLeave={e => {
        // Only fire when the cursor truly leaves this element (not just entering a child)
        if (!ref.current?.contains(e.relatedTarget as Node)) {
          onDragLeave()
        }
      }}
      onDrop={e => {
        e.preventDefault()
        const data = e.dataTransfer.getData('text/plain')
        if (data.startsWith('reorder:')) {
          onReorderDrop(cat.id)
        } else {
          onDrop(cat.id)
        }
      }}
      onClick={() => {
        if (!isDragging) onToggleExpand(cat.id)
      }}
      className={clsx(
        'flex items-center gap-2 rounded-lg px-3 py-2.5 transition-all duration-100',
        isHovered && isDragging
          ? 'scale-[1.04] border-4 border-solid border-accent-500 bg-accent-100 shadow-2xl ring-4 ring-accent-300 ring-offset-1'
          : isDragging
            ? 'border-2 border-dashed border-slate-300 bg-slate-50'
            : isReorderOver && isReorderDragging
              ? 'border-2 border-dashed border-accent-400 bg-accent-50'
              : 'border-2 border-dashed border-transparent bg-white hover:bg-slate-50',
        hasSelected && !isDragging ? 'cursor-pointer hover:border-slate-300' : !isDragging ? 'cursor-pointer' : '',
      )}
    >
      {/* Reorder grip */}
      <div
        draggable
        onDragStart={e => {
          e.stopPropagation()
          e.dataTransfer.setData('text/plain', 'reorder:' + cat.id)
          e.dataTransfer.effectAllowed = 'move'
          onReorderDragStart(cat.id)
        }}
        onDragEnd={e => { e.stopPropagation(); onReorderDragEnd() }}
        className="cursor-grab active:cursor-grabbing text-slate-300 hover:text-slate-500 flex-shrink-0 px-0.5 touch-none"
        title="Drag to reorder"
      >
        <GripVertical size={14} />
      </div>

      <CategoryIcon name={cat.icon} color={cat.color} size={20} />
      <span className="flex-1 text-sm font-medium text-slate-700">{cat.name}</span>
      {txCount != null && txCount > 0 && (
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
          {txCount}
        </span>
      )}
      {!isDragging && (
        <ChevronRight
          size={14}
          className={clsx(
            'flex-shrink-0 text-slate-300 transition-transform duration-150',
            isExpanded ? 'rotate-90' : ''
          )}
        />
      )}
      {isDragging && isHovered && (
        <span className="flex-shrink-0 rounded-full bg-accent-500 px-2 py-0.5 text-[10px] font-bold text-white animate-pulse">
          DROP
        </span>
      )}
    </div>
  )
}

// ─── Confirmation Modal ───────────────────────────────────────────────────────

function ConfirmModal({
  state,
  onApplyOne,
  onApplyAll,
  onCancel,
  isPending,
}: {
  state: ConfirmState
  onApplyOne: () => void
  onApplyAll: () => void
  onCancel: () => void
  isPending: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100">
            <CategoryIcon name={state.category.icon} color={state.category.color} size={20} />
          </span>
          <div>
            <h3 className="font-bold text-slate-900">Move to {state.category.name}?</h3>
            <p className="text-sm text-slate-500">
              &ldquo;{state.transaction.merchantNormalized || state.transaction.description}&rdquo;
            </p>
          </div>
        </div>

        {state.similarCount > 1 && (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
            <strong>{state.similarCount}</strong> uncategorized transactions from{' '}
            <strong>{state.transaction.merchantNormalized}</strong> found.
            Apply to all?
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onApplyOne}
            disabled={isPending}
            className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-2 text-sm font-medium text-accent-700 hover:bg-accent-100 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="inline animate-spin" /> : 'Just this one'}
          </button>
          {state.similarCount > 1 && (
            <button
              onClick={onApplyAll}
              disabled={isPending}
              className="btn-primary"
            >
              {isPending
                ? <Loader2 size={14} className="inline animate-spin" />
                : `Apply to all ${state.similarCount}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Touch Ghost ──────────────────────────────────────────────────────────────

function TouchGhost({ tx, pos }: { tx: Transaction | null; pos: { x: number; y: number } | null }) {
  if (!tx || !pos) return null
  return (
    <div
      className="pointer-events-none fixed z-[100] max-w-[180px] rounded-lg border border-accent-300 bg-white/90 p-2 shadow-lg backdrop-blur-sm"
      style={{ left: pos.x - 90, top: pos.y - 30 }}
    >
      <p className="truncate text-xs font-semibold text-slate-900">{tx.merchantNormalized || tx.description}</p>
      <p className="text-[10px] text-slate-500">{fmtAmt(tx.amount)}</p>
    </div>
  )
}

// ─── Category Transaction List ────────────────────────────────────────────────

const SOURCE_LABELS: Record<string, string> = {
  rule: '⚙️ Rule',
  ai:   '🤖 AI',
  user: '✏️ You',
  bank: '🏦 Bank',
}

function CategoryTransactionList({
  catName,
  txs,
  categories,
  onMove,
}: {
  catName: string
  txs: Transaction[]
  categories: Category[]
  onMove: (txId: string, newCatName: string, applyToAll: boolean) => void
}) {
  const [movingId,  setMovingId]  = useState<string | null>(null)
  const [catSearch, setCatSearch] = useState('')
  const [pendingMove, setPendingMove] = useState<{ txId: string; catName: string; count: number } | null>(null)

  if (txs.length === 0) {
    return (
      <div className="mt-1 mb-1 ml-8 px-3 py-2 text-xs text-slate-400 italic">
        No transactions assigned to {catName} yet
      </div>
    )
  }

  return (
    <div className="mt-1.5 mb-1 ml-2 mr-1 rounded-xl border border-slate-100 bg-white shadow-sm overflow-y-auto max-h-72">
      {txs.map(tx => (
        <div key={tx.id} className="px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0">
          <div className="flex items-start gap-2.5">
            <div className="flex-1 min-w-0">
              {/* Name + amount row */}
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-sm text-slate-800 truncate">
                  {tx.merchantNormalized || tx.description}
                </span>
                <span className={clsx('font-bold text-sm flex-shrink-0', tx.amount >= 0 ? 'text-green-700' : 'text-red-700')}>
                  {tx.amount >= 0 ? '+' : '-'}{fmtAmt(tx.amount)}
                </span>
              </div>

              {/* Badge row */}
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-xs text-slate-400">{fmtDate(tx.date)}</span>
                <span className="text-xs text-slate-300">
                  {SOURCE_LABELS[tx.categorizationSource] ?? ''}
                </span>
              </div>
              {tx.bankCategoryRaw && (
                <div className="mt-0.5 flex items-center gap-1">
                  <span className="text-[10px] font-medium text-blue-500 uppercase tracking-wide">Bank:</span>
                  <span className="text-[10px] text-blue-600 font-medium bg-blue-50 px-1.5 py-0.5 rounded">
                    {tx.bankCategoryRaw}
                  </span>
                </div>
              )}

              {/* Move picker */}
              {pendingMove?.txId === tx.id ? (
                <div className="mt-2 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-xs">
                  <p className="text-amber-800 font-medium mb-2">
                    {pendingMove.count} transactions from <strong>{tx.merchantNormalized}</strong> found.
                    Move all to <strong>{pendingMove.catName}</strong>?
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => { onMove(pendingMove.txId, pendingMove.catName, false); setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="px-2.5 py-1 rounded bg-white border border-slate-200 text-slate-700 hover:border-slate-400 font-medium transition"
                    >
                      Just this one
                    </button>
                    <button
                      onClick={() => { onMove(pendingMove.txId, pendingMove.catName, true); setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="px-2.5 py-1 rounded bg-accent-500 text-white font-medium hover:bg-accent-600 transition"
                    >
                      Move all {pendingMove.count}
                    </button>
                    <button
                      onClick={() => { setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="px-2 py-1 text-slate-400 hover:text-slate-600 transition"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : movingId === tx.id ? (
                <div className="mt-2">
                  <input
                    type="text"
                    placeholder="Search categories…"
                    autoFocus
                    value={catSearch}
                    onChange={e => setCatSearch(e.target.value)}
                    className="w-full rounded border border-slate-200 px-2 py-1 text-xs mb-1 outline-none focus:border-accent-400"
                  />
                  <div className="flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                    {categories
                      .filter(c => c.name !== catName && c.name.toLowerCase().includes(catSearch.toLowerCase()))
                      .map(c => (
                        <button
                          key={c.id}
                          onClick={() => {
                            const sameCount = txs.filter(
                              t => t.merchantNormalized === tx.merchantNormalized && t.amount === tx.amount
                            ).length
                            if (sameCount > 1) {
                              setPendingMove({ txId: tx.id, catName: c.name, count: sameCount })
                            } else {
                              onMove(tx.id, c.name, false)
                              setMovingId(null)
                              setCatSearch('')
                            }
                          }}
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-accent-50 hover:text-accent-700 transition text-slate-700 text-left"
                        >
                          <CategoryIcon name={c.icon} color={c.color} size={14} />
                          <span className="truncate">{c.name}</span>
                        </button>
                      ))}
                  </div>
                  <button
                    onClick={() => { setMovingId(null); setCatSearch('') }}
                    className="mt-1 text-xs text-slate-400 hover:text-slate-600 transition"
                  >
                    ✕ Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setMovingId(tx.id)}
                  className="mt-1.5 flex-shrink-0 px-2 py-0.5 rounded border border-slate-200 text-[10px] font-medium text-slate-500 hover:border-accent-400 hover:text-accent-600 bg-white transition"
                >
                  Move
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Remember This? Prompt ───────────────────────────────────────────────────

interface RulePromptState {
  vendor:     string   // display name (merchantNormalized)
  catName:    string
  categoryId: string
}

function RulePrompt({
  state,
  onAlways,
  onAsk,
  onDismiss,
  isPending,
}: {
  state:     RulePromptState
  onAlways:  () => void
  onAsk:     () => void
  onDismiss: () => void
  isPending: boolean
}) {
  return (
    <div className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-sm px-4">
      <div className="rounded-xl border border-accent-200 bg-white shadow-xl ring-1 ring-accent-100 p-4">
        <div className="flex items-start gap-2.5 mb-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-100">
            <Zap size={14} className="text-accent-600" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-slate-900">Remember this?</p>
            <p className="text-xs text-slate-500 mt-0.5">
              You&apos;ve assigned <strong>{state.vendor}</strong> → <strong>{state.catName}</strong> multiple times.
            </p>
          </div>
          <button onClick={onDismiss} className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition">
            <X size={14} />
          </button>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onAlways}
            disabled={isPending}
            className="flex-1 rounded-lg bg-accent-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600 disabled:opacity-50 transition"
          >
            {isPending ? <Loader2 size={12} className="inline animate-spin" /> : 'Always assign'}
          </button>
          <button
            onClick={onAsk}
            disabled={isPending}
            className="flex-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition"
          >
            Ask me next time
          </button>
          <button
            onClick={onDismiss}
            disabled={isPending}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50 transition"
          >
            No
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CategorizePage() {
  const router  = useRouter()
  const user    = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc      = useQueryClient()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [, startTransition] = useTransition()

  // ── "Remember this?" session tracking ──
  // Maps normalizedVendor -> { catName, categoryId, count }
  // After the 2nd consistent assignment we surface the rule prompt.
  const sessionAssignMap = useRef<Map<string, { catName: string; categoryId: string; count: number }>>(new Map())
  const [rulePrompt, setRulePrompt] = useState<RulePromptState | null>(null)
  // Track vendors we've already prompted (don't show twice per session)
  const promptedVendors = useRef<Set<string>>(new Set())

  // Debounced dashboard invalidation — prevents 30 refetches when bulk-categorizing
  const dashboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const invalidateDashboard = useCallback(() => {
    if (dashboardTimer.current) clearTimeout(dashboardTimer.current)
    dashboardTimer.current = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ['summary'] })
      qc.invalidateQueries({ queryKey: ['trends'] })
    }, 800)
  }, [qc])

  useEffect(() => { if (!user) router.replace('/login') }, [user, router])

  const [filterMode,    setFilterMode]    = useState<FilterMode>('needs-review')
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [anchorId,      setAnchorId]      = useState<string | null>(null)
  const [dragging,      setDragging]      = useState<Transaction | null>(null)
  const [draggingIds,   setDraggingIds]   = useState<string[]>([])
  const [hoveredCatId,  setHoveredCatId]  = useState<string | null>(null)
  const [confirm,       setConfirm]       = useState<ConfirmState | null>(null)
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null)

  // Touch drag state
  const [touchTx,    setTouchTx]    = useState<Transaction | null>(null)
  const [touchPos,   setTouchPos]   = useState<{ x: number; y: number } | null>(null)
  const [touchCatId, setTouchCatId] = useState<string | null>(null)
  const catRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Reorder drag state
  const [reorderDragId, setReorderDragId] = useState<string | null>(null)
  const [reorderOverId, setReorderOverId] = useState<string | null>(null)

  // Sort + vendor filter state (persisted to localStorage)
  const [sortKey, setSortKey] = useState<CatSortKey>(() => {
    try { return (localStorage.getItem('budgetlens:cat-sort-key') as CatSortKey) || 'date' }
    catch { return 'date' }
  })
  const [sortDir, setSortDir] = useState<CatSortDir>(() => {
    try { return (localStorage.getItem('budgetlens:cat-sort-dir') as CatSortDir) || 'desc' }
    catch { return 'desc' }
  })
  const [vendorQuery, setVendorQuery] = useState('')

  // ── Data ──
  const { data: txData, isLoading: txLoading, error: txError } = useQuery({
    queryKey: ['categorize-transactions'],
    queryFn: () => apiFetch('/api/transactions?limit=500'),
    enabled: !!user,
  })

  const { data: catData, isLoading: catLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories'),
    enabled: !!user,
  })

  const allTxs: Transaction[] = txData?.transactions ?? []

  // Build sorted categories
  const rawCategories: Category[] = useMemo(() => {
    const cats: Category[] = catData?.categories ?? []
    return [...cats].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.name)
      const bi = CATEGORY_ORDER.indexOf(b.name)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  }, [catData])

  // Category order — persisted to localStorage
  const [catOrder, setCatOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('budgetlens:cat-order')
      if (saved) return JSON.parse(saved) as string[]
    } catch { /* ignore */ }
    return []
  })
  // originalOrder = the order as last saved to the backend (dirty comparison baseline)
  const [originalOrder,  setOriginalOrder]  = useState<string[]>([])
  const [saveConfirmed,  setSaveConfirmed]  = useState(false)

  const categories: Category[] = useMemo(() => {
    if (catOrder.length === 0) return rawCategories
    const idToPos = new Map(catOrder.map((id, i) => [id, i]))
    return [...rawCategories].sort((a, b) => {
      const ai = idToPos.get(a.id) ?? 9999
      const bi = idToPos.get(b.id) ?? 9999
      return ai - bi
    })
  }, [rawCategories, catOrder])

  // Load saved order from backend on mount
  const { data: prefData } = useQuery({
    queryKey: ['category-order-pref'],
    queryFn: () => apiFetch('/api/preferences/category-order'),
    enabled: !!user,
  })

  const savePrefMutation = useMutation({
    mutationFn: (order: string[]) =>
      apiFetch('/api/preferences/category-order', {
        method: 'PUT',
        body: JSON.stringify({ order }),
      }),
  })

  // When backend data arrives, sync local order AND set the dirty-check baseline
  useEffect(() => {
    if (prefData?.order && Array.isArray(prefData.order) && prefData.order.length > 0) {
      setCatOrder(prefData.order)
      setOriginalOrder(prefData.order)
      localStorage.setItem('budgetlens:cat-order', JSON.stringify(prefData.order))
    }
  }, [prefData])

  // Queue = transactions without an appCategory
  const queueTxs: Transaction[] = useMemo(() => {
    if (filterMode === 'all') return allTxs.filter(t => !t.isTransfer)
    return allTxs.filter(t => !t.isTransfer && !t.appCategory)
  }, [allTxs, filterMode])

  const needsReviewCount = useMemo(
    () => allTxs.filter(t => !t.isTransfer && !t.appCategory).length,
    [allTxs]
  )

  // Filtered + sorted view of the queue
  const sortedQueueTxs = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase()
    const filtered = q
      ? queueTxs.filter(t =>
          (t.merchantNormalized || t.description || '').toLowerCase().includes(q)
        )
      : queueTxs
    return sortCategorizeTransactions(filtered, sortKey, sortDir)
  }, [queueTxs, sortKey, sortDir, vendorQuery])

  // Count transactions per category bucket (by appCategory matching cat.name)
  const txCountByCat = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of allTxs) {
      if (tx.appCategory) map.set(tx.appCategory, (map.get(tx.appCategory) ?? 0) + 1)
    }
    return map
  }, [allTxs])

  // ── Mutation — sets appCategory (free text) ──
  const updateMutation = useMutation({
    mutationFn: ({ id, appCategory, applyToAll }: { id: string; appCategory: string; applyToAll: boolean }) =>
      apiFetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ appCategory, applyToAll }),
      }),
    onMutate: async ({ id, applyToAll, appCategory }) => {
      await qc.cancelQueries({ queryKey: ['categorize-transactions'] })
      const prev = qc.getQueryData(['categorize-transactions'])
      qc.setQueryData(['categorize-transactions'], (old: { transactions: Transaction[] } | undefined) => {
        if (!old) return old
        const affectedTx = old.transactions.find(t => t.id === id)
        const merchant   = affectedTx?.merchantNormalized
        const amount     = affectedTx?.amount
        const removeIds  = new Set(
          applyToAll && merchant
            ? old.transactions.filter(t => t.merchantNormalized === merchant && t.amount === amount && !t.appCategory).map(t => t.id)
            : [id]
        )
        return { ...old, transactions: old.transactions.filter(t => !removeIds.has(t.id)) }
      })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['categorize-transactions'], ctx.prev)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categorize-transactions'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      invalidateDashboard()   // debounced — collapses rapid changes into one refetch
    },
  })

  // ── Rule creation mutation ──
  const createRuleMutation = useMutation({
    mutationFn: ({ matchValue, categoryId, mode }: { matchValue: string; categoryId: string; mode: 'always' | 'ask' }) =>
      apiFetch('/api/rules', {
        method: 'POST',
        body: JSON.stringify({ matchType: 'vendor_exact', matchValue, categoryId, mode }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] })
      setRulePrompt(null)
    },
  })

  // ── Helpers ──
  const countSimilar = useCallback((merchant: string, amount: number) =>
    allTxs.filter(t => t.merchantNormalized === merchant && t.amount === amount && !t.appCategory).length,
    [allTxs]
  )

  // Track a session assignment and maybe surface the "Remember this?" prompt
  const trackSessionAssign = useCallback((vendor: string, catName: string, catId: string) => {
    if (!vendor) return
    const key = vendor.toLowerCase().trim()
    if (promptedVendors.current.has(key)) return   // already prompted this session
    const existing = sessionAssignMap.current.get(key)
    if (existing && existing.catName === catName) {
      const newCount = existing.count + 1
      sessionAssignMap.current.set(key, { catName, categoryId: catId, count: newCount })
      if (newCount >= 2) {
        promptedVendors.current.add(key)
        setRulePrompt({ vendor, catName, categoryId: catId })
      }
    } else {
      // Different category or first time — reset counter
      sessionAssignMap.current.set(key, { catName, categoryId: catId, count: 1 })
    }
  }, [])

  // initiateAssign: takes a Category object's id, looks up the cat, then sets appCategory = cat.name
  const initiateAssign = useCallback((tx: Transaction, categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) return
    const similarCount = countSimilar(tx.merchantNormalized, tx.amount)
    if (similarCount <= 1) {
      updateMutation.mutate({ id: tx.id, appCategory: cat.name, applyToAll: false })
      trackSessionAssign(tx.merchantNormalized, cat.name, cat.id)
      setSelectedIds(new Set()); setAnchorId(null)
      return
    }
    setConfirm({ transaction: tx, category: cat, similarCount })
  }, [categories, countSimilar, updateMutation, trackSessionAssign])

  // ── Click handler (multi-select) ──
  const handleTxClick = useCallback((tx: Transaction, e: React.MouseEvent) => {
    const isCtrl = e.ctrlKey || e.metaKey
    const isShift = e.shiftKey

    if (isShift && anchorId) {
      const anchorIdx = sortedQueueTxs.findIndex(t => t.id === anchorId)
      const clickIdx  = sortedQueueTxs.findIndex(t => t.id === tx.id)
      if (anchorIdx === -1 || clickIdx === -1) {
        setSelectedIds(new Set([tx.id]))
        setAnchorId(tx.id)
        return
      }
      const [lo, hi] = anchorIdx < clickIdx ? [anchorIdx, clickIdx] : [clickIdx, anchorIdx]
      setSelectedIds(new Set(sortedQueueTxs.slice(lo, hi + 1).map(t => t.id)))
    } else if (isCtrl) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        if (next.has(tx.id)) next.delete(tx.id)
        else next.add(tx.id)
        return next
      })
      setAnchorId(tx.id)
    } else {
      setSelectedIds(new Set([tx.id]))
      setAnchorId(tx.id)
    }
  }, [anchorId, sortedQueueTxs])

  // ── Drag handlers ──
  const handleDragEnd = useCallback(() => {
    setDragging(null)
    setDraggingIds([])
    setHoveredCatId(null)
  }, [])

  const handleDragStart = useCallback((tx: Transaction) => {
    if (selectedIds.has(tx.id) && selectedIds.size > 1) {
      setDraggingIds([...selectedIds])
    } else {
      setDraggingIds([tx.id])
    }
    setDragging(tx)
  }, [selectedIds])

  const handleDrop = useCallback((categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) { setDragging(null); setDraggingIds([]); setHoveredCatId(null); return }

    if (draggingIds.length > 1) {
      // Bulk assign all selected — no confirm modal
      draggingIds.forEach(id => {
        updateMutation.mutate({ id, appCategory: cat.name, applyToAll: false })
      })
      setSelectedIds(new Set())
      setAnchorId(null)
    } else if (dragging) {
      initiateAssign(dragging, categoryId)
    }
    setDragging(null)
    setDraggingIds([])
    setHoveredCatId(null)
  }, [dragging, draggingIds, categories, initiateAssign, updateMutation])

  const handleClickAssign = useCallback((categoryId: string) => {
    const anchored = sortedQueueTxs.find(t => t.id === anchorId)
    if (anchored) initiateAssign(anchored, categoryId)
  }, [anchorId, sortedQueueTxs, initiateAssign])

  // ── Sort handlers ──
  function handleCatSort(key: CatSortKey) {
    if (sortKey === key) {
      const next: CatSortDir = sortDir === 'asc' ? 'desc' : 'asc'
      setSortDir(next)
      localStorage.setItem('budgetlens:cat-sort-dir', next)
    } else {
      const defaultDir: CatSortDir = key === 'vendor' ? 'asc' : 'desc'
      setSortKey(key)
      setSortDir(defaultDir)
      localStorage.setItem('budgetlens:cat-sort-key', key)
      localStorage.setItem('budgetlens:cat-sort-dir', defaultDir)
    }
  }

  function resetSort() {
    setSortKey('date'); setSortDir('desc')
    localStorage.setItem('budgetlens:cat-sort-key', 'date')
    localStorage.setItem('budgetlens:cat-sort-dir', 'desc')
    setVendorQuery('')
  }

  // ── Reorder handlers ──
  const handleCatReorderStart = useCallback((catId: string) => {
    setReorderDragId(catId)
  }, [])

  const handleCatReorderOver = useCallback((catId: string) => {
    setReorderOverId(catId)
  }, [])

  const handleCatReorderDrop = useCallback((targetId: string) => {
    if (!reorderDragId || reorderDragId === targetId) {
      setReorderDragId(null); setReorderOverId(null); return
    }
    setCatOrder(prev => {
      const order = prev.length > 0 ? prev : categories.map(c => c.id)
      const from  = order.indexOf(reorderDragId)
      const to    = order.indexOf(targetId)
      if (from === -1 || to === -1) return prev
      const next = [...order]
      next.splice(from, 1)
      next.splice(to, 0, reorderDragId)
      localStorage.setItem('budgetlens:cat-order', JSON.stringify(next))
      return next
    })
    setReorderDragId(null); setReorderOverId(null)
  }, [reorderDragId, categories])

  const handleCatReorderEnd = useCallback(() => {
    setReorderDragId(null); setReorderOverId(null)
  }, [])

  // ── Finish Categorizing ──
  function handleFinishCategorizing() {
    // Cancel pending debounce and flush immediately so Dashboard gets fresh data
    if (dashboardTimer.current) { clearTimeout(dashboardTimer.current); dashboardTimer.current = null }
    qc.invalidateQueries({ queryKey: ['summary'] })
    qc.invalidateQueries({ queryKey: ['trends'] })
    startTransition(() => router.push('/dashboard'))
  }

  // ── Save Layout ──
  const isDirty = (() => {
    const a = catOrder.length > 0 ? catOrder : categories.map(c => c.id)
    const b = originalOrder.length > 0 ? originalOrder : categories.map(c => c.id)
    return a.length !== b.length || a.some((id, i) => id !== b[i])
  })()

  function handleSaveLayout() {
    const orderToSave = catOrder.length > 0 ? catOrder : categories.map(c => c.id)
    savePrefMutation.mutate(orderToSave, {
      onSuccess: () => {
        setOriginalOrder(orderToSave)
        setSaveConfirmed(true)
        setTimeout(() => setSaveConfirmed(false), 2000)
      },
    })
  }

  // ── Touch drag ──
  const registerCatRef = useCallback((cat: Category, el: HTMLDivElement | null) => {
    if (el) catRefs.current.set(cat.id, el)
    else    catRefs.current.delete(cat.id)
  }, [])

  const handleTouchStart = useCallback((tx: Transaction, e: React.TouchEvent) => {
    const t = e.touches[0]
    setTouchTx(tx)
    setTouchPos({ x: t.clientX, y: t.clientY })
    setDragging(tx)
  }, [])

  useEffect(() => {
    if (!touchTx) return

    const onMove = (e: TouchEvent) => {
      e.preventDefault()
      const t = e.touches[0]
      setTouchPos({ x: t.clientX, y: t.clientY })
      let found: string | null = null
      catRefs.current.forEach((el, catId) => {
        const r = el.getBoundingClientRect()
        if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom)
          found = catId
      })
      setTouchCatId(found)
      setHoveredCatId(found)
    }

    const onEnd = () => {
      if (touchCatId && touchTx) initiateAssign(touchTx, touchCatId)
      setTouchTx(null); setTouchPos(null); setDragging(null)
      setHoveredCatId(null); setTouchCatId(null)
    }

    document.addEventListener('touchmove', onMove, { passive: false })
    document.addEventListener('touchend', onEnd)
    document.addEventListener('touchcancel', onEnd)
    return () => {
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
      document.removeEventListener('touchcancel', onEnd)
    }
  }, [touchTx, touchCatId, initiateAssign])

  // ── Keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (confirm) {
        if (e.key === 'Escape') setConfirm(null)
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const idx  = sortedQueueTxs.findIndex(t => t.id === anchorId)
        const next = sortedQueueTxs[Math.min(idx + 1, sortedQueueTxs.length - 1)]
        if (next) { setSelectedIds(new Set([next.id])); setAnchorId(next.id) }
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const idx  = sortedQueueTxs.findIndex(t => t.id === anchorId)
        const prev = sortedQueueTxs[Math.max(idx - 1, 0)]
        if (prev) { setSelectedIds(new Set([prev.id])); setAnchorId(prev.id) }
      }
      if (e.key === 'Escape') { setSelectedIds(new Set()); setAnchorId(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, anchorId, sortedQueueTxs])

  // Auto-select first visible item if none selected
  useEffect(() => {
    if (selectedIds.size === 0 && sortedQueueTxs.length > 0) {
      const first = sortedQueueTxs[0]
      setSelectedIds(new Set([first.id]))
      setAnchorId(first.id)
    }
  }, [sortedQueueTxs, selectedIds])

  // Clear selection when filter tab changes
  useEffect(() => {
    setSelectedIds(new Set())
    setAnchorId(null)
  }, [filterMode])

  // ── Render ──
  if (!user) return null

  if (txLoading || catLoading) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center gap-3 text-slate-500">
          <Loader2 size={24} className="animate-spin text-accent-500" />
          Loading transactions…
        </div>
      </AppShell>
    )
  }

  if (txError) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-red-600">
          <AlertCircle size={32} />
          <p className="font-semibold">Failed to load transactions</p>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['categorize-transactions'] })} className="btn-primary">
            Retry
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <main className="max-w-6xl mx-auto px-4 py-6 pb-24">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Categorize</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Bank categories (blue) are imported automatically. Drag transactions to assign your own App Category.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {needsReviewCount > 0 && (
              <span className="badge bg-amber-100 text-amber-700">
                {needsReviewCount} uncategorized
              </span>
            )}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-semibold">
              <button
                onClick={() => setFilterMode('needs-review')}
                className={clsx('px-3 py-1.5 transition', filterMode === 'needs-review' ? 'bg-accent-500 text-white' : 'text-slate-600 hover:bg-slate-50')}
              >
                Uncategorized
              </button>
              <button
                onClick={() => setFilterMode('all')}
                className={clsx('px-3 py-1.5 transition', filterMode === 'all' ? 'bg-accent-500 text-white' : 'text-slate-600 hover:bg-slate-50')}
              >
                All
              </button>
            </div>
            <button
              onClick={handleFinishCategorizing}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-green-700 transition"
            >
              Finish Categorizing →
            </button>
          </div>
        </div>

        {queueTxs.length === 0 ? (
          /* All caught up */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 size={32} className="text-green-600" />
            </div>
            <h2 className="text-xl font-bold text-slate-800">All caught up!</h2>
            <p className="mt-2 max-w-sm text-sm text-slate-500">
              {filterMode === 'needs-review'
                ? 'Every transaction has an app category. New imports will appear here.'
                : 'No transactions to show.'}
            </p>
            <button onClick={() => router.push('/dashboard')} className="btn-primary mt-6">
              Go to Dashboard →
            </button>
          </div>
        ) : (
          /* Two-column layout */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* LEFT: Category drop targets */}
            <div>
              {/* Panel header: label + Save Layout button */}
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Categories
                </span>
                <button
                  onClick={handleSaveLayout}
                  disabled={(!isDirty && !saveConfirmed) || savePrefMutation.isPending}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition',
                    saveConfirmed
                      ? 'border-green-300 bg-green-50 text-green-700'
                      : isDirty
                        ? 'border-accent-500 bg-accent-500 text-white hover:bg-accent-600'
                        : 'border-slate-200 bg-white text-slate-300 cursor-not-allowed'
                  )}
                >
                  {savePrefMutation.isPending
                    ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                    : saveConfirmed
                      ? <>✓ Saved</>
                      : <><Save size={12} /> Save Layout</>
                  }
                </button>
              </div>

              {/* Category rows — grouped into pairs so the accordion expands inline under its row */}
              <div className="max-h-[calc(100vh-270px)] overflow-y-auto pr-1">
                {Array.from({ length: Math.ceil(categories.length / 2) }, (_, rowIdx) => {
                  const row = categories.slice(rowIdx * 2, rowIdx * 2 + 2)
                  const expandedCat = row.find(c => c.id === expandedCatId)
                    ? categories.find(c => c.id === expandedCatId)!
                    : null
                  return (
                    <div key={rowIdx}>
                      <div className="grid grid-cols-2 gap-1.5 mb-1.5">
                        {row.map(cat => (
                          <CategoryBucket
                            key={cat.id}
                            cat={cat}
                            isDragging={!!dragging}
                            isHovered={hoveredCatId === cat.id}
                            hasSelected={selectedIds.size > 0}
                            isExpanded={expandedCatId === cat.id}
                            isReorderDragging={!!reorderDragId}
                            isReorderOver={reorderOverId === cat.id}
                            onDragOver={() => {}}
                            onDragEnter={setHoveredCatId}
                            onDragLeave={() => setHoveredCatId(null)}
                            onDrop={handleDrop}
                            onRegisterRef={registerCatRef}
                            onClickAssign={handleClickAssign}
                            onToggleExpand={(id) => setExpandedCatId(prev => prev === id ? null : id)}
                            onReorderDragStart={handleCatReorderStart}
                            onReorderDragOver={handleCatReorderOver}
                            onReorderDrop={handleCatReorderDrop}
                            onReorderDragEnd={handleCatReorderEnd}
                            txCount={txCountByCat.get(cat.name) ?? 0}
                          />
                        ))}
                        {/* Fill empty cell if odd number of categories */}
                        {row.length === 1 && <div />}
                      </div>

                      {/* Inline accordion — spans full width, appears directly under this row */}
                      {expandedCat && (
                        <div className="mb-2 rounded-xl border border-slate-200 bg-slate-50 shadow-inner overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-white">
                            <span className="text-xs font-semibold text-slate-600 flex items-center gap-1.5">
                              <CategoryIcon name={expandedCat.icon} color={expandedCat.color} size={14} />
                              {expandedCat.name}
                            </span>
                            <button
                              onClick={() => setExpandedCatId(null)}
                              className="text-xs text-slate-400 hover:text-slate-600 transition"
                            >
                              ✕ close
                            </button>
                          </div>
                          <CategoryTransactionList
                            catName={expandedCat.name}
                            txs={allTxs.filter(t => t.appCategory === expandedCat.name)}
                            categories={categories}
                            onMove={(txId, newCatName, applyToAll) => {
                              updateMutation.mutate({ id: txId, appCategory: newCatName, applyToAll })
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* RIGHT: Transaction queue */}
            <div>
              {/* ── Sort + filter controls ──────────────────────────── */}
              <div className="mb-2 space-y-2">
                {/* Sort buttons row */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 mr-0.5">Sort:</span>
                  {(['date', 'amount', 'vendor'] as CatSortKey[]).map(key => {
                    const active = sortKey === key
                    const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                    const label = key === 'date' ? 'Date' : key === 'amount' ? 'Amount' : 'Vendor'
                    return (
                      <button
                        key={key}
                        onClick={() => handleCatSort(key)}
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
                          active
                            ? 'border-accent-400 bg-accent-50 text-accent-700'
                            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-400 hover:text-slate-700'
                        )}
                      >
                        {label}<Icon size={11} />
                      </button>
                    )
                  })}
                  {(sortKey !== 'date' || sortDir !== 'desc' || vendorQuery) && (
                    <button
                      onClick={resetSort}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-400 hover:text-slate-600 transition"
                      title="Reset to default sort"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Vendor filter */}
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Filter by vendor…"
                    value={vendorQuery}
                    onChange={e => setVendorQuery(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-7 pr-7 text-xs text-slate-700 placeholder-slate-400 outline-none focus:border-accent-400 transition"
                  />
                  {vendorQuery && (
                    <button
                      onClick={() => setVendorQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Count label */}
              <div className="mb-2 flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {sortedQueueTxs.length}
                  {vendorQuery && queueTxs.length !== sortedQueueTxs.length ? ` of ${queueTxs.length}` : ''}
                  {' '}transaction{sortedQueueTxs.length !== 1 ? 's' : ''}
                </p>
                {selectedIds.size > 1 && (
                  <span className="text-xs font-semibold text-accent-600 bg-accent-50 border border-accent-200 rounded-full px-2 py-0.5">
                    {selectedIds.size} selected
                  </span>
                )}
              </div>

              <div className="space-y-2 max-h-[calc(100vh-300px)] overflow-y-auto pr-1">
                {sortedQueueTxs.map((tx) => (
                  <TxCard
                    key={tx.id}
                    tx={tx}
                    isSelected={selectedIds.has(tx.id)}
                    onClick={handleTxClick}
                    onDragStart={handleDragStart}
                    onDragEnd={handleDragEnd}
                    onTouchStart={handleTouchStart}
                  />
                ))}
                {sortedQueueTxs.length === 0 && vendorQuery && (
                  <div className="py-8 text-center text-sm text-slate-400">
                    No transactions match &ldquo;{vendorQuery}&rdquo;
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Touch ghost element */}
      <TouchGhost tx={touchTx} pos={touchPos} />

      {/* "Remember this?" rule prompt */}
      {rulePrompt && (
        <RulePrompt
          state={rulePrompt}
          isPending={createRuleMutation.isPending}
          onAlways={() => createRuleMutation.mutate({
            matchValue: rulePrompt.vendor,
            categoryId: rulePrompt.categoryId,
            mode: 'always',
          })}
          onAsk={() => createRuleMutation.mutate({
            matchValue: rulePrompt.vendor,
            categoryId: rulePrompt.categoryId,
            mode: 'ask',
          })}
          onDismiss={() => setRulePrompt(null)}
        />
      )}

      {/* Confirmation modal */}
      {confirm && (
        <ConfirmModal
          state={confirm}
          isPending={updateMutation.isPending}
          onCancel={() => setConfirm(null)}
          onApplyOne={() => {
            updateMutation.mutate(
              { id: confirm.transaction.id, appCategory: confirm.category.name, applyToAll: false },
              { onSuccess: () => {
                trackSessionAssign(confirm.transaction.merchantNormalized, confirm.category.name, confirm.category.id)
                setConfirm(null); setSelectedIds(new Set()); setAnchorId(null)
              } }
            )
          }}
          onApplyAll={() => {
            updateMutation.mutate(
              { id: confirm.transaction.id, appCategory: confirm.category.name, applyToAll: true },
              { onSuccess: () => {
                trackSessionAssign(confirm.transaction.merchantNormalized, confirm.category.name, confirm.category.id)
                setConfirm(null); setSelectedIds(new Set()); setAnchorId(null)
              } }
            )
          }}
        />
      )}
    </AppShell>
  )
}
