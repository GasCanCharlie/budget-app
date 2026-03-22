'use client'

import { useState, useCallback, useEffect, useRef, useMemo, useTransition } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { CheckCircle2, GripVertical, Loader2, AlertCircle, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Search, X, Save, Zap, FileText, Equal, Lightbulb, Store, Trash2, PlusCircle, Brain, BarChart3, Repeat2, Sparkles, Activity } from 'lucide-react'
import clsx from 'clsx'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  pointerWithin,
  rectIntersection,
  MeasuringStrategy,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
  type Modifier,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useDroppable } from '@dnd-kit/core'
import { useDraggable } from '@dnd-kit/core'
import { AppShell } from '@/components/AppShell'
import { CategoryIcon } from '@/components/CategoryIcon'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { useInsightsUnlock } from '@/hooks/useInsightsUnlock'
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
  accountId: string
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

// Active drag item — discriminated union so we know which overlay to render
type ActiveDragItem =
  | { kind: 'tx'; tx: Transaction; draggingIds: string[] }
  | { kind: 'cat'; catId: string }

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

// ─── DragOverlay ghost for a transaction ─────────────────────────────────────

function TxOverlay({ tx, count }: { tx: Transaction; count: number }) {
  return (
    <div
      style={{
        background: 'linear-gradient(180deg,#0E162B,#101B33)',
        border: '1px solid rgba(140,190,255,.35)',
        boxShadow: '0 16px 50px rgba(0,0,0,.55)',
        borderRadius: 14,
        padding: '10px 12px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        cursor: 'grabbing',
        minWidth: 220,
        maxWidth: 400,
      }}
    >
      {/* dot handle */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 3, marginTop: 2, flexShrink: 0 }} aria-hidden>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} style={{ display: 'block', width: 3, height: 3, borderRadius: 2, background: 'rgba(255,255,255,.55)' }} />
        ))}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
          <p style={{ fontWeight: 600, fontSize: 13, color: 'rgba(255,255,255,.92)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
            {tx.merchantNormalized || tx.description}
          </p>
          <p style={{ flexShrink: 0, fontWeight: 700, fontSize: 13, color: tx.amount < 0 ? '#FF5B78' : '#2EE59D', margin: 0 }}>
            {fmtAmt(tx.amount)}
          </p>
        </div>
        <p style={{ marginTop: 2, fontSize: 11, color: 'rgba(255,255,255,.55)', margin: '2px 0 0' }}>
          {fmtDate(tx.date)}
        </p>
        <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
          {tx.bankCategoryRaw && (
            <span style={{ background: 'rgba(120,170,255,.14)', color: 'rgba(160,200,255,.95)', border: '1px solid rgba(120,170,255,.22)', borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 500 }}>
              {tx.bankCategoryRaw}
            </span>
          )}
          {count > 1 && (
            <span style={{ background: 'rgba(255,180,60,.12)', color: 'rgba(255,180,60,.9)', border: '1px solid rgba(255,180,60,.22)', borderRadius: 999, padding: '1px 7px', fontSize: 10, fontWeight: 600 }}>
              {count} selected
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── DragOverlay ghost for a category ────────────────────────────────────────

function CatOverlay({ cat }: { cat: Category; txCount: number }) {
  return (
    <div
      style={{
        position: 'relative',
        pointerEvents: 'none',
        width: 48,
        height: 48,
        borderRadius: 14,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(168,85,247,0.85))',
        boxShadow: '0 0 0 6px rgba(99,102,241,0.18), 0 0 24px rgba(99,102,241,0.55), 0 8px 24px rgba(0,0,0,0.5)',
        border: '1px solid rgba(168,85,247,0.5)',
      }}
    >
      <CategoryIcon name={cat.icon} color="white" size={22} />
    </div>
  )
}

// ─── Transaction Card ────────────────────────────────────────────────────────

function TxCard({
  tx,
  isSelected,
  isDragSource,
  onClick,
}: {
  tx: Transaction
  isSelected: boolean
  isDragSource: boolean
  onClick: (tx: Transaction, e: React.MouseEvent) => void
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `tx-${tx.id}`,
    data: { kind: 'tx', tx },
  })

  // isDragging from useDraggable is true while this specific item is being dragged
  const isSource = isDragSource || isDragging

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={e => onClick(tx, e)}
      tabIndex={0}
      data-source={isSource ? 'true' : undefined}
      data-selected={isSelected ? 'true' : undefined}
      className={clsx(
        'transaction-card touch-none select-none',
        isSource ? 'dragging cursor-grabbing' : isSelected ? 'selected cursor-grab' : 'cursor-grab',
      )}
      style={undefined}
    >
      <div className="transaction-main">
        <div className="transaction-info">
          <span className="transaction-vendor">{tx.merchantNormalized || tx.description}</span>
          <span className="transaction-date">{fmtDate(tx.date)}</span>
        </div>
        <div className="transaction-tags">
          {tx.appCategory ? (
            <span className="badge-success">
              <span className="badge-icon">✓</span>
              <span>{tx.appCategory}</span>
            </span>
          ) : (
            <span className="badge-warning">Uncategorized</span>
          )}
          {tx.bankCategoryRaw && (
            <span className="badge-tag">{tx.bankCategoryRaw}</span>
          )}
        </div>
        <span className={clsx('transaction-amount', tx.amount < 0 ? 'expense' : 'income')}>
          {fmtAmt(tx.amount)}
        </span>
      </div>
    </div>
  )
}

const CAT_COLORS = ['#6366f1','#3b82f6','#0ea5e9','#14b8a6','#10b981','#22c55e','#f59e0b','#f97316','#ef4444','#ec4899','#a855f7','#64748b']
const CAT_ICONS  = ['📦','💳','🏷️','⭐','💡','🎯','🛒','🏠','🚗','🍔','🐕','🎸','💊','🌿','🧴']

// ─── Category Drop Target ────────────────────────────────────────────────────

function CategoryBucket({
  cat,
  isDraggingTx,
  hasSelected,
  isExpanded,
  onClickAssign,
  onToggleExpand,
  onContextMenu,
  txCount,
  catAmount,
  children,
}: {
  cat: Category
  isDraggingTx: boolean
  hasSelected: boolean
  isExpanded: boolean
  onClickAssign: (id: string) => void
  onToggleExpand: (id: string) => void
  onContextMenu: (cat: Category, e: React.MouseEvent) => void
  txCount?: number
  catAmount?: number
  children?: React.ReactNode
}) {
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `cat-${cat.id}`,
    data: { kind: 'cat', catId: cat.id },
  })

  const {
    attributes,
    listeners,
    setNodeRef: setSortRef,
    transform,
    transition,
    isDragging: isSortDragging,
  } = useSortable({
    id: `sort-cat-${cat.id}`,
    data: { kind: 'cat', catId: cat.id },
  })

  // Merge drop ref + sort ref onto the same element
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      setDropRef(el)
      setSortRef(el)
    },
    [setDropRef, setSortRef]
  )

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isSortDragging ? 0.4 : 1,
  }

  const showOver = isOver && isDraggingTx

  return (
    <div
      ref={setRef}
      {...attributes}
      {...listeners}
      style={{ ...style, opacity: isSortDragging ? 0.4 : 1, cursor: isSortDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      onClick={() => { if (!isDraggingTx) onToggleExpand(cat.id) }}
      onContextMenu={e => { e.preventDefault(); onContextMenu(cat, e) }}
      className={clsx('category-item select-none', showOver && 'drag-over')}
    >
      {/* Left: icon + name */}
      <div className="category-left">
        <CategoryIcon name={cat.icon} color={cat.color} size={22} />
        <span className="category-name">{cat.name}</span>
      </div>

      {/* Right: meta */}
      <div className="category-meta">
        {/* Dollar total */}
        {catAmount != null && catAmount > 0 && !showOver && (
          <span style={{ fontSize: 11, fontWeight: 700, color: '#6c7cff', whiteSpace: 'nowrap' }}>
            ${catAmount >= 1000 ? `${(catAmount / 1000).toFixed(1)}k` : catAmount.toFixed(0)}
          </span>
        )}
        {/* Count badge */}
        {txCount != null && txCount > 0 && !showOver && (
          <span className="cat-count">{txCount}</span>
        )}

        {/* Chevron */}
        {!isDraggingTx && (
          <ChevronRight
            size={14}
            className={clsx('category-arrow transition-transform duration-150', isExpanded && 'rotate-90')}
          />
        )}
      </div>
    </div>
  )
}

// ─── Rule Ask Modal ───────────────────────────────────────────────────────────

interface RuleAskState {
  tx: Transaction
  category: { id: string; name: string; icon: string; color: string }
  similarCount: number
}

type RuleMatchType = 'vendor_exact_amount' | 'vendor_exact' | 'vendor_smart'

function RuleAskModal({
  state,
  allVendorAmounts,
  isPending,
  onAlways,
  onAlwaysAll,
  onJustOne,
  onCancel,
  totalRemaining,
}: {
  state: RuleAskState
  allVendorAmounts: number[]
  isPending: boolean
  onAlways:    (matchType: RuleMatchType, learnedAmounts: number[]) => void
  onAlwaysAll?: (matchType: RuleMatchType, learnedAmounts: number[]) => void
  onJustOne: () => void
  onCancel:  () => void
  totalRemaining?: number
}) {
  const { apiFetch } = useApi()
  // Default to vendor-only when this merchant has multiple price points;
  // default to exact-amount when it always charges the same price.
  const [matchType, setMatchType] = useState<RuleMatchType>(
    allVendorAmounts.length > 1 ? 'vendor_exact' : 'vendor_exact_amount'
  )
  const vendor     = state.tx.merchantNormalized
  const amountExact = Math.abs(Math.round(state.tx.amount * 100))
  const totalInQueue = (totalRemaining ?? 0) + 1

  function fmtCents(cents: number) {
    return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  }

  const { data: preview } = useQuery<{ exactCount: number; vendorCount: number; smartCount: number }>({
    queryKey: ['rule-preview', vendor, amountExact, allVendorAmounts],
    queryFn: () => apiFetch('/api/rules/preview', {
      method: 'POST',
      body: JSON.stringify({ vendor, amountExact, learnedAmounts: allVendorAmounts }),
    }),
    staleTime: 30_000,
    enabled: !!vendor,
  })

  const previewCount =
    matchType === 'vendor_exact_amount' ? preview?.exactCount :
    matchType === 'vendor_exact'        ? preview?.vendorCount :
    preview?.smartCount

  const options: Array<{ value: RuleMatchType; label: string; desc: string }> = [
    {
      value: 'vendor_exact_amount',
      label: 'This exact transaction',
      desc:  `Only ${vendor} transactions of exactly ${fmtCents(amountExact)}`,
    },
    {
      value: 'vendor_exact',
      label: 'This vendor only (any amount)',
      desc:  `All ${vendor} transactions regardless of amount`,
    },
    {
      value: 'vendor_smart',
      label: allVendorAmounts.length > 1
        ? `Similar amounts (${allVendorAmounts.slice(0, 3).map(fmtCents).join(', ')}${allVendorAmounts.length > 3 ? '…' : ''})`
        : 'Smart match (learned amounts)',
      desc: allVendorAmounts.length > 1
        ? `Matches any of the ${allVendorAmounts.length} amounts seen for this vendor`
        : `Matches ${fmtCents(amountExact)} and any future amounts you categorize`,
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-sm rounded-2xl overflow-hidden" style={{ background: 'rgba(11,16,32,.97)', border: '1px solid rgba(110,168,255,.25)', boxShadow: '0 24px 64px rgba(0,0,0,.65)' }}>
        {/* Header */}
        <div className="flex items-start gap-3 p-4 pb-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full" style={{ background: 'rgba(99,102,241,.15)' }}>
            <Zap size={15} className="text-accent-400" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#e5e7eb]">Save a rule for future transactions?</p>
            <p className="text-xs mt-0.5" style={{ color: '#8b97c3' }}>
              <span className="font-medium text-[#c4cde8]">{vendor}</span>
              {' → '}
              <span style={{ color: state.category.color }}>
                {state.category.icon} {state.category.name}
              </span>
            </p>
          </div>
          <button onClick={onCancel} className="flex-shrink-0 ml-auto" style={{ color: 'rgba(255,255,255,.3)' }}>
            <X size={14} />
          </button>
        </div>

        {/* Radio options */}
        <div className="px-4 pb-3 space-y-2">
          {options.map(opt => (
            <label
              key={opt.value}
              className="flex items-start gap-3 rounded-xl p-3 cursor-pointer transition-all"
              style={{
                background: matchType === opt.value ? 'rgba(99,102,241,.12)' : 'rgba(255,255,255,.03)',
                border: `1px solid ${matchType === opt.value ? 'rgba(99,102,241,.4)' : 'rgba(255,255,255,.07)'}`,
              }}
              onClick={() => setMatchType(opt.value)}
            >
              <span
                className="flex-shrink-0 mt-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                style={{ borderColor: matchType === opt.value ? '#818cf8' : 'rgba(255,255,255,.3)' }}
              >
                {matchType === opt.value && (
                  <span className="w-2 h-2 rounded-full" style={{ background: '#818cf8' }} />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-xs font-semibold" style={{ color: matchType === opt.value ? '#c7d2fe' : '#9ca3af' }}>
                  {opt.label}
                </p>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'rgba(139,151,195,.7)' }}>
                  {opt.desc}
                </p>
              </div>
            </label>
          ))}
        </div>

        {/* Preview count */}
        {previewCount !== undefined && previewCount > 0 && (
          <div className="mx-4 mb-3 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs" style={{ background: 'rgba(34,197,94,.1)', color: '#86efac' }}>
            <CheckCircle2 size={12} />
            Will auto-categorize {previewCount} past transaction{previewCount !== 1 ? 's' : ''}
          </div>
        )}

        {/* Apply all (queue) */}
        {onAlwaysAll && totalRemaining != null && totalRemaining > 0 && (
          <div className="px-4 pb-2">
            <button
              onClick={() => onAlwaysAll(matchType, allVendorAmounts)}
              disabled={isPending}
              className="w-full rounded-xl py-2 text-xs font-semibold transition-all disabled:opacity-50"
              style={{ background: 'rgba(99,102,241,.2)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,.3)' }}
            >
              {isPending
                ? <Loader2 size={12} className="inline animate-spin" />
                : `Apply all ${totalInQueue} rules at once`}
            </button>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 p-4 pt-2">
          <button
            onClick={onJustOne}
            disabled={isPending}
            aria-label="Apply category to this transaction only — no rule will be saved"
            className="flex-1 rounded-xl py-2 text-xs font-medium transition-all disabled:opacity-50"
            style={{ background: 'rgba(255,255,255,.05)', color: '#9ca3af', border: '1px solid rgba(255,255,255,.08)' }}
          >
            Apply once
          </button>
          <button
            onClick={() => onAlways(matchType, allVendorAmounts)}
            disabled={isPending}
            aria-label="Save rule and apply to matching transactions"
            className="flex-1 rounded-xl py-2 text-xs font-semibold transition-all disabled:opacity-50"
            style={{ background: '#4f46e5', color: '#fff' }}
          >
            {isPending ? <Loader2 size={12} className="inline animate-spin" /> : 'Save Rule'}
          </button>
        </div>
        {/* Helper text */}
        <p className="px-4 pb-3 text-center text-[10px]" style={{ color: 'rgba(139,151,195,.5)' }}>
          Apply once — no rule saved. Save Rule — auto-applies to future transactions.
        </p>
      </div>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" style={{ backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: 'rgba(11,16,32,.96)', border: '1px solid rgba(255,255,255,.12)' }}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100">
            <CategoryIcon name={state.category.icon} color={state.category.color} size={20} />
          </span>
          <div>
            <h3 className="font-bold text-[#e5e7eb]">Move to {state.category.name}?</h3>
            <p className="text-sm text-slate-500">
              &ldquo;{state.transaction.merchantNormalized || state.transaction.description}&rdquo;
              {' · '}
              <span className={state.transaction.amount < 0 ? 'text-[#FF5B78]' : 'text-[#2EE59D]'}>
                {fmtAmt(state.transaction.amount)}
              </span>
            </p>
          </div>
        </div>


        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg border border-white/12 px-4 py-2 text-sm font-medium text-[#8b97c3] hover:bg-white/[.06] disabled:opacity-50"
            style={{ borderColor: 'rgba(255,255,255,.12)' }}
          >
            Cancel
          </button>
          <button
            onClick={onApplyAll}
            disabled={isPending}
            className="btn-primary"
          >
            {isPending
              ? <Loader2 size={14} className="inline animate-spin" />
              : state.similarCount > 1
                ? `Apply to all ${state.similarCount}`
                : 'Apply'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Touch Ghost (kept for fallback — TouchGhost is now less needed but harmless) ──

function TouchGhost({ tx, pos }: { tx: Transaction | null; pos: { x: number; y: number } | null }) {
  if (!tx || !pos) return null
  return (
    <div
      className="pointer-events-none fixed z-[100] max-w-[180px] rounded-lg p-2 shadow-lg backdrop-blur-sm"
      style={{ background: 'rgba(11,16,32,.92)', border: '1px solid rgba(110,168,255,.35)', left: pos.x - 90, top: pos.y - 30 }}
    >
      <p className="truncate text-xs font-semibold text-[#e5e7eb]">{tx.merchantNormalized || tx.description}</p>
      <p className="text-[10px] text-[#8b97c3]">{fmtAmt(tx.amount)}</p>
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
  onRemove,
}: {
  catName: string
  txs: Transaction[]
  categories: Category[]
  onMove: (txId: string, newCatName: string, applyToAll: boolean) => void
  onRemove: (txId: string) => void
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
    <div className="mt-1.5 mb-1 ml-2 mr-1 rounded-xl overflow-y-auto max-h-72" style={{ background: 'var(--card2)', border: '1px solid var(--border)' }}>
      {txs.map(tx => {
        const moveCat = pendingMove?.txId === tx.id
          ? categories.find(c => c.name === pendingMove.catName)
          : undefined
        return (
        <div key={tx.id} className="px-3 py-2.5 transition-colors border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-start gap-2.5">
            <div className="flex-1 min-w-0">
              {/* Name + amount row */}
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-sm truncate" style={{ color: 'var(--text)' }}>
                  {tx.merchantNormalized || tx.description}
                </span>
                <span className={clsx('font-bold text-sm flex-shrink-0', tx.amount >= 0 ? 'text-green-700' : 'text-red-700')}>
                  {tx.amount >= 0 ? '+' : '-'}{fmtAmt(tx.amount)}
                </span>
              </div>

              {/* Badge row */}
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <span className="text-xs text-slate-400">{fmtDate(tx.date)}</span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
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
                <div className="mt-2 rounded-2xl p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100">
                      <CategoryIcon name={moveCat?.icon ?? 'tag'} color={moveCat?.color ?? '#6366f1'} size={20} />
                    </span>
                    <div>
                      <p className="font-bold text-sm" style={{ color: 'var(--text)' }}>Move to {pendingMove.catName}?</p>
                      <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{tx.merchantNormalized}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium transition hover:bg-[var(--bg-hover)]" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { onMove(pendingMove.txId, pendingMove.catName, false); setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-accent-700 hover:bg-accent-500/10 transition border border-accent-200"
                    >
                      Just this one
                    </button>
                    <button
                      onClick={() => { onMove(pendingMove.txId, pendingMove.catName, true); setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="rounded-lg px-3 py-1.5 text-xs bg-accent-500 text-white font-medium hover:bg-accent-600 transition"
                    >
                      Move all {pendingMove.count}
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
                    className="input text-xs mb-1 py-1 px-2"
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
                          className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium hover:bg-[var(--bg-hover)] transition text-left" style={{ color: 'var(--text)' }}
                        >
                          <CategoryIcon name={c.icon} color={c.color} size={14} />
                          <span className="truncate">{c.name}</span>
                        </button>
                      ))}
                  </div>
                  <button
                    onClick={() => { setMovingId(null); setCatSearch('') }}
                    className="mt-1 text-xs transition hover:text-[var(--text)]" style={{ color: 'var(--text-muted)' }}
                  >
                    ✕ Cancel
                  </button>
                </div>
              ) : (
                <div className="mt-1.5 flex items-center gap-1.5">
                  <button
                    onClick={() => setMovingId(tx.id)}
                    className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium hover:border-accent-400 hover:text-accent-600 transition" style={{ border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text-muted)' }}
                  >
                    Move
                  </button>
                  <button
                    onClick={() => onRemove(tx.id)}
                    className="flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-medium transition" style={{ border: '1px solid rgba(255,127,144,0.25)', background: 'rgba(255,127,144,0.08)', color: '#ff7f90' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,127,144,0.16)' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,127,144,0.08)' }}
                  >
                    Remove
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        )
      })}
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
      <div className="rounded-2xl p-4" style={{ background: 'rgba(11,16,32,.96)', border: '1px solid rgba(110,168,255,.25)', boxShadow: '0 20px 60px rgba(0,0,0,.55)' }}>
        <div className="flex items-start gap-2.5 mb-3">
          <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-accent-100">
            <Zap size={14} className="text-accent-600" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#e5e7eb]">Remember this?</p>
            <p className="text-xs text-[#8b97c3] mt-0.5">
              You&apos;ve assigned <strong>{state.vendor}</strong> → <strong>{state.catName}</strong> multiple times.
            </p>
          </div>
          <button onClick={onDismiss} className="flex-shrink-0 text-white/30 hover:text-white/60 transition">
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

// ─── Custom collision detection ───────────────────────────────────────────────
// Modifier: snap the top-left corner of the overlay to the cursor tip
const snapPointerToTopLeft: Modifier = ({ transform, activatorEvent, draggingNodeRect }) => {
  if (!activatorEvent || !draggingNodeRect) return transform
  const evt = activatorEvent as PointerEvent
  const grabX = evt.clientX - draggingNodeRect.left
  const grabY = evt.clientY - draggingNodeRect.top
  return { ...transform, x: transform.x + grabX, y: transform.y + grabY }
}

// When dragging a transaction: use pointerWithin for category drop targets
// When dragging a category (sort): use closestCenter for sortable items
function buildCollisionDetector(activeKind: 'tx' | 'cat' | null): CollisionDetection {
  return (args) => {
    if (activeKind === 'cat') {
      return closestCenter(args)
    }
    // For tx drags: prefer pointerWithin, fall back to rectIntersection
    const pointerHits = pointerWithin(args)
    if (pointerHits.length > 0) return pointerHits
    return rectIntersection(args)
  }
}

// ─── Categorization Tips Panel ───────────────────────────────────────────────

interface CategorizationTipsProps {
  onSortAmount:    () => void
  onSortVendor:    () => void
  onSortSamePrice: () => void
}

function CategorizationTips({ onSortAmount, onSortVendor, onSortSamePrice }: CategorizationTipsProps) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return localStorage.getItem('budgetlens:tips-dismissed') === '1' }
    catch { return false }
  })

  if (dismissed) return null

  function dismiss() {
    try { localStorage.setItem('budgetlens:tips-dismissed', '1') }
    catch { /* ignore */ }
    setDismissed(true)
  }

  const cards: Array<{ Icon: React.ElementType; title: string; desc: string; onClick: () => void }> = [
    {
      Icon: ArrowUpDown,
      title: 'Amount Matching',
      desc: 'Group identical transactions',
      onClick: onSortAmount,
    },
    {
      Icon: Store,
      title: 'Vendor Clustering',
      desc: 'Merge similar merchants',
      onClick: onSortVendor,
    },
    {
      Icon: Repeat2,
      title: 'Recurring Detection',
      desc: 'Identify subscriptions automatically',
      onClick: onSortSamePrice,
    },
  ]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
      marginBottom: 16, padding: '10px 0',
    }}>

      {/* Label */}
      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.30)', flexShrink: 0, whiteSpace: 'nowrap' }}>
        Smart Suggestions
      </span>

      {/* Tip cards */}
      <div style={{ display: 'flex', gap: 8, flex: 1, flexWrap: 'wrap' }}>
        {cards.map(({ Icon, title, desc, onClick }) => (
          <button
            key={title}
            onClick={onClick}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 8,
              padding: '10px 13px', cursor: 'pointer', textAlign: 'left',
              background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 10, transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(108,124,255,0.07)'
              e.currentTarget.style.borderColor = 'rgba(108,124,255,0.18)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.02)'
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)'
            }}
          >
            <Icon size={13} strokeWidth={1.5} style={{ color: 'rgba(255,255,255,0.45)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 }}>{title}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{desc}</div>
            </div>
          </button>
        ))}
      </div>

      {/* Dismiss */}
      <button
        onClick={dismiss}
        style={{
          marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3,
          fontSize: 11, color: 'var(--muted)', background: 'none',
          border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: 0,
          transition: 'color 0.15s', flexShrink: 0,
        }}
        onMouseEnter={e => (e.currentTarget.style.color = 'var(--text)')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--muted)')}
      >
        <X size={11} />
        Dismiss
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CategorizePage() {
  const router       = useRouter()
  const user         = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc           = useQueryClient()
  const { unlocked, categorized: catCount, total: txTotal } = useInsightsUnlock()
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [, startTransition] = useTransition()

  // ── Rule ask modal state ──
  const [ruleAsk, setRuleAsk] = useState<RuleAskState | null>(null)
  const [ruleAskQueue, setRuleAskQueue] = useState<RuleAskState[]>([])

  const popRuleAsk = useCallback(() => {
    setRuleAskQueue(q => {
      if (q.length === 0) { setRuleAsk(null); return q }
      setRuleAsk(q[0])
      return q.slice(1)
    })
  }, [])

  // Debounced dashboard invalidation
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
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null)

  // ── Category context menu ──
  const [catCtxMenu,      setCatCtxMenu]      = useState<{ cat: Category; x: number; y: number } | null>(null)
  const [catDeleteConfirm, setCatDeleteConfirm] = useState(false)
  const [showAddCat,      setShowAddCat]      = useState(false)
  const [addCatName,      setAddCatName]      = useState('')
  const [addCatIcon,      setAddCatIcon]      = useState('📦')
  const [addCatColor,     setAddCatColor]     = useState('#6366f1')

  // Active dnd-kit drag item (replaces dragging / hoveredCatId / reorderDragId / reorderOverId)
  const [activeDrag, setActiveDrag] = useState<ActiveDragItem | null>(null)

  // Derived: which tx ids are being dragged right now
  const draggingIds: string[] = activeDrag?.kind === 'tx' ? activeDrag.draggingIds : []

  // Touch drag state (kept for mobile fallback)
  const [touchTx,    setTouchTx]    = useState<Transaction | null>(null)
  const [touchPos,   setTouchPos]   = useState<{ x: number; y: number } | null>(null)
  const [touchCatId, setTouchCatId] = useState<string | null>(null)
  const catRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Sort + vendor filter state (persisted to localStorage)
  const [sortKey, setSortKey] = useState<CatSortKey>(() => {
    try { return (localStorage.getItem('budgetlens:cat-sort-key') as CatSortKey) || 'date' }
    catch { return 'date' }
  })
  const [sortDir, setSortDir] = useState<CatSortDir>(() => {
    try { return (localStorage.getItem('budgetlens:cat-sort-dir') as CatSortDir) || 'desc' }
    catch { return 'desc' }
  })
  const [vendorQuery,    setVendorQuery]    = useState('')
  const [samePriceOnly,  setSamePriceOnly]  = useState(false)

  // ── Data ──
  const { data: txData, isLoading: txLoading, error: txError } = useQuery({
    queryKey: ['categorize-transactions'],
    queryFn: () => apiFetch('/api/transactions?limit=500'),
    enabled: !!user,
    staleTime: 60_000,          // don't eagerly refetch — optimistic updates handle the UI
    refetchOnWindowFocus: false, // prevent mid-categorization refetches from restoring removed txs
  })

  const { data: catData, isLoading: catLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories'),
    enabled: !!user,
  })

  const { data: rulesData } = useQuery({
    queryKey: ['rules'],
    queryFn: () => apiFetch('/api/rules'),
    staleTime: 0,
    refetchOnMount: 'always' as const,
    enabled: !!user,
  })
  const existingRules: Array<{ matchValue: string; amountExact: number | null; scopeAccountId: string | null }> = rulesData?.rules ?? []

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

  useEffect(() => {
    if (prefData?.order && Array.isArray(prefData.order) && prefData.order.length > 0) {
      setCatOrder(prefData.order)
      setOriginalOrder(prefData.order)
      localStorage.setItem('budgetlens:cat-order', JSON.stringify(prefData.order))
    }
  }, [prefData])

  // Amounts that appear on 2+ transactions (excluding transfers)
  const samePriceAmounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const t of allTxs) {
      if (!t.isTransfer) counts.set(t.amount, (counts.get(t.amount) ?? 0) + 1)
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([amt]) => amt))
  }, [allTxs])

  const samePriceCount = useMemo(
    () => allTxs.filter(t => !t.isTransfer && samePriceAmounts.has(t.amount)).length,
    [allTxs, samePriceAmounts]
  )

  // Queue = transactions without an appCategory
  const queueTxs: Transaction[] = useMemo(() => {
    if (filterMode === 'all') return allTxs.filter(t => !t.isTransfer)
    return allTxs.filter(t => !t.isTransfer && !t.appCategory)
  }, [allTxs, filterMode])

  const needsReviewCount = useMemo(
    () => allTxs.filter(t => !t.isTransfer && !t.appCategory).length,
    [allTxs]
  )

  const sortedQueueTxs = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase()
    let filtered = samePriceOnly ? queueTxs.filter(t => samePriceAmounts.has(t.amount)) : queueTxs
    if (q) filtered = filtered.filter(t => (t.merchantNormalized || t.description || '').toLowerCase().includes(q))
    return sortCategorizeTransactions(filtered, sortKey, sortDir)
  }, [queueTxs, sortKey, sortDir, vendorQuery, samePriceOnly, samePriceAmounts])

  const txCountByCat = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of allTxs) {
      if (tx.appCategory) map.set(tx.appCategory, (map.get(tx.appCategory) ?? 0) + 1)
    }
    return map
  }, [allTxs])

  const amountByCat = useMemo(() => {
    const map = new Map<string, number>()
    for (const tx of allTxs) {
      if (tx.appCategory && tx.amount < 0) {
        map.set(tx.appCategory, (map.get(tx.appCategory) ?? 0) + Math.abs(tx.amount))
      }
    }
    return map
  }, [allTxs])

  // ── Mutation — sets appCategory (free text) ──
  const updateMutation = useMutation({
    mutationFn: ({ id, appCategory, applyToAll }: { id: string; appCategory: string | null; applyToAll: boolean }) =>
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
      // Do NOT invalidate categorize-transactions here — doing so triggers a server
      // refetch that returns stale data (other in-flight PATCHes not yet committed),
      // which overwrites the optimistic update and makes transactions reappear.
      // The optimistic update in onMutate is the source of truth for the queue.
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['insights-unlock-status'] })
      invalidateDashboard()
    },
  })

  // ── Rule creation mutation ──
  const createRuleMutation = useMutation({
    mutationFn: ({ matchType, matchValue, amountExact, learnedAmounts, categoryId, mode, scopeAccountId }: {
      matchType: 'vendor_exact_amount' | 'vendor_exact' | 'vendor_smart'
      matchValue: string; amountExact?: number; learnedAmounts?: number[]
      categoryId: string; mode: 'always' | 'ask'; scopeAccountId?: string
    }) =>
      apiFetch('/api/rules', {
        method: 'POST',
        body: JSON.stringify({ matchType, matchValue, amountExact, learnedAmounts, categoryId, mode, scopeAccountId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] })
      // Auto-backfill: apply the new rule to any already-committed uncategorized transactions
      void apiFetch('/api/transactions/apply-rules', { method: 'POST' }).then(() => {
        void qc.invalidateQueries({ queryKey: ['categorize-transactions'] })
        invalidateDashboard()
      })
    },
  })

  // ── Bulk assign mutation (Apply All) ──
  // Single round-trip: categorizes all transactions + creates all rules at once.
  // Avoids the race conditions from firing N separate mutate() calls in a loop.
  const bulkAssignMutation = useMutation({
    mutationFn: (items: {
      txId: string; appCategory: string; applyToAll: boolean
      createRule: boolean; matchType?: 'vendor_exact_amount' | 'vendor_exact' | 'vendor_smart'
      matchValue?: string; amountExact?: number; learnedAmounts?: number[]
      categoryId?: string; scopeAccountId?: string
    }[]) =>
      apiFetch('/api/transactions/bulk-assign', {
        method: 'POST',
        body: JSON.stringify({ items }),
      }),
    onMutate: async (items) => {
      await qc.cancelQueries({ queryKey: ['categorize-transactions'] })
      const prev = qc.getQueryData(['categorize-transactions'])
      qc.setQueryData(['categorize-transactions'], (old: { transactions: Transaction[] } | undefined) => {
        if (!old) return old
        const removeIds = new Set<string>()
        for (const item of items) {
          const tx = old.transactions.find(t => t.id === item.txId)
          removeIds.add(item.txId)
          if (item.applyToAll && tx?.merchantNormalized) {
            old.transactions
              .filter(t => t.merchantNormalized === tx.merchantNormalized && t.amount === tx.amount && !t.appCategory)
              .forEach(t => removeIds.add(t.id))
          }
        }
        return { ...old, transactions: old.transactions.filter(t => !removeIds.has(t.id)) }
      })
      return { prev }
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['categorize-transactions'], ctx.prev)
    },
    onSuccess: () => {
      // Same as updateMutation — don't invalidate categorize-transactions to avoid
      // race condition where refetch restores optimistically-removed transactions.
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['rules'] })
      qc.invalidateQueries({ queryKey: ['insights-unlock-status'] })
      invalidateDashboard()
    },
  })

  // ── Category CRUD mutations ──
  const createCatMutation = useMutation({
    mutationFn: () => apiFetch('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name: addCatName.trim(), icon: addCatIcon, color: addCatColor, isIncome: false }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setShowAddCat(false); setAddCatName(''); setAddCatIcon('📦'); setAddCatColor('#6366f1')
    },
  })

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['categorize-transactions'] })
      setCatCtxMenu(null); setCatDeleteConfirm(false)
    },
  })

  // ── Apply saved rules to all uncategorized committed transactions ──
  const [applyRulesMsg, setApplyRulesMsg] = useState<string | null>(null)
  const applyRulesMutation = useMutation({
    mutationFn: () => apiFetch('/api/transactions/apply-rules', { method: 'POST' }),
    onSuccess: (res: { applied: number; skipped: number }) => {
      void qc.invalidateQueries({ queryKey: ['categorize-transactions'] })
      qc.invalidateQueries({ queryKey: ['insights-unlock-status'] })
      setApplyRulesMsg(`${res.applied} transaction${res.applied !== 1 ? 's' : ''} categorized by rules`)
      setTimeout(() => setApplyRulesMsg(null), 3000)
    },
    onError: (err: Error) => {
      setApplyRulesMsg(`Error: ${err.message}`)
      setTimeout(() => setApplyRulesMsg(null), 3000)
    },
  })

  // ── Helpers ──
  const countSimilar = useCallback((merchant: string, amount: number) =>
    allTxs.filter(t => t.merchantNormalized === merchant && t.amount === amount && !t.appCategory).length,
    [allTxs]
  )

  const ruleExistsFor = useCallback((merchant: string, amount: number, accountId: string) => {
    const key = merchant.toLowerCase().trim()
    const amountCents = Math.round(amount * 100)
    return existingRules.some(r =>
      r.matchValue.toLowerCase() === key &&
      r.amountExact === amountCents &&
      (r.scopeAccountId === null || r.scopeAccountId === accountId)
    )
  }, [existingRules])

  // Compute all distinct absolute-cent amounts seen for a vendor across all transactions
  const vendorAmountsFor = useCallback((merchant: string): number[] => {
    const seen = new Set<number>()
    allTxs.forEach(t => {
      if (t.merchantNormalized === merchant) seen.add(Math.abs(Math.round(t.amount * 100)))
    })
    return [...seen]
  }, [allTxs])

  const initiateAssign = useCallback((tx: Transaction, categoryId: string) => {
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) return
    if (ruleExistsFor(tx.merchantNormalized, tx.amount, tx.accountId)) {
      // Rule already exists — silently categorize (apply to all similar)
      const applyToAll = countSimilar(tx.merchantNormalized, tx.amount) > 1
      updateMutation.mutate({ id: tx.id, appCategory: cat.name, applyToAll })
      setSelectedIds(new Set()); setAnchorId(null)
      return
    }
    // No rule yet — ask
    const similarCount = countSimilar(tx.merchantNormalized, tx.amount)
    setRuleAsk({ tx, category: cat, similarCount })
  }, [categories, ruleExistsFor, countSimilar, updateMutation])

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

  // ── handleDrop (used by dnd-kit onDragEnd and click-assign) ──
  const handleDrop = useCallback((categoryId: string, txsToDrop: string[], primaryTx: Transaction | null) => {
    const cat = categories.find(c => c.id === categoryId)
    if (!cat) return

    if (txsToDrop.length > 1) {
      // Categorize all immediately
      txsToDrop.forEach(id => {
        updateMutation.mutate({ id, appCategory: cat.name, applyToAll: false })
      })
      // Build queue: unique vendor+price combos without existing rules
      const seen = new Set<string>()
      const queue: RuleAskState[] = []
      for (const id of txsToDrop) {
        const tx = allTxs.find(t => t.id === id)
        if (!tx?.merchantNormalized) continue
        const key = `${tx.merchantNormalized.toLowerCase()}|${Math.round(tx.amount * 100)}|${tx.accountId}`
        if (seen.has(key)) continue
        seen.add(key)
        if (!ruleExistsFor(tx.merchantNormalized, tx.amount, tx.accountId)) {
          queue.push({ tx, category: cat, similarCount: 1 })
        }
      }
      if (queue.length > 0) {
        setRuleAsk(queue[0])
        setRuleAskQueue(queue.slice(1))
      }
      setSelectedIds(new Set()); setAnchorId(null)
      return
    } else if (primaryTx) {
      initiateAssign(primaryTx, categoryId)
    }
  }, [categories, initiateAssign, updateMutation, allTxs, ruleExistsFor])

  const handleClickAssign = useCallback((categoryId: string) => {
    if (selectedIds.size > 1) {
      // Multi-select: route through handleDrop so the full batch gets the
      // "Apply all rules at once" prompt rather than ignoring the selection.
      const primaryTx = sortedQueueTxs.find(t => t.id === anchorId) ?? null
      handleDrop(categoryId, [...selectedIds], primaryTx)
    } else {
      const anchored = sortedQueueTxs.find(t => t.id === anchorId)
      if (anchored) initiateAssign(anchored, categoryId)
    }
  }, [anchorId, selectedIds, sortedQueueTxs, initiateAssign, handleDrop])

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
    setSamePriceOnly(false)
  }

  // ── Category reorder (dnd-kit arrayMove) ──
  const handleCatReorderDrop = useCallback((dragId: string, overId: string) => {
    if (dragId === overId) return
    setCatOrder(prev => {
      const order = prev.length > 0 ? prev : categories.map(c => c.id)
      const from  = order.indexOf(dragId)
      const to    = order.indexOf(overId)
      if (from === -1 || to === -1) return prev
      const next = arrayMove(order, from, to)
      localStorage.setItem('budgetlens:cat-order', JSON.stringify(next))
      return next
    })
  }, [categories])

  // ── Finish Categorizing ──
  function handleFinishCategorizing() {
    if (dashboardTimer.current) { clearTimeout(dashboardTimer.current); dashboardTimer.current = null }
    qc.invalidateQueries({ queryKey: ['summary'] })
    qc.invalidateQueries({ queryKey: ['trends'] })
    qc.invalidateQueries({ queryKey: ['insights-unlock-status'] })

    // Fire autopsy generation in the background for the most recent transaction month
    const token = useAuthStore.getState().token
    if (token && allTxs.length > 0) {
      const mostRecent = allTxs.reduce((best, tx) => tx.date > best ? tx.date : best, allTxs[0].date)
      const d = new Date(mostRecent)
      const year = d.getFullYear()
      const month = d.getMonth() + 1
      void fetch('/api/insights/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ year, month }),
      }).catch(() => { /* silent — user will still land on insights page */ })
    }

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

  // ── Touch drag (kept for mobile) ──
  const registerCatRef = useCallback((cat: Category, el: HTMLDivElement | null) => {
    if (el) catRefs.current.set(cat.id, el)
    else    catRefs.current.delete(cat.id)
  }, [])

  const handleTouchStart = useCallback((tx: Transaction, e: React.TouchEvent) => {
    const t = e.touches[0]
    setTouchTx(tx)
    setTouchPos({ x: t.clientX, y: t.clientY })
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
    }

    const onEnd = () => {
      if (touchCatId && touchTx) initiateAssign(touchTx, touchCatId)
      setTouchTx(null); setTouchPos(null)
      setTouchCatId(null)
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
      if (ruleAsk) {
        if (e.key === 'Escape') { setRuleAskQueue([]); setRuleAsk(null) }
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
  }, [ruleAsk, anchorId, sortedQueueTxs])

  // Close category context menu on outside click or Escape
  useEffect(() => {
    if (!catCtxMenu) return
    const close = () => { setCatCtxMenu(null); setCatDeleteConfirm(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('mousedown', close); window.removeEventListener('keydown', onKey) }
  }, [catCtxMenu])

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

  // ── dnd-kit sensors ──
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // Sortable IDs for category panel
  const sortableCatIds = useMemo(
    () => categories.map(c => `sort-cat-${c.id}`),
    [categories]
  )

  // Collision detection — switches strategy based on active drag kind
  const activeKind = activeDrag?.kind ?? null
  const collisionDetection = useMemo(
    () => buildCollisionDetector(activeKind),
    [activeKind]
  )

  // ── dnd-kit event handlers ──
  const onDragStart = useCallback((event: DragStartEvent) => {
    const data = event.active.data.current as { kind: string; tx?: Transaction; catId?: string } | undefined
    if (!data) return

    if (data.kind === 'tx' && data.tx) {
      const tx = data.tx
      const ids = selectedIds.has(tx.id) && selectedIds.size > 1
        ? [...selectedIds]
        : [tx.id]
      setActiveDrag({ kind: 'tx', tx, draggingIds: ids })
    } else if (data.kind === 'cat' && data.catId) {
      setActiveDrag({ kind: 'cat', catId: data.catId })
    }
  }, [selectedIds])

  const onDragOver = useCallback((_event: DragOverEvent) => {
    // nothing needed — useDroppable isOver handles visual feedback
  }, [])

  const onDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event

    if (!over) {
      setActiveDrag(null)
      return
    }

    const activeData = active.data.current as { kind: string; tx?: Transaction; catId?: string } | undefined
    const overData   = over.data.current   as { kind: string; catId?: string } | undefined

    if (activeData?.kind === 'tx' && overData?.kind === 'cat' && overData.catId) {
      // Transaction dropped on category bucket
      const tx = activeData.tx
      if (tx) {
        const ids = selectedIds.has(tx.id) && selectedIds.size > 1
          ? [...selectedIds]
          : [tx.id]
        handleDrop(overData.catId, ids, tx)
      }
    } else if (activeData?.kind === 'cat' && activeData.catId) {
      // Category reorder — over.id is a sortable cat id like "sort-cat-{catId}"
      const dragCatId = activeData.catId
      // Extract actual cat id from over.id string or from overData
      const overCatId = overData?.catId ?? (typeof over.id === 'string' ? over.id.replace('sort-cat-', '') : null)
      if (overCatId && dragCatId !== overCatId) {
        handleCatReorderDrop(dragCatId, overCatId)
      }
    }

    setActiveDrag(null)
  }, [selectedIds, handleDrop, handleCatReorderDrop])

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

  const isDraggingTx = activeDrag?.kind === 'tx'

  return (
    <AppShell>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <main className="max-w-6xl mx-auto px-4 py-6 pb-24">
          {/* Unlock intent banner — always shown */}
          {!unlocked && (
            <div style={{
              marginBottom: 20, padding: '20px 22px',
              borderRadius: 14,
              background: 'rgba(99,102,241,0.06)',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              border: '1px solid rgba(99,102,241,0.18)',
            }}>
              <p style={{ margin: '0 0 6px', fontSize: 21, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1.2 }}>
                Categorize your transactions to unlock insights
              </p>
              <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 600 }}>
                This step powers your entire analysis — your Money Personality, spending patterns, and insights depend on accurate categorization.
              </p>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {[
                  { Icon: Brain,     label: 'Money Personality' },
                  { Icon: BarChart3, label: 'Spending Patterns' },
                  { Icon: Repeat2,   label: 'Subscriptions' },
                  { Icon: Sparkles,  label: 'Insights' },
                ].map(({ Icon, label }) => (
                  <span key={label} style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '5px 12px', borderRadius: 999, fontSize: 13,
                    background: 'transparent', border: '1px solid rgba(255,255,255,0.09)',
                    color: 'rgba(255,255,255,0.65)',
                  }}>
                    <Icon size={12} strokeWidth={1.5} />
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Progress bar */}
          {txTotal > 0 && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary, #8b97c3)' }}>
                  Categorization Progress
                </span>
                <span style={{ fontSize: 13, fontWeight: 700, color: unlocked ? '#39d07f' : 'var(--text)' }}>
                  {unlocked ? '✓ Complete' : `${catCount} / ${txTotal} categorized · ${Math.round((catCount / txTotal) * 100)}%`}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: 'var(--surface2)', overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 999,
                  width: `${txTotal > 0 ? Math.round((catCount / txTotal) * 100) : 0}%`,
                  background: unlocked
                    ? 'linear-gradient(90deg, #39d07f, #7be5ad)'
                    : 'linear-gradient(90deg, #6c7cff, #939aff)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}

          {/* Header */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.02em' }}>Categorize</h1>
              <p style={{ margin: '3px 0 0', fontSize: 13, color: 'var(--muted)', lineHeight: 1.4 }}>
                Group similar transactions to categorize faster.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {/* State tabs */}
              <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                <button
                  onClick={() => setFilterMode('needs-review')}
                  style={{
                    padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                    background: filterMode === 'needs-review' ? 'rgba(108,124,255,0.22)' : 'transparent',
                    color: filterMode === 'needs-review' ? '#c5cbff' : 'rgba(255,255,255,0.40)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  Uncategorized
                </button>
                <button
                  onClick={() => setFilterMode('all')}
                  style={{
                    padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none',
                    borderLeft: '1px solid rgba(255,255,255,0.08)',
                    background: filterMode === 'all' ? 'rgba(108,124,255,0.22)' : 'transparent',
                    color: filterMode === 'all' ? '#c5cbff' : 'rgba(255,255,255,0.40)',
                    transition: 'background 0.15s, color 0.15s',
                  }}
                >
                  All
                </button>
              </div>
              {/* Primary CTA */}
              <button
                onClick={handleFinishCategorizing}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '8px 16px', height: 40, borderRadius: 999, border: 'none',
                  background: 'linear-gradient(135deg, #16a34a, #15803d)',
                  color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  boxShadow: '0 2px 12px rgba(22,163,74,0.30)',
                  transition: 'opacity 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
              >
                Finish Categorizing →
              </button>
            </div>
          </div>

          {/* ── Categorization tips panel ─────────────────────────────────── */}
          <CategorizationTips
            onSortAmount={() => { handleCatSort('amount'); setSamePriceOnly(false) }}
            onSortVendor={() => { handleCatSort('vendor'); setSamePriceOnly(false) }}
            onSortSamePrice={() => { setSamePriceOnly(true); setSortKey('amount'); setSortDir('desc') }}
          />

          {queueTxs.length === 0 ? (
            txTotal === 0 ? (
              /* No transactions at all — nothing to categorize */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14, marginBottom: 20,
                  background: 'rgba(108,124,255,0.10)', border: '1px solid rgba(108,124,255,0.20)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <FileText size={22} strokeWidth={1.5} style={{ color: 'rgba(108,124,255,0.70)' }} />
                </div>
                <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                  No transactions yet
                </h2>
                <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 340 }}>
                  Upload a bank or credit card statement to get started.
                </p>
                <button
                  onClick={() => router.push('/upload')}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '10px 20px', borderRadius: 999, border: 'none',
                    background: 'linear-gradient(135deg, #6c7cff, #8b6fff)',
                    color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                    boxShadow: '0 2px 16px rgba(108,124,255,0.30)',
                  }}
                >
                  Upload a Statement →
                </button>
              </div>
            ) : (
              /* All transactions categorized */
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 14, marginBottom: 20,
                  background: 'rgba(22,163,74,0.10)', border: '1px solid rgba(22,163,74,0.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <CheckCircle2 size={22} strokeWidth={1.5} style={{ color: 'rgba(34,197,94,0.80)' }} />
                </div>
                <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 600, color: 'var(--text)', letterSpacing: '-0.01em' }}>
                  {filterMode === 'needs-review' ? 'All transactions categorized' : 'No transactions to show'}
                </h2>
                <p style={{ margin: '0 0 24px', fontSize: 14, color: 'var(--muted)', lineHeight: 1.6, maxWidth: 360 }}>
                  {filterMode === 'needs-review'
                    ? 'Your financial data is now structured and ready for analysis.'
                    : 'Try switching to Uncategorized view.'}
                </p>
                {filterMode === 'needs-review' && (
                  <button
                    onClick={() => router.push('/dashboard')}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: '10px 20px', borderRadius: 999, border: 'none',
                      background: 'linear-gradient(135deg, #16a34a, #15803d)',
                      color: '#fff', fontSize: 14, fontWeight: 700, cursor: 'pointer',
                      boxShadow: '0 2px 16px rgba(22,163,74,0.28)',
                    }}
                  >
                    Go to Dashboard →
                  </button>
                )}
              </div>
            )
          ) : (
            /* Two-column layout */
            <>
              {/* ── Shared toolbar row (categories label + sort controls on one line) ── */}
              <div className="mb-2 flex items-center gap-3">
                {/* Left half: category label + save + apply-rules */}
                <div className="flex flex-1 items-center gap-2 min-w-0">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">
                    Categories
                  </span>
                  <button
                    onClick={handleSaveLayout}
                    disabled={savePrefMutation.isPending}
                    className={clsx(
                      'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition whitespace-nowrap',
                      saveConfirmed
                        ? 'border-green-300 bg-green-50 text-green-700'
                        : 'border-accent-500 bg-accent-500 text-white hover:bg-accent-600'
                    )}
                  >
                    {savePrefMutation.isPending
                      ? <><Loader2 size={12} className="animate-spin" /> Saving…</>
                      : saveConfirmed
                        ? <>✓ Saved</>
                        : <><Save size={12} /> Save Layout</>
                    }
                  </button>
                  <button
                    onClick={() => applyRulesMutation.mutate()}
                    disabled={applyRulesMutation.isPending}
                    title="Apply your saved rules to all uncategorized transactions"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-soft)] bg-[var(--surface2)] px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text)] hover:border-[var(--border-hover)] transition whitespace-nowrap"
                  >
                    {applyRulesMutation.isPending
                      ? <><Loader2 size={12} className="animate-spin" /> Applying…</>
                      : <><Zap size={12} /> Apply Rules</>
                    }
                  </button>
                  {applyRulesMsg && (
                    <span className="text-xs font-semibold text-green-400 whitespace-nowrap">{applyRulesMsg}</span>
                  )}
                </div>
                {/* Right half: sort controls */}
                <div className="flex flex-1 items-center gap-1.5 justify-end min-w-0">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 whitespace-nowrap">Sort:</span>
                  {(['date', 'amount', 'vendor'] as CatSortKey[]).map(key => {
                    const active = sortKey === key
                    const Icon = active ? (sortDir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
                    const label = key === 'date' ? 'Date' : key === 'amount' ? 'Amount' : 'Vendor'
                    return (
                      <button
                        key={key}
                        onClick={() => handleCatSort(key)}
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap',
                          active
                            ? 'border-accent-400 bg-accent-50 text-accent-700'
                            : 'border-[var(--border-soft)] bg-[var(--surface2)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text)]'
                        )}
                      >
                        {label}<Icon size={11} />
                      </button>
                    )
                  })}
                  {(sortKey !== 'date' || sortDir !== 'desc' || vendorQuery || samePriceOnly) && (
                    <button
                      onClick={resetSort}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--border-soft)] bg-[var(--surface2)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:text-[var(--text)] transition whitespace-nowrap"
                      title="Reset to default sort"
                    >
                      Reset
                    </button>
                  )}
                  <button
                    onClick={() => {
                      if (!samePriceOnly) {
                        setSamePriceOnly(true)
                        setSortKey('amount')
                        setSortDir('desc')
                        localStorage.setItem('budgetlens:cat-sort-key', 'amount')
                        localStorage.setItem('budgetlens:cat-sort-dir', 'desc')
                      } else {
                        const next: CatSortDir = sortDir === 'desc' ? 'asc' : 'desc'
                        setSortDir(next)
                        localStorage.setItem('budgetlens:cat-sort-dir', next)
                      }
                    }}
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition whitespace-nowrap',
                      samePriceOnly
                        ? 'border-teal-400 bg-teal-500/20 text-teal-300'
                        : 'border-[var(--border-soft)] bg-[var(--surface2)] text-[var(--text-secondary)] hover:border-[var(--border-hover)] hover:text-[var(--text)]'
                    )}
                  >
                    <Equal size={11} />
                    Same Price{samePriceCount > 0 && ` (${samePriceCount})`}
                    {samePriceOnly
                      ? (sortDir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)
                      : <ArrowUpDown size={11} />
                    }
                  </button>
                </div>
              </div>

              {/* ── Two-column grid ── */}
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

              {/* LEFT: Category drop targets */}
              <div>
                {/* Category rows — grouped into pairs so accordion expands inline */}
                <div className={clsx('categories-panel max-h-[calc(100vh-300px)] overflow-x-hidden overflow-y-auto px-1 py-0.5', isDraggingTx && 'drag-mode')}>
                  <SortableContext items={sortableCatIds} strategy={verticalListSortingStrategy}>
                    {Array.from({ length: Math.ceil(categories.length / 2) }, (_, rowIdx) => {
                      const row = categories.slice(rowIdx * 2, rowIdx * 2 + 2)
                      const expandedCat = row.find(c => c.id === expandedCatId)
                        ? categories.find(c => c.id === expandedCatId)!
                        : null
                      return (
                        <div key={rowIdx}>
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            {row.map((cat, i) => (
                              <div key={cat.id} className={row.length === 1 ? 'col-span-2' : ''}>
                                <CategoryBucket
                                  cat={cat}
                                  isDraggingTx={isDraggingTx}
                                  hasSelected={selectedIds.size > 0}
                                  isExpanded={expandedCatId === cat.id}
                                  onClickAssign={handleClickAssign}
                                  onToggleExpand={(id) => setExpandedCatId(prev => prev === id ? null : id)}
                                  onContextMenu={(c, e) => { setCatCtxMenu({ cat: c, x: e.clientX, y: e.clientY }); setCatDeleteConfirm(false) }}
                                  txCount={txCountByCat.get(cat.name) ?? 0}
                                  catAmount={amountByCat.get(cat.name)}
                                />
                              </div>
                            ))}
                          </div>

                          {/* Inline accordion — spans full width, appears directly under this row */}
                          {expandedCat && (
                            <div className="mb-2 rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-soft)', background: 'var(--card2)' }}>
                              <div className="flex items-center justify-between px-3 py-2 border-b" style={{ borderColor: 'var(--border-soft)', background: 'var(--surface2)' }}>
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
                                onRemove={(txId) => {
                                  updateMutation.mutate({ id: txId, appCategory: null, applyToAll: false })
                                }}
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </SortableContext>
                </div>
              </div>

              {/* RIGHT: Transaction queue */}
              <div>
                {/* Vendor filter */}
                <div className="relative mb-2">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Filter by vendor…"
                    value={vendorQuery}
                    onChange={e => setVendorQuery(e.target.value)}
                    className="w-full rounded-lg py-1.5 pl-7 pr-7 text-xs outline-none transition"
                    style={{ background: 'var(--surface2)', border: '1px solid var(--border-soft)', color: 'var(--text)', borderRadius: 10 }}
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
                      isDragSource={draggingIds.includes(tx.id)}
                      onClick={handleTxClick}
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
          </>
          )}

        </main>

        {/* Touch ghost element */}
        <TouchGhost tx={touchTx} pos={touchPos} />

        {/* Category right-click context menu */}
        {catCtxMenu && (
          <div
            onMouseDown={e => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: Math.min(catCtxMenu.y, window.innerHeight - 180),
              left: Math.min(catCtxMenu.x, window.innerWidth - 220),
              zIndex: 9999, width: 210,
              background: '#111a2d', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              padding: 6, display: 'flex', flexDirection: 'column', gap: 2,
            }}
          >
            <button
              onClick={() => { setCatCtxMenu(null); setShowAddCat(true) }}
              style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:9, background:'transparent', border:'none', cursor:'pointer', width:'100%', textAlign:'left', color:'#d0d8f0', fontSize:13, fontWeight:600 }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.07)' }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
            >
              <PlusCircle size={14} style={{ color: '#6c7cff' }} />
              Add category
            </button>
            <>
              <div style={{ height:1, background:'rgba(255,255,255,0.07)', margin:'2px 0' }} />
              {catDeleteConfirm ? (
                <div style={{ padding:'8px 10px' }}>
                  <p style={{ fontSize:12, color:'#9aa6bf', marginBottom:8 }}>
                    {catCtxMenu.cat.isSystem ? 'Hide' : 'Delete'} <strong style={{ color:'#f2f5ff' }}>{catCtxMenu.cat.name}</strong>?
                  </p>
                  {catCtxMenu.cat.isSystem && (
                    <p style={{ fontSize:11, color:'#6b7a99', marginBottom:8 }}>It can be restored from the Categories page.</p>
                  )}
                  <div style={{ display:'flex', gap:6 }}>
                    <button
                      onClick={() => deleteCatMutation.mutate(catCtxMenu.cat.id)}
                      disabled={deleteCatMutation.isPending}
                      style={{ flex:1, padding:'6px 0', borderRadius:8, background:'rgba(255,127,144,0.15)', border:'1px solid rgba(255,127,144,0.3)', color:'#ff7f90', fontSize:12, fontWeight:700, cursor:'pointer' }}
                    >
                      {deleteCatMutation.isPending ? '…' : catCtxMenu.cat.isSystem ? 'Hide' : 'Delete'}
                    </button>
                    <button
                      onClick={() => setCatDeleteConfirm(false)}
                      style={{ flex:1, padding:'6px 0', borderRadius:8, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'#9aa6bf', fontSize:12, fontWeight:600, cursor:'pointer' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setCatDeleteConfirm(true)}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:9, background:'transparent', border:'none', cursor:'pointer', width:'100%', textAlign:'left', color:'#ff7f90', fontSize:13, fontWeight:600 }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,127,144,0.1)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent' }}
                >
                  <Trash2 size={14} />
                  {catCtxMenu.cat.isSystem ? 'Hide' : 'Delete'} {catCtxMenu.cat.name}
                </button>
              )}
            </>
          </div>
        )}

        {/* Add category modal */}
        {showAddCat && (
          <div
            onClick={() => setShowAddCat(false)}
            style={{ position:'fixed', inset:0, zIndex:9998, background:'rgba(0,0,0,0.55)', display:'flex', alignItems:'center', justifyContent:'center' }}
          >
            <div
              onClick={e => e.stopPropagation()}
              style={{ width:320, background:'#111a2d', border:'1px solid rgba(255,255,255,0.1)', borderRadius:18, padding:24, boxShadow:'0 16px 48px rgba(0,0,0,0.6)' }}
            >
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
                <span style={{ fontSize:15, fontWeight:700, color:'#f2f5ff' }}>New Category</span>
                <button onClick={() => setShowAddCat(false)} style={{ background:'none', border:'none', cursor:'pointer', color:'#6b7a99', padding:4 }}><X size={16} /></button>
              </div>

              <input
                autoFocus
                placeholder="Category name…"
                value={addCatName}
                onChange={e => setAddCatName(e.target.value)}
                maxLength={50}
                style={{ width:'100%', padding:'8px 12px', borderRadius:10, background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', color:'#f2f5ff', fontSize:14, outline:'none', marginBottom:16, boxSizing:'border-box' }}
              />

              <p style={{ fontSize:11, fontWeight:700, color:'#6b7a99', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:8 }}>Icon</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:16 }}>
                {CAT_ICONS.map(ico => (
                  <button key={ico} onClick={() => setAddCatIcon(ico)}
                    style={{ width:34, height:34, borderRadius:8, fontSize:16, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', background: addCatIcon === ico ? 'rgba(108,124,255,0.2)' : 'rgba(255,255,255,0.06)', border: addCatIcon === ico ? '1px solid rgba(108,124,255,0.4)' : '1px solid rgba(255,255,255,0.08)' }}
                  >{ico}</button>
                ))}
              </div>

              <p style={{ fontSize:11, fontWeight:700, color:'#6b7a99', letterSpacing:'0.07em', textTransform:'uppercase', marginBottom:8 }}>Color</p>
              <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:20 }}>
                {CAT_COLORS.map(c => (
                  <button key={c} onClick={() => setAddCatColor(c)}
                    style={{ width:24, height:24, borderRadius:'50%', cursor:'pointer', backgroundColor:c, border: addCatColor === c ? '2px solid #fff' : '2px solid transparent', transform: addCatColor === c ? 'scale(1.15)' : 'scale(1)', transition:'transform 0.1s' }}
                  />
                ))}
              </div>

              <button
                onClick={() => createCatMutation.mutate()}
                disabled={!addCatName.trim() || createCatMutation.isPending}
                style={{ width:'100%', padding:'10px 0', borderRadius:10, background: addCatName.trim() ? 'rgba(108,124,255,0.2)' : 'rgba(255,255,255,0.05)', border:'1px solid rgba(108,124,255,0.3)', color: addCatName.trim() ? '#c5d0ff' : '#6b7a99', fontSize:14, fontWeight:700, cursor: addCatName.trim() ? 'pointer' : 'not-allowed' }}
              >
                {createCatMutation.isPending ? 'Creating…' : 'Create Category'}
              </button>
            </div>
          </div>
        )}

        {/* Rule ask modal — prompt on first assignment of a vendor+price combo */}
        {ruleAsk && (
          <RuleAskModal
            state={ruleAsk}
            allVendorAmounts={vendorAmountsFor(ruleAsk.tx.merchantNormalized)}
            isPending={updateMutation.isPending || createRuleMutation.isPending || bulkAssignMutation.isPending}
            totalRemaining={ruleAskQueue.length}
            onAlways={(matchType, learnedAmounts) => {
              updateMutation.mutate({ id: ruleAsk.tx.id, appCategory: ruleAsk.category.name, applyToAll: ruleAsk.similarCount > 1 })
              createRuleMutation.mutate({
                matchType,
                matchValue:     ruleAsk.tx.merchantNormalized,
                amountExact:    matchType === 'vendor_exact_amount' ? Math.round(ruleAsk.tx.amount * 100) : undefined,
                learnedAmounts: matchType === 'vendor_smart' ? learnedAmounts : undefined,
                categoryId:     ruleAsk.category.id,
                mode:           'always',
                scopeAccountId: ruleAsk.tx.accountId,
              })
              popRuleAsk(); setSelectedIds(new Set()); setAnchorId(null)
            }}
            onAlwaysAll={(matchType, learnedAmounts) => {
              const allItems = [ruleAsk, ...ruleAskQueue]
              bulkAssignMutation.mutate(
                allItems.map(item => ({
                  txId:           item.tx.id,
                  appCategory:    item.category.name,
                  applyToAll:     item.similarCount > 1,
                  createRule:     true,
                  matchType,
                  matchValue:     item.tx.merchantNormalized,
                  amountExact:    matchType === 'vendor_exact_amount' ? Math.round(item.tx.amount * 100) : undefined,
                  learnedAmounts: matchType === 'vendor_smart' ? [Math.abs(Math.round(item.tx.amount * 100))] : undefined,
                  categoryId:     item.category.id,
                  scopeAccountId: item.tx.accountId,
                }))
              )
              setRuleAskQueue([]); setRuleAsk(null); setSelectedIds(new Set()); setAnchorId(null)
            }}
            onJustOne={() => {
              updateMutation.mutate({ id: ruleAsk.tx.id, appCategory: ruleAsk.category.name, applyToAll: false })
              popRuleAsk(); setSelectedIds(new Set()); setAnchorId(null)
            }}
            onCancel={() => { setRuleAskQueue([]); setRuleAsk(null) }}
          />
        )}

        {/* DragOverlay — renders the ghost following the cursor */}
        <DragOverlay dropAnimation={null} modifiers={[snapPointerToTopLeft]}>
          {activeDrag?.kind === 'tx' && (
            <div style={{
              position: 'relative',
              pointerEvents: 'none',
              width: 44,
              height: 44,
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-card)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.12)',
              border: '1px solid var(--border-selected)',
            }}>
              <FileText size={18} style={{ color: 'var(--accent)' }} strokeWidth={1.75} />
              {activeDrag.draggingIds.length > 1 && (
                <span style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  background: 'var(--warn)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: '1px 5px',
                  border: '1.5px solid rgba(0,0,0,0.12)',
                }}>
                  {activeDrag.draggingIds.length}
                </span>
              )}
            </div>
          )}
          {activeDrag?.kind === 'cat' && (() => {
            const cat = categories.find(c => c.id === activeDrag.catId)
            if (!cat) return null
            return <CatOverlay cat={cat} txCount={txCountByCat.get(cat.name) ?? 0} />
          })()}
        </DragOverlay>
      </DndContext>
    </AppShell>
  )
}
