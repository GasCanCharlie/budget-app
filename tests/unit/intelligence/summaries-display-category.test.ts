/**
 * summaries-display-category.test.ts
 *
 * Tests for the new display-category system in computeMonthSummary:
 *  - appCategory takes priority over bankCategoryRaw when set
 *  - bankCategoryRaw is used when appCategory is null
 *  - bankCategoryRaw is never mutated (read-only after import)
 *  - "Uncategorized" is used as the final fallback
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  default: {
    transaction: { findMany: vi.fn() },
    monthSummary: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    monthCategoryTotal: { deleteMany: vi.fn(), createMany: vi.fn(), findMany: vi.fn() },
    anomalyAlert: { deleteMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}))

import prisma from '@/lib/db'
import { computeMonthSummary } from '@/lib/intelligence/summaries'

// ─── Transaction fixture ──────────────────────────────────────────────────────

type TxFixture = {
  id: string
  date: Date
  amount: number
  description: string
  merchantNormalized: string
  bankCategoryRaw: string | null
  appCategory: string | null
}

function makeTx(overrides: Partial<TxFixture> = {}): TxFixture {
  return {
    id:                 'tx-1',
    date:               new Date('2024-03-15'),
    amount:             -50,
    description:        'MERCHANT ABC',
    merchantNormalized: 'Merchant Abc',
    bankCategoryRaw:    'Groceries',
    appCategory:        null,
    ...overrides,
  }
}

const SAVED_SUMMARY_STUB = {
  id: 'summary-1', userId: 'user-1', year: 2024, month: 3,
  totalIncome: 0, totalSpending: 0, net: 0, transactionCount: 0,
  isPartialMonth: false, dateRangeStart: null, dateRangeEnd: null,
  computedAt: new Date(), isStale: false,
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([])
  vi.mocked(prisma.monthCategoryTotal.findMany).mockResolvedValue([])
  vi.mocked(prisma.monthSummary.upsert).mockResolvedValue(SAVED_SUMMARY_STUB as never)
  vi.mocked(prisma.monthCategoryTotal.deleteMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.monthCategoryTotal.createMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.anomalyAlert.deleteMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.anomalyAlert.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.anomalyAlert.create).mockResolvedValue({ id: 'alert-1' } as never)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeMonthSummary — display category grouping', () => {

  describe('groups by bankCategoryRaw when appCategory is null', () => {
    it('uses bankCategoryRaw as the category name and key', async () => {
      const tx = makeTx({ bankCategoryRaw: 'Gas/Fuel', appCategory: null })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(1)
      const cat = result.categoryTotals[0]
      expect(cat.categoryId).toBe('Gas/Fuel')
      expect(cat.categoryName).toBe('Gas/Fuel')
    })

    it('applies the correct icon/color from CATEGORY_STYLES for known bankCategoryRaw values', async () => {
      const tx = makeTx({ bankCategoryRaw: 'Gasoline/Fuel', appCategory: null })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      const cat = result.categoryTotals[0]
      // Gasoline/Fuel is in CATEGORY_STYLES
      expect(cat.categoryColor).toBe('#3b82f6')
      expect(cat.categoryIcon).toBe('Zap')
    })

    it('uses default style (#94a3b8 / 📦) for unknown bankCategoryRaw values', async () => {
      const tx = makeTx({ bankCategoryRaw: 'Some Unknown Bank Category', appCategory: null })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      const cat = result.categoryTotals[0]
      expect(cat.categoryColor).toBe('#94a3b8')
      expect(cat.categoryIcon).toBe('📦')
    })

    it('accumulates multiple transactions with the same bankCategoryRaw into one group', async () => {
      const tx1 = makeTx({ id: 'tx-1', bankCategoryRaw: 'Groceries', amount: -30 })
      const tx2 = makeTx({ id: 'tx-2', bankCategoryRaw: 'Groceries', amount: -70, date: new Date('2024-03-20') })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx1, tx2] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(1)
      expect(result.categoryTotals[0].categoryId).toBe('Groceries')
      expect(result.categoryTotals[0].total).toBe(100)
      expect(result.categoryTotals[0].transactionCount).toBe(2)
    })
  })

  describe('groups by appCategory when set (overrides bankCategoryRaw)', () => {
    it('uses appCategory instead of bankCategoryRaw for grouping', async () => {
      const tx = makeTx({ bankCategoryRaw: 'Food & Dining', appCategory: 'Restaurants' })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(1)
      expect(result.categoryTotals[0].categoryId).toBe('Restaurants')
      expect(result.categoryTotals[0].categoryName).toBe('Restaurants')
    })

    it('two transactions with different bankCategoryRaw but same appCategory merge into one group', async () => {
      const tx1 = makeTx({ id: 'tx-1', bankCategoryRaw: 'Fast Food',   appCategory: 'Eating Out', amount: -25 })
      const tx2 = makeTx({ id: 'tx-2', bankCategoryRaw: 'Restaurants', appCategory: 'Eating Out', amount: -80, date: new Date('2024-03-20') })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx1, tx2] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(1)
      expect(result.categoryTotals[0].categoryId).toBe('Eating Out')
      expect(result.categoryTotals[0].total).toBe(105)
      expect(result.categoryTotals[0].transactionCount).toBe(2)
    })

    it('two transactions with same bankCategoryRaw but different appCategory split into two groups', async () => {
      const tx1 = makeTx({ id: 'tx-1', bankCategoryRaw: 'Shopping', appCategory: 'Clothing', amount: -60 })
      const tx2 = makeTx({ id: 'tx-2', bankCategoryRaw: 'Shopping', appCategory: 'Electronics', amount: -120, date: new Date('2024-03-20') })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx1, tx2] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(2)
      const ids = result.categoryTotals.map(c => c.categoryId).sort()
      expect(ids).toEqual(['Clothing', 'Electronics'])
    })

    it('applies CATEGORY_STYLES for known appCategory values', async () => {
      const tx = makeTx({ bankCategoryRaw: 'Unknown', appCategory: 'Entertainment' })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      const cat = result.categoryTotals[0]
      // Entertainment is in CATEGORY_STYLES: { color: '#ec4899', icon: 'Film' }
      expect(cat.categoryColor).toBe('#ec4899')
      expect(cat.categoryIcon).toBe('Film')
    })

    it('topTransactions also use appCategory for categoryName', async () => {
      const tx = makeTx({ amount: -200, bankCategoryRaw: 'Food & Dining', appCategory: 'Business Meals' })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.topTransactions).toHaveLength(1)
      expect(result.topTransactions[0].categoryName).toBe('Business Meals')
    })
  })

  describe('bankCategoryRaw is never changed after import', () => {
    it('bankCategoryRaw in the fixture is preserved as-is (no mutation by computeMonthSummary)', async () => {
      const originalBankCategory = 'Gasoline/Fuel'
      const tx = makeTx({ bankCategoryRaw: originalBankCategory, appCategory: 'My Fuel' })
      const txRef = tx  // keep a reference to check mutation

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      await computeMonthSummary('user-1', 2024, 3)

      // The original transaction object's bankCategoryRaw must be unchanged
      expect(txRef.bankCategoryRaw).toBe(originalBankCategory)
    })

    it('a transaction with appCategory set still shows bankCategoryRaw in the raw transaction data', async () => {
      // The display category uses appCategory for grouping, but bankCategoryRaw
      // must always be available as the raw bank-provided value.
      const tx = makeTx({ bankCategoryRaw: 'Food & Dining', appCategory: 'Groceries' })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      // The category shown to the user uses appCategory
      expect(result.categoryTotals[0].categoryId).toBe('Groceries')

      // The underlying tx still has its original bankCategoryRaw
      expect(tx.bankCategoryRaw).toBe('Food & Dining')
    })
  })

  describe('"Uncategorized" fallback', () => {
    it('groups as "Uncategorized" when both appCategory and bankCategoryRaw are null', async () => {
      const tx = makeTx({ bankCategoryRaw: null, appCategory: null })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(1)
      expect(result.categoryTotals[0].categoryId).toBe('Uncategorized')
      expect(result.categoryTotals[0].categoryName).toBe('Uncategorized')
    })

    it('uses the "Uncategorized" icon (❓) for the fallback category', async () => {
      const tx = makeTx({ bankCategoryRaw: null, appCategory: null })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals[0].categoryIcon).toBe('Package')
      expect(result.categoryTotals[0].categoryColor).toBe('#94a3b8')
    })

    it('whitespace-only bankCategoryRaw is treated as null and falls back to Uncategorized', async () => {
      const tx = makeTx({ bankCategoryRaw: '   ', appCategory: null })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals[0].categoryId).toBe('Uncategorized')
    })

    it('whitespace-only appCategory falls through to bankCategoryRaw', async () => {
      const tx = makeTx({ bankCategoryRaw: 'Groceries', appCategory: '   ' })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      // appCategory is whitespace-only → trim() gives '' → falsy → falls back to bankCategoryRaw
      expect(result.categoryTotals[0].categoryId).toBe('Groceries')
    })
  })
})
