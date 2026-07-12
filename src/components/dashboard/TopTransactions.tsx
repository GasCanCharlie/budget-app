'use client'

import React from 'react'
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

const RANK_STYLES: Record<number, React.CSSProperties> = {
  1: { background: 'rgba(234,179,8,0.15)', color: 'rgb(234,179,8)' },
  2: { background: 'rgba(148,163,184,0.15)', color: 'var(--muted)' },
  3: { background: 'rgba(249,115,22,0.15)', color: 'rgb(249,115,22)' },
}
const DEFAULT_RANK_STYLE: React.CSSProperties = { background: 'rgba(99,102,241,0.1)', color: 'var(--accent)' }

function getRankStyle(rank: number): React.CSSProperties {
  return RANK_STYLES[rank] ?? DEFAULT_RANK_STYLE
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
          className="text-sm hover:underline"
          style={{ color: 'var(--accent)' }}
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
                  className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold"
                  style={getRankStyle(rank)}
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
