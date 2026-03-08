'use client'

import { useState, useCallback, useEffect, useRef, useMemo, useTransition } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { CheckCircle2, GripVertical, Loader2, AlertCircle, ChevronRight, ArrowUp, ArrowDown, ArrowUpDown, Search, X, Save, Zap, FileText, Equal, Lightbulb, Store } from 'lucide-react'
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
        'tx-card group relative flex items-start gap-3 rounded-xl border p-3 touch-none select-none',
        isSource
          ? 'opacity-50 border-dashed cursor-grabbing'
          : isSelected
            ? 'border-accent-500 ring-2 ring-accent-200 bg-accent-50 cursor-grab'
            : 'cursor-grab',
      )}
      style={!isSelected ? {
        background: 'var(--card)',
        borderColor: 'var(--border)',
      } : undefined}
    >
      {/* Drag handle */}
      <div
        aria-hidden="true"
        className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-[10px] flex items-center justify-center border opacity-60 group-hover:opacity-100 transition-opacity duration-[140ms]"
        style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}
      >
        <div className="grid grid-cols-3 gap-[3px]" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="block w-[3px] h-[3px] rounded-sm" style={{ background: 'var(--muted)' }} />
          ))}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>
            {tx.merchantNormalized || tx.description}
          </p>
          <p style={{ flexShrink: 0, fontSize: 13, fontWeight: 700, color: tx.amount < 0 ? '#FF5B78' : '#2EE59D', margin: 0 }}>
            {fmtAmt(tx.amount)}
          </p>
        </div>

        <p className="mt-0.5 truncate text-xs" style={{ color: 'var(--muted)' }}>{fmtDate(tx.date)}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {tx.appCategory ? (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold border"
              style={{ background: 'rgba(16,185,129,0.12)', color: '#10b981', borderColor: 'rgba(16,185,129,0.25)' }}>
              ✓ {tx.appCategory}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border"
              style={{ background: 'rgba(245,158,11,0.12)', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.25)' }}>
              Uncategorized
            </span>
          )}
          {tx.bankCategoryRaw && (
            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium border"
              style={{ background: 'var(--accent-muted)', color: 'var(--accent)', borderColor: 'var(--border2)' }}>
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
  isDraggingTx,
  hasSelected,
  isExpanded,
  onClickAssign,
  onToggleExpand,
  txCount,
  children,
}: {
  cat: Category
  isDraggingTx: boolean
  hasSelected: boolean
  isExpanded: boolean
  onClickAssign: (id: string) => void
  onToggleExpand: (id: string) => void
  txCount?: number
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
      style={{
        ...style,
        // @ts-ignore CSS custom property for accent bar color
        '--cat-accent': cat.color,
        background: showOver ? 'rgba(120,170,255,0.10)' : 'var(--card)',
        border: showOver ? '1px solid rgba(120,170,255,.40)' : '1px solid var(--border)',
        boxShadow: showOver ? '0 0 0 3px rgba(120,170,255,.16)' : undefined,
        borderRadius: 16,
        padding: '12px 14px',
        opacity: isSortDragging ? 0.4 : 1,
      }}
      onClick={() => { if (!isDraggingTx) onToggleExpand(cat.id) }}
      className={clsx(
        'cat-bucket flex items-center gap-3 select-none cursor-pointer overflow-hidden',
        showOver && '!transform-none',
      )}
    >
      {/* Reorder grip */}
      <div
        {...attributes}
        {...listeners}
        onClick={e => e.stopPropagation()}
        aria-label="Reorder category"
        className="flex-shrink-0 w-5 h-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-40 hover:!opacity-80 transition-opacity duration-100"
        style={{ cursor: isSortDragging ? 'grabbing' : 'grab', touchAction: 'none' }}
      >
        <GripVertical size={13} style={{ color: 'var(--muted)' }} />
      </div>

      {/* Icon box — tinted with category color */}
      <div
        className="cat-icon flex-shrink-0 flex items-center justify-center"
        style={{
          width: 36, height: 36, borderRadius: 12,
          background: cat.color + '22',
          border: `1px solid ${cat.color}33`,
        }}
      >
        <CategoryIcon name={cat.icon} color={cat.color} size={18} />
      </div>

      {/* Name */}
      <span className="flex-1 min-w-0 truncate font-semibold" style={{ fontSize: 15, color: 'var(--text)' }}>
        {cat.name}
      </span>

      {/* Drop hint */}
      {showOver && (
        <span className="flex-shrink-0 text-[11px] font-medium" style={{ color: 'rgba(120,170,255,0.9)' }}>
          Drop to assign
        </span>
      )}

      {/* Count badge */}
      {txCount != null && txCount > 0 && !showOver && (
        <span
          className="flex-shrink-0 text-[11.5px] font-medium px-2 py-0.5 rounded-full"
          style={{ color: 'var(--muted)', background: 'var(--surface2)', border: '1px solid var(--border)' }}
        >
          {txCount}
        </span>
      )}

      {/* Chevron */}
      {!isDraggingTx && (
        <ChevronRight
          size={14}
          style={{ color: 'var(--muted)', flexShrink: 0 }}
          className={clsx('transition-transform duration-150', isExpanded ? 'rotate-90' : '')}
        />
      )}
    </div>
  )
}

// ─── Rule Ask Modal ───────────────────────────────────────────────────────────

interface RuleAskState {
  tx: Transaction
  category: { id: string; name: string; icon: string; color: string }
  similarCount: number
}

function RuleAskModal({
  state,
  isPending,
  onAlways,
  onJustOne,
  onCancel,
  totalRemaining,
}: {
  state: RuleAskState
  isPending: boolean
  onAlways: () => void
  onJustOne: () => void
  onCancel: () => void
  totalRemaining?: number
}) {
  const vendor = state.tx.merchantNormalized || state.tx.description
  const amount = state.tx.amount
  const totalInQueue = (totalRemaining ?? 0) + 1
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" style={{ backdropFilter: 'blur(4px)' }}>
      <div className="w-full max-w-md rounded-2xl p-6 shadow-xl" style={{ background: 'rgba(11,16,32,.96)', border: '1px solid rgba(255,255,255,.12)' }}>
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100">
            <Zap size={18} className="text-accent-600" />
          </span>
          <div>
            <h3 className="font-bold text-[#eaf0ff]">
              Auto-assign rule?{totalRemaining && totalRemaining > 0 ? ` (1 of ${totalInQueue})` : ''}
            </h3>
            <p className="text-sm text-[#8b97c3] mt-0.5">
              Always assign <strong className="text-[#c8d4f5]">{vendor}</strong>{' '}
              ({fmtAmt(amount)}) →{' '}
              <strong className="text-[#c8d4f5]">{state.category.name}</strong>{' '}
              for future imports?
            </p>
            {state.similarCount > 1 && (
              <p className="text-xs text-[rgba(255,180,60,.85)] mt-1">
                Also categorizes {state.similarCount - 1} similar transaction{state.similarCount > 2 ? 's' : ''} in this batch.
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            disabled={isPending}
            className="rounded-lg border px-4 py-2 text-sm font-medium text-[#8b97c3] hover:bg-white/[.06] disabled:opacity-50"
            style={{ borderColor: 'rgba(255,255,255,.12)' }}
          >
            Cancel
          </button>
          <button
            onClick={onJustOne}
            disabled={isPending}
            className="rounded-lg border border-accent-200 bg-accent-50 px-4 py-2 text-sm font-medium text-accent-700 hover:bg-accent-100 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="inline animate-spin" /> : 'Just this one'}
          </button>
          <button
            onClick={onAlways}
            disabled={isPending}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="inline animate-spin" /> : 'Yes, always'}
          </button>
        </div>
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
            <h3 className="font-bold text-[#eaf0ff]">Move to {state.category.name}?</h3>
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

// ─── Touch Ghost (kept for fallback — TouchGhost is now less needed but harmless) ──

function TouchGhost({ tx, pos }: { tx: Transaction | null; pos: { x: number; y: number } | null }) {
  if (!tx || !pos) return null
  return (
    <div
      className="pointer-events-none fixed z-[100] max-w-[180px] rounded-lg p-2 shadow-lg backdrop-blur-sm"
      style={{ background: 'rgba(11,16,32,.92)', border: '1px solid rgba(110,168,255,.35)', left: pos.x - 90, top: pos.y - 30 }}
    >
      <p className="truncate text-xs font-semibold text-[#eaf0ff]">{tx.merchantNormalized || tx.description}</p>
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
    <div className="mt-1.5 mb-1 ml-2 mr-1 rounded-xl overflow-y-auto max-h-72" style={{ background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)' }}>
      {txs.map(tx => {
        const moveCat = pendingMove?.txId === tx.id
          ? categories.find(c => c.name === pendingMove.catName)
          : undefined
        return (
        <div key={tx.id} className="px-3 py-2.5 hover:bg-white/[.04] transition-colors border-b border-white/[.06] last:border-0">
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
                <div className="mt-2 rounded-2xl p-4" style={{ background: 'rgba(11,16,32,.96)', border: '1px solid rgba(255,255,255,.12)' }}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-100">
                      <CategoryIcon name={moveCat?.icon ?? 'tag'} color={moveCat?.color ?? '#6366f1'} size={20} />
                    </span>
                    <div>
                      <p className="font-bold text-sm text-[#eaf0ff]">Move to {pendingMove.catName}?</p>
                      <p className="text-xs text-slate-500">{tx.merchantNormalized}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#8b97c3] hover:bg-white/[.06] transition" style={{ border: '1px solid rgba(255,255,255,.12)' }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => { onMove(pendingMove.txId, pendingMove.catName, false); setPendingMove(null); setMovingId(null); setCatSearch('') }}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-accent-300 hover:bg-accent-500/10 transition" style={{ border: '1px solid rgba(99,102,241,.35)' }}
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
                    className="w-full rounded border border-white/10 px-2 py-1 text-xs mb-1 outline-none focus:border-accent-400 text-[#eaf0ff] placeholder-slate-400" style={{ background: 'rgba(255,255,255,.06)' }}
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
                  className="mt-1.5 flex-shrink-0 px-2 py-0.5 rounded border border-white/10 text-[10px] font-medium text-[#8b97c3] hover:border-accent-400 hover:text-accent-600 transition" style={{ background: 'rgba(255,255,255,.04)' }}
                >
                  Move
                </button>
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
            <p className="text-sm font-semibold text-[#eaf0ff]">Remember this?</p>
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

  const cards: Array<{ Icon: React.ElementType; title: string; body: string; sub: string; onClick: () => void }> = [
    {
      Icon: ArrowUpDown,
      title: 'Amount',
      body: 'Groups identical transactions.',
      sub: 'Great for bills and subscriptions.',
      onClick: onSortAmount,
    },
    {
      Icon: Store,
      title: 'Vendor',
      body: 'Clusters merchants together.',
      sub: 'Categorize many at once.',
      onClick: onSortVendor,
    },
    {
      Icon: Equal,
      title: 'Same Price',
      body: 'Detect recurring payments.',
      sub: 'Netflix, Spotify, utilities.',
      onClick: onSortSamePrice,
    },
  ]

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
      marginBottom: 16, padding: '12px 16px', borderRadius: 12,
      background: 'var(--card)',
      border: '1px solid var(--border)',
    }}>

      {/* Header label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
        <Lightbulb size={14} style={{ color: 'var(--accent)' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          Smart Tips
        </span>
      </div>

      {/* Divider */}
      <div style={{ width: 1, height: 32, background: 'var(--border)', flexShrink: 0 }} />

      {/* Tip cards */}
      <div style={{ display: 'flex', gap: 10, flex: 1, flexWrap: 'wrap' }}>
        {cards.map(({ Icon, title, body, sub, onClick }) => (
          <button
            key={title}
            onClick={onClick}
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 9,
              padding: '8px 12px', borderRadius: 10, cursor: 'pointer',
              background: 'var(--card2)',
              border: '1px solid var(--border)',
              textAlign: 'left', transition: 'background 0.15s, border-color 0.15s',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'var(--accent-muted)'
              e.currentTarget.style.borderColor = 'var(--border2)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'var(--card2)'
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            <Icon size={13} style={{ color: 'var(--accent)', marginTop: 2, flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 }}>{title}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{body}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.4 }}>{sub}</div>
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
  const [fromInsights, setFromInsights] = useState(false)
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
  useEffect(() => {
    setFromInsights(new URLSearchParams(window.location.search).get('from') === 'insights')
  }, [])

  const [filterMode,    setFilterMode]    = useState<FilterMode>('needs-review')
  const [selectedIds,   setSelectedIds]   = useState<Set<string>>(new Set())
  const [anchorId,      setAnchorId]      = useState<string | null>(null)
  const [expandedCatId, setExpandedCatId] = useState<string | null>(null)

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
      qc.invalidateQueries({ queryKey: ['insights-unlock-status'] })
      invalidateDashboard()
    },
  })

  // ── Rule creation mutation ──
  const createRuleMutation = useMutation({
    mutationFn: ({ matchValue, amountExact, categoryId, mode, scopeAccountId }: { matchValue: string; amountExact?: number; categoryId: string; mode: 'always' | 'ask'; scopeAccountId?: string }) =>
      apiFetch('/api/rules', {
        method: 'POST',
        body: JSON.stringify({ matchType: 'vendor_exact_amount', matchValue, amountExact, categoryId, mode, scopeAccountId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rules'] })
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
          {/* From-insights banner */}
          {fromInsights && !unlocked && (
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                marginBottom: 16, padding: '12px 16px', borderRadius: 12,
                background: 'rgba(111,128,255,0.12)',
                border: '1px solid rgba(111,128,255,0.3)',
              }}
            >
              <span style={{ fontSize: 16 }}>🔒</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
                Finish categorizing your transactions to unlock AI Insights.
              </span>
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
                    : 'linear-gradient(90deg, #6f80ff, #9aa5ff)',
                  transition: 'width 0.4s ease',
                }} />
              </div>
            </div>
          )}

          {/* Header */}
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">Categorize</h1>
              <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
                Categorizations go faster when you group similar transactions.
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {needsReviewCount > 0 && (
                <span className="badge bg-amber-100 text-amber-700">
                  {needsReviewCount} uncategorized
                </span>
              )}
              <div className="flex rounded-lg border border-white/10 overflow-hidden text-sm font-semibold">
                <button
                  onClick={() => setFilterMode('needs-review')}
                  className={clsx('px-3 py-1.5 transition', filterMode === 'needs-review' ? 'bg-accent-500 text-white' : 'text-[#8b97c3] hover:bg-white/[.06]')}
                >
                  Uncategorized
                </button>
                <button
                  onClick={() => setFilterMode('all')}
                  className={clsx('px-3 py-1.5 transition', filterMode === 'all' ? 'bg-accent-500 text-white' : 'text-[#8b97c3] hover:bg-white/[.06]')}
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

          {/* ── Categorization tips panel ─────────────────────────────────── */}
          <CategorizationTips
            onSortAmount={() => { handleCatSort('amount'); setSamePriceOnly(false) }}
            onSortVendor={() => { handleCatSort('vendor'); setSamePriceOnly(false) }}
            onSortSamePrice={() => { setSamePriceOnly(true); setSortKey('amount'); setSortDir('desc') }}
          />

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
                          : 'border-white/10 bg-white/[.03] text-white/20 cursor-not-allowed'
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

                {/* Category rows — grouped into pairs so accordion expands inline */}
                <div className="max-h-[calc(100vh-270px)] overflow-x-hidden overflow-y-auto px-1 py-0.5">
                  <SortableContext items={sortableCatIds} strategy={verticalListSortingStrategy}>
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
                                isDraggingTx={isDraggingTx}
                                hasSelected={selectedIds.size > 0}
                                isExpanded={expandedCatId === cat.id}
                                onClickAssign={handleClickAssign}
                                onToggleExpand={(id) => setExpandedCatId(prev => prev === id ? null : id)}
                                txCount={txCountByCat.get(cat.name) ?? 0}
                              />
                            ))}
                            {/* Fill empty cell if odd number of categories */}
                            {row.length === 1 && <div />}
                          </div>

                          {/* Inline accordion — spans full width, appears directly under this row */}
                          {expandedCat && (
                            <div className="mb-2 rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.02)' }}>
                              <div className="flex items-center justify-between px-3 py-2 border-b border-white/[.07]" style={{ background: 'rgba(255,255,255,.04)' }}>
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
                  </SortableContext>
                </div>
              </div>

              {/* RIGHT: Transaction queue */}
              <div>
                {/* Sort + filter controls */}
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
                              : 'border-white/10 bg-white/[.04] text-[#8b97c3] hover:border-white/20 hover:text-[#c8d4f5]'
                          )}
                        >
                          {label}<Icon size={11} />
                        </button>
                      )
                    })}
                    {(sortKey !== 'date' || sortDir !== 'desc' || vendorQuery || samePriceOnly) && (
                      <button
                        onClick={resetSort}
                        className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/[.04] px-2 py-1 text-xs text-[#8b97c3] hover:text-[#c8d4f5] transition"
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
                          // already on — toggle direction
                          const next: CatSortDir = sortDir === 'desc' ? 'asc' : 'desc'
                          setSortDir(next)
                          localStorage.setItem('budgetlens:cat-sort-dir', next)
                        }
                      }}
                      className={clsx(
                        'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold transition',
                        samePriceOnly
                          ? 'border-teal-400 bg-teal-500/20 text-teal-300'
                          : 'border-white/10 bg-white/[.04] text-[#8b97c3] hover:border-white/20 hover:text-[#c8d4f5]'
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

                  {/* Vendor filter */}
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter by vendor…"
                      value={vendorQuery}
                      onChange={e => setVendorQuery(e.target.value)}
                      className="w-full rounded-lg border border-white/10 py-1.5 pl-7 pr-7 text-xs text-[#c8d4f5] placeholder-slate-400 outline-none focus:border-accent-400 transition" style={{ background: 'rgba(255,255,255,.06)' }}
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
          )}

        </main>

        {/* Touch ghost element */}
        <TouchGhost tx={touchTx} pos={touchPos} />

        {/* Rule ask modal — prompt on first assignment of a vendor+price combo */}
        {ruleAsk && (
          <RuleAskModal
            state={ruleAsk}
            isPending={updateMutation.isPending || createRuleMutation.isPending}
            totalRemaining={ruleAskQueue.length}
            onAlways={() => {
              updateMutation.mutate({ id: ruleAsk.tx.id, appCategory: ruleAsk.category.name, applyToAll: ruleAsk.similarCount > 1 })
              createRuleMutation.mutate({
                matchValue:     ruleAsk.tx.merchantNormalized,
                amountExact:    Math.round(ruleAsk.tx.amount * 100),
                categoryId:     ruleAsk.category.id,
                mode:           'always',
                scopeAccountId: ruleAsk.tx.accountId,
              })
              popRuleAsk(); setSelectedIds(new Set()); setAnchorId(null)
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
              width: 48,
              height: 48,
              borderRadius: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'linear-gradient(135deg, rgba(99,102,241,0.9), rgba(168,85,247,0.85))',
              boxShadow: '0 0 0 6px rgba(99,102,241,0.18), 0 0 24px rgba(99,102,241,0.55), 0 8px 24px rgba(0,0,0,0.5)',
              border: '1px solid rgba(168,85,247,0.5)',
            }}>
              <FileText size={22} color="white" strokeWidth={1.75} />
              {activeDrag.draggingIds.length > 1 && (
                <span style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  background: 'rgba(255,180,60,0.95)',
                  color: '#fff',
                  fontSize: 10,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: '1px 5px',
                  border: '1.5px solid rgba(0,0,0,0.2)',
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
