/**
 * scripts/rerun-categorization.ts
 *
 * Re-runs the categorization engine on all transactions that are:
 *   - Not manually reviewed / overridden by the user
 *   - Either stuck in "Other" OR AI-classified with confidence < 0.6
 *
 * Run:  npx tsx scripts/rerun-categorization.ts
 */

import { loadEnvConfig } from '@next/env'

// Load .env.local before any other imports
loadEnvConfig(process.cwd())

import prisma from '../src/lib/db'
import { categorize, normalizeMerchant } from '../src/lib/categorization/engine'

async function main() {
  console.log('🔍  Finding candidates for re-categorization...\n')

  const otherCat = await prisma.category.findFirst({
    where: { name: 'Other', isSystem: true, userId: null },
    select: { id: true },
  })

  const candidates = await prisma.transaction.findMany({
    where: {
      reviewedByUser: false,
      userOverrideCategoryId: null,
      isExcluded: false,
      OR: [
        { categorizationSource: 'ai', confidenceScore: { lt: 0.6 } },
        ...(otherCat ? [{ categoryId: otherCat.id }] : []),
      ],
    },
    select: {
      id: true,
      description: true,
      merchantNormalized: true,
      amount: true,
      account: { select: { userId: true } },
    },
  })

  const total = candidates.length
  console.log(`  Found ${total} candidate transactions.\n`)

  if (total === 0) {
    console.log('✅  Nothing to re-categorize.')
    return
  }

  let updated = 0
  let skipped = 0
  let errors  = 0

  for (let i = 0; i < candidates.length; i++) {
    const tx = candidates[i]
    const userId = tx.account?.userId

    if (!userId) { skipped++; continue }

    try {
      const freshMerchant = normalizeMerchant(tx.description).trim()
      const descForCat    = freshMerchant || tx.merchantNormalized?.trim() || tx.description

      const result = await categorize(descForCat, userId, tx.amount)

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
          merchantNormalized:   freshMerchant || undefined,
          categoryId:           result.categoryId ?? null,
          categorizationSource: result.source,
          confidenceScore:      result.confidence,
        },
      })

      updated++
      const icon = result.source === 'rule' ? '📋' : '🤖'
      console.log(
        `  [${i + 1}/${total}] ${icon}  ${(descForCat).padEnd(35)}  →  ${result.categoryName} (${Math.round(result.confidence * 100)}%)`
      )
    } catch (err) {
      errors++
      console.error(`  [${i + 1}/${total}] ❌  ${tx.description.slice(0, 40)} — ${err}`)
    }
  }

  console.log(`\n✅  Done.  updated=${updated}  skipped=${skipped}  errors=${errors}  total=${total}`)
  await prisma.$disconnect()
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
