'use client'

import Link from 'next/link'
import { CategoryIcon } from '@/components/CategoryIcon'

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

interface CategoryItem {
  categoryId: string
  categoryName: string
  categoryColor: string
  categoryIcon: string
  total: number
  transactionCount: number
  pctOfSpending: number
  isIncome: boolean
}

interface Props {
  categories: CategoryItem[]
  totalSpending: number
  month: number
  year: number
}

export function CategoryBreakdown({ categories, totalSpending, month, year }: Props) {
  const monthLabel = MONTH_NAMES[month - 1] ?? ''
  const topCategories = categories.slice(0, 10)

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-base font-semibold text-slate-800">Category Breakdown</h2>
        <span className="text-xs text-slate-400">
          {monthLabel} {year}
        </span>
      </div>

      {topCategories.length === 0 ? (
        <div className="flex items-center justify-center py-4">
          <p className="text-slate-400">No spending categories this month</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {topCategories.map((cat) => (
            <li key={cat.categoryId}>
              <Link
                href={'/transactions?displayCategory=' + encodeURIComponent(cat.categoryName)}
                className="group flex items-start gap-3"
              >
                <div className="w-6 flex-shrink-0 flex items-center">
                  <CategoryIcon name={cat.categoryIcon} color={cat.categoryColor} size={18} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-slate-700 group-hover:text-blue-600 transition-colors truncate">
                      {cat.categoryName}
                    </span>
                    <span className="font-bold text-slate-800 tabular-nums flex-shrink-0">
                      ${Math.round(cat.total).toLocaleString()}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-2 mt-0.5">
                    <span className="text-xs text-slate-400">
                      {cat.transactionCount} transaction{cat.transactionCount !== 1 ? 's' : ''}
                    </span>
                    <span className="text-xs text-slate-400 tabular-nums w-8 text-right">
                      {Math.round(cat.pctOfSpending)}%
                    </span>
                  </div>

                  <div className="mt-1.5 h-1.5 w-full bg-slate-100 rounded-full">
                    <div
                      className="h-1.5 bg-blue-500 rounded-full"
                      style={{ width: `${Math.min(cat.pctOfSpending, 100)}%` }}
                    />
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
