/**
 * PATCH /api/insights/[cardId]/dismiss
 * Auth: JWT cookie / Bearer
 *
 * Sets isDismissed = true on the specified InsightCard.
 * Verifies ownership before updating.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { cardId: string } },
) {
  const user = getUserFromRequest(req)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { cardId } = params

  try {
    // Verify ownership
    const card = await prisma.insightCard.findFirst({
      where: { id: cardId, userId: user.userId },
      select: { id: true },
    })

    if (!card) {
      return NextResponse.json({ error: 'Card not found' }, { status: 404 })
    }

    await prisma.insightCard.update({
      where: { id: cardId },
      data: { isDismissed: true },
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('PATCH /api/insights/[cardId]/dismiss error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
