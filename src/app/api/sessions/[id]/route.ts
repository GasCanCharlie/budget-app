import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// PATCH /api/sessions/:id — update title or archive the session
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.analysisSession.findFirst({
    where: { id: params.id, userId: payload.userId },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({})) as { title?: string; action?: 'archive' | 'reopen' }

  const data: Record<string, unknown> = {}
  if (body.title)            data.title = body.title
  if (body.action === 'archive') {
    if (session.status === 'ARCHIVED') return NextResponse.json({ error: 'Already archived' }, { status: 400 })
    data.status     = 'ARCHIVED'
    data.archivedAt = new Date()
  }
  if (body.action === 'reopen') {
    if (session.status !== 'ARCHIVED') return NextResponse.json({ error: 'Not archived' }, { status: 400 })
    // Check no other active session
    const activeExists = await prisma.analysisSession.findFirst({
      where: { userId: payload.userId, status: { in: ['ACTIVE', 'READY', 'PROCESSING'] } },
    })
    if (activeExists) return NextResponse.json({ error: 'Another session is still active' }, { status: 409 })
    data.status     = 'ACTIVE'
    data.archivedAt = null
  }

  const updated = await prisma.analysisSession.update({
    where: { id: params.id },
    data,
  })

  return NextResponse.json({ session: updated })
}

// DELETE /api/sessions/:id — delete a session (only if no uploads)
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const session = await prisma.analysisSession.findFirst({
    where:  { id: params.id, userId: payload.userId },
    select: { id: true, uploads: { select: { id: true }, take: 1 } },
  })
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (session.uploads.length > 0) {
    return NextResponse.json({ error: 'Cannot delete session with uploads. Archive it instead.' }, { status: 400 })
  }

  await prisma.analysisSession.delete({ where: { id: params.id } })
  return NextResponse.json({ ok: true })
}
