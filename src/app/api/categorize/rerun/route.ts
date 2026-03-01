import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { categorize, normalizeMerchant } from '@/lib/categorization/engine'

/**
 * POST /api/categorize/rerun
 *
 * Re-runs the categorization engine on all transactions that were previously
 * assigned "Other" with 0% confidence or AI confidence < 0.6, and that have
 * NOT been manually reviewed or overridden by the user.
 *
 * This is needed when transactions were imported before the keyword-matching
 * layer was added, or when the AI was unavailable during import.
 */
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { userId } = payload

  try {
    // Look up the "Other" system category id so we can filter by it
    const otherCat = await prisma.category.findFirst({
      where: { name: 'Other', isSystem: true, userId: null },
      select: { id: true },
    })

    // Find all transactions that are candidates for re-categorization:
    // - belongs to this user
    // - NOT manually reviewed or overridden
    // - either stuck in "Other" OR AI categorized with low confidence
    const candidates = await prisma.transaction.findMany({
      where: {
        account: { userId },
        reviewedByUser: false,
        userOverrideCategoryId: null,
        isExcluded: false,
        OR: [
          // Low-confidence AI classification
          {
            categorizationSource: 'ai',
            confidenceScore: { lt: 0.6 },
          },
          // Anything sitting in "Other" that the user hasn't touched
          ...(otherCat ? [{ categoryId: otherCat.id }] : []),
        ],
      },
      select: {
        id: true,
        description: true,
        merchantNormalized: true,
        amount: true,
      },
    })

    const total = candidates.length
    let updated = 0
    let skipped = 0

    for (const tx of candidates) {
      try {
        // Re-apply the improved normalizeMerchant on the stored description.
        // This strips Bank of Hawaii credit card metadata ("Date X Xx X 734 Card 25...")
        // that was stored verbatim when the transaction was originally imported.
        const freshMerchant = normalizeMerchant(tx.description).trim()
        const descForCat = freshMerchant || tx.merchantNormalized?.trim() || tx.description

        const result = await categorize(descForCat, userId, tx.amount)

        // Only write back if we got a better result than "Other 0%"
        const isImprovement =
          result.source !== 'ai' ||
          result.confidence >= 0.6 ||
          (otherCat && result.categoryId !== otherCat.id)

        if (!isImprovement) {
          skipped++
          continue
        }

        await prisma.transaction.update({
          where: { id: tx.id },
          data: {
            // Also update merchantNormalized so the UI displays the clean name
            merchantNormalized:   freshMerchant || undefined,
            categoryId:           result.categoryId ?? null,
            categorizationSource: result.source,
            confidenceScore:      result.confidence,
          },
        })

        updated++
      } catch (err) {
        console.error(`[categorize/rerun] failed on tx ${tx.id}:`, err)
        skipped++
      }
    }

    return NextResponse.json({ updated, skipped, total })
  } catch (e) {
    console.error('[categorize/rerun] ERROR:', e)
    return NextResponse.json({ error: 'Re-run failed', detail: String(e) }, { status: 500 })
  }
}
