'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, AlertCircle, Search, X } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Transaction {
  id: string
  date: string
  description: string
  merchantNormalized: string
  amount: number
  isTransfer: boolean
  categorizationSource: string
  confidenceScore: number
  reviewedByUser: boolean
  category: { id: string; name: string; color: string; icon: string } | null
  bankCategoryRaw?: string | null
  appCategory?: string | null
}

type FilterMode = 'all' | 'no-category' | 'has-category'

// ─── Toast prompt for "apply to all" ─────────────────────────────────────────

interface ApplyAllPrompt {
  txId: string
  merchantNormalized: string
  appCategory: string
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtAmt(n: number) {
  const abs = Math.abs(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
  return n < 0 ? `-${abs}` : abs
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ─── AppCategoryPicker ────────────────────────────────────────────────────────

function AppCategoryPicker({
  txId,
  appCategory,
  existingCategories,
  onAssign,
  onClear,
}: {
  txId: string
  appCategory?: string | null
  existingCategories: string[]
  onAssign: (txId: string, value: string) => void
  onClear: (txId: string) => void
}) {
  const [open, setOpen]     = useState(false)
  const [search, setSearch] = useState('')
  const inputRef            = useRef<HTMLInputElement>(null)
  const containerRef        = useRef<HTMLDivElement>(null)

  // Auto-focus input when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    } else {
      setSearch('')
    }
  }, [open])

  // Close on click outside
  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const filtered = existingCategories.filter(c =>
    c.toLowerCase().includes(search.toLowerCase())
  )

  const showCreate = search.trim().length > 0 &&
    !existingCategories.some(c => c.toLowerCase() === search.trim().toLowerCase())

