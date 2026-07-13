import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { normalizeMerchant } from '@/lib/categorization/engine'
import { chooseOfxDescription, isGenericOfxName } from '@/lib/ingestion/parse-ofx'

export const runtime = 'nodejs'

// POST /api/uploads/[id]/repair-merchant
// Re-runs the OFX merchant-selection logic against stored rawFields (NAME/MEMO)
// and writes corrected description + merchantNormalized to existing transaction rows.
// Safe: amounts, dates, IDs, categories are untouched unless clearCategory is passed.
//
// Body: { dryRun?: boolean, clearCategory?: string }
//   clearCategory — only clear appCategory if it exactly matches this value

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

  // A transaction needs repair if its current merchantNormalized is generic
  // according to the same function now used by the upload route.
  const genericTxs = transactions.filter(tx =>
    isGenericOfxName(tx.merchantNormalized),
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

  function extractOfxFields(rawId: string | null) {
    const rawFieldsStr = rawMap.get(rawId ?? '') ?? '{}'
    let rf: Record<string, string> = {}
    try { rf = JSON.parse(rawFieldsStr) } catch { /* leave empty */ }
    return {
      name:    rf['NAME']    || rf['name']    || '',
      memo:    rf['MEMO']    || rf['memo']    || '',
      trnType: rf['TRNTYPE'] || rf['trntype'] || '',
    }
  }

  if (dryRun) {
    const preview = genericTxs.map(tx => {
      const { name, memo, trnType } = extractOfxFields(tx.rawId)
      const { descNorm } = chooseOfxDescription(name, memo, trnType)
      const newMerchant = descNorm ? normalizeMerchant(descNorm) : tx.merchantNormalized
      return {
        id: tx.id,
        currentMerchant: tx.merchantNormalized,
        newMerchant,
        memo: memo || name,
        appCategory: tx.appCategory,
        willClearCategory: !!(clearCategory && tx.appCategory === clearCategory && tx.assignedBy === 'manual'),
      }
    })
    return NextResponse.json({ dryRun: true, affected: genericTxs.length, preview })
  }

  let repaired = 0
  let categoryCleared = 0

  for (const tx of genericTxs) {
    const { name, memo, trnType } = extractOfxFields(tx.rawId)
    const { descRaw, descNorm } = chooseOfxDescription(name, memo, trnType)
    if (!descNorm.trim() && !descRaw.trim()) continue   // nothing to repair

    const newDescription       = descNorm || descRaw
    const newMerchantNormalized = normalizeMerchant(descNorm || descRaw)

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
