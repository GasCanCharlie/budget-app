import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { processUpload, uploadErrorResponse } from '@/lib/intake/process-upload'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/uploads
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const ip = getClientIp(req)
  const rl = await checkRateLimit(ip, 'upload')
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many upload requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil((rl.resetAt.getTime() - Date.now()) / 1000)) } },
    )
  }

  try {
    const formData  = await req.formData()
    const file      = formData.get('file') as File | null
    const accountId = formData.get('accountId') as string | null

    if (!file)      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!accountId) return NextResponse.json({ error: 'No accountId provided' }, { status: 400 })

    const account = await prisma.account.findFirst({ where: { id: accountId, userId: payload.userId } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const result = await processUpload({
      userId:               payload.userId,
      file,
      filename:             file.name,
      mimeType:             file.type,
      accountId,
      openingBalance:        (formData.get('openingBalance')        as string | null) || null,
      closingBalance:        (formData.get('closingBalance')        as string | null) || null,
      statementTotalCredits: (formData.get('statementTotalCredits') as string | null) || null,
      statementTotalDebits:  (formData.get('statementTotalDebits')  as string | null) || null,
    })

    return NextResponse.json(result, { status: 201 })
  } catch (e) {
    return uploadErrorResponse(e)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/uploads
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uploads = await prisma.upload.findMany({
    where:   { userId: payload.userId },
    include: { account: { select: { name: true, institution: true } } },
    orderBy: { createdAt: 'desc' },
    take:    20,
  })

  return NextResponse.json({ uploads })
}
