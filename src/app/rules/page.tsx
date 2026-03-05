'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { Loader2, Trash2, AlertCircle, BookOpen, ToggleLeft, ToggleRight } from 'lucide-react'
import clsx from 'clsx'
import { AppShell } from '@/components/AppShell'
import { CategoryIcon } from '@/components/CategoryIcon'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Rule {
  id:          string
  matchType:   string
  matchValue:  string
  amountExact: number | null
  mode:        'always' | 'ask'
  isEnabled:   boolean
  createdAt:   string
  category: {
    id:    string
    name:  string
    icon:  string
    color: string
  }
}

// ─── Mode badge ───────────────────────────────────────────────────────────────

function ModeBadge({ mode }: { mode: 'always' | 'ask' }) {
  if (mode === 'always') {
    return (
      <span className="inline-flex items-center rounded-full bg-green-50 border border-green-200 px-2 py-0.5 text-[11px] font-semibold text-green-700">
        Auto-assign
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      Ask me
    </span>
  )
}

// ─── Rule Row ─────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  onToggleEnabled,
  onToggleMode,
  onDelete,
  isPending,
}: {
  rule:            Rule
  onToggleEnabled: (id: string, isEnabled: boolean) => void
  onToggleMode:    (id: string, mode: 'always' | 'ask') => void
  onDelete:        (id: string) => void
  isPending:       boolean
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 transition-colors"
      style={!rule.isEnabled ? { opacity: 0.5, background: 'var(--surface2)' } : undefined}
    >
      {/* Toggle enabled */}
      <button
        onClick={() => onToggleEnabled(rule.id, !rule.isEnabled)}
        disabled={isPending}
        className="flex-shrink-0 text-slate-400 hover:text-slate-600 transition disabled:opacity-50"
        title={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
      >
        {rule.isEnabled
          ? <ToggleRight size={22} className="text-accent-500" />
          : <ToggleLeft  size={22} />
        }
      </button>

      {/* Vendor key → Category */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold px-1.5 py-0.5 rounded" style={{ color: 'var(--text)', background: 'var(--surface2)' }}>
            {rule.matchValue}
          </span>
          {rule.amountExact != null && (
            <span className="text-xs font-semibold tabular-nums px-1.5 py-0.5 rounded" style={{ color: 'var(--muted)', background: 'var(--surface2)' }}>
              ${(rule.amountExact / 100).toFixed(2)}
            </span>
          )}
          <span className="text-xs" style={{ color: 'var(--muted)' }}>→</span>
          <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text)' }}>
            <CategoryIcon name={rule.category.icon} color={rule.category.color} size={14} />
            {rule.category.name}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
            {rule.matchType === 'vendor_exact_amount' ? 'Exact vendor + price' : rule.matchType === 'vendor_exact' ? 'Exact vendor' : 'Contains'}
          </span>
        </div>
      </div>

      {/* Mode toggle button */}
      <button
        onClick={() => onToggleMode(rule.id, rule.mode === 'always' ? 'ask' : 'always')}
        disabled={isPending || !rule.isEnabled}
        className="flex-shrink-0 disabled:cursor-not-allowed"
        title="Click to toggle between Auto-assign and Ask me"
      >
        <ModeBadge mode={rule.mode} />
      </button>

      {/* Delete */}
      {confirmDelete ? (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <span className="text-xs font-medium" style={{ color: 'var(--danger)' }}>Delete?</span>
          <button
            onClick={() => { onDelete(rule.id); setConfirmDelete(false) }}
            disabled={isPending}
            className="rounded bg-red-500 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-600 disabled:opacity-50"
          >
            Yes
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="rounded border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            No
          </button>
        </div>
      ) : (
        <button
          onClick={() => setConfirmDelete(true)}
          disabled={isPending}
          className="flex-shrink-0 text-slate-300 hover:text-red-500 transition disabled:opacity-50"
          title="Delete rule"
        >
          <Trash2 size={15} />
        </button>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RulesPage() {
  const router = useRouter()
  const user   = useAuthStore(s => s.user)
  const { apiFetch } = useApi()
  const qc     = useQueryClient()

  const { data, isLoading, isError } = useQuery<{ rules: Rule[] }>({
    queryKey: ['rules'],
    queryFn:  () => apiFetch('/api/rules'),
    enabled:  !!user,
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Rule> }) =>
      apiFetch(`/api/rules/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/api/rules/${id}`, { method: 'DELETE' }),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: ['rules'] })
      const prev = qc.getQueryData(['rules'])
      qc.setQueryData(['rules'], (old: { rules: Rule[] } | undefined) =>
        old ? { ...old, rules: old.rules.filter(r => r.id !== id) } : old
      )
      return { prev }
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(['rules'], ctx.prev)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rules'] }),
  })

  const rules: Rule[] = data?.rules ?? []
  const isPending = updateMutation.isPending || deleteMutation.isPending

  // ── Render ──────────────────────────────────────────────────────────────────

  if (!user) { router.replace('/login'); return null }

  if (isLoading) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] items-center justify-center gap-3 text-slate-500">
          <Loader2 size={24} className="animate-spin text-accent-500" />
          Loading rules…
        </div>
      </AppShell>
    )
  }

  if (isError) {
    return (
      <AppShell>
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-red-600">
          <AlertCircle size={32} />
          <p className="font-semibold">Failed to load rules</p>
          <button onClick={() => qc.invalidateQueries({ queryKey: ['rules'] })} className="btn-primary">
            Retry
          </button>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <main className="max-w-2xl mx-auto px-4 py-6 pb-24">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Rules</h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
            Auto-categorization rules are applied to every new import. Drag transactions to
            a category on the Categorize page to create rules automatically.
          </p>
        </div>

        {rules.length === 0 ? (
          /* Empty state */
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full" style={{ background: 'var(--surface2)' }}>
              <BookOpen size={28} style={{ color: 'var(--muted)' }} />
            </div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>No rules yet</h2>
            <p className="mt-2 max-w-sm text-sm" style={{ color: 'var(--muted)' }}>
              Rules are created automatically when you categorize the same vendor twice.
              Head to the Categorize page to get started.
            </p>
            <button onClick={() => router.push('/categorize')} className="btn-primary mt-6">
              Go to Categorize
            </button>
          </div>
        ) : (
          <div className="overflow-hidden" style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)', background: 'var(--card)', boxShadow: 'var(--shadow-soft)' }}>
            {/* Column headers */}
            <div className="flex items-center gap-3 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider" style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)' }}>
              <span className="w-6 flex-shrink-0" />
              <span className="flex-1">Vendor → Category</span>
              <span className="flex-shrink-0 pr-1">Action</span>
              <span className="w-6 flex-shrink-0" />
            </div>

            {/* Rules list */}
            <div style={{ ['--tw-divide-border-color' as string]: 'var(--border)' }} className="[&>*+*]:border-t [&>*+*]:[border-color:var(--border)]">
              {rules.map(rule => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  isPending={isPending}
                  onToggleEnabled={(id, isEnabled) => updateMutation.mutate({ id, patch: { isEnabled } })}
                  onToggleMode={(id, mode) => updateMutation.mutate({ id, patch: { mode } })}
                  onDelete={(id) => deleteMutation.mutate(id)}
                />
              ))}
            </div>

            {/* Footer */}
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)' }}>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {rules.filter(r => r.isEnabled).length} of {rules.length} enabled
              </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                Rules apply on the next import
              </span>
            </div>
          </div>
        )}

      </main>
    </AppShell>
  )
}
