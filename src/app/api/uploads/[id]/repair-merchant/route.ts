import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeMerchant } from '@/lib/categorization/engine'

export const runtime = 'nodejs'

// POST /api/uploads/[id]/repair-merchant
// Reads MEMO (or NAME) from stored rawFields, recomputes merchantNormalized and
// description for transactions that have a generic placeholder merchant name.
// Clears appCategory/assignedBy when the merchant was one of the unsafe generics
// AND the category was applied by "manual" bulk action (applyToAll).
//
// Body: { dryRun?: boolean, clearCategory?: string }
//   clearCategory — only clear appCategory if it exactly matches this value
//                   (pass the wrong category that got bulk-applied)

const GENERIC_MERCHANTS = new Set([
  'posted', 'pending', 'debit', 'credit', 'purchase', 'payment',
  'transaction', 'withdrawal', 'deposit', 'check', 'unknown', 'other',
  'ach', 'wire transfer', 'wire',
])

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    dryRun?: boolean
    clearCategory?: string | null
  }
  const dryRun = body.dryRun ?? false
  const clearCategory = body.clearCategory ?? null  // null = don't clear any

  // Verify upload ownership
  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true, filename: true, formatDetected: true },
  })
  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  // Find all transactions in this upload that have a generic merchantNormalized
  const transactions = await prisma.transaction.findMany({
    where: {
      uploadId: params.id,
      account: { userId: payload.userId },
    },
    select: {
      id: true,
      description: true,
      merchantNormalized: true,
      appCategory: true,
      assignedBy: true,
      rawId: true,
    },
  })

  const genericTxs = transactions.filter(tx =>
    GENERIC_MERCHANTS.has((tx.merchantNormalized ?? '').toLowerCase().trim()),
  )

  if (genericTxs.length === 0) {
    return NextResponse.json({
      message: 'No generic-merchant transactions found in this upload',
      repaired: 0,
      categoryCleared: 0,
    })
  }

  // Load rawFields for each affected transaction
  const rawIds = genericTxs.map(tx => tx.rawId)
  const raws = await prisma.transactionRaw.findMany({
    where: { id: { in: rawIds } },
    select: { id: true, rawFields: true },
  })
  const rawMap = new Map(raws.map(r => [r.id, r.rawFields]))

  // Build snapshot for audit before touching anything
  const snapshot = genericTxs.map(tx => ({
    txId:              tx.id,
    prevMerchant:      tx.merchantNormalized,
    prevDescription:   tx.description,
    prevAppCategory:   tx.appCategory,
    prevAssignedBy:    tx.assignedBy,
  }))

  console.log('[repair-merchant] upload=%s dryRun=%s affected=%d snapshot=%s',
    params.id, dryRun, genericTxs.length, JSON.stringify(snapshot))

  if (dryRun) {
    const preview = genericTxs.map(tx => {
      const rawFieldsStr = rawMap.get(tx.rawId) ?? '{}'
      let rawFields: Record<string, string> = {}
      try { rawFields = JSON.parse(rawFieldsStr) } catch { /* leave empty */ }
      const memo = rawFields['MEMO'] || rawFields['memo'] || rawFields['NAME'] || rawFields['name'] || ''
      const newMerchant = memo.trim() ? normalizeMerchant(memo) : tx.merchantNormalized
      return {
        id: tx.id,
        currentMerchant: tx.merchantNormalized,
        newMerchant,
        memo,
        appCategory: tx.appCategory,
        willClearCategory: !!(clearCategory && tx.appCategory === clearCategory && tx.assignedBy === 'manual'),
      }
    })
    return NextResponse.json({ dryRun: true, affected: genericTxs.length, preview })
  }

  let repaired = 0
  let categoryCleared = 0

  for (const tx of genericTxs) {
    const rawFieldsStr = rawMap.get(tx.rawId) ?? '{}'
    let rawFields: Record<string, string> = {}
    try { rawFields = JSON.parse(rawFieldsStr) } catch { /* leave empty */ }

    const memo = rawFields['MEMO'] || rawFields['memo'] || rawFields['NAME'] || rawFields['name'] || ''
    if (!memo.trim()) continue   // nothing to repair

    const newDescription      = memo.trim()
    const newMerchantNormalized = normalizeMerchant(memo)

    const updates: Record<string, unknown> = {
      description:          newDescription,
      descriptionNormalized: newDescription,
      merchantNormalized:   newMerchantNormalized,
    }

    // Optionally clear the wrong bulk-applied category
    const shouldClearCat = clearCategory
      && tx.appCategory === clearCategory
      && tx.assignedBy === 'manual'

    if (shouldClearCat) {
      updates['appCategory'] = null
      updates['assignedBy']  = null
      categoryCleared++
    }

    await prisma.transaction.update({
      where: { id: tx.id },
      data:  updates,
    })
    repaired++
  }

  console.log('[repair-merchant] done repaired=%d categoryCleared=%d', repaired, categoryCleared)

  return NextResponse.json({
    repaired,
    categoryCleared,
    snapshot,
    message: `Repaired ${repaired} transactions. Cleared ${categoryCleared} incorrect categories.`,
  })
}
