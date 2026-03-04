'use client'

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
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

export function CategoryRanking({ categories, totalSpending, year, month }: Props) {
  const top = categories.slice(0, 10)

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-sm font-semibold text-slate-800">Spending by Category</h2>
        <span className="text-xs text-slate-400">
          {categories.length} {categories.length !== 1 ? 'categories' : 'category'}
        </span>
      </div>

      {top.length === 0 ? (
        <div className="py-10 text-center text-sm text-slate-400">No spending data this month</div>
      ) : (
        <div className="space-y-1">
          {top.map((cat, i) => {
            const pct = Math.min(cat.pctOfSpending, 100)
            const barColor = cat.categoryColor || '#2563eb'

            return (
              <Link
                key={cat.categoryId}
                href={`/transactions?displayCategory=${encodeURIComponent(cat.categoryName)}&year=${year}&month=${month}`}
                className="group flex items-center gap-3 -mx-2 px-2 py-2.5 rounded-xl hover:bg-slate-50 transition-colors"
              >
                {/* Rank number */}
                <span className="text-xs font-bold text-slate-300 w-4 text-right flex-shrink-0 tabular-nums">
                  {i + 1}
                </span>

                {/* Category icon */}
                <div className="flex-shrink-0">
                  <CategoryIcon name={cat.categoryIcon} color={cat.categoryColor} size={16} />
                </div>

                {/* Category name */}
                <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors w-32 flex-shrink-0 truncate">
                  {cat.categoryName}
                </span>

                {/* Progress bar */}
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, backgroundColor: barColor, opacity: 0.85 }}
                  />
                </div>

                {/* % */}
                <span className="text-xs text-slate-400 w-9 text-right tabular-nums flex-shrink-0">
                  {Math.round(cat.pctOfSpending)}%
                </span>

                {/* Amount */}
                <span className="text-sm font-bold text-slate-800 tabular-nums w-20 text-right flex-shrink-0">
                  {fmt(cat.total)}
                </span>
              </Link>
            )
          })}
        </div>
      )}

      {/* Footer total */}
      {top.length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100 flex items-center justify-between">
          <span className="text-xs text-slate-400 uppercase tracking-wide">Total Spending</span>
          <span className="text-base font-bold text-slate-800 tabular-nums">{fmt(totalSpending)}</span>
        </div>
      )}
    </div>
  )
}
