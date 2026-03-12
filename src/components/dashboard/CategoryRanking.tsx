'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CategoryIcon } from '@/components/CategoryIcon'

interface CategoryItem {
  categoryId: string
  categoryName: string
  categoryColor: string
  categoryIcon: string
  total: number
  transactionCount: number
  pctOfSpending: number
}

interface Props {
  categories: CategoryItem[]
  totalSpending: number
  year: number
  month: number
  prevCategories?: CategoryItem[]
}

function MomBadge({ current, prev }: { current: number; prev: number }) {
  if (prev === 0) return null
  const pct = Math.round(((current - prev) / prev) * 100)
  if (Math.abs(pct) < 3) return null
  const up = pct > 0
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 5px',
      background: up ? 'rgba(239,68,68,0.12)' : 'rgba(16,185,129,0.12)',
      color: up ? '#ef4444' : '#10b981',
      whiteSpace: 'nowrap',
    }}>
      {up ? '↑' : '↓'}{Math.abs(pct)}%
    </span>
  )
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export function CategoryRanking({ categories, totalSpending, year, month, prevCategories = [] }: Props) {
  const [sort, setSort] = useState<'amount' | 'pct'>('amount')

  const top = [...categories.slice(0, 10)].sort((a, b) =>
    sort === 'amount' ? b.total - a.total : b.pctOfSpending - a.pctOfSpending
  )

  return (
    <div
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)',
      }}
      className="p-5"
    >
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Spending by Category</h2>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSort('amount')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              sort === 'amount'
                ? 'bg-blue-600 text-white'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Amount
          </button>
          <button
            onClick={() => setSort('pct')}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              sort === 'pct'
                ? 'bg-blue-600 text-white'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            %
          </button>
        </div>
      </div>

      {top.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>No spending data this month</div>
      ) : (
        <div className="space-y-1">
          {top.map((cat, i) => {
            const pct = Math.min(cat.pctOfSpending, 100)
            const barColor = cat.categoryColor || '#2563eb'

            const prevCat = prevCategories.find(p => p.categoryName === cat.categoryName)

            return (
              <Link
                key={cat.categoryId}
                href={`/transactions?displayCategory=${encodeURIComponent(cat.categoryName)}&year=${year}&month=${month}`}
                className="group flex items-center gap-3 -mx-2 px-2 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
              >
                {/* Rank number */}
                <span className="text-xs font-bold w-4 text-right flex-shrink-0 tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                  {i + 1}
                </span>

                {/* Category icon */}
                <div className="flex-shrink-0">
                  <CategoryIcon name={cat.categoryIcon} color={cat.categoryColor} size={16} />
                </div>

                {/* Category name */}
                <span className="text-sm font-medium group-hover:text-blue-600 transition-colors w-28 flex-shrink-0 truncate" style={{ color: 'var(--text)' }}>
                  {cat.categoryName}
                </span>

                {/* Progress bar */}
                <div
                  className="flex-1 h-2.5 rounded-full overflow-hidden"
                  style={{ backgroundColor: 'var(--track)' }}
                >
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: barColor, opacity: 0.85 }}
                  />
                </div>

                {/* % */}
                <span className="text-xs w-9 text-right tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                  {Math.round(cat.pctOfSpending)}%
                </span>

                {/* MoM delta */}
                <div className="w-12 flex justify-end flex-shrink-0">
                  {prevCat && <MomBadge current={cat.total} prev={prevCat.total} />}
                </div>

                {/* Amount */}
                <span className="text-sm font-bold tabular-nums w-20 text-right flex-shrink-0" style={{ color: 'var(--text)' }}>
                  {fmt(cat.total)}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {/* Footer total */}
      {top.length > 0 && (
        <div className="mt-4 pt-4 border-t flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>Total Spending</span>
          <span className="text-base font-bold tabular-nums" style={{ color: 'var(--text)' }}>{fmt(totalSpending)}</span>
        </div>
      )}
    </div>
  )
}
