import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { dryRunRules } from '@/lib/rules/dry-run'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/staging/[uploadId]/apply-rules
// Apply rule matches to staging transactions (writes ruleId, ruleReason, status
// and creates RuleHit records) WITHOUT committing anything to the ledger.
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

    // Run the dry-run to get match results
    const dryRun = await dryRunRules(stagingUpload.id, user.userId, accountId)

    let applied  = 0
    let review   = 0
    const unchanged = dryRun.unmatched

    for (const match of dryRun.matches) {
      if (match.status === 'auto') {
        // Auto-categorize: write rule details and set status='categorized'
        await prisma.stagingTransaction.update({
          where: { id: match.stagingTxId },
          data: {
            ruleId:         match.ruleId,
            ruleReason:     match.ruleReason,
            categoryId:     match.categoryId,
            categorySource: 'rule',
            status:         'categorized',
          },
        })

        // Create a RuleHit record (wasAccepted=null = pending commit)
        if (match.ruleId) {
          await prisma.ruleHit.create({
            data: {
              ruleId:     match.ruleId,
              stagingTxId: match.stagingTxId,
              uploadId:   stagingUpload.uploadId,
              wasAccepted: null,
            },
          })
        }

        applied++
      } else if (match.status === 'needs_review') {
        // Flag for review: set status and ruleId if a rule matched (may be null on conflict)
        await prisma.stagingTransaction.update({
          where: { id: match.stagingTxId },
          data: {
            status: 'needs_review',
            ...(match.ruleId ? { ruleId: match.ruleId } : {}),
            ...(match.ruleReason ? { ruleReason: match.ruleReason } : {}),
          },
        })

        review++
      }
    }

    // Update aggregate counts on staging upload
    await prisma.stagingUpload.update({
      where: { id: stagingUpload.id },
      data: {
        autoCount:   applied,
        reviewCount: review,
      },
    })

    return NextResponse.json({ applied, review, unchanged })
  } catch (err) {
    console.error('POST /api/staging/[uploadId]/apply-rules error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
