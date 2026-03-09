import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const base = { account: { userId: payload.userId }, isExcluded: false }

  const [total, uncategorized] = await Promise.all([
    prisma.transaction.count({ where: base }),
    prisma.transaction.count({ where: { ...base, appCategory: null } }),
  ])

  return NextResponse.json({
    total,
    uncategorized,
    categorized: total - uncategorized,
    unlocked: total > 0 && uncategorized / total <= 0.05,
  })
}
