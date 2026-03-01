import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { runReconciliation } from '@/lib/ingestion/stage4-reconcile'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/uploads/[id]/issues/resolve-all
// Resolves all unresolved issues of a specific type for an upload.
//
// Request body:
//   { issueType: string, dateFormat?: 'MM/DD' | 'DD/MM' }
//
// When issueType === 'DATE_AMBIGUOUS', dateFormat is required.
// The corresponding transaction date interpretation is applied atomically
// before marking all matching issues resolved.
// After resolution, reconciliation is re-run for the upload.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
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

  let body: { issueType?: string; dateFormat?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.issueType || typeof body.issueType !== 'string') {
    return NextResponse.json({ error: '"issueType" (string) is required' }, { status: 400 })
  }

  if (body.issueType === 'DATE_AMBIGUOUS' && body.dateFormat !== 'MM/DD' && body.dateFormat !== 'DD/MM') {
    return NextResponse.json(
      { error: '"dateFormat" must be "MM/DD" or "DD/MM" when issueType is "DATE_AMBIGUOUS"' },
      { status: 400 },
    )
  }

  // Find all unresolved issues of the given type for this upload
  const issues = await prisma.ingestionIssue.findMany({
    where: { uploadId: params.id, issueType: body.issueType, resolved: false },
    include: {
      transaction: {
        select: {
          id:                   true,
          dateInterpretationA:  true,
          dateInterpretationB:  true,
        },
      },
    },
  })

  const count = issues.length

  // Build all DB operations to run atomically
  await prisma.$transaction(async (tx) => {
    // Step 1: For DATE_AMBIGUOUS issues, update each linked transaction's date
    if (body.issueType === 'DATE_AMBIGUOUS' && body.dateFormat) {
      for (const issue of issues) {
        const transaction = issue.transaction
        if (!transaction) continue

        const chosenDate =
          body.dateFormat === 'MM/DD'
            ? transaction.dateInterpretationA
            : transaction.dateInterpretationB

        if (!chosenDate) continue

        await tx.transaction.update({
          where: { id: transaction.id },
          data: {
            date:          chosenDate,
            postedDate:    chosenDate,
            dateAmbiguity: 'RESOLVED',
          },
        })
      }
    }

    // Step 2: Mark all matching unresolved issues as resolved
    await tx.ingestionIssue.updateMany({
      where: { uploadId: params.id, issueType: body.issueType, resolved: false },
      data: {
        resolved:   true,
        resolvedBy: 'USER',
        resolvedAt: new Date(),
        resolution: body.dateFormat
          ? `Date format confirmed: ${body.dateFormat}`
          : 'Bulk resolved',
      },
    })
  })

  // Re-run reconciliation after resolving issues
  const { status } = await runReconciliation(params.id)

  return NextResponse.json({ resolved: count, reconStatus: status })
}
