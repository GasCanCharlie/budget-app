import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeForRule } from '@/lib/ingestion/vendor-normalize'
import { triggerAutopsyIfReady } from '@/lib/insights/autopsy-trigger'

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
  matchType:      z.enum(['vendor_exact_amount', 'vendor_exact', 'vendor_smart']).optional(),
  matchValue:     z.string().optional(),
  amountExact:    z.number().int().optional(),
  learnedAmounts: z.array(z.number().int()).optional(),
  categoryId:     z.string().optional(),
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
      const ruleMatchType = item.matchType ?? 'vendor_exact_amount'
      const isSmartRule   = ruleMatchType === 'vendor_smart'
      const isVendorOnly  = ruleMatchType === 'vendor_exact'
      const needsAmount   = !isSmartRule && !isVendorOnly
      if (item.createRule && item.matchValue && item.categoryId &&
          (!needsAmount || item.amountExact !== undefined)) {
        const category = await prisma.category.findFirst({
          where: {
            id: item.categoryId,
            OR: [{ userId: payload.userId }, { isSystem: true }],
          },
        })
        if (!category) continue

        const normalizedValue = normalizeForRule(item.matchValue)
        const existing = await prisma.categoryRule.findFirst({
          where: isSmartRule
            ? { userId: payload.userId, matchType: 'vendor_smart', vendorKey: normalizedValue, isSystem: false }
            : needsAmount
              ? { userId: payload.userId, vendorKey: normalizedValue, amountExact: item.amountExact!, isSystem: false }
              : { userId: payload.userId, matchType: 'vendor_exact', matchValue: normalizedValue, isSystem: false },
        })

        if (existing) {
          await prisma.categoryRule.update({
            where: { id: existing.id },
            data: {
              categoryId:     item.categoryId,
              mode:           'always',
              isEnabled:      true,
              learnedAmounts: isSmartRule ? JSON.stringify(item.learnedAmounts ?? []) : undefined,
              scopeAccountId: item.scopeAccountId ?? null,
            },
          })
        } else {
          await prisma.categoryRule.create({
            data: {
              userId:         payload.userId,
              categoryId:     item.categoryId,
              matchType:      ruleMatchType,
              matchValue:     normalizedValue,
              vendorKey:      normalizedValue,
              amountExact:    needsAmount ? (item.amountExact ?? null) : null,
              learnedAmounts: isSmartRule ? JSON.stringify(item.learnedAmounts ?? []) : '[]',
              mode:           'always',
              confidence:     'high',
              isEnabled:      true,
              isSystem:       false,
              priority:       ruleMatchType === 'vendor_exact_amount' ? 30 : isSmartRule ? 25 : 20,
              scopeAccountId: item.scopeAccountId ?? null,
            },
          })
        }
      }
    }

    // Stale insight cards so the next visit auto-regenerates with fresh category data
    if (totalUpdated > 0) {
      await prisma.insightCard.updateMany({
        where: { userId: payload.userId },
        data:  { generatedAt: new Date(0) },
      })

      // Auto-trigger Financial Autopsy if categorization threshold is met.
      // Resolve uploadId from the first owned transaction in this batch.
      const firstTx = ownedTxs[0]
      if (firstTx) {
        const txWithUpload = await prisma.transaction.findFirst({
          where: { id: firstTx.id },
          select: { uploadId: true },
        })
        if (txWithUpload?.uploadId) {
          void triggerAutopsyIfReady(payload.userId, txWithUpload.uploadId)
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
