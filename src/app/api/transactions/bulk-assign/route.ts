import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeForRule } from '@/lib/ingestion/vendor-normalize'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions/bulk-assign
//
// Categorizes multiple transactions and optionally creates rules for each —
// all in a single round-trip. Used by the "Apply All" button in the rule-ask
// modal so we avoid firing N separate PATCH + N POST /rules requests.
// ─────────────────────────────────────────────────────────────────────────────

const itemSchema = z.object({
  txId:           z.string(),
  appCategory:    z.string(),
  applyToAll:     z.boolean(),
  createRule:     z.boolean(),
  matchValue:     z.string().optional(),    // tx.merchantNormalized
  amountExact:    z.number().int().optional(), // cents
  categoryId:     z.string().optional(),    // needed for rule creation
  scopeAccountId: z.string().optional(),
})

const bodySchema = z.object({
  items: z.array(itemSchema).min(1).max(100),
})

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { items } = bodySchema.parse(body)

    // ── Verify all txIds belong to this user ───────────────────────────────
    const txIds = [...new Set(items.map(i => i.txId))]
    const ownedTxs = await prisma.transaction.findMany({
      where: { id: { in: txIds }, account: { userId: payload.userId } },
      select: { id: true, merchantNormalized: true, amount: true, accountId: true },
    })
    const ownedIds = new Set(ownedTxs.map(t => t.id))
    const txMap    = new Map(ownedTxs.map(t => [t.id, t]))

    let totalUpdated = 0

    for (const item of items) {
      if (!ownedIds.has(item.txId)) continue

      // ── 1. Categorize this transaction ──────────────────────────────────
      await prisma.transaction.update({
        where: { id: item.txId },
        data: {
          appCategory:    item.appCategory,
          reviewedByUser: true,
          assignedBy:     'manual',
          needsReview:    false,
        },
      })
      totalUpdated++

      // ── 2. applyToAll — same merchant + amount, uncategorized ───────────
      if (item.applyToAll) {
        const tx = txMap.get(item.txId)
        if (tx?.merchantNormalized) {
          const similar = await prisma.transaction.findMany({
            where: {
              account:            { userId: payload.userId },
              merchantNormalized: tx.merchantNormalized,
              amount:             tx.amount,
              id:                 { not: item.txId },
              appCategory:        null,
            },
            select: { id: true },
          })
          if (similar.length > 0) {
            await prisma.transaction.updateMany({
              where: { id: { in: similar.map(s => s.id) } },
              data:  { appCategory: item.appCategory, reviewedByUser: true, assignedBy: 'rule', needsReview: false },
            })
            totalUpdated += similar.length
          }
        }
      }

      // ── 3. Create rule if requested ─────────────────────────────────────
      if (item.createRule && item.matchValue && item.categoryId && item.amountExact !== undefined) {
        // Verify category ownership
        const category = await prisma.category.findFirst({
          where: {
            id: item.categoryId,
            OR: [{ userId: payload.userId }, { isSystem: true }],
          },
        })
        if (!category) continue

        const normalizedValue = normalizeForRule(item.matchValue)
        const existing = await prisma.categoryRule.findFirst({
          where: {
            userId:      payload.userId,
            vendorKey:   normalizedValue,
            amountExact: item.amountExact,
            isSystem:    false,
          },
        })

        if (existing) {
          await prisma.categoryRule.update({
            where: { id: existing.id },
            data: {
              categoryId:     item.categoryId,
              mode:           'always',
              isEnabled:      true,
              scopeAccountId: item.scopeAccountId ?? null,
            },
          })
        } else {
          await prisma.categoryRule.create({
            data: {
              userId:         payload.userId,
              categoryId:     item.categoryId,
              matchType:      'vendor_exact_amount',
              matchValue:     normalizedValue,
              vendorKey:      normalizedValue,
              amountExact:    item.amountExact,
              mode:           'always',
              confidence:     'high',
              isEnabled:      true,
              isSystem:       false,
              priority:       30,
              scopeAccountId: item.scopeAccountId ?? null,
            },
          })
        }
      }
    }

    return NextResponse.json({ updated: totalUpdated })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    console.error('[bulk-assign]', e)
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
