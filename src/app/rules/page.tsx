'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import {
  Loader2, Trash2, AlertCircle, Zap, ToggleLeft, ToggleRight,
  ArrowRight, CheckCircle2, HelpCircle, Tag,
} from 'lucide-react'
import { AppShell } from '@/components/AppShell'
import { CategoryIcon } from '@/components/CategoryIcon'
import { useAuthStore } from '@/store/auth'
import { useApi } from '@/hooks/useApi'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Rule Card ────────────────────────────────────────────────────────────────

function RuleCard({
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

  const matchLabel =
    rule.matchType === 'vendor_exact_amount' ? 'Exact vendor + amount' :
    rule.matchType === 'vendor_exact'        ? 'Vendor matches' :
    'Vendor contains'

  return (
    <div
      style={{
        background: rule.isEnabled ? 'var(--card2)' : 'var(--surface2)',
        border: `1px solid ${rule.isEnabled ? 'var(--border-soft)' : 'var(--border)'}`,
        borderRadius: 16,
        padding: '16px 18px',
        opacity: rule.isEnabled ? 1 : 0.55,
        transition: 'opacity 0.2s, border-color 0.2s',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      {/* Top row: condition → result */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* IF condition pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'rgba(124,145,255,0.10)', border: '1px solid rgba(124,145,255,0.22)',
          borderRadius: 8, padding: '5px 10px',
        }}>
          <Tag size={11} style={{ color: '#7c91ff', flexShrink: 0 }} />
          <span style={{ fontSize: 12, color: '#a8b4d8', fontWeight: 600 }}>IF</span>
          <span style={{ fontSize: 13, color: '#e2e8f5', fontWeight: 700 }}>
            &ldquo;{rule.matchValue}&rdquo;
          </span>
          {rule.amountExact != null && (
            <span style={{ fontSize: 12, color: '#6b7a99', fontWeight: 600 }}>
              = ${(rule.amountExact / 100).toFixed(2)}
            </span>
          )}
        </div>

        {/* Arrow */}
        <ArrowRight size={14} style={{ color: '#4b5568', flexShrink: 0 }} />

        {/* THEN category pill */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: `${rule.category.color}18`,
          border: `1px solid ${rule.category.color}35`,
          borderRadius: 8, padding: '5px 10px',
        }}>
          <CategoryIcon name={rule.category.icon} color={rule.category.color} size={13} />
          <span style={{ fontSize: 13, color: '#e2e8f5', fontWeight: 700 }}>
            {rule.category.name}
          </span>
        </div>
      </div>

      {/* Bottom row: meta + actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        {/* Match type label */}
        <span style={{ fontSize: 11, color: '#4b5568', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {matchLabel}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Mode toggle */}
          <button
            onClick={() => onToggleMode(rule.id, rule.mode === 'always' ? 'ask' : 'always')}
            disabled={isPending || !rule.isEnabled}
            title="Toggle between Auto and Ask"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20,
              fontSize: 11, fontWeight: 700,
              border: 'none', cursor: 'pointer',
              background: rule.mode === 'always' ? 'rgba(57,208,127,0.15)' : 'rgba(245,158,11,0.15)',
              color: rule.mode === 'always' ? '#39d07f' : '#f59e0b',
              transition: 'background 0.15s',
            }}
          >
            {rule.mode === 'always'
              ? <><CheckCircle2 size={11} /> Auto-assign</>
              : <><HelpCircle size={11} /> Ask me</>
            }
          </button>

          {/* Enabled toggle */}
          <button
            onClick={() => onToggleEnabled(rule.id, !rule.isEnabled)}
            disabled={isPending}
            title={rule.isEnabled ? 'Disable rule' : 'Enable rule'}
            style={{ display: 'flex', alignItems: 'center', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            {rule.isEnabled
              ? <ToggleRight size={20} style={{ color: '#7c91ff' }} />
              : <ToggleLeft  size={20} style={{ color: '#3a4460' }} />
            }
          </button>

          {/* Delete */}
          {confirmDelete ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 700 }}>Delete?</span>
              <button
                onClick={() => { onDelete(rule.id); setConfirmDelete(false) }}
                disabled={isPending}
                style={{ background: '#ef4444', color: 'white', border: 'none', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
              >
                Yes
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                style={{ background: 'rgba(255,255,255,0.06)', color: '#8b97c3', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              disabled={isPending}
              title="Delete rule"
              style={{ background: 'none', border: 'none', padding: 2, cursor: 'pointer', color: '#3a4460', lineHeight: 1 }}
              onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#ef4444')}
              onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#3a4460')}
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>
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
  const enabledCount = rules.filter(r => r.isEnabled).length

  useEffect(() => { if (!user) router.replace('/login') }, [user, router])
  if (!user) return null

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
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div style={{ background: 'rgba(124,145,255,0.15)', borderRadius: 10, padding: '6px 8px', display: 'inline-flex' }}>
                <Zap size={18} style={{ color: '#7c91ff' }} />
              </div>
              <h1 className="text-2xl font-bold" style={{ color: 'var(--text)' }}>Smart Automation</h1>
            </div>
            <p className="text-sm" style={{ color: 'var(--muted)' }}>
              Rules auto-categorize transactions on every new import.
              Drag any transaction to a category to create a rule instantly.
            </p>
          </div>
          {rules.length > 0 && (
            <div style={{
              background: 'rgba(57,208,127,0.10)', border: '1px solid rgba(57,208,127,0.22)',
              borderRadius: 10, padding: '6px 12px', flexShrink: 0,
              fontSize: 12, fontWeight: 700, color: '#39d07f', textAlign: 'center',
            }}>
              <div style={{ fontSize: 20, lineHeight: 1 }}>{enabledCount}</div>
              <div style={{ fontSize: 10, opacity: 0.8, marginTop: 1 }}>active</div>
            </div>
          )}
        </div>

        {rules.length === 0 ? (
          /* Empty state */
          <div style={{
            background: 'var(--card2)', border: '1px solid var(--border-soft)',
            borderRadius: 20, padding: '48px 32px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 12,
          }}>
            <div style={{ background: 'rgba(124,145,255,0.12)', borderRadius: '50%', width: 64, height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Zap size={28} style={{ color: '#7c91ff' }} />
            </div>
            <div>
              <h2 className="text-lg font-bold mb-1" style={{ color: 'var(--text)' }}>No automation rules yet</h2>
              <p className="text-sm max-w-xs" style={{ color: 'var(--muted)' }}>
                Rules are created automatically when you categorize vendors.
                The more you categorize, the smarter your imports become.
              </p>
            </div>
            <button onClick={() => router.push('/categorize')} className="btn-primary mt-2">
              Start Categorizing →
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {rules.map(rule => (
              <RuleCard
                key={rule.id}
                rule={rule}
                isPending={isPending}
                onToggleEnabled={(id, isEnabled) => updateMutation.mutate({ id, patch: { isEnabled } })}
                onToggleMode={(id, mode) => updateMutation.mutate({ id, patch: { mode } })}
                onDelete={(id) => deleteMutation.mutate(id)}
              />
            ))}

            {/* Footer note */}
            <p className="text-center text-xs mt-2" style={{ color: 'var(--muted)' }}>
              {enabledCount} of {rules.length} rules active · Applied on every new import
            </p>
          </div>
        )}

      </main>
    </AppShell>
  )
}
