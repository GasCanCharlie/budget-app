'use client'

import {
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface TrendMonth {
  year: number
  month: number
  label: string
  totalIncome: number | null
  totalSpending: number | null
  net: number | null
  hasData: boolean
}

interface Props {
  months: TrendMonth[]
}

interface TooltipPayloadEntry {
  name: string
  value: number
  color: string
}

interface CustomTooltipProps {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string
}

function CustomTooltip({ active, payload, label }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-md text-sm">
      <p className="mb-1 font-medium text-slate-700">{label}</p>
      {payload.map((entry) => (
        <p key={entry.name} style={{ color: entry.color }} className="tabular-nums">
          {entry.name === 'income' ? 'Income' : 'Spending'}:{' '}
          <span className="font-semibold">${entry.value.toLocaleString()}</span>
        </p>
      ))}
    </div>
  )
}

export function TrendChart({ months }: Props) {
  const hasAnyData = months.some((m) => m.hasData)
  if (!hasAnyData) return null

  const data = months.map((m) => ({
    label: m.label,
    income: m.totalIncome ?? 0,
    spending: m.totalSpending ?? 0,
  }))

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <p className="mb-4 text-sm font-medium text-slate-700">12-Month Trends</p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart
          data={data}
          barCategoryGap="25%"
          barGap={2}
        >
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
            width={44}
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: '#f1f5f9' }} />
          <Legend
            verticalAlign="bottom"
            formatter={(value: string) =>
              value === 'income' ? 'Income' : 'Spending'
            }
            wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          />
          <Bar
            dataKey="income"
            name="income"
            fill="#16a34a"
            radius={[3, 3, 0, 0]}
          />
          <Bar
            dataKey="spending"
            name="spending"
            fill="#2563eb"
            radius={[3, 3, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
