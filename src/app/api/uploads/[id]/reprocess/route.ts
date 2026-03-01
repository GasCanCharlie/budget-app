import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/uploads/[id]/reprocess
//
// Applies a user-confirmed date order to all ambiguous transactions in this
// upload, then re-runs reconciliation.
//
// Request body:
//   { dateOrder: 'MDY' | 'DMY' }
//
// MDY = Month/Day/Year (e.g. 2/12/2026 = Feb 12, 2026) — US format
// DMY = Day/Month/Year (e.g. 2/12/2026 = Dec 2, 2026)  — European format
//
// After confirmation:
//  1. All transactions with dateAmbiguity='AMBIGUOUS_MMDD_DDMM' get their
//     date / postedDate / transactionDate updated to the correct interpretation.
//  2. Their dateAmbiguity is set to 'RESOLVED'.
//  3. The upload-level DATE_FORMAT_CONFIRMATION_NEEDED issue is marked resolved.
//  4. All remaining per-row DATE_AMBIGUOUS issues are marked resolved.
//  5. Upload.dateOrderUsed / dateOrderSource / dateOrderConfidence are updated.
//  6. Reconciliation is re-run.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true },
  })
  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  let body: { dateOrder?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (body.dateOrder !== 'MDY' && body.dateOrder !== 'DMY') {
    return NextResponse.json(
      { error: '"dateOrder" must be "MDY" or "DMY"' },
      { status: 400 },
    )
  }

  const dateOrder = body.dateOrder as 'MDY' | 'DMY'

  // Load all ambiguous transactions for this upload
  const ambiguousTxs = await prisma.transaction.findMany({
    where: { uploadId: params.id, dateAmbiguity: 'AMBIGUOUS_MMDD_DDMM' },
    select: {
      id: true,
      dateInterpretationA: true,  // MM/DD reading
      dateInterpretationB: true,  // DD/MM reading
    },
  })

  const updatedCount = ambiguousTxs.length

  // Apply the user's choice atomically
  await prisma.$transaction(async (tx) => {
    // Step 1: Update each ambiguous transaction
    for (const t of ambiguousTxs) {
      const chosenDate = dateOrder === 'MDY' ? t.dateInterpretationA : t.dateInterpretationB
      if (!chosenDate) continue

      await tx.transaction.update({
        where: { id: t.id },
        data: {
          date:                chosenDate,
          postedDate:          chosenDate,
          dateAmbiguity:       'RESOLVED',
          dateInterpretationA: null,
          dateInterpretationB: null,
        },
      })
    }

    // Step 2: Mark upload-level DATE_FORMAT_CONFIRMATION_NEEDED issue as resolved
    await tx.ingestionIssue.updateMany({
      where: {
        uploadId:  params.id,
        issueType: 'DATE_FORMAT_CONFIRMATION_NEEDED',
        resolved:  false,
      },
      data: {
        resolved:   true,
        resolvedBy: 'USER',
        resolvedAt: new Date(),
        resolution: `Date order confirmed: ${dateOrder}`,
      },
    })

    // Step 3: Also resolve any legacy per-row DATE_AMBIGUOUS issues
    await tx.ingestionIssue.updateMany({
      where: {
        uploadId:  params.id,
        issueType: 'DATE_AMBIGUOUS',
        resolved:  false,
      },
      data: {
        resolved:   true,
        resolvedBy: 'USER',
        resolvedAt: new Date(),
        resolution: `Date format confirmed: ${dateOrder === 'MDY' ? 'MM/DD' : 'DD/MM'}`,
      },
    })

    // Step 4: Update upload-level date order fields
    await tx.upload.update({
      where: { id: params.id },
      data: {
        dateOrderUsed:       dateOrder,
        dateOrderSource:     'user_confirmed',
        dateOrderConfidence: 100,
      },
    })
  })

  // Step 5: Log the user confirmation
  await prisma.auditLogEntry.create({
    data: {
      uploadId: params.id,
      stage:    'NORMALIZE',
      level:    'INFO',
      message:  `User confirmed date order: ${dateOrder} (${dateOrder === 'MDY' ? 'MM/DD/YYYY' : 'DD/MM/YYYY'}) — updated ${updatedCount} transactions`,
      context: JSON.stringify({
        dateOrder,
        updatedTransactions: updatedCount,
        source: 'user_confirmed',
      }),
    },
  })

  // Step 6: Re-run reconciliation with correct dates
  const { status } = await runReconciliation(params.id)

  return NextResponse.json({
    dateOrder,
    updatedTransactions: updatedCount,
    reconStatus: status,
  })
}
