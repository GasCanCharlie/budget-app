'use client'

import Link from 'next/link'
import { format } from 'date-fns'
import { CategoryIcon } from '@/components/CategoryIcon'

interface TopTx {
  id: string
  date: string | Date
  description: string
  merchantNormalized: string
  amount: number // negative = expense
  categoryName: string
  categoryColor: string
  categoryIcon: string
}

interface Props {
  transactions: TopTx[]
}

const RANK_STYLES: Record<number, string> = {
  1: 'bg-yellow-100 text-yellow-700',
  2: 'bg-slate-200 text-slate-600',
  3: 'bg-orange-100 text-orange-600',
}

function getRankStyle(rank: number): string {
  return RANK_STYLES[rank] ?? 'bg-blue-50 text-blue-600'
}

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(Math.abs(amount))
}

export function TopTransactions({ transactions }: Props) {
  const top = transactions.slice(0, 5)

  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--surface)', border: '1px solid var(--border)', boxShadow: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.04)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Top Expenses</p>
        <Link
          href="/transactions"
          className="text-sm text-blue-600 hover:underline"
        >
          View all →
        </Link>
      </div>

      {/* List */}
      {top.length === 0 ? (
        <div className="flex h-32 items-center justify-center text-sm" style={{ color: 'var(--text-secondary)' }}>
          No expenses this month
        </div>
      ) : (
        <ul className="space-y-1">
          {top.map((tx, index) => {
            const rank = index + 1
            const merchant = tx.merchantNormalized || tx.description
            const dateLabel = format(
              typeof tx.date === 'string' ? new Date(tx.date) : tx.date,
              'MMM d',
            )

            return (
              <li
                key={tx.id}
                className="flex items-center gap-3 px-2 py-2 hover:bg-black/5 rounded-lg transition"
              >
                {/* Rank badge */}
                <span
                  className={`flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold ${getRankStyle(rank)}`}
                >
                  {rank}
                </span>

                {/* Merchant + meta */}
                <div className="flex-1 min-w-0">
                  <p className="truncate font-semibold text-sm" style={{ color: 'var(--text)' }}>
                    {merchant}
                  </p>
                  <p className="text-xs flex items-center gap-1" style={{ color: 'var(--text-secondary)' }}>
                    {dateLabel} ·
                    <CategoryIcon name={tx.categoryIcon} color={tx.categoryColor} size={12} />
                    {tx.categoryName}
                  </p>
                </div>

                {/* Amount */}
                <span className="flex-shrink-0 font-bold text-sm tabular-nums" style={{ color: 'var(--danger)' }}>
                  {formatAmount(tx.amount)}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
