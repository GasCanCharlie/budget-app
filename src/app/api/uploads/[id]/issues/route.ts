import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/uploads/[id]/issues
// Returns all IngestionIssue records for an upload.
// Query params:
//   resolved=true|false  — filter by resolved state (default: all)
//   severity=ERROR|WARNING|INFO — filter by severity
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify upload ownership
  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true },
  })
  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const resolvedParam  = searchParams.get('resolved')
  const severityParam  = searchParams.get('severity')

  const where: Record<string, unknown> = { uploadId: params.id }
  if (resolvedParam === 'true')  where.resolved = true
  if (resolvedParam === 'false') where.resolved = false
  if (severityParam)             where.severity = severityParam

  const issues = await prisma.ingestionIssue.findMany({
    where,
    include: {
      transaction: {
        select: {
          id:          true,
          date:        true,
          description: true,
          amount:      true,
          dateAmbiguity: true,
          dateInterpretationA: true,
          dateInterpretationB: true,
        },
      },
    },
    orderBy: [
      { severity: 'asc' },   // ERROR first (alphabetically: ERROR < INFO < WARNING)
      { resolved: 'asc' },   // unresolved first
      { id: 'asc' },
    ],
  })

  return NextResponse.json({ issues })
}
