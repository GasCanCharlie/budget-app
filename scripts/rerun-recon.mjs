// Re-runs stage4 reconciliation on the most recent upload to verify the fix.
// Usage: node --env-file=.env.local scripts/rerun-recon.mjs

import { runReconciliation } from '../src/lib/ingestion/stage4-reconcile.ts'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const upload = await prisma.upload.findFirst({
  orderBy: { createdAt: 'desc' },
  select: { id: true, filename: true, reconciliationStatus: true }
})

if (!upload) { console.log('No uploads'); process.exit(0) }
console.log(`Re-reconciling: ${upload.filename} (was: ${upload.reconciliationStatus})`)

// Reset existing chain validation data so we get a clean re-run
await prisma.transaction.updateMany({
  where: { uploadId: upload.id },
  data: { balanceChainValid: null, balanceChainExpected: null, balanceChainActual: null }
})
// Remove old ingestion issues for balance chain breaks
await prisma.ingestionIssue.deleteMany({
  where: { uploadId: upload.id, issueType: 'BALANCE_CHAIN_BREAK' }
})

const { status, mode } = await runReconciliation(upload.id)
console.log(`Result: ${status} (mode: ${mode})`)

await prisma.$disconnect()
