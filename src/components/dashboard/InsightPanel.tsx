'use client'

import { Lightbulb } from 'lucide-react'

interface CategoryItem {
  categoryName: string
  total: number
  pctOfSpending: number
}

interface TopTx {
  description: string
  merchantNormalized: string
  amount: number
}

interface Props {
  categories: CategoryItem[]
  topTransactions: TopTx[]
  totalIncome: number
  totalSpending: number
  prevMonthSpending: number | null
}

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function buildInsights(
  categories: CategoryItem[],
  topTransactions: TopTx[],
  totalIncome: number,
  totalSpending: number,
  prevMonthSpending: number | null,
): string[] {
  const insights: string[] = []
  if (categories.length === 0) return insights

  // 1. Top category concentration
  const top1 = categories[0]
  if (top1 && top1.pctOfSpending >= 15) {
    insights.push(
      `${top1.categoryName} represents ${Math.round(top1.pctOfSpending)}% of total spending — your dominant expense category.`
    )
  }

  // 2. Top 3 concentration
  if (categories.length >= 3) {
    const top3Sum = categories.slice(0, 3).reduce((s, c) => s + c.total, 0)
    const top3Pct = totalSpending > 0 ? Math.round((top3Sum / totalSpending) * 100) : 0
    if (top3Pct > 0) {
      const names = categories.slice(0, 3).map(c => c.categoryName).join(', ')
      insights.push(`${names} account for ${top3Pct}% of all expenses this month.`)
    }
  }

  // 3. Largest single transaction
  const largest = topTransactions[0]
  if (largest) {
    const merchant = largest.merchantNormalized || largest.description
    insights.push(`Largest transaction: ${fmtCurrency(Math.abs(largest.amount))} — ${merchant}.`)
  }

  // 4. Spending ratio commentary
  if (totalIncome > 0) {
    const ratio = Math.round((totalSpending / totalIncome) * 100)
    if (ratio > 95) {
      insights.push(`Spending is ${ratio}% of income — you are over budget. Review variable and discretionary expenses.`)
    } else if (ratio > 80) {
      insights.push(`Spending is ${ratio}% of income — elevated. A ratio below 80% gives meaningful savings headroom.`)
    } else if (ratio < 55) {
      insights.push(`Spending is ${ratio}% of income — strong savings margin. Consider putting surplus toward goals.`)
    } else {
      insights.push(`Spending is ${ratio}% of income — within a healthy operating range.`)
    }
  }

  // 5. Month-over-month spending change
  if (prevMonthSpending !== null && prevMonthSpending > 0) {
    const momPct = Math.round(((totalSpending - prevMonthSpending) / prevMonthSpending) * 100)
    if (momPct >= 10) {
      insights.push(
        `Spending increased ${momPct}% from last month — consider reviewing for new recurring charges.`
      )
    } else if (momPct <= -10) {
      insights.push(
        `Spending decreased ${Math.abs(momPct)}% from last month — a meaningful improvement.`
      )
    }
  }

  return insights.slice(0, 5)
}

export function InsightPanel({
  categories, topTransactions, totalIncome, totalSpending, prevMonthSpending,
}: Props) {
  const insights = buildInsights(categories, topTransactions, totalIncome, totalSpending, prevMonthSpending)
  if (insights.length === 0) return null

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-7 h-7 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center flex-shrink-0">
          <Lightbulb size={13} className="text-blue-600" />
        </div>
        <h2 className="text-sm font-semibold text-slate-800">Intelligent Insights</h2>
      </div>

      <ul className="space-y-3">
        {insights.map((insight, i) => (
          <li key={i} className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-400 mt-[7px] flex-shrink-0" />
            <p className="text-sm text-slate-600 leading-relaxed">{insight}</p>
          </li>
        ))}
      </ul>
    </div>
  )
}
