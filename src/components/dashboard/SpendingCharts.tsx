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

// Tonal accent palette — indigo-based, calibrated for dark backgrounds
const DONUT_PALETTE = [
  '#6C7CFF',
  '#7F8BFF',
  '#939AFF',
  '#A7A9FF',
  '#BCC0FF',
  '#D1D7FF',
  '#E6E9FF',
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
}

function EmptyState() {
  return (
    <div className="flex h-48 items-center justify-center text-sm" style={{ color: 'var(--muted)' }}>
      No spending data
    </div>
  )
}

// Custom bar shape with gradient fill
function GradientBar(props: {
  x?: number; y?: number; width?: number; height?: number;
  fill?: string; index?: number;
}) {
  const { x = 0, y = 0, width = 0, height = 0, index = 0 } = props
  const id = `bar-grad-${index}`
  if (!width || !height) return null
  return (
    <g>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#5E6BFF" />
          <stop offset="100%" stopColor="#8791FF" />
        </linearGradient>
      </defs>
      <rect
        x={x} y={y + (height - 12) / 2}
        width={width} height={12}
        rx={6} ry={6}
        fill={`url(#${id})`}
        style={{ transition: 'opacity 0.2s ease' }}
      />
    </g>
  )
}

export function SpendingCharts({ categories }: Props) {
  const isEmpty = categories.length === 0

  const barData = categories.slice(0, 8).map((c) => ({
    name: c.categoryName,
    value: c.total,
  }))

  const donutData = categories.slice(0, 7).map((c, i) => ({
    name: c.categoryName,
    value: c.total,
    color: DONUT_PALETTE[i % DONUT_PALETTE.length],
  }))

  const tooltipStyle = {
    background: '#111827',
    border: '1px solid #1F2937',
    borderRadius: 8,
    fontSize: 12,
    color: '#E5E7EB',
    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {/* Bar chart — 2/3 width on md+ */}
      <div className="card p-5 md:col-span-2" style={{
        background: '#111827',
        border: '1px solid #1F2937',
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      }}>
        <p className="mb-4 text-sm font-semibold" style={{ color: '#E5E7EB' }}>
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
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={100}
                tick={{ fontSize: 11, fill: '#9CA3AF' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Spent']}
                cursor={{ fill: 'rgba(108,124,255,0.06)' }}
                contentStyle={tooltipStyle}
              />
              <Bar
                dataKey="value"
                shape={(props: object) => <GradientBar {...(props as Parameters<typeof GradientBar>[0])} />}
                radius={[0, 6, 6, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Donut chart — 1/3 width on md+ */}
      <div className="card p-5 md:col-span-1" style={{
        background: '#111827',
        border: '1px solid #1F2937',
        borderRadius: 12,
        boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
      }}>
        <p className="mb-4 text-sm font-semibold" style={{ color: '#E5E7EB' }}>Breakdown</p>
        {isEmpty ? (
          <EmptyState />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={donutData}
                dataKey="value"
                nameKey="name"
                innerRadius={62}
                outerRadius={88}
                paddingAngle={2}
                strokeWidth={0}
              >
                {donutData.map((entry, i) => (
                  <Cell
                    key={entry.name}
                    fill={entry.color}
                    opacity={1}
                    style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))' }}
                  />
                ))}
              </Pie>
              <Legend
                iconType="circle"
                iconSize={7}
                wrapperStyle={{ fontSize: 11, color: '#9CA3AF' }}
              />
              <Tooltip
                formatter={(v: number) => [`$${v.toLocaleString()}`, 'Spent']}
                contentStyle={tooltipStyle}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
