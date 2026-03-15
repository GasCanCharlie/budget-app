'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { PlusCircle, Trash2, Loader2, RotateCcw, Pencil, Check, X, Target } from 'lucide-react'
import clsx from 'clsx'
import { CategoryIcon } from '@/components/CategoryIcon'

interface Category {
  id: string
  name: string
  icon: string
  color: string
  isSystem: boolean
  isIncome: boolean
  isTransfer: boolean
  userId: string | null
}

interface BudgetTarget {
  id: string
  categoryId: string
  amountCents: number
  period: string
}

const PRESET_COLORS = [
  '#f97316', '#ef4444', '#ec4899', '#a855f7', '#6366f1',
  '#3b82f6', '#0ea5e9', '#14b8a6', '#10b981', '#22c55e',
  '#84cc16', '#f59e0b', '#78716c', '#64748b', '#94a3b8',
]

const PRESET_ICONS = [
  '📦','💳','🏷️','⭐','🔖','💡','🎯','🔑','🧾','📊',
  '🍺','🍷','🥃','🍸','🚬','🍟','🍔','🌮','🍕','🍣',
  '💄','🎸','🏋️','🐕','🌿','🧴','💊','🛒','🏠','🚗',
]

export default function CategoriesPage() {
  const router = useRouter()
  const user   = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc     = useQueryClient()

  useEffect(() => { if (!user) router.replace('/login') }, [user, router])

  const [showAdd,    setShowAdd]    = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newIcon,    setNewIcon]    = useState('📦')
  const [newColor,   setNewColor]   = useState('#6366f1')
  const [newIncome,  setNewIncome]  = useState(false)
  const [customIcon, setCustomIcon] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [editingId,   setEditingId]   = useState<string | null>(null)
  const [editName,    setEditName]    = useState('')
  const [editIcon,    setEditIcon]    = useState('📦')
  const [editColor,   setEditColor]   = useState('#6366f1')
  const [editCustomIcon, setEditCustomIcon] = useState('')

  // Budget state
  const [budgetEditId,    setBudgetEditId]    = useState<string | null>(null)
  const [budgetInputVal,  setBudgetInputVal]  = useState('')

  function startEdit(cat: Category) {
    setEditingId(cat.id)
    setEditName(cat.name)
    setEditIcon(cat.icon)
    setEditColor(cat.color)
    setEditCustomIcon('')
    setDeleteConfirm(null)
  }

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories'),
    enabled: !!user,
  })

  const { data: allCatsData } = useQuery({
    queryKey: ['categories-all'],
    queryFn: () => apiFetch('/api/categories/all'),
    enabled: !!user,
  })

  const { data: hiddenData } = useQuery({
    queryKey: ['hidden-categories'],
    queryFn: () => apiFetch('/api/preferences/hidden-categories'),
    enabled: !!user,
  })

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets'],
    queryFn: () => apiFetch('/api/budgets'),
    enabled: !!user,
  })
  const budgets: BudgetTarget[] = budgetsData?.budgets ?? []
  const budgetMap = new Map(budgets.map((b: BudgetTarget) => [b.categoryId, b]))

  const budgetMutation = useMutation({
    mutationFn: ({ categoryId, amountCents }: { categoryId: string; amountCents: number }) =>
      apiFetch('/api/budgets', {
        method: 'POST',
        body: JSON.stringify({ categoryId, amountCents }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] })
      setBudgetEditId(null)
      setBudgetInputVal('')
    },
  })

  const budgetDeleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/budgets/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['budgets'] }),
  })

  function openBudgetEdit(cat: Category) {
    const existing = budgetMap.get(cat.id)
    setBudgetEditId(cat.id)
    setBudgetInputVal(existing ? String(existing.amountCents / 100) : '')
    setEditingId(null)
  }

  function saveBudget(categoryId: string) {
    const dollars = parseFloat(budgetInputVal)
    if (isNaN(dollars) || dollars < 0) return
    budgetMutation.mutate({ categoryId, amountCents: Math.round(dollars * 100) })
  }

  const hiddenIds: string[] = hiddenData?.hidden ?? []
  const allSystemCats: Category[] = allCatsData?.categories ?? []
  const hiddenCats = allSystemCats.filter(c => hiddenIds.includes(c.id))

  const categories: Category[] = data?.categories ?? []
  const systemCats = categories.filter(c => c.isSystem)
  const userCats   = categories.filter(c => !c.isSystem)

  const createMutation = useMutation({
    mutationFn: () => apiFetch('/api/categories', {
      method: 'POST',
      body: JSON.stringify({ name: newName, icon: customIcon || newIcon, color: newColor, isIncome: newIncome }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setNewName(''); setCustomIcon(''); setNewIcon('📦'); setNewColor('#6366f1'); setNewIncome(false)
      setShowAdd(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['hidden-categories'] })
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      setDeleteConfirm(null)
    },
  })

  const updateMutation = useMutation({
    mutationFn: ({ id }: { id: string }) => apiFetch(`/api/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: editName.trim(), icon: editCustomIcon || editIcon, color: editColor }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setEditingId(null)
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (idToRestore: string) => {
      const next = hiddenIds.filter(id => id !== idToRestore)
      return apiFetch('/api/preferences/hidden-categories', {
        method: 'PUT',
        body: JSON.stringify({ hidden: next }),
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['hidden-categories'] })
    },
  })

  if (!user) return null

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-4 py-8 pb-24 space-y-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Categories</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
            Manage your spending categories. System categories cannot be deleted.
          </p>
        </div>

        {/* Add new category */}
        <div className="card space-y-4" style={{ overflow: 'visible', padding: '18px' }}>
          <div className="flex items-center justify-between">
            <h2 className="font-bold" style={{ color: 'var(--text)' }}>Custom Categories</h2>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1"
            >
              <PlusCircle size={13} /> Add category
            </button>
          </div>

          {showAdd && (
            <div className="rounded-lg p-4 space-y-4" style={{ background: 'var(--surface2)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>New Category</h3>

              {/* Name */}
              <input
                className="input"
                placeholder="Category name (e.g. Fast Food)"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                maxLength={50}
              />

              {/* Icon picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Icon</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_ICONS.map(ico => (
                    <button
                      key={ico}
                      onClick={() => { setNewIcon(ico); setCustomIcon('') }}
                      className={clsx(
                        'w-9 h-9 rounded-lg text-lg flex items-center justify-center border-2 transition',
                        (customIcon ? false : newIcon === ico) ? 'border-accent-500 bg-accent-50' : 'border-slate-200 hover:border-slate-300'
                      )}
                    >
                      {ico}
                    </button>
                  ))}
                </div>
                <input
                  className="input text-sm"
                  placeholder="Or type any emoji..."
                  value={customIcon}
                  onChange={e => setCustomIcon(e.target.value.slice(0, 4))}
                  maxLength={4}
                />
              </div>

              {/* Color picker */}
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Color</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_COLORS.map(c => (
                    <button
                      key={c}
                      onClick={() => setNewColor(c)}
                      className={clsx(
                        'w-7 h-7 rounded-full border-2 transition',
                        newColor === c ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-105'
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {/* Income toggle */}
              <label className="flex items-center gap-3 cursor-pointer">
                <div
                  onClick={() => setNewIncome(!newIncome)}
                  className={clsx(
                    'relative w-10 h-5 rounded-full transition-colors',
                    newIncome ? 'bg-accent-500' : 'bg-slate-200'
                  )}
                >
                  <div className={clsx(
                    'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform',
                    newIncome ? 'translate-x-5' : 'translate-x-0.5'
                  )} />
                </div>
                <span className="text-sm" style={{ color: 'var(--text)' }}>This is an income category</span>
              </label>

              {/* Preview */}
              {newName && (
                <div className="flex items-center gap-2 p-2 rounded-lg" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                  <span className="text-lg">{customIcon || newIcon}</span>
                  <span className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{newName}</span>
                  <span className="ml-auto w-3 h-3 rounded-full" style={{ backgroundColor: newColor }} />
                </div>
              )}

              <button
                onClick={() => createMutation.mutate()}
                disabled={!newName.trim() || createMutation.isPending}
                className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {createMutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : 'Create Category'}
              </button>
              {createMutation.isError && (
                <p className="text-sm text-red-600">{(createMutation.error as Error).message}</p>
              )}
            </div>
          )}

          {/* User custom categories */}
          {userCats.length === 0 ? (
            <p className="text-sm text-slate-400">No custom categories yet.</p>
          ) : (
            <div className="space-y-2">
              {userCats.map(cat => {
                const budget = budgetMap.get(cat.id)
                const isEditingBudget = budgetEditId === cat.id
                return (
                <div key={cat.id} className="rounded-lg overflow-hidden" style={{ border: isEditingBudget ? '1px solid var(--accent)' : '1px solid var(--border2)', background: 'var(--tile)' }}>

                  {/* Row */}
                  <div className="flex items-center gap-3 p-3">
                    <CategoryIcon name={editingId === cat.id ? (editCustomIcon || editIcon) : cat.icon} color={editingId === cat.id ? editColor : cat.color} size={20} />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm" style={{ color: 'var(--text)' }}>{cat.name}</p>
                      <p className="text-xs" style={{ color: 'var(--muted)' }}>
                        {cat.isIncome ? 'Income' : 'Expense'} · Custom
                        {budget && !cat.isIncome && ` · $${(budget.amountCents / 100).toFixed(0)}/mo`}
                      </p>
                    </div>
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />

                    {deleteConfirm === cat.id ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>Delete?</span>
                        <button onClick={() => deleteMutation.mutate(cat.id)} disabled={deleteMutation.isPending}
                          className="text-xs font-bold px-2 py-1 rounded-lg transition" style={{ color: '#ff7f90', background: 'rgba(255,127,144,0.1)', border: '1px solid rgba(255,127,144,0.25)' }}>
                          {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Delete'}
                        </button>
                        <button onClick={() => setDeleteConfirm(null)} className="text-xs px-2 py-1 rounded-lg transition" style={{ color: 'var(--muted)' }}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        {!cat.isIncome && (
                          <button onClick={() => isEditingBudget ? setBudgetEditId(null) : openBudgetEdit(cat)}
                            className="p-1.5 rounded-lg transition"
                            style={{ color: isEditingBudget ? 'var(--accent)' : 'var(--text-secondary)' }}
                            title={budget ? 'Edit budget' : 'Set budget'}>
                            <Target size={14} />
                          </button>
                        )}
                        <button onClick={() => editingId === cat.id ? setEditingId(null) : startEdit(cat)}
                          className="p-1.5 rounded-lg transition" style={{ color: editingId === cat.id ? 'var(--accent)' : 'var(--text-secondary)' }}
                          title="Edit category">
                          <Pencil size={14} />
                        </button>
                        <button onClick={() => { setDeleteConfirm(cat.id); setEditingId(null) }}
                          className="p-1.5 rounded-lg transition" style={{ color: 'var(--text-secondary)' }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#ff7f90')}
                          onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-secondary)')}
                          title="Delete category">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Inline budget editor for custom categories */}
                  {isEditingBudget && (
                    <div className="px-3 pb-3 flex items-center gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
                      <span className="text-xs" style={{ color: 'var(--muted)' }}>Monthly budget: $</span>
                      <input
                        autoFocus
                        type="number"
                        min="0"
                        step="10"
                        placeholder="0"
                        value={budgetInputVal}
                        onChange={e => setBudgetInputVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveBudget(cat.id); if (e.key === 'Escape') setBudgetEditId(null) }}
                        className="input text-sm py-1 px-2 flex-1 min-w-0"
                        style={{ height: 32 }}
                      />
                      <button onClick={() => saveBudget(cat.id)} disabled={budgetMutation.isPending}
                        className="btn-primary py-1 px-3 text-xs flex items-center gap-1">
                        {budgetMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        Save
                      </button>
                      {budget && (
                        <button onClick={() => { budgetDeleteMutation.mutate(budget.id); setBudgetEditId(null) }}
                          className="btn-secondary py-1 px-2 text-xs flex items-center gap-1 text-red-400">
                          <X size={12} /> Remove
                        </button>
                      )}
                    </div>
                  )}

                  {/* Inline edit panel */}
                  {editingId === cat.id && (
                    <div className="px-4 pb-4 space-y-4 border-t" style={{ borderColor: 'var(--border)', background: 'var(--surface2)' }}>
                      <div className="pt-3">
                        <input
                          autoFocus
                          className="input"
                          value={editName}
                          onChange={e => setEditName(e.target.value)}
                          maxLength={50}
                          placeholder="Category name"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Icon</label>
                        <div className="flex flex-wrap gap-1.5">
                          {PRESET_ICONS.map(ico => (
                            <button key={ico} onClick={() => { setEditIcon(ico); setEditCustomIcon('') }}
                              className={clsx('w-9 h-9 rounded-lg text-lg flex items-center justify-center border-2 transition',
                                (!editCustomIcon && editIcon === ico) ? 'border-accent-500 bg-accent-50' : 'border-slate-200 hover:border-slate-300')}>
                              {ico}
                            </button>
                          ))}
                        </div>
                        <input className="input text-sm" placeholder="Or type any emoji…"
                          value={editCustomIcon}
                          onChange={e => setEditCustomIcon(e.target.value.slice(0, 4))}
                          maxLength={4} />
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Color</label>
                        <div className="flex flex-wrap gap-1.5">
                          {PRESET_COLORS.map(c => (
                            <button key={c} onClick={() => setEditColor(c)}
                              className={clsx('w-7 h-7 rounded-full border-2 transition', editColor === c ? 'border-slate-800 scale-110' : 'border-transparent hover:scale-105')}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>

                      <div className="flex gap-2 pt-1">
                        <button onClick={() => updateMutation.mutate({ id: cat.id })}
                          disabled={!editName.trim() || updateMutation.isPending}
                          className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
                          {updateMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                          Save
                        </button>
                        <button onClick={() => setEditingId(null)} className="btn-secondary flex items-center gap-1.5">
                          <X size={13} /> Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )})}
            </div>
          )}
        </div>

        {/* System categories */}
        <div className="card space-y-3" style={{ overflow: 'visible', padding: '18px' }}>
          <div className="flex items-center justify-between">
            <h2 className="font-bold" style={{ color: 'var(--text)' }}>System Categories</h2>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{systemCats.length} active</span>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {systemCats.map(cat => {
                const budget = budgetMap.get(cat.id)
                const isEditingBudget = budgetEditId === cat.id
                return (
                  <div
                    key={cat.id}
                    className="rounded-lg group overflow-hidden"
                    style={{ background: 'var(--tile)', border: isEditingBudget ? '1px solid var(--accent)' : '1px solid var(--border2)' }}
                  >
                    <div className="flex items-center gap-2 p-2.5">
                      <CategoryIcon name={cat.icon} color={cat.color} size={16} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>{cat.name}</p>
                        <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                          {cat.isIncome ? 'income' : cat.isTransfer ? 'transfer' : (
                            budget ? `$${(budget.amountCents / 100).toFixed(0)}/mo` : 'expense'
                          )}
                        </p>
                      </div>
                      {deleteConfirm === cat.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteMutation.mutate(cat.id)}
                            disabled={deleteMutation.isPending}
                            className="text-[10px] font-bold text-red-400 px-1.5 py-0.5 rounded"
                            style={{ background: 'rgba(255,127,144,0.12)', border: '1px solid rgba(255,127,144,0.25)' }}
                          >
                            {deleteMutation.isPending ? '…' : 'Hide'}
                          </button>
                          <button onClick={() => setDeleteConfirm(null)} className="text-[10px] text-slate-400 px-1 py-0.5 rounded hover:text-slate-300">✕</button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition">
                          {!cat.isIncome && !cat.isTransfer && (
                            <button
                              onClick={() => isEditingBudget ? setBudgetEditId(null) : openBudgetEdit(cat)}
                              className="p-1 rounded transition"
                              style={{ color: isEditingBudget ? 'var(--accent)' : 'var(--text-secondary)' }}
                              title={budget ? 'Edit budget' : 'Set budget'}
                            >
                              <Target size={12} />
                            </button>
                          )}
                          <button
                            onClick={() => setDeleteConfirm(cat.id)}
                            className="p-1 rounded transition text-slate-500 hover:text-red-400"
                            title="Hide category"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Inline budget editor */}
                    {isEditingBudget && (
                      <div className="px-2.5 pb-2.5 flex items-center gap-1.5 border-t" style={{ borderColor: 'var(--border)' }}>
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>$</span>
                        <input
                          autoFocus
                          type="number"
                          min="0"
                          step="10"
                          placeholder="0"
                          value={budgetInputVal}
                          onChange={e => setBudgetInputVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveBudget(cat.id); if (e.key === 'Escape') setBudgetEditId(null) }}
                          className="input text-xs py-1 px-2 flex-1 min-w-0"
                          style={{ height: 28 }}
                        />
                        <span className="text-[10px]" style={{ color: 'var(--muted)' }}>/mo</span>
                        <button
                          onClick={() => saveBudget(cat.id)}
                          disabled={budgetMutation.isPending}
                          className="p-1 rounded transition"
                          style={{ color: 'var(--accent)' }}
                        >
                          {budgetMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                        </button>
                        {budget && (
                          <button
                            onClick={() => { budgetDeleteMutation.mutate(budget.id); setBudgetEditId(null) }}
                            className="p-1 rounded transition text-slate-500 hover:text-red-400"
                            title="Remove budget"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Hidden categories — restore */}
          {hiddenCats.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>Hidden ({hiddenCats.length})</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {hiddenCats.map(cat => (
                  <div
                    key={cat.id}
                    className="flex items-center gap-2 p-2.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', opacity: 0.65 }}
                  >
                    <CategoryIcon name={cat.icon} color={cat.color} size={16} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>{cat.name}</p>
                    </div>
                    <button
                      onClick={() => restoreMutation.mutate(cat.id)}
                      disabled={restoreMutation.isPending}
                      className="p-1 rounded transition text-slate-500 hover:text-green-400"
                      title="Restore category"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="text-xs text-center text-slate-400">
          Deleting a custom category reassigns its transactions to &ldquo;Other&rdquo;.
          System categories are hidden per-account and can be restored.
        </p>
      </main>
    </AppShell>
  )
}
