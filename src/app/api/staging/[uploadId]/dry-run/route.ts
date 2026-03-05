import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { dryRunRules } from '@/lib/rules/dry-run'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/staging/[uploadId]/dry-run
// Preview rule matching against all uncommitted staging transactions.
// No writes are performed.
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: { uploadId: string } },
) {
  const user = getUserFromRequest(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { uploadId } = params

  try {
    // Verify ownership
    const stagingUpload = await prisma.stagingUpload.findFirst({
      where: { id: uploadId, userId: user.userId },
      include: { upload: { select: { accountId: true } } },
    })
    if (!stagingUpload) {
      return NextResponse.json({ error: 'Staging upload not found' }, { status: 404 })
    }

    const accountId = stagingUpload.upload.accountId

    const result = await dryRunRules(stagingUpload.id, user.userId, accountId)

    return NextResponse.json(result)
  } catch (err) {
    console.error('POST /api/staging/[uploadId]/dry-run error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
