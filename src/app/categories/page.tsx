'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { AppShell } from '@/components/AppShell'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'
import { PlusCircle, Trash2, Loader2, Lock } from 'lucide-react'
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

  const { data, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: () => apiFetch('/api/categories'),
    enabled: !!user,
  })

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
      qc.invalidateQueries({ queryKey: ['transactions'] })
      qc.invalidateQueries({ queryKey: ['summary'] })
      setDeleteConfirm(null)
    },
  })

  if (!user) return null

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-4 py-8 pb-24 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Categories</h1>
          <p className="text-slate-500 text-sm mt-1">
            Manage your spending categories. System categories cannot be deleted.
          </p>
        </div>

        {/* Add new category */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700">Custom Categories</h2>
            <button
              onClick={() => setShowAdd(!showAdd)}
              className="text-sm text-accent-500 font-semibold flex items-center gap-1 hover:underline"
            >
              <PlusCircle size={14} /> Add category
            </button>
          </div>

          {showAdd && (
            <div className="bg-slate-50 rounded-lg p-4 space-y-4 border border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">New Category</h3>

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
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Icon</label>
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
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Color</label>
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
                <span className="text-sm text-slate-700">This is an income category</span>
              </label>

              {/* Preview */}
              {newName && (
                <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-slate-100">
                  <span className="text-lg">{customIcon || newIcon}</span>
                  <span className="text-sm font-semibold text-slate-800">{newName}</span>
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
              {userCats.map(cat => (
                <div key={cat.id} className="flex items-center gap-3 p-3 rounded-lg border border-slate-200 bg-white">
                  <CategoryIcon name={cat.icon} color={cat.color} size={20} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-slate-800">{cat.name}</p>
                    <p className="text-xs text-slate-400">
                      {cat.isIncome ? 'Income' : 'Expense'} · Custom
                    </p>
                  </div>
                  <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />

                  {deleteConfirm === cat.id ? (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Delete?</span>
                      <button
                        onClick={() => deleteMutation.mutate(cat.id)}
                        disabled={deleteMutation.isPending}
                        className="text-xs font-bold text-red-600 hover:text-red-700 px-2 py-1 rounded-lg bg-red-50 hover:bg-red-100"
                      >
                        {deleteMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : 'Yes, delete'}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(null)}
                        className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirm(cat.id)}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition"
                      title="Delete category"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System categories (read-only) */}
        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-slate-700">System Categories</h2>
            <span className="badge bg-slate-100 text-slate-500 flex items-center gap-1">
              <Lock size={10} /> {systemCats.length} built-in
            </span>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 text-slate-400 text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {systemCats.map(cat => (
                <div
                  key={cat.id}
                  className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50 border border-slate-100"
                >
                  <CategoryIcon name={cat.icon} color={cat.color} size={16} />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-700 truncate">{cat.name}</p>
                    <p className="text-[10px] text-slate-400">
                      {cat.isIncome ? 'income' : cat.isTransfer ? 'transfer' : 'expense'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <p className="text-xs text-center text-slate-400">
          Deleting a custom category reassigns its transactions to &ldquo;Other&rdquo;.
        </p>
      </main>
    </AppShell>
  )
}
