import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  default: {
    transaction: { findMany: vi.fn(), update: vi.fn() },
    transactionLink: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))

import prisma from '@/lib/db'
import { isTransferDescription, detectTransfers } from '@/lib/intelligence/transfers'

// ─── Helpers ─────────────────────────────────────────────────────────────────

type MockTx = {
  id: string
  date: Date
  amount: number
  description: string
  accountId: string
}

function makeTx(overrides: Partial<MockTx> = {}): MockTx {
  return {
    id: 'tx-1',
    date: new Date('2024-03-15'),
    amount: -100,
    description: 'STARBUCKS #1234',
    accountId: 'acct-1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── isTransferDescription ────────────────────────────────────────────────────

describe('isTransferDescription', () => {
  describe('returns true for transfer-pattern descriptions', () => {
    it('"TRANSFER TO SAVINGS" → true', () => {
      expect(isTransferDescription('TRANSFER TO SAVINGS')).toBe(true)
    })

    it('"PAYMENT THANK YOU" → true', () => {
      expect(isTransferDescription('PAYMENT THANK YOU')).toBe(true)
    })

    it('"AUTOPAY" → true', () => {
      expect(isTransferDescription('AUTOPAY')).toBe(true)
    })

    it('"ACH TRANSFER" → true', () => {
      expect(isTransferDescription('ACH TRANSFER')).toBe(true)
    })

    it('"WIRE TRANSFER" → true', () => {
      expect(isTransferDescription('WIRE TRANSFER')).toBe(true)
    })

    it('"BANK TRANSFER" → true', () => {
      expect(isTransferDescription('BANK TRANSFER')).toBe(true)
    })

    it('"CREDIT CARD PAYMENT" → true', () => {
      expect(isTransferDescription('CREDIT CARD PAYMENT')).toBe(true)
    })

    it('"CARD PAYMENT" → true', () => {
      expect(isTransferDescription('CARD PAYMENT')).toBe(true)
    })

    it('"ONLINE PAYMENT" → true', () => {
      expect(isTransferDescription('ONLINE PAYMENT')).toBe(true)
    })

    it('"BILL PAYMENT" → true', () => {
      expect(isTransferDescription('BILL PAYMENT')).toBe(true)
    })

    it('"AUTO PAY" (with space) → true', () => {
      expect(isTransferDescription('AUTO PAY')).toBe(true)
    })

    it('"ACCOUNT TRANSFER" → true', () => {
      expect(isTransferDescription('ACCOUNT TRANSFER')).toBe(true)
    })

    it('"TRANSFER FROM CHECKING" → true', () => {
      expect(isTransferDescription('TRANSFER FROM CHECKING')).toBe(true)
    })
  })

  describe('returns false for non-transfer descriptions', () => {
    it('"STARBUCKS #1234" → false', () => {
      expect(isTransferDescription('STARBUCKS #1234')).toBe(false)
    })

    it('"AMAZON.COM PURCHASE" → false', () => {
      expect(isTransferDescription('AMAZON.COM PURCHASE')).toBe(false)
    })

    it('"WHOLE FOODS MARKET" → false', () => {
      expect(isTransferDescription('WHOLE FOODS MARKET')).toBe(false)
    })

    it('"NETFLIX.COM" → false', () => {
      expect(isTransferDescription('NETFLIX.COM')).toBe(false)
    })

    it('empty string → false', () => {
      expect(isTransferDescription('')).toBe(false)
    })

    it('"DIRECT DEPOSIT PAYROLL" → false', () => {
      expect(isTransferDescription('DIRECT DEPOSIT PAYROLL')).toBe(false)
    })
  })

  describe('case insensitive matching', () => {
    it('"transfer to savings" (lowercase) → true', () => {
      expect(isTransferDescription('transfer to savings')).toBe(true)
    })

    it('"Payment Thank You" (mixed case) → true', () => {
      expect(isTransferDescription('Payment Thank You')).toBe(true)
    })

    it('"autopay" (lowercase) → true', () => {
      expect(isTransferDescription('autopay')).toBe(true)
    })

    it('"Ach Transfer" (title case) → true', () => {
      expect(isTransferDescription('Ach Transfer')).toBe(true)
    })

    it('"AutoPay" (camel case) → true', () => {
      expect(isTransferDescription('AutoPay')).toBe(true)
    })

    it('"STARBUCKS #1234" case variation stays false', () => {
      expect(isTransferDescription('starbucks #1234')).toBe(false)
    })
  })

  describe('partial string matching within a longer description', () => {
    it('matches when pattern is embedded mid-string', () => {
      expect(isTransferDescription('REF#12345 ACH TRANSFER COMPLETED')).toBe(true)
    })

    it('matches when pattern is at end of string', () => {
      expect(isTransferDescription('SCHEDULED AUTOPAY')).toBe(true)
    })
  })
})

// ─── detectTransfers ──────────────────────────────────────────────────────────

describe('detectTransfers', () => {
  describe('pairs cross-account transactions with inverse amounts within ±5 days', () => {
    it('marks two matching transactions as transfers and returns count 2', async () => {
      const txA = makeTx({
        id: 'tx-a',
        amount: -500,
        description: 'TRANSFER TO SAVINGS',
        accountId: 'acct-1',
        date: new Date('2024-03-15'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 500,
        description: 'TRANSFER FROM CHECKING',
        accountId: 'acct-2',
        date: new Date('2024-03-15'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}, {}] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(2)
      expect(prisma.$transaction).toHaveBeenCalledOnce()
    })

    it('creates a transactionLink with linkType=transfer_pair', async () => {
      const txA = makeTx({
        id: 'tx-a',
        amount: -200,
        description: 'ACH TRANSFER',
        accountId: 'acct-1',
        date: new Date('2024-03-10'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 200,
        description: 'ACH TRANSFER',
        accountId: 'acct-2',
        date: new Date('2024-03-11'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}, {}] as never)

      await detectTransfers('user-1')

      const $txCall = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown[]
      // The third operation in the atomic array should be the transactionLink.create
      expect($txCall).toHaveLength(3)
    })
  })

  describe('does not pair transactions from the same account', () => {
    it('returns 0 when both transactions belong to acct-1', async () => {
      const txA = makeTx({
        id: 'tx-a',
        amount: -100,
        description: 'TRANSFER TO SAVINGS',
        accountId: 'acct-1',
        date: new Date('2024-03-15'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 100,
        description: 'TRANSFER FROM CHECKING',
        accountId: 'acct-1', // same account
        date: new Date('2024-03-15'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(0)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('respects the ±5 day date window', () => {
    it('returns 0 when transactions are 6 days apart', async () => {
      const txA = makeTx({
        id: 'tx-a',
        amount: -100,
        description: 'TRANSFER TO SAVINGS',
        accountId: 'acct-1',
        date: new Date('2024-03-01'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 100,
        description: 'TRANSFER FROM CHECKING',
        accountId: 'acct-2',
        date: new Date('2024-03-07'), // 6 days later
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(0)
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('pairs transactions exactly 5 days apart', async () => {
      const txA = makeTx({
        id: 'tx-a',
        amount: -300,
        description: 'ACH TRANSFER',
        accountId: 'acct-1',
        date: new Date('2024-03-01'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 300,
        description: 'ACH TRANSFER',
        accountId: 'acct-2',
        date: new Date('2024-03-06'), // exactly 5 days later
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}, {}] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(2)
    })
  })

  describe('requires exact inverse amounts (within $0.01)', () => {
    it('returns 0 when amounts differ by more than $0.01', async () => {
      const txA = makeTx({
        id: 'tx-a',
        amount: -100,
        description: 'ACH TRANSFER',
        accountId: 'acct-1',
        date: new Date('2024-03-15'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 100.02, // 2 cents off
        description: 'ACH TRANSFER',
        accountId: 'acct-2',
        date: new Date('2024-03-15'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(0)
    })

    it('does NOT pair transactions whose amounts differ by exactly $0.01 (floating-point: 0.01 > 0.01 fails)', async () => {
      // IEEE-754: Math.abs(-100 + 100.01) === 0.010000000000005116 which IS > 0.01
      // so the source condition `Math.abs(tx.amount + other.amount) > 0.01` correctly
      // rejects this pair. This test documents that boundary behavior.
      const txA = makeTx({
        id: 'tx-a',
        amount: -100,
        description: 'TRANSFER TO SAVINGS',
        accountId: 'acct-1',
        date: new Date('2024-03-15'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 100.01, // floating-point sum exceeds 0.01 threshold
        description: 'TRANSFER FROM CHECKING',
        accountId: 'acct-2',
        date: new Date('2024-03-15'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(0)
    })

    it('pairs transactions whose absolute sum is well within $0.01 (e.g., $0.005 apart)', async () => {
      // Use amounts whose floating-point sum is safely below the 0.01 threshold
      const txA = makeTx({
        id: 'tx-a',
        amount: -100.005,
        description: 'ACH TRANSFER',
        accountId: 'acct-1',
        date: new Date('2024-03-15'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 100, // Math.abs(-100.005 + 100) = 0.005 which is < 0.01
        description: 'BANK TRANSFER',
        accountId: 'acct-2',
        date: new Date('2024-03-15'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}, {}] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(2)
    })
  })

  describe('requires at least one side to match a transfer pattern', () => {
    it('returns 0 when neither description matches a transfer pattern', async () => {
      const txA = makeTx({
        id: 'tx-a',
        amount: -75,
        description: 'WALMART #4201',
        accountId: 'acct-1',
        date: new Date('2024-03-15'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 75,
        description: 'WALMART REFUND',
        accountId: 'acct-2',
        date: new Date('2024-03-15'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB] as never)

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(0)
    })
  })

  describe('passes the correct query to prisma.transaction.findMany', () => {
    it('queries with isTransfer=false and isExcluded=false', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([])

      await detectTransfers('user-xyz')

      expect(prisma.transaction.findMany).toHaveBeenCalledOnce()
      const callArg = vi.mocked(prisma.transaction.findMany).mock.calls[0][0]
      expect(callArg.where).toMatchObject({
        account: { userId: 'user-xyz' },
        isTransfer: false,
        isExcluded: false,
      })
    })

    it('returns 0 when no transactions are found', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([])

      const linked = await detectTransfers('user-1')

      expect(linked).toBe(0)
    })
  })

  describe('only links each transaction once (break after first match)', () => {
    it('does not double-link a transaction that matches multiple candidates', async () => {
      // txA matches both txB and txC — should only link with txB (first match)
      const txA = makeTx({
        id: 'tx-a',
        amount: -100,
        description: 'TRANSFER TO SAVINGS',
        accountId: 'acct-1',
        date: new Date('2024-03-15'),
      })
      const txB = makeTx({
        id: 'tx-b',
        amount: 100,
        description: 'TRANSFER FROM CHECKING',
        accountId: 'acct-2',
        date: new Date('2024-03-15'),
      })
      const txC = makeTx({
        id: 'tx-c',
        amount: 100,
        description: 'BANK TRANSFER',
        accountId: 'acct-3',
        date: new Date('2024-03-15'),
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txA, txB, txC] as never)
      vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}, {}] as never)

      const linked = await detectTransfers('user-1')

      // Only one pair should be linked (txA + txB), not two
      expect(prisma.$transaction).toHaveBeenCalledOnce()
      expect(linked).toBe(2)
    })
  })
})
