import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { computeInsights } from '@/lib/insights/compute'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/staging/[uploadId]/commit
// Commit approved staging transactions to the ledger (Transaction table).
//
// Body: { transactionIds?: string[] }
//   - If transactionIds is omitted, commit ALL categorized uncommitted staging txs.
//   - If transactionIds is provided, commit only the specified staging tx IDs.
//
// For each staging transaction committed:
//   1. Find the matching Transaction record by uploadId + date + amount.
//   2. Update Transaction: appCategory, assignedBy, appliedRuleId, needsReview,
//      reviewedByUser.
//   3. Mark StagingTransaction: committedAt, transactionId.
//   4. Update RuleHit.wasAccepted = true (if a RuleHit exists for this staging tx).
//
// After all commits, if every staging row is committed, set status='committed'.
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
    })
    if (!stagingUpload) {
      return NextResponse.json({ error: 'Staging upload not found' }, { status: 404 })
    }

    // Parse optional body
    let transactionIds: string[] | undefined
    try {
      const body = await req.json() as { transactionIds?: string[] }
      transactionIds = body.transactionIds
    } catch {
      // No body or invalid JSON — treat as "commit all"
      transactionIds = undefined
    }

    const toCommit = await prisma.stagingTransaction.findMany({
      where: {
        stagingUploadId: stagingUpload.id,
        status: 'categorized',
        committedAt: null,
        ...(transactionIds && transactionIds.length > 0
          ? { id: { in: transactionIds } }
          : {}),
      },
      include: {
        category: { select: { name: true } },
        ruleHits: { take: 1, orderBy: { createdAt: 'desc' } },
      },
    })

    let committed = 0
    const now = new Date()

    for (const stx of toCommit) {
      // Find the matching Transaction record in the ledger.
      // Match strategy: same uploadId, same date (within 1ms), amount within $0.01.
      // We convert amountCents back to float dollars for comparison.
      const amountDollars = stx.amountCents / 100

      const matchingTx = await prisma.transaction.findFirst({
        where: {
          uploadId: stagingUpload.uploadId,
          date: stx.date ?? undefined,
          amount: {
            gte: amountDollars - 0.01,
            lte: amountDollars + 0.01,
          },
        },
        select: { id: true },
      })

      if (!matchingTx) {
        // No matching ledger transaction found — skip this staging row
        continue
      }

      const categoryName = stx.category?.name ?? null

      const isRule = stx.categorySource !== 'manual' && stx.ruleId != null
      // Update the Transaction record in the ledger
      await prisma.transaction.update({
        where: { id: matchingTx.id },
        data: {
          appCategory:          categoryName,
          categoryId:           stx.categoryId ?? null,
          categorizationSource: isRule ? 'rule' : 'user',
          assignedBy:           stx.categorySource === 'manual' ? 'manual' : 'rule',
          appliedRuleId:        stx.ruleId ?? null,
          needsReview:          stx.status === 'needs_review',
          reviewedByUser:       true,
        },
      })

      // Mark the staging transaction as committed
      await prisma.stagingTransaction.update({
        where: { id: stx.id },
        data: {
          committedAt:   now,
          transactionId: matchingTx.id,
        },
      })

      // Update RuleHit.wasAccepted = true for any rule hit on this staging tx
      if (stx.ruleHits.length > 0) {
        await prisma.ruleHit.updateMany({
          where: { stagingTxId: stx.id },
          data: {
            wasAccepted:     true,
            finalCategoryId: stx.categoryId ?? null,
          },
        })
      }

      committed++
    }

    // Determine how many rows are still uncommitted
    const remainingCount = await prisma.stagingTransaction.count({
      where: {
        stagingUploadId: stagingUpload.id,
        committedAt: null,
        status: { not: 'excluded' },
      },
    })

    // If all rows are committed (or excluded), mark the staging upload as committed
    if (remainingCount === 0) {
      await prisma.stagingUpload.update({
        where: { id: stagingUpload.id },
        data: { status: 'committed' },
      })
    }

    // Fire-and-forget insights generation after successful commit.
    // Derive year/month from the first committed staging transaction's date.
    if (committed > 0) {
      const firstCommitted = toCommit.find(stx => stx.date != null)
      if (firstCommitted?.date) {
        const txDate = firstCommitted.date
        const insightYear = txDate.getFullYear()
        const insightMonth = txDate.getMonth() + 1
        computeInsights(user.userId, insightYear, insightMonth).catch(err =>
          console.error('[insights] generation failed after commit:', err),
        )
      }
    }

    return NextResponse.json({ committed, remaining: remainingCount })
  } catch (err) {
    console.error('POST /api/staging/[uploadId]/commit error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
