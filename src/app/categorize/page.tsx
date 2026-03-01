'use client'

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { CheckCircle2, GripVertical, ArrowRight, Loader2, AlertCircle } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
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

interface TxCategory {
  id: string
  name: string
  color: string
  icon: string
}

interface Transaction {
  id: string
  date: string
  description: string
  merchantNormalized: string
  amount: number
  isTransfer: boolean
  categorizationSource: 'rule' | 'ai' | 'user'
  confidenceScore: number
  reviewedByUser: boolean
  category: TxCategory | null
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
  const srcIcon = tx.categorizationSource === 'user' ? '✏️' : tx.categorizationSource === 'rule' ? '⚙️' : '🤖'
  const lowConf  = tx.categorizationSource === 'ai' && tx.confidenceScore < 0.75

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

        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-xs">{srcIcon}</span>
          <span className={clsx(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            tx.category ? 'bg-slate-100 text-slate-600' : 'bg-amber-50 text-amber-700'
          )}>
            {tx.category?.name ?? 'Uncategorized'}
          </span>
          {lowConf && (
            <span className="text-xs text-amber-500">{(tx.confidenceScore * 100).toFixed(0)}%</span>
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
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onRegisterRef,
  onClickAssign,
}: {
  cat: Category
  index: number
  isDragging: boolean
  isHovered: boolean
  hasSelected: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragEnter: (id: string) => void
  onDragLeave: () => void
  onDrop: (id: string) => void
  onRegisterRef: (cat: Category, el: HTMLDivElement | null) => void
  onClickAssign: (id: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    onRegisterRef(cat, ref.current)
    return () => onRegisterRef(cat, null)
  }, [cat, onRegisterRef])

  return (
    <div
      ref={ref}
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; onDragOver(e) }}
      onDragEnter={e => { e.preventDefault(); onDragEnter(cat.id) }}
      onDragLeave={onDragLeave}
      onDrop={e => { e.preventDefault(); onDrop(cat.id) }}
      onClick={() => { if (hasSelected) onClickAssign(cat.id) }}
      className={clsx(
        'flex items-center gap-2 rounded-lg border-2 border-dashed px-3 py-2.5 transition-all',
        isHovered && isDragging
          ? 'scale-[1.02] border-solid border-accent-500 bg-accent-50 shadow-md'
          : isDragging
            ? 'border-slate-200 bg-slate-50'
            : 'border-transparent bg-white hover:bg-slate-50',
        hasSelected && !isDragging ? 'cursor-pointer hover:border-slate-300' : ''
      )}
    >
      <span className="text-lg">{cat.icon}</span>
      <span className="flex-1 text-sm font-medium text-slate-700">{cat.name}</span>
      {index < 9 && (
        <kbd className="hidden rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-400 sm:inline-block">
          {index + 1}
        </kbd>
      )}
      {isDragging && isHovered && <ArrowRight size={14} className="animate-pulse text-accent-500" />}
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
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 text-xl">
            {state.category.icon}
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
            <strong>{state.similarCount}</strong> unreviewed transactions from{' '}
            <strong>{state.transaction.merchantNormalized}</strong> found.
            Apply to all + save as a rule for future imports?
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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CategorizePage() {
  const router  = useRouter()
  const user    = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc      = useQueryClient()

  useEffect(() => { if (!user) router.replace('/') }, [user, router])

  const [filterMode,   setFilterMode]   = useState<FilterMode>('needs-review')
  const [selectedId,   setSelectedId]   = useState<string | null>(null)
  const [dragging,     setDragging]     = useState<Transaction | null>(null)
  const [hoveredCatId, setHoveredCatId] = useState<string | null>(null)
  const [confirm,      setConfirm]      = useState<ConfirmState | null>(null)

  // Touch drag state
  const [touchTx,  setTouchTx]  = useState<Transaction | null>(null)
  const [touchPos, setTouchPos] = useState<{ x: number; y: number } | null>(null)
  const [touchCatId, setTouchCatId] = useState<string | null>(null)
  const catRefs = useRef<Map<string, HTMLDivElement>>(new Map())

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

  const categories: Category[] = useMemo(() => {
    const cats: Category[] = catData?.categories ?? []
    return [...cats].sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a.name)
      const bi = CATEGORY_ORDER.indexOf(b.name)
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
    })
  }, [catData])

  const queueTxs: Transaction[] = useMemo(() => {
    if (filterMode === 'all') return allTxs.filter(t => !t.isTransfer)
    return allTxs.filter(t => {
      if (t.isTransfer) return false
      if (t.reviewedByUser) return false
      if (!t.category || t.category.name === 'Other') return true
      if (t.categorizationSource === 'ai' && t.confidenceScore < 0.75) return true
      return false
    })
  }, [allTxs, filterMode])

  const needsReviewCount = useMemo(() => allTxs.filter(t => {
    if (t.isTransfer || t.reviewedByUser) return false
    if (!t.category || t.category.name === 'Other') return true
    if (t.categorizationSource === 'ai' && t.confidenceScore < 0.75) return true
    return false
  }).length, [allTxs])

  // ── Mutation ──
  const updateMutation = useMutation({
    mutationFn: ({ id, categoryId, applyToAll }: { id: string; categoryId: string; applyToAll: boolean }) =>
      apiFetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ categoryId, applyToAll }),
      }),
    onMutate: async ({ id, applyToAll, categoryId: _categoryId }) => {
      // Cancel any in-flight refetches
      await qc.cancelQueries({ queryKey: ['categorize-transactions'] })
      // Snapshot previous data for rollback
      const prev = qc.getQueryData(['categorize-transactions'])
      // Optimistically remove the categorized transaction(s) from the list
      qc.setQueryData(['categorize-transactions'], (old: { transactions: Transaction[] } | undefined) => {
        if (!old) return old
        // Find the merchant name of the affected tx for applyToAll
        const affectedTx = old.transactions.find(t => t.id === id)
        const merchant = affectedTx?.merchantNormalized
        const removeIds = new Set(
          applyToAll && merchant
            ? old.transactions.filter(t => t.merchantNormalized === merchant && !t.reviewedByUser).map(t => t.id)
            : [id]
        )
        return { ...old, transactions: old.transactions.filter(t => !removeIds.has(t.id)) }
      })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      // Roll back on error
      if (ctx?.prev) qc.setQueryData(['categorize-transactions'], ctx.prev)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categorize-transactions'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
    },
  })

  // ── Helpers ──
  const countSimilar = useCallback((merchant: string) =>
    allTxs.filter(t => t.merchantNormalized === merchant && !t.reviewedByUser).length,
    [allTxs]
  )

  const initiateAssign = useCallback((tx: Transaction, categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) return
    setConfirm({ transaction: tx, category: cat, similarCount: countSimilar(tx.merchantNormalized) })
  }, [categories, countSimilar])

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
        const idx = queueTxs.findIndex(t => t.id === selectedId)
        const next = queueTxs[Math.min(idx + 1, queueTxs.length - 1)]
        if (next) setSelectedId(next.id)
      }
      if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const idx = queueTxs.findIndex(t => t.id === selectedId)
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
              Drag transactions into a category on the left, or select one and press a number key.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {needsReviewCount > 0 && (
              <span className="badge bg-amber-100 text-amber-700">
                {needsReviewCount} need review
              </span>
            )}
            <div className="flex rounded-lg border border-slate-200 overflow-hidden text-sm font-semibold">
              <button
                onClick={() => setFilterMode('needs-review')}
                className={clsx('px-3 py-1.5 transition', filterMode === 'needs-review' ? 'bg-accent-500 text-white' : 'text-slate-600 hover:bg-slate-50')}
              >
                Needs Review
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
                ? 'Every transaction has been reviewed. New imports will appear here automatically.'
                : 'No transactions to show.'}
            </p>
            <button onClick={() => router.push('/dashboard')} className="btn-primary mt-6">
              Go to Dashboard →
            </button>
          </div>
        ) : (
          /* Two-column layout — categories LEFT, transactions RIGHT */
          /* On mobile they stack: categories on top so user can see drop targets first */
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

            {/* LEFT (mobile: top): Category drop targets */}
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Drop categories here
                {selectedId && ' · or click to assign selected'}
              </p>
              <div className="space-y-1 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
                {categories.map((cat, i) => (
                  <CategoryBucket
                    key={cat.id}
                    cat={cat}
                    index={i}
                    isDragging={!!dragging}
                    isHovered={hoveredCatId === cat.id}
                    hasSelected={!!selectedId}
                    onDragOver={() => {}}
                    onDragEnter={setHoveredCatId}
                    onDragLeave={() => setHoveredCatId(null)}
                    onDrop={handleDrop}
                    onRegisterRef={registerCatRef}
                    onClickAssign={handleClickAssign}
                  />
                ))}
              </div>
            </div>

            {/* RIGHT (mobile: bottom): Transaction queue */}
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
              { id: confirm.transaction.id, categoryId: confirm.category.id, applyToAll: false },
              { onSuccess: () => { setConfirm(null); setSelectedId(null) } }
            )
          }}
          onApplyAll={() => {
            updateMutation.mutate(
              { id: confirm.transaction.id, categoryId: confirm.category.id, applyToAll: true },
              { onSuccess: () => { setConfirm(null); setSelectedId(null) } }
            )
          }}
        />
      )}
    </AppShell>
  )
}
