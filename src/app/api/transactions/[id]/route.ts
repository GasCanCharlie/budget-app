import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { computeMonthSummary } from '@/lib/intelligence/summaries'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/transactions/[id]
// Returns full transaction detail including pipeline lineage.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const tx = await prisma.transaction.findFirst({
    where: { id: params.id, account: { userId: payload.userId } },
    include: {
      raw: true,
      account:         { select: { id: true, name: true, accountType: true } },
      upload:          { select: { id: true, filename: true, formatDetected: true } },
      category:        { select: { id: true, name: true, color: true, icon: true } },
      overrideCategory:{ select: { id: true, name: true, color: true, icon: true } },
      historyEntries: {
        orderBy: { changedAt: 'desc' },
        take: 20,
        include: {
          oldCategory: { select: { name: true, icon: true } },
          newCategory: { select: { name: true, icon: true } },
        },
      },
      ingestionIssues: { orderBy: { id: 'asc' } },
    },
  })

  if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

  // Parse JSON blobs stored as strings
  let transformations: unknown[] = []
  let rawFields: Record<string, string> = {}
  let sourceLocator: unknown = null

  try { transformations = JSON.parse(tx.transformations || '[]') } catch { /* leave [] */ }
  try { rawFields = JSON.parse(tx.raw?.rawFields ?? '{}') }        catch { /* leave {} */ }
  try { sourceLocator = JSON.parse(tx.raw?.sourceLocator ?? '{}') }catch { /* leave null */ }

  const effectiveCat = tx.overrideCategory ?? tx.category

  return NextResponse.json({
    transaction: {
      // ── Core fields ──────────────────────────────────────────────────────
      id:                   tx.id,
      date:                 tx.date,
      description:          tx.description,
      merchantNormalized:   tx.merchantNormalized,
      amount:               tx.amount,
      isTransfer:           tx.isTransfer,
      isExcluded:           tx.isExcluded,
      isForeignCurrency:    tx.isForeignCurrency,
      foreignAmount:        tx.foreignAmount,
      foreignCurrency:      tx.foreignCurrency,
      reviewedByUser:       tx.reviewedByUser,
      categorizationSource: tx.userOverrideCategoryId ? 'user' : tx.categorizationSource,
      confidenceScore:      tx.confidenceScore,
      category:             effectiveCat,
      // ── Date lineage ─────────────────────────────────────────────────────
      postedDate:           tx.postedDate,
      transactionDate:      tx.transactionDate,
      dateRaw:              tx.dateRaw,
      dateAmbiguity:        tx.dateAmbiguity,
      dateInterpretationA:  tx.dateInterpretationA,
      dateInterpretationB:  tx.dateInterpretationB,
      // ── Amount lineage ───────────────────────────────────────────────────
      amountRaw:            tx.amountRaw,
      currencyCode:         tx.currencyCode,
      currencyDetected:     tx.currencyDetected,
      // ── Description lineage ──────────────────────────────────────────────
      descriptionRaw:       tx.descriptionRaw,
      descriptionNormalized: tx.descriptionNormalized,
      // ── Category fields ──────────────────────────────────────────────────
      bankCategoryRaw:      tx.bankCategoryRaw,
      appCategory:          tx.appCategory,
      // ── Ingestion status ─────────────────────────────────────────────────
      ingestionStatus:      tx.ingestionStatus,
      isPossibleDuplicate:  tx.isPossibleDuplicate,
      bankFingerprint:      tx.bankFingerprint,
      // ── Balance chain ────────────────────────────────────────────────────
      runningBalance:       tx.runningBalance,
      runningBalanceRaw:    tx.runningBalanceRaw,
      balanceChainValid:    tx.balanceChainValid,
      balanceChainExpected: tx.balanceChainExpected,
      balanceChainActual:   tx.balanceChainActual,
      // ── Other metadata ───────────────────────────────────────────────────
      checkNumber:          tx.checkNumber,
      bankTransactionId:    tx.bankTransactionId,
      pendingFlag:          tx.pendingFlag,
      createdAt:            tx.createdAt,
      updatedAt:            tx.updatedAt,
      // ── Relationships ────────────────────────────────────────────────────
      account:              tx.account,
      upload:               tx.upload,
      // ── Pipeline lineage (parsed from JSON blobs) ────────────────────────
      transformations,
      sourceLocator,
      rawFields,
      raw: tx.raw ? {
        id:             tx.raw.id,
        rawDate:        tx.raw.rawDate,
        rawDescription: tx.raw.rawDescription,
        rawAmount:      tx.raw.rawAmount,
        rawBalance:     tx.raw.rawBalance,
        rawLine:        tx.raw.rawLine,
        parseOrder:     tx.raw.parseOrder,
      } : null,
      // ── History and issues ───────────────────────────────────────────────
      history: tx.historyEntries.map(h => ({
        oldCategory: h.oldCategory ? { name: h.oldCategory.name, icon: h.oldCategory.icon } : null,
        newCategory: { name: h.newCategory.name, icon: h.newCategory.icon },
        changedBy:   h.changedBy,
        changedAt:   h.changedAt,
      })),
      ingestionIssues: tx.ingestionIssues.map(i => ({
        id:              i.id,
        issueType:       i.issueType,
        severity:        i.severity,
        description:     i.description,
        suggestedAction: i.suggestedAction,
        resolved:        i.resolved,
        resolvedBy:      i.resolvedBy,
        resolvedAt:      i.resolvedAt,
      })),
    },
  })
}

