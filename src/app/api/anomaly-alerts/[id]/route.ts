import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/anomaly-alerts/[id]
// Dismiss (or un-dismiss) a single AnomalyAlert.
// Body: { dismissed: boolean }
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = params

  // Issue 24: validate ID format (cuid: lowercase alphanumeric, 20-30 chars)
  if (!id || !/^[a-z0-9]{20,30}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid alert ID' }, { status: 400 })
  }

  let body: { dismissed?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.dismissed !== 'boolean') {
    return NextResponse.json({ error: '"dismissed" (boolean) is required' }, { status: 400 })
  }

  // Issue 25: combine ownership check + update into a single atomic operation
  // to eliminate the TOCTOU race between findFirst and update
  const result = await prisma.anomalyAlert.updateMany({
    where: { id, userId: payload.userId },
    data:  { isDismissed: body.dismissed },
  })

  if (result.count === 0) {
    return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
  }

  const updated = await prisma.anomalyAlert.findUnique({ where: { id } })

  // Issue 26: return a shape consistent with the AnomalyAlert interface
  // used across the rest of the API (type vs alertType, etc.)
  return NextResponse.json({
    alert: {
      id:          updated!.id,
      type:        updated!.alertType,
      message:     updated!.message,
      amount:      updated!.amount ?? undefined,
      isDismissed: updated!.isDismissed,
    },
  })
}
