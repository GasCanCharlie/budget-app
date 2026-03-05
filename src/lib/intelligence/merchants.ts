/**
 * Merchant intelligence functions.
 */
import { startOfMonth, endOfMonth } from 'date-fns'
import prisma from '@/lib/db'

// Strip trailing store numbers: "STARBUCKS #1234" → "STARBUCKS"
export function normalizeMerchant(raw: string): string {
  return raw.replace(/#\d+\s*$/, '').replace(/\s+/g, ' ').trim()
}

export interface MerchantStats {
  merchantNormalized: string
  visitCount: number
  totalSpent: number
  avgPerVisit: number
  dates: string[]          // YYYY-MM-DD, sorted ASC
  weeklyAvg: number        // visitCount / (daysInMonth / 7), 1 decimal
  category: string | null
}

export async function getMerchantStats(
  userId: string,
  merchantQuery: string,   // partial match, case-insensitive
  year: number,
  month: number,
): Promise<MerchantStats | null> {
  const start = startOfMonth(new Date(year, month - 1))
  const end = endOfMonth(new Date(year, month - 1))

  const rows = await prisma.transaction.findMany({
    where: {
      account: { userId },
      date: { gte: start, lte: end },
      isTransfer: false,
      isExcluded: false,
      isDuplicate: false,
      amount: { lt: 0 },  // expenses only
      merchantNormalized: { contains: merchantQuery, mode: 'insensitive' },
    },
    select: {
      merchantNormalized: true,
      amount: true,
      date: true,
      appCategory: true,
      category: { select: { name: true } },
      overrideCategory: { select: { name: true } },
    },
    orderBy: { date: 'asc' },
  })

  if (rows.length === 0) return null

  const totalSpent = rows.reduce((s, r) => s + Math.abs(r.amount), 0)
  const dates = rows.map(r => r.date.toISOString().slice(0, 10))
  const daysInMonth = end.getDate()
  const category = rows[0].overrideCategory?.name ?? rows[0].category?.name ?? rows[0].appCategory ?? null

  return {
    merchantNormalized: normalizeMerchant(rows[0].merchantNormalized ?? merchantQuery),
    visitCount: rows.length,
    totalSpent,
    avgPerVisit: totalSpent / rows.length,
    dates,
    weeklyAvg: Math.round((rows.length / (daysInMonth / 7)) * 10) / 10,
    category,
  }
}