const patchSchema = z.object({
  categoryId:       z.string().optional(),
  isExcluded:       z.boolean().optional(),
  isTransfer:       z.boolean().optional(),
  applyToAll:       z.boolean().optional(),
  // Date ambiguity resolution: ISO date string chosen by user (MM/DD or DD/MM interpretation)
  resolvedDate:     z.string().optional(),
  // Duplicate dismissal: user confirms this transaction is NOT a duplicate
  dismissDuplicate: z.boolean().optional(),
  // User's free-text app category (null to clear)
  appCategory:      z.string().nullable().optional(),
})

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const data = patchSchema.parse(body)

    // Verify ownership
    const tx = await prisma.transaction.findFirst({
      where: { id: params.id, account: { userId: payload.userId } },
      include: { category: true },
    })
    if (!tx) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

    const updates: Record<string, unknown> = {}
    let didRecategorize = false

    if (data.categoryId !== undefined) {
      // Log history before changing
      await prisma.categoryHistory.create({
        data: {
          transactionId: tx.id,
          oldCategoryId: tx.userOverrideCategoryId ?? tx.categoryId,
          newCategoryId: data.categoryId,
          changedBy:     'user',
        }
      })
      updates['userOverrideCategoryId'] = data.categoryId
      updates['reviewedByUser']         = true
      didRecategorize = true
    }
    if (data.isExcluded  !== undefined) updates['isExcluded']  = data.isExcluded
    if (data.isTransfer  !== undefined) updates['isTransfer']  = data.isTransfer

    // appCategory — free-text label assigned by the user (null clears it)
    if (data.appCategory !== undefined) {
      updates['appCategory']    = data.appCategory  // null clears it
      updates['reviewedByUser'] = true
      updates['assignedBy']     = data.appCategory ? 'manual' : null
      updates['needsReview']    = false
    }

    // Resolve date ambiguity — user has chosen MM/DD or DD/MM interpretation
    if (data.resolvedDate) {
      const resolvedDateObj = new Date(data.resolvedDate)
      updates['date']                = resolvedDateObj
      updates['postedDate']          = resolvedDateObj
      updates['dateAmbiguity']       = 'RESOLVED'
      updates['dateInterpretationA'] = null
      updates['dateInterpretationB'] = null
      // Date ambiguity was the cause of UNRESOLVED — promote to VALID
      if (tx.ingestionStatus === 'UNRESOLVED') {
        updates['ingestionStatus'] = 'VALID'
      }
    }

    // Dismiss possible duplicate — user confirms this is not a duplicate
    if (data.dismissDuplicate) {
      updates['isPossibleDuplicate'] = false
      updates['isDuplicate']         = false
    }

    await prisma.transaction.update({ where: { id: tx.id }, data: updates })

    // Apply to all same merchant if requested (user-local Layer 2 mapping)
    let appliedCount = 1
    if (data.applyToAll && data.appCategory !== undefined && tx.merchantNormalized) {
      // Apply appCategory to all same-merchant transactions
      const similar = await prisma.transaction.findMany({
        where: {
          account: { userId: payload.userId },
          merchantNormalized: tx.merchantNormalized,
          amount: tx.amount,
          id: { not: tx.id },
        },
        select: { id: true },
      })
      for (const s of similar) {
        await prisma.transaction.update({
          where: { id: s.id },
          data: { appCategory: data.appCategory ?? null },
        })
        appliedCount++
      }
    }
    if (data.applyToAll && data.categoryId && tx.merchantNormalized) {
      const similar = await prisma.transaction.findMany({
        where: {
          account: { userId: payload.userId },
          merchantNormalized: tx.merchantNormalized,
          amount: tx.amount,
          id: { not: tx.id },
          reviewedByUser: false,
        }
      })

      for (const s of similar) {
        await prisma.categoryHistory.create({
          data: {
            transactionId: s.id,
            oldCategoryId: s.userOverrideCategoryId ?? s.categoryId,
            newCategoryId: data.categoryId!,
            changedBy:     'user',
          }
        })
        await prisma.transaction.update({
          where: { id: s.id },
          data: { userOverrideCategoryId: data.categoryId, reviewedByUser: true }
        })
        appliedCount++
      }

      // Save as vendor+exact-amount rule so future uploads auto-categorize
      // only this specific vendor+price combination (not every price from this vendor)
      const vendorKey   = tx.merchantNormalized.toLowerCase()
      const amountCents = Math.round(Number(tx.amount) * 100)
      await prisma.categoryRule.upsert({
        where: {
          id: (await prisma.categoryRule.findFirst({
            where: { userId: payload.userId, vendorKey, amountExact: amountCents }
          }))?.id ?? 'new-rule-placeholder',
        },
        create: {
          userId:      payload.userId,
          categoryId:  data.categoryId!,
          matchType:   'vendor_exact_amount',
          matchValue:  vendorKey,
          vendorKey,
          amountExact: amountCents,
          priority:    30,
          isSystem:    false,
        },
        update: { categoryId: data.categoryId! },
      }).catch(() => {
        // Ignore upsert conflicts — rule already exists
      })
    }

    // Invalidate month summary cache (synchronous — Phase 7 requirement)
    const txYear  = tx.date.getFullYear()
    const txMonth = tx.date.getMonth() + 1
    if (didRecategorize) {
      await prisma.monthSummary.updateMany({
        where: { userId: payload.userId, year: txYear, month: txMonth },
        data: { isStale: true }
      })
      // Recompute immediately
      await computeMonthSummary(payload.userId, txYear, txMonth)
    }

    // Stale insight cards so the next visit auto-regenerates with fresh category data
    if (data.appCategory !== undefined || data.categoryId !== undefined) {
      await prisma.insightCard.updateMany({
        where: { userId: payload.userId },
        data:  { generatedAt: new Date(0) },
      })
    }

    return NextResponse.json({ updated: appliedCount })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
