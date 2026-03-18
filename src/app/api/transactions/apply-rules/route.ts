import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeForRule } from '@/lib/ingestion/vendor-normalize'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/apply-rules
// Apply saved category rules to all uncategorized committed transactions.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = payload

  try {
    // Fetch all enabled high-confidence rules for this user
    const rules = await prisma.categoryRule.findMany({
      where: { userId, isEnabled: true, confidence: 'high', isSystem: false },
      orderBy: [{ scopeAccountId: 'desc' }, { priority: 'desc' }, { createdAt: 'asc' }],
    })

    if (rules.length === 0) {
      return NextResponse.json({ applied: 0, skipped: 0, message: 'No rules found' })
    }

    // Fetch all transactions missing categoryId (uncategorized or previously categorized
    // before categoryId was being written — catches both new and legacy transactions)
    const transactions = await prisma.transaction.findMany({
      where: {
        account: { userId },
        categoryId: null,
        isExcluded: false,
      },
      select: {
        id: true,
        merchantNormalized: true,
        description: true,
        accountId: true,
        amount: true,
      },
    })

    if (transactions.length === 0) {
      return NextResponse.json({ applied: 0, skipped: 0 })
    }

    let applied = 0
    let skipped = 0

    for (const tx of transactions) {
      const txKey = normalizeForRule(tx.merchantNormalized || tx.description || '')
      const amountCents = Math.round(Number(tx.amount) * 100)

      const matching = rules.filter(rule => {
        if (rule.scopeAccountId && rule.scopeAccountId !== tx.accountId) return false
        const mv = (rule.vendorKey || rule.matchValue).toLowerCase().trim()
        if (rule.matchType === 'vendor_exact_amount') {
          return txKey === mv && rule.amountExact !== null && amountCents === rule.amountExact
        }
        if (rule.matchType === 'vendor_exact') return txKey === mv
        if (rule.matchType === 'contains') return txKey.includes(mv) || mv.includes(txKey)
        if (rule.matchType === 'vendor_smart') {
          const learned: number[] = JSON.parse((rule.learnedAmounts as string) || '[]')
          const absAmt = Math.abs(amountCents)
          return txKey === mv && (learned.length === 0 || learned.includes(absAmt))
        }
        return false
      })

      if (matching.length === 0) { skipped++; continue }

      // Use highest-priority match; skip if conflict (multiple different categories)
      const categories = [...new Set(matching.map(r => r.categoryId))]
      if (categories.length > 1) { skipped++; continue }

      const rule = matching[0]
      if (rule.mode !== 'always') { skipped++; continue }

      const category = await prisma.category.findUnique({
        where: { id: rule.categoryId },
        select: { name: true },
      })
      if (!category) { skipped++; continue }

      await prisma.transaction.update({
        where: { id: tx.id },
        data: {
          appCategory:          category.name,
          categoryId:           rule.categoryId,
          categorizationSource: 'rule',
          assignedBy:           'rule',
          appliedRuleId:        rule.id,
          needsReview:          false,
        },
      })
      applied++
    }

    // Stale insight cards so the next visit auto-regenerates with fresh category data
    if (applied > 0) {
      await prisma.insightCard.updateMany({
        where: { userId },
        data:  { generatedAt: new Date(0) },
      })
    }

    return NextResponse.json({ applied, skipped })
  } catch (err) {
    console.error('POST /api/transactions/apply-rules error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
