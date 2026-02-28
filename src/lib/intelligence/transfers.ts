/**
 * Transfer detection — Phase 4
 * Exact amount match + description pattern match + ±5 day window
 * Phase 2 agreed: amount proximity alone is insufficient
 */

import prisma from '@/lib/db'

const TRANSFER_PATTERNS = [
  /payment\s+thank\s+you/i,
  /autopay/i,
  /auto\s+pay/i,
  /credit\s+card\s+payment/i,
  /card\s+payment/i,
  /online\s+payment/i,
  /bill\s+payment/i,
  /bank\s+transfer/i,
  /ach\s+transfer/i,
  /wire\s+transfer/i,
  /transfer\s+(to|from)/i,
  /account\s+transfer/i,
]

export function isTransferDescription(description: string): boolean {
  return TRANSFER_PATTERNS.some(p => p.test(description))
}

/**
 * Cross-account transfer pairing: after uploading multiple accounts,
 * find pairs where:
 * - Amounts are exact inverse (within $0.01)
 * - Description matches a transfer pattern on at least one side
 * - Dates within ±5 days
 */
export async function detectTransfers(userId: string): Promise<number> {
  const transactions = await prisma.transaction.findMany({
    where: {
      account: { userId },
      isTransfer: false,
      isExcluded: false,
    },
    select: {
      id: true,
      date: true,
      amount: true,
      description: true,
      accountId: true,
    },
    orderBy: { date: 'asc' },
  })

  let linked = 0

  for (let i = 0; i < transactions.length; i++) {
    const tx = transactions[i]
    if (!isTransferDescription(tx.description)) continue

    for (let j = i + 1; j < transactions.length; j++) {
      const other = transactions[j]
      if (other.accountId === tx.accountId) continue // different accounts only

      // Date window check: ±5 days
      const daysDiff = Math.abs(tx.date.getTime() - other.date.getTime()) / (1000 * 60 * 60 * 24)
      if (daysDiff > 5) continue

      // Exact inverse amount (within $0.01)
      if (Math.abs(tx.amount + other.amount) > 0.01) continue

      // At least one must match transfer pattern
      if (!isTransferDescription(tx.description) && !isTransferDescription(other.description)) continue

      // Link them
      await prisma.$transaction([
        prisma.transaction.update({ where: { id: tx.id }, data: { isTransfer: true } }),
        prisma.transaction.update({ where: { id: other.id }, data: { isTransfer: true } }),
        prisma.transactionLink.create({
          data: {
            transactionAId: tx.id,
            transactionBId: other.id,
            linkType: 'transfer_pair',
            confidence: 0.95,
          }
        })
      ])
      linked += 2
      break
    }
  }

  return linked
}
