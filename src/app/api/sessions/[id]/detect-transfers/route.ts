import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { detectCrossAccountTransfers } from '@/lib/sessions/detect-cross-account-transfers'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.analysisSession.findFirst({
    where: { id: params.id, userId: payload.userId },
  })
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  const pairsFound = await detectCrossAccountTransfers(params.id)

  return NextResponse.json({ pairsFound })
}
