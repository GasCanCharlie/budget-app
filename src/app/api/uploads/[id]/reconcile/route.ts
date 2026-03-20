import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/uploads/[id]/reconcile
// Accepts user-provided statement totals and re-runs Stage 4 reconciliation.
// Used when the original upload was UNVERIFIABLE (no running balance, no totals).
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true, status: true },
  })
  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })
  if (upload.status !== 'complete') {
    return NextResponse.json({ error: 'Upload is not yet complete' }, { status: 409 })
  }

  const body = await req.json() as {
    openingBalance?:    string | null
    closingBalance?:    string | null
    totalCredits?:      string | null
    totalDebits?:       string | null
  }

  // Update statement totals on the upload record
  await prisma.upload.update({
    where: { id: params.id },
    data: {
      statementOpenBalance:  body.openingBalance  ?? null,
      statementCloseBalance: body.closingBalance  ?? null,
      statementTotalCredits: body.totalCredits    ?? null,
      statementTotalDebits:  body.totalDebits     ?? null,
    },
  })

  // Re-run Stage 4 reconciliation with the new totals
  const result = await runReconciliation(params.id)

  return NextResponse.json({
    reconciliationStatus: result.status,
    reconciliationMode:   result.mode,
  })
}
