import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/categories/app-categories
// Returns the distinct list of appCategory values the user has assigned,
// sorted alphabetically. Used to power the inline AppCategoryPicker dropdown.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    // Fetch all distinct non-null appCategory values for this user's transactions
    const rows = await prisma.transaction.findMany({
      where: {
        account: { userId: payload.userId },
        appCategory: { not: null },
      },
      select: { appCategory: true },
      distinct: ['appCategory'],
      orderBy: { appCategory: 'asc' },
    })

    const categories = rows
      .map(r => r.appCategory)
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)

    return NextResponse.json({ categories })
  } catch (e) {
    console.error('[/api/categories/app-categories] ERROR:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
