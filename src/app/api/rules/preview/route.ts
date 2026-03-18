import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeForRule } from '@/lib/ingestion/vendor-normalize'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/rules/preview
// Returns how many uncategorized committed transactions would be matched by
// each of the three rule types (exact, vendor-only, smart), so the UI can
// show an impact preview before the user commits to a rule.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      vendor:         string    // merchantNormalized from the transaction
      amountExact:    number    // absolute cents
      learnedAmounts: number[]  // absolute cents array
    }

    const vendorKey = normalizeForRule(body.vendor ?? '')
    const learnedSet = new Set<number>(body.learnedAmounts ?? [])

    // Fetch all uncategorized committed transactions for this user
    const txs = await prisma.transaction.findMany({
      where: {
        account:    { userId: user.userId },
        categoryId: null,
        isExcluded: false,
      },
      select: { merchantNormalized: true, amount: true },
    })

    let exactCount  = 0
    let vendorCount = 0
    let smartCount  = 0

    for (const tx of txs) {
      const txKey    = normalizeForRule(tx.merchantNormalized || '')
      const txCents  = Math.abs(Math.round(Number(tx.amount) * 100))

      if (txKey !== vendorKey) continue

      vendorCount++
      if (txCents === body.amountExact) exactCount++
      if (learnedSet.has(txCents))      smartCount++
    }

    return NextResponse.json({ exactCount, vendorCount, smartCount })
  } catch (err) {
    console.error('POST /api/rules/preview error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
