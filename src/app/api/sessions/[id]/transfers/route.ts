import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

const TX_SELECT = {
  id:                 true,
  date:               true,
  description:        true,
  merchantNormalized: true,
  amount:             true,
  isTransfer:         true,
  account: { select: { id: true, name: true, accountType: true } },
} as const

// GET /api/sessions/[id]/transfers
// Returns all isTransfer transactions in the session, split into
// confirmed/unconfirmed pairs and unpaired (description-only detections).
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.analysisSession.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Find all links where both sides are in this session
  const links = await prisma.transactionLink.findMany({
    where: {
      transactionA: { upload: { sessionId: params.id } },
      transactionB: { upload: { sessionId: params.id } },
    },
    select: {
      id:             true,
      transactionAId: true,
      transactionBId: true,
      confirmedByUser: true,
      confidence:      true,
      transactionA:   { select: TX_SELECT },
      transactionB:   { select: TX_SELECT },
    },
    orderBy: { transactionA: { date: 'desc' } },
  })

  const linkedIds = new Set(links.flatMap(l => [l.transactionAId, l.transactionBId]))

  // Unpaired: isTransfer:true in session, not part of any in-session link
  const unpairedWhere =
    linkedIds.size > 0
      ? { isTransfer: true, upload: { sessionId: params.id }, id: { notIn: Array.from(linkedIds) } }
      : { isTransfer: true, upload: { sessionId: params.id } }

  const unpaired = await prisma.transaction.findMany({
    where:   unpairedWhere,
    select:  TX_SELECT,
    orderBy: { date: 'desc' },
  })

  const formatTx = (tx: typeof links[0]['transactionA']) => ({
    id:                 tx.id,
    date:               tx.date.toISOString(),
    description:        tx.description,
    merchantNormalized: tx.merchantNormalized,
    amount:             tx.amount,
    accountId:          tx.account.id,
    accountName:        tx.account.name,
    accountType:        tx.account.accountType,
  })

  const pairs = links.map(l => ({
    linkId:          l.id,
    confirmedByUser: l.confirmedByUser,
    confidence:      l.confidence,
    txA:             formatTx(l.transactionA),
    txB:             formatTx(l.transactionB),
  }))

  const unpairedOut = unpaired.map(tx => ({
    id:                 tx.id,
    date:               tx.date.toISOString(),
    description:        tx.description,
    merchantNormalized: tx.merchantNormalized,
    amount:             tx.amount,
    accountId:          tx.account.id,
    accountName:        tx.account.name,
    accountType:        tx.account.accountType,
  }))

  return NextResponse.json({
    pairs,
    unpaired:      unpairedOut,
    totalCount:    pairs.length * 2 + unpaired.length,
    pairedCount:   pairs.length * 2,
    unpairedCount: unpaired.length,
  })
}

// PATCH /api/sessions/[id]/transfers
// Body: { linkId: string } — confirms a transfer pair (confirmedByUser = true)
const confirmSchema = z.object({ linkId: z.string().min(1) })

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json()
    const { linkId } = confirmSchema.parse(body)

    // Verify the link belongs to this user's session
    const link = await prisma.transactionLink.findFirst({
      where: {
        id:           linkId,
        transactionA: { upload: { sessionId: params.id }, account: { userId: payload.userId } },
      },
      select: { id: true },
    })
    if (!link) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await prisma.transactionLink.update({
      where: { id: linkId },
      data:  { confirmedByUser: true },
    })

    return NextResponse.json({ confirmed: true })
  } catch (e) {
    if (e instanceof z.ZodError) return NextResponse.json({ error: e.errors[0].message }, { status: 400 })
    return NextResponse.json({ error: 'Server error' }, { status: 500 })
  }
}
