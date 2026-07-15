/**
 * Cross-account transfer detection.
 *
 * When a user uploads both a bank statement and a credit card statement,
 * the credit card payment appears twice:
 *   - Bank: "VISA PAYMENT -$1,000" (negative)
 *   - CC:   "PAYMENT RECEIVED +$1,000" (positive)
 *
 * This logic finds those pairs and marks both as isTransfer = true so
 * they're excluded from spending totals.
 *
 * Matching criteria:
 *   - Amounts cancel out (bank negative ≈ CC positive)
 *   - Within ±3 calendar days of each other
 *   - One transaction from a bank account, one from a credit account
 */

import prisma from '@/lib/db'

const PAYMENT_KEYWORDS = /payment|pymt|pay|credit card pay|cc pay|visa pay|mastercard pay|amex pay/i

interface TxForDetection {
  id:          string
  date:        Date
  amount:      number
  description: string
  accountId:   string
  accountType: string
}

export async function detectCrossAccountTransfers(sessionId: string): Promise<number> {
  const CREDIT_TYPES = new Set(['credit', 'credit_card', 'creditcard'])
  const BANK_TYPES   = new Set(['checking', 'savings', 'bank'])
  const THREE_DAYS   = 3 * 24 * 60 * 60 * 1000

  // Fetch all non-excluded transactions for this session
  const rows = await prisma.transaction.findMany({
    where: {
      upload: { sessionId },
      isExcluded:  false,
      isDuplicate: false,
      amount:      { not: 0 },
    },
    select: {
      id: true, date: true, amount: true, description: true,
      account: { select: { id: true, accountType: true } },
    },
  })

  const txs: TxForDetection[] = rows.map(r => ({
    id:          r.id,
    date:        r.date,
    amount:      r.amount,
    description: r.description,
    accountId:   r.account.id,
    accountType: (r.account.accountType ?? '').toLowerCase(),
  }))

  const bankTxs   = txs.filter(t => BANK_TYPES.has(t.accountType)   && t.amount < 0)
  const creditTxs = txs.filter(t => CREDIT_TYPES.has(t.accountType) && t.amount > 0)

  const pairIds: [string, string][] = []
  const usedBankIds   = new Set<string>()
  const usedCreditIds = new Set<string>()

  for (const bank of bankTxs) {
    if (usedBankIds.has(bank.id)) continue
    if (!PAYMENT_KEYWORDS.test(bank.description)) continue

    for (const cc of creditTxs) {
      if (usedCreditIds.has(cc.id)) continue

      const amountMatch = Math.abs(Math.abs(bank.amount) - cc.amount) < 1.00
      const dateMatch   = Math.abs(bank.date.getTime() - cc.date.getTime()) <= THREE_DAYS

      if (amountMatch && dateMatch) {
        pairIds.push([bank.id, cc.id])
        usedBankIds.add(bank.id)
        usedCreditIds.add(cc.id)
        break
      }
    }
  }

  if (pairIds.length === 0) return 0

  // Mark both sides as isTransfer = true and create TransactionLinks
  const allIds = pairIds.flat()
  await prisma.transaction.updateMany({
    where: { id: { in: allIds } },
    data:  { isTransfer: true },
  })

  await prisma.transactionLink.createMany({
    data: pairIds.map(([aId, bId]) => ({
      transactionAId: aId, transactionBId: bId,
      linkType: 'CROSS_ACCOUNT_TRANSFER', confidence: 0.9,
    })),
    skipDuplicates: true,
  })

  return pairIds.length
}