  function handleSelect(value: string) {
    onAssign(txId, value.trim())
    setOpen(false)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (showCreate) {
        handleSelect(search.trim())
      } else if (filtered.length > 0) {
        handleSelect(filtered[0])
      }
    }
    if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (appCategory) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-green-700 bg-green-50 px-1.5 py-0.5 rounded-full border border-green-200">
        {appCategory}
        <button
          onClick={e => { e.stopPropagation(); onClear(txId) }}
          className="ml-0.5 text-green-500 hover:text-green-700 transition leading-none"
          title="Clear category"
        >
          <X size={10} />
        </button>
      </span>
    )
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        onClick={() => setOpen(v => !v)}
        className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 border border-dashed border-slate-300 px-1.5 py-0.5 rounded hover:border-green-400 hover:text-green-600 transition"
      >
        + Add category
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-52 rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="p-1.5 border-b border-slate-100">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search or type new…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-green-400"
            />
          </div>
          <div className="max-h-44 overflow-y-auto py-1">
            {showCreate && (
              <button
                onClick={() => handleSelect(search.trim())}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-green-700 hover:bg-green-50 transition text-left"
              >
                <span className="text-green-500">+</span>
                Create &ldquo;{search.trim()}&rdquo;
              </button>
            )}
            {filtered.map(cat => (
              <button
                key={cat}
                onClick={() => handleSelect(cat)}
                className="flex w-full items-center px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50 transition text-left"
              >
                {cat}
              </button>
            ))}
            {filtered.length === 0 && !showCreate && (
              <p className="px-3 py-2 text-[10px] text-slate-400 italic">
                No categories yet — type to create one
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Transaction Card ─────────────────────────────────────────────────────────

function TxCard({
  tx,
  existingCategories,
  onAssign,
  onClear,
}: {
  tx: Transaction
  existingCategories: string[]
  onAssign: (txId: string, value: string) => void
  onClear: (txId: string) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 hover:shadow-sm transition-all">
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="truncate text-sm font-semibold text-slate-900">
            {tx.merchantNormalized || tx.description}
          </p>
          <p className={clsx('flex-shrink-0 text-sm font-bold', tx.amount < 0 ? 'text-red-600' : 'text-green-600')}>
            {fmtAmt(tx.amount)}
          </p>
        </div>

        <p className="mt-0.5 text-xs text-slate-400">{fmtDate(tx.date)}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {tx.bankCategoryRaw && (
            <span className="text-[10px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full font-medium">
              {tx.bankCategoryRaw}
            </span>
          )}
          <AppCategoryPicker
            txId={tx.id}
            appCategory={tx.appCategory}
            existingCategories={existingCategories}
            onAssign={onAssign}
            onClear={onClear}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Apply-to-all Toast ───────────────────────────────────────────────────────

function ApplyAllToast({
  prompt,
  onApplyAll,
  onDismiss,
}: {
  prompt: ApplyAllPrompt
  onApplyAll: () => void
  onDismiss: () => void
}) {
  return (
    <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-xl bg-slate-800 px-4 py-3 text-sm text-white shadow-lg">
      <span className="text-slate-300">
        Apply <strong className="text-white">&ldquo;{prompt.appCategory}&rdquo;</strong> to all{' '}
        <strong className="text-white">{prompt.merchantNormalized}</strong>?
      </span>
      <button
        onClick={onApplyAll}
        className="rounded-lg bg-green-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-green-500 transition"
      >
        Yes, all
      </button>
      <button
        onClick={onDismiss}
        className="text-slate-400 hover:text-white transition text-xs font-semibold"
      >
        Just this one
      </button>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CategorizePage() {
  const router = useRouter()
  const user   = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc     = useQueryClient()

  useEffect(() => { if (!user) router.replace('/') }, [user, router])

  const [filterMode,    setFilterMode]    = useState<FilterMode>('all')
  const [searchText,    setSearchText]    = useState('')
  const [applyAllPrompt, setApplyAllPrompt] = useState<ApplyAllPrompt | null>(null)

  // ── Transactions query ──────────────────────────────────────────────────────

  const { data: txData, isLoading: txLoading, error: txError } = useQuery({
    queryKey: ['transactions', 'categorize'],
    queryFn: () => apiFetch('/api/transactions?page=1&limit=100'),
    enabled: !!user,
  })

  const allTxs: Transaction[] = txData?.transactions ?? []

  // ── App categories query ────────────────────────────────────────────────────

  const { data: appCatsData } = useQuery({
    queryKey: ['app-categories'],
    queryFn: () => apiFetch('/api/categories/app-categories'),
    enabled: !!user,
  })
  const existingAppCategories: string[] = appCatsData?.categories ?? []

  // ── Assign mutation ─────────────────────────────────────────────────────────

  const assignMutation = useMutation({
    mutationFn: ({ id, appCategory, applyToAll }: { id: string; appCategory: string | null; applyToAll?: boolean }) =>
      apiFetch(`/api/transactions/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ appCategory, applyToAll: applyToAll ?? false }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['app-categories'] })
    },
  })

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleAssign = useCallback((txId: string, value: string) => {
    const tx = allTxs.find(t => t.id === txId)
    // Optimistic update in local query cache
    qc.setQueryData(['transactions', 'categorize'], (old: { transactions: Transaction[] } | undefined) => {
      if (!old) return old
      return {
        ...old,
        transactions: old.transactions.map(t =>
          t.id === txId ? { ...t, appCategory: value } : t
        ),
      }
    })
    assignMutation.mutate({ id: txId, appCategory: value, applyToAll: false })
    // Show "apply to all" prompt if merchant is known
    if (tx?.merchantNormalized) {
      setApplyAllPrompt({ txId, merchantNormalized: tx.merchantNormalized, appCategory: value })
      // Auto-dismiss after 8 seconds
      setTimeout(() => setApplyAllPrompt(p => p?.txId === txId ? null : p), 8000)
    }
  }, [allTxs, assignMutation, qc])

  const handleClear = useCallback((txId: string) => {
    qc.setQueryData(['transactions', 'categorize'], (old: { transactions: Transaction[] } | undefined) => {
      if (!old) return old
      return {
        ...old,
        transactions: old.transactions.map(t =>
          t.id === txId ? { ...t, appCategory: null } : t
        ),
      }
    })
    assignMutation.mutate({ id: txId, appCategory: null })
    setApplyAllPrompt(null)
  }, [assignMutation, qc])

  const handleApplyAll = useCallback(() => {
    if (!applyAllPrompt) return
    const { txId, appCategory } = applyAllPrompt
    assignMutation.mutate({ id: txId, appCategory, applyToAll: true })
    // Optimistically apply to all same-merchant
    const tx = allTxs.find(t => t.id === txId)
    if (tx?.merchantNormalized) {
      const merchant = tx.merchantNormalized
      qc.setQueryData(['transactions', 'categorize'], (old: { transactions: Transaction[] } | undefined) => {
        if (!old) return old
        return {
          ...old,
          transactions: old.transactions.map(t =>
            t.merchantNormalized === merchant ? { ...t, appCategory } : t
          ),
        }
      })
    }
    setApplyAllPrompt(null)
  }, [applyAllPrompt, allTxs, assignMutation, qc])

  // ── Filtered transactions ────────────────────────────────────────────────────

  const visibleTxs = allTxs.filter(tx => {
    if (tx.isTransfer) return false
    if (filterMode === 'no-category' && tx.appCategory) return false
    if (filterMode === 'has-category' && !tx.appCategory) return false
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      const name = (tx.merchantNormalized || tx.description).toLowerCase()
      if (!name.includes(q)) return false
    }
    return true
  })

  const noCategoryCount  = allTxs.filter(t => !t.isTransfer && !t.appCategory).length
  const hasCategoryCount = allTxs.filter(t => !t.isTransfer && !!t.appCategory).length

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!user) return null

  if (txLoading) {
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
          <button onClick={() => qc.invalidateQueries({ queryKey: ['transactions', 'categorize'] })} className="btn-primary">
            Retry
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <main className="max-w-3xl mx-auto px-4 py-6 pb-28">
        {/* Header */}
        <div className="mb-5">
          <h1 className="text-2xl font-bold text-slate-900">Categorize</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Assign your own labels to transactions. Bank categories are shown in blue for reference.
          </p>
        </div>

        {/* Filter controls */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {/* Toggle buttons */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold">
            <button
              onClick={() => setFilterMode('all')}
              className={clsx(
                'px-3 py-1.5 transition',
                filterMode === 'all' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              All ({allTxs.filter(t => !t.isTransfer).length})
            </button>
            <button
              onClick={() => setFilterMode('no-category')}
              className={clsx(
                'px-3 py-1.5 transition border-l border-slate-200',
                filterMode === 'no-category' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              No category ({noCategoryCount})
            </button>
            <button
              onClick={() => setFilterMode('has-category')}
              className={clsx(
                'px-3 py-1.5 transition border-l border-slate-200',
                filterMode === 'has-category' ? 'bg-green-600 text-white' : 'text-slate-600 hover:bg-slate-50'
              )}
            >
              Has category ({hasCategoryCount})
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 min-w-[160px]">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search merchant…"
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              className="w-full rounded-lg border border-slate-200 pl-8 pr-3 py-1.5 text-xs outline-none focus:border-slate-400"
            />
          </div>
        </div>

        {/* Transaction list */}
        {visibleTxs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <CheckCircle2 size={32} className="text-green-600" />
            </div>
            <h2 className="text-lg font-bold text-slate-800">
              {filterMode === 'no-category' ? 'All transactions categorized!' : 'No transactions found'}
            </h2>
            <p className="mt-1 max-w-xs text-sm text-slate-500">
              {filterMode === 'no-category'
                ? 'Every transaction has an app category.'
                : 'Try adjusting your search or filter.'}
            </p>
            {filterMode !== 'all' && (
              <button
                onClick={() => { setFilterMode('all'); setSearchText('') }}
                className="mt-4 btn-primary"
              >
                Show all
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {visibleTxs.map(tx => (
              <TxCard
                key={tx.id}
                tx={tx}
                existingCategories={existingAppCategories}
                onAssign={handleAssign}
                onClear={handleClear}
              />
            ))}
          </div>
        )}

        {/* Summary footer */}
        {visibleTxs.length > 0 && (
          <p className="mt-4 text-center text-xs text-slate-400">
            Showing {visibleTxs.length} transaction{visibleTxs.length !== 1 ? 's' : ''}
          </p>
        )}
      </main>

      {/* Apply-to-all toast */}
      {applyAllPrompt && (
        <ApplyAllToast
          prompt={applyAllPrompt}
          onApplyAll={handleApplyAll}
          onDismiss={() => setApplyAllPrompt(null)}
        />
      )}
    </AppShell>
  )
}
