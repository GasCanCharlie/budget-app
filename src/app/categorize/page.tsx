'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { CheckCircle2, GripVertical, Loader2, AlertCircle, ChevronRight } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { CategoryIcon } from '@/components/CategoryIcon'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

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
  index,
  isSelected,
  onSelect,
  onDragStart,
  onDragEnd,
  onTouchStart,
}: {
  tx: Transaction
  index: number
  isSelected: boolean
  onSelect: (id: string) => void
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
      onClick={() => onSelect(tx.id)}
      tabIndex={0}
      className={clsx(
        'group relative flex cursor-grab items-start gap-3 rounded-lg border bg-white p-3 transition-all active:cursor-grabbing touch-none select-none',
        isSelected ? 'border-accent-500 ring-2 ring-accent-200' : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
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

      {/* Selected indicator */}
      {isSelected && (
        <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-accent-500 text-[10px] font-bold text-white">
          {index + 1}
        </div>
      )}
    </div>
  )
}

// ─── Category Drop Target ────────────────────────────────────────────────────

function CategoryBucket({
  cat,
  index,
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
  index: number
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
      {index < 9 && (
        <kbd className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 sm:inline-block">
          {index + 1}
        </kbd>
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CategorizePage() {
  const router  = useRouter()
  const user    = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc      = useQueryClient()

  useEffect(() => { if (!user) router.replace('/') }, [user, router])

  const [filterMode,    setFilterMode]    = useState<FilterMode>('needs-review')
  const [selectedId,    setSelectedId]    = useState<string | null>(null)
  const [dragging,      setDragging]      = useState<Transaction | null>(null)
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

  const categories: Category[] = useMemo(() => {
    if (catOrder.length === 0) return rawCategories
    const idToPos = new Map(catOrder.map((id, i) => [id, i]))
    return [...rawCategories].sort((a, b) => {
      const ai = idToPos.get(a.id) ?? 9999
      const bi = idToPos.get(b.id) ?? 9999
      return ai - bi
    })
  }, [rawCategories, catOrder])

  // Queue = transactions without an appCategory
  const queueTxs: Transaction[] = useMemo(() => {
    if (filterMode === 'all') return allTxs.filter(t => !t.isTransfer)
    return allTxs.filter(t => !t.isTransfer && !t.appCategory)
  }, [allTxs, filterMode])

  const needsReviewCount = useMemo(
    () => allTxs.filter(t => !t.isTransfer && !t.appCategory).length,
    [allTxs]
  )

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
      qc.invalidateQueries({ queryKey: ['summary'] })
    },
  })

  // ── Helpers ──
  const countSimilar = useCallback((merchant: string, amount: number) =>
    allTxs.filter(t => t.merchantNormalized === merchant && t.amount === amount && !t.appCategory).length,
    [allTxs]
  )

  // initiateAssign: takes a Category object's id, looks up the cat, then sets appCategory = cat.name
  const initiateAssign = useCallback((tx: Transaction, categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) return
    const similarCount = countSimilar(tx.merchantNormalized, tx.amount)
    if (similarCount <= 1) {
      updateMutation.mutate({ id: tx.id, appCategory: cat.name, applyToAll: false })
      setSelectedId(null)
      return
    }
    setConfirm({ transaction: tx, category: cat, similarCount })
  }, [categories, countSimilar, updateMutation])

  // ── Drag handlers ──
  const handleDragEnd = useCallback(() => {
    setDragging(null)
    setHoveredCatId(null)
  }, [])

  const handleDrop = useCallback((categoryId: string) => {
    if (dragging) initiateAssign(dragging, categoryId)
    setDragging(null)
    setHoveredCatId(null)
  }, [dragging, initiateAssign])

  const handleClickAssign = useCallback((categoryId: string) => {
    const tx = queueTxs.find(t => t.id === selectedId)
    if (tx) initiateAssign(tx, categoryId)
  }, [selectedId, queueTxs, initiateAssign])

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
      const num = parseInt(e.key)
      if (num >= 1 && num <= 9 && selectedId) {
        const cat = categories[num - 1]
        if (cat) {
          e.preventDefault()
          const tx = queueTxs.find(t => t.id === selectedId)
          if (tx) initiateAssign(tx, cat.id)
        }
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const idx  = queueTxs.findIndex(t => t.id === selectedId)
        const next = queueTxs[Math.min(idx + 1, queueTxs.length - 1)]
        if (next) setSelectedId(next.id)
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const idx  = queueTxs.findIndex(t => t.id === selectedId)
        const prev = queueTxs[Math.max(idx - 1, 0)]
        if (prev) setSelectedId(prev.id)
      }
      if (e.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [confirm, selectedId, queueTxs, categories, initiateAssign])

  // Auto-select first if none selected
  useEffect(() => {
    if (!selectedId && queueTxs.length > 0) setSelectedId(queueTxs[0].id)
  }, [queueTxs, selectedId])

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
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Categories · click to expand · drag or press 1–9 to assign
              </p>
              <div className="max-h-[calc(100vh-240px)] overflow-y-auto pr-1 space-y-2">
                {/* 2-column grid of category buttons */}
                <div className="grid grid-cols-2 gap-1.5">
                  {categories.map((cat, i) => (
                    <CategoryBucket
                      key={cat.id}
                      cat={cat}
                      index={i}
                      isDragging={!!dragging}
                      isHovered={hoveredCatId === cat.id}
                      hasSelected={!!selectedId}
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
                </div>
                {/* Expanded transaction list spans full width below the grid */}
                {expandedCatId && (() => {
                  const cat = categories.find(c => c.id === expandedCatId)
                  return cat ? (
                    <CategoryTransactionList
                      catName={cat.name}
                      txs={allTxs.filter(t => t.appCategory === cat.name)}
                      categories={categories}
                      onMove={(txId, newCatName, applyToAll) => {
                        updateMutation.mutate({ id: txId, appCategory: newCatName, applyToAll })
                      }}
                    />
                  ) : null
                })()}
              </div>
            </div>

            {/* RIGHT: Transaction queue */}
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {queueTxs.length} transaction{queueTxs.length !== 1 ? 's' : ''} — drag to the left
                {selectedId && ' · or press 1–9'}
              </p>
              <div className="space-y-2 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
                {queueTxs.map((tx, i) => (
                  <TxCard
                    key={tx.id}
                    tx={tx}
                    index={i}
                    isSelected={tx.id === selectedId}
                    onSelect={setSelectedId}
                    onDragStart={setDragging}
                    onDragEnd={handleDragEnd}
                    onTouchStart={handleTouchStart}
                  />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Keyboard hint */}
        <p className="mt-4 text-center text-xs text-slate-400 hidden sm:block">
          ↑↓ or J/K to navigate · 1–9 to assign · Drag left onto a category
        </p>
      </main>

      {/* Touch ghost element */}
      <TouchGhost tx={touchTx} pos={touchPos} />

      {/* Confirmation modal */}
      {confirm && (
        <ConfirmModal
          state={confirm}
          isPending={updateMutation.isPending}
          onCancel={() => setConfirm(null)}
          onApplyOne={() => {
            updateMutation.mutate(
              { id: confirm.transaction.id, appCategory: confirm.category.name, applyToAll: false },
              { onSuccess: () => { setConfirm(null); setSelectedId(null) } }
            )
          }}
          onApplyAll={() => {
            updateMutation.mutate(
              { id: confirm.transaction.id, appCategory: confirm.category.name, applyToAll: true },
              { onSuccess: () => { setConfirm(null); setSelectedId(null) } }
            )
          }}
        />
      )}
    </AppShell>
  )
}
