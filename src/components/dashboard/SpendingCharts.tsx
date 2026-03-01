'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts'

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
}

function EmptyState() {
  return (
    <div className="flex h-48 items-center justify-center text-sm text-slate-400">
      No spending data
    </div>
  )
}

export function SpendingCharts({ categories }: Props) {
  const isEmpty = categories.length === 0

  const barData = categories.slice(0, 8).map((c) => ({
    name: c.categoryName,
    value: c.total,
  }))

  const donutData = categories.slice(0, 6).map((c) => ({
    name: c.categoryName,
    value: c.total,
    color: c.categoryColor,
  }))

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Bar chart — 2/3 width on md+ */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 md:col-span-2">
        <p className="mb-4 text-sm font-semibold text-slate-700">
          Spending by Category
        </p>
        {isEmpty ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart
              data={barData}
              layout="vertical"
              margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
            >
              <XAxis
                type="number"
                tickFormatter={(v: number) => `$${v.toLocaleString()}`}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Spent']}
                cursor={{ fill: '#f1f5f9' }}
              />
              <Bar dataKey="value" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Donut chart — 1/3 width on md+ */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 md:col-span-1">
        <p className="mb-4 text-sm font-semibold text-slate-700">Breakdown</p>
        {isEmpty ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="name"
                innerRadius={55}
                outerRadius={85}
                paddingAngle={2}
              >
                {donutData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Legend
                iconType="circle"
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Spent']}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
