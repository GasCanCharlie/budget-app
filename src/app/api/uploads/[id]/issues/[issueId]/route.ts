import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/uploads/[id]/issues/[issueId]
// Resolve (or re-open) a single IngestionIssue.
//
// Request body:
//   { resolved: boolean, resolution?: string }
//
// resolution: free-text or structured JSON string describing what the user did.
// resolvedBy is always set to "USER" when called from this endpoint.
// ─────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; issueId: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify upload ownership
  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true },
  })
  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  // Verify issue belongs to this upload
  const existingIssue = await prisma.ingestionIssue.findFirst({
    where: { id: params.issueId, uploadId: params.id },
  })
  if (!existingIssue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })

  let body: { resolved?: boolean; resolution?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.resolved !== 'boolean') {
    return NextResponse.json({ error: '"resolved" (boolean) is required' }, { status: 400 })
  }

  const updated = await prisma.ingestionIssue.update({
    where: { id: params.issueId },
    data: {
      resolved:    body.resolved,
      resolvedBy:  body.resolved ? 'USER' : null,
      resolvedAt:  body.resolved ? new Date() : null,
      resolution:  body.resolution ?? null,
    },
  })

  return NextResponse.json({ issue: updated })
}
