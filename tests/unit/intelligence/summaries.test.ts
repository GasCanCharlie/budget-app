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
import { computeMonthSummary, getAvailableMonths } from '@/lib/intelligence/summaries'

// ─── Types ────────────────────────────────────────────────────────────────────

type MockTransaction = {
  id: string
  date: Date
  amount: number
  description: string
  merchantNormalized: string
  bankCategoryRaw: string | null
  appCategory: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<MockTransaction> = {}): MockTransaction {
  return {
    id: 'tx-1',
    date: new Date('2024-03-15'),
    amount: -50,
    description: 'STARBUCKS #1234',
    merchantNormalized: 'Starbucks',
    bankCategoryRaw: 'Food & Dining',
    appCategory: null,
    ...overrides,
  }
}

// Saved summary stub returned by prisma.monthSummary.upsert
const SAVED_SUMMARY_STUB = {
  id: 'summary-1',
  userId: 'user-1',
  year: 2024,
  month: 3,
  totalIncome: 0,
  totalSpending: 0,
  net: 0,
  transactionCount: 0,
  incomeTxCount: 0,
  isPartialMonth: false,
  dateRangeStart: null,
  dateRangeEnd: null,
  computedAt: new Date(),
  isStale: false,
}

// ─── Setup: stub every Prisma method before each test ─────────────────────────
//
// The call sequence inside computeMonthSummary (when transactions exist) is:
//   1. prisma.transaction.findMany       — main tx query
//   2. prisma.monthCategoryTotal.findMany — anomaly history (returns [] → early exit)
//      (Because distinctMonths.size < 3 the rest of detectAnomalies is skipped,
//       so prisma.transaction.findMany is NOT called a second time.)
//   3. prisma.anomalyAlert.deleteMany
//   4. prisma.monthSummary.upsert
//
// NOTE: MonthCategoryTotal.deleteMany + createMany are intentionally NOT called
// because categoryId is now a free-text string, incompatible with the FK constraint.

beforeEach(() => {
  vi.resetAllMocks()

  // Default: no transactions (most tests override this)
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([])

  // Anomaly history: return empty → distinctMonths.size === 0 < 3 → early return
  vi.mocked(prisma.monthCategoryTotal.findMany).mockResolvedValue([])

  // Persist mocks
  vi.mocked(prisma.monthSummary.upsert).mockResolvedValue(SAVED_SUMMARY_STUB as never)
  vi.mocked(prisma.monthCategoryTotal.deleteMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.monthCategoryTotal.createMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.anomalyAlert.deleteMany).mockResolvedValue({ count: 0 })
  vi.mocked(prisma.anomalyAlert.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.anomalyAlert.create).mockResolvedValue({ id: 'alert-1' } as never)
})

// ─── computeMonthSummary ──────────────────────────────────────────────────────

describe('computeMonthSummary', () => {

  // 1. Zero summary when no transactions ──────────────────────────────────────

  describe('1. Returns zero summary when no transactions exist', () => {
    it('returns all-zero numeric fields and empty arrays', async () => {
      // findMany already returns [] from beforeEach
      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.totalIncome).toBe(0)
      expect(result.totalSpending).toBe(0)
      expect(result.net).toBe(0)
      expect(result.transactionCount).toBe(0)
      expect(result.isPartialMonth).toBe(false)
      expect(result.dateRangeStart).toBeNull()
      expect(result.dateRangeEnd).toBeNull()
      expect(result.categoryTotals).toEqual([])
      expect(result.topTransactions).toEqual([])
      expect(result.alerts).toEqual([])
    })

    it('does NOT call upsert when there are no transactions', async () => {
      await computeMonthSummary('user-1', 2024, 3)

      expect(prisma.monthSummary.upsert).not.toHaveBeenCalled()
    })
  })

  // 2. Income vs spending ─────────────────────────────────────────────────────

  describe('2. Correctly sums income and spending separately', () => {
    it('sums positive-amount transactions into totalIncome and negative-amount into totalSpending', async () => {
      const salary = makeTx({
        id: 'tx-income',
        amount: 3000,
        description: 'DIRECT DEPOSIT PAYROLL',
        bankCategoryRaw: 'Income',
        appCategory: null,
      })
      const food = makeTx({
        id: 'tx-food',
        amount: -80,
        description: 'GROCERY STORE',
        date: new Date('2024-03-10'),
        bankCategoryRaw: 'Groceries',
      })

      vi.mocked(prisma.transaction.findMany).mockResolvedValue([salary, food] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.totalIncome).toBe(3000)
      expect(result.totalSpending).toBe(80)
      expect(result.net).toBe(2920)
    })

    it('classifies by amount sign regardless of bankCategoryRaw', async () => {
      // amount > 0 → income even if bankCategoryRaw is 'Groceries'
      const positiveTx = makeTx({
        id: 'tx-positive',
        amount: 1000,
        description: 'REFUND',
        bankCategoryRaw: 'Groceries',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([positiveTx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.totalIncome).toBe(1000)
      expect(result.totalSpending).toBe(0)
    })

    it('uses Math.abs so negative spending amounts are still added positively', async () => {
      const tx = makeTx({ id: 'tx-a', amount: -120.50 })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.totalSpending).toBeCloseTo(120.50)
    })
  })

  // 3. Display category priority: appCategory > bankCategoryRaw > "Uncategorized" ─

  describe('3. Uses appCategory when set, falls back to bankCategoryRaw, then Uncategorized', () => {
    it('uses appCategory as the display category when set', async () => {
      const tx = makeTx({
        id: 'tx-override',
        amount: -200,
        appCategory: 'Entertainment',
        bankCategoryRaw: 'Food & Dining',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(1)
      expect(result.categoryTotals[0].categoryName).toBe('Entertainment')
      expect(result.categoryTotals[0].categoryId).toBe('Entertainment')
    })

    it('falls back to bankCategoryRaw when appCategory is null', async () => {
      const tx = makeTx({
        id: 'tx-bank-cat',
        amount: -50,
        appCategory: null,
        bankCategoryRaw: 'Gasoline/Fuel',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals[0].categoryName).toBe('Gasoline/Fuel')
      expect(result.categoryTotals[0].categoryId).toBe('Gasoline/Fuel')
    })

    it('falls back to "Uncategorized" when both appCategory and bankCategoryRaw are null', async () => {
      const tx = makeTx({
        id: 'tx-no-cat',
        amount: -30,
        appCategory: null,
        bankCategoryRaw: null,
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals[0].categoryId).toBe('Uncategorized')
      expect(result.categoryTotals[0].categoryName).toBe('Uncategorized')
    })

    it('trims whitespace from appCategory when determining the display category', async () => {
      const tx = makeTx({
        id: 'tx-trim',
        amount: -40,
        appCategory: '  Groceries  ',
        bankCategoryRaw: 'Food & Dining',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals[0].categoryName).toBe('Groceries')
    })
  })

  // 4. Exclusion filters ──────────────────────────────────────────────────────

  describe('4. Excludes isTransfer, isExcluded, isDuplicate, isForeignCurrency, amount=0 via WHERE clause', () => {
    it('passes isTransfer: false to findMany', async () => {
      await computeMonthSummary('user-1', 2024, 3)

      const whereClause = (vi.mocked(prisma.transaction.findMany).mock.calls[0][0] as {
        where: Record<string, unknown>
      }).where
      expect(whereClause.isTransfer).toBe(false)
    })

    it('passes isExcluded: false to findMany', async () => {
      await computeMonthSummary('user-1', 2024, 3)

      const whereClause = (vi.mocked(prisma.transaction.findMany).mock.calls[0][0] as {
        where: Record<string, unknown>
      }).where
      expect(whereClause.isExcluded).toBe(false)
    })

    it('passes isDuplicate: false to findMany', async () => {
      await computeMonthSummary('user-1', 2024, 3)

      const whereClause = (vi.mocked(prisma.transaction.findMany).mock.calls[0][0] as {
        where: Record<string, unknown>
      }).where
      expect(whereClause.isDuplicate).toBe(false)
    })

    it('passes isForeignCurrency: false to findMany', async () => {
      await computeMonthSummary('user-1', 2024, 3)

      const whereClause = (vi.mocked(prisma.transaction.findMany).mock.calls[0][0] as {
        where: Record<string, unknown>
      }).where
      expect(whereClause.isForeignCurrency).toBe(false)
    })

    it('passes amount: { not: 0 } to findMany to exclude zero-amount transactions', async () => {
      await computeMonthSummary('user-1', 2024, 3)

      const whereClause = (vi.mocked(prisma.transaction.findMany).mock.calls[0][0] as {
        where: Record<string, unknown>
      }).where
      expect(whereClause.amount).toEqual({ not: 0 })
    })

    it('filters by the userId through the account relation', async () => {
      await computeMonthSummary('user-xyz', 2024, 3)

      const whereClause = (vi.mocked(prisma.transaction.findMany).mock.calls[0][0] as {
        where: Record<string, unknown>
      }).where
      expect(whereClause.account).toEqual({ userId: 'user-xyz' })
    })
  })

  // 5. categoryTotals sorted by total descending ──────────────────────────────

  describe('5. Sorts categoryTotals by total descending', () => {
    it('highest-total category appears first', async () => {
      const txFoodA = makeTx({ id: 'tx-f1', amount: -30, date: new Date('2024-03-01'), bankCategoryRaw: 'Food & Dining' })
      const txFoodB = makeTx({ id: 'tx-f2', amount: -40, date: new Date('2024-03-05'), bankCategoryRaw: 'Food & Dining' })
      const txEnt   = makeTx({
        id: 'tx-ent',
        amount: -200,
        date: new Date('2024-03-10'),
        bankCategoryRaw: 'Entertainment',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([txFoodA, txFoodB, txEnt] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals[0].categoryName).toBe('Entertainment')
      expect(result.categoryTotals[0].total).toBe(200)
      expect(result.categoryTotals[1].categoryName).toBe('Food & Dining')
      expect(result.categoryTotals[1].total).toBe(70)
    })

    it('accumulates multiple transactions in the same category', async () => {
      const tx1 = makeTx({ id: 'tx-1', amount: -50, date: new Date('2024-03-01'), bankCategoryRaw: 'Groceries' })
      const tx2 = makeTx({ id: 'tx-2', amount: -75, date: new Date('2024-03-10'), bankCategoryRaw: 'Groceries' })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx1, tx2] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.categoryTotals).toHaveLength(1)
      expect(result.categoryTotals[0].total).toBe(125)
      expect(result.categoryTotals[0].transactionCount).toBe(2)
    })
  })

  // 6. Top 5 transactions ─────────────────────────────────────────────────────

  describe('6. Returns top 5 transactions (most negative amounts)', () => {
    it('limits result to 5 and sorts by amount ascending (most negative first)', async () => {
      const amounts = [-10, -500, -200, -750, -300, -50, -125]
      const txs: MockTransaction[] = amounts.map((amount, i) =>
        makeTx({
          id: `tx-${i}`,
          amount,
          date: new Date(`2024-03-${String(i + 1).padStart(2, '0')}`),
          description: `Merchant ${i}`,
        }),
      )
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(txs as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.topTransactions).toHaveLength(5)
      expect(result.topTransactions[0].amount).toBe(-750)
      expect(result.topTransactions[1].amount).toBe(-500)
      expect(result.topTransactions[2].amount).toBe(-300)
    })

    it('excludes positive (income) transactions from topTransactions', async () => {
      const spending = makeTx({ id: 'tx-spend', amount: -80 })
      const income   = makeTx({
        id: 'tx-income',
        amount: 2000,
        bankCategoryRaw: 'Income',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([spending, income] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.topTransactions.every(t => t.amount < 0)).toBe(true)
    })

    it('topTransaction entries use appCategory when set, else bankCategoryRaw', async () => {
      const tx = makeTx({
        id: 'tx-1',
        amount: -99,
        merchantNormalized: 'Whole Foods',
        appCategory: 'Groceries',
        bankCategoryRaw: 'Food & Dining',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      const top = result.topTransactions[0]
      expect(top.merchantNormalized).toBe('Whole Foods')
      expect(top.categoryName).toBe('Groceries')
      // Groceries has color #22c55e in CATEGORY_STYLES
      expect(top.categoryColor).toBe('#22c55e')
    })
  })

  // 7. Partial month detection ─────────────────────────────────────────────────

  describe('7. Detects partial month (daysCovered < 90% of days in month)', () => {
    it('isPartialMonth=false when transactions span all 31 days of March', async () => {
      // daysCovered = ceil((Mar31 - Mar01) / 86400000) + 1 = 30 + 1 = 31
      // threshold   = 31 * 0.9 = 27.9  →  31 < 27.9  →  false
      const txs: MockTransaction[] = [
        makeTx({ id: 'tx-start', date: new Date('2024-03-01'), amount: -10 }),
        makeTx({ id: 'tx-end',   date: new Date('2024-03-31'), amount: -10 }),
      ]
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(txs as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.isPartialMonth).toBe(false)
    })

    it('isPartialMonth=true when transactions only cover the first 10 days of March', async () => {
      // daysCovered = ceil((Mar10 - Mar01) / 86400000) + 1 = 9 + 1 = 10
      // threshold   = 31 * 0.9 = 27.9  →  10 < 27.9  →  true
      const txs: MockTransaction[] = [
        makeTx({ id: 'tx-start', date: new Date('2024-03-01'), amount: -10 }),
        makeTx({ id: 'tx-end',   date: new Date('2024-03-10'), amount: -10 }),
      ]
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(txs as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.isPartialMonth).toBe(true)
    })

    it('single transaction always produces isPartialMonth=true (1 day < 90% of any real month)', async () => {
      const txs: MockTransaction[] = [
        makeTx({ id: 'tx-only', date: new Date('2024-03-15'), amount: -10 }),
      ]
      vi.mocked(prisma.transaction.findMany).mockResolvedValue(txs as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      expect(result.isPartialMonth).toBe(true)
    })
  })

  // 8. monthSummary.upsert arguments ─────────────────────────────────────────

  describe('8. Calls prisma.monthSummary.upsert with correct userId/year/month', () => {
    it('calls upsert exactly once with the compound unique key', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        makeTx({ id: 'tx-1', amount: -50, date: new Date('2024-03-15') }),
      ] as never)

      await computeMonthSummary('user-abc', 2024, 3)

      expect(prisma.monthSummary.upsert).toHaveBeenCalledOnce()
      const callArg = vi.mocked(prisma.monthSummary.upsert).mock.calls[0][0]
      expect(callArg.where).toEqual({
        userId_year_month: { userId: 'user-abc', year: 2024, month: 3 },
      })
    })

    it('create and update data contain the correct aggregate fields', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        makeTx({ id: 'tx-1', amount: -50, date: new Date('2024-03-15') }),
      ] as never)

      await computeMonthSummary('user-abc', 2024, 3)

      const callArg = vi.mocked(prisma.monthSummary.upsert).mock.calls[0][0]
      expect(callArg.create).toMatchObject({
        userId:           'user-abc',
        year:             2024,
        month:            3,
        totalSpending:    50,
        totalIncome:      0,
        net:              -50,
        transactionCount: 1,
      })
      // create and update should be identical objects
      expect(callArg.create).toEqual(callArg.update)
    })
  })

  // 9. MonthCategoryTotal persistence is intentionally skipped ─────────────────

  describe('9. Does NOT persist MonthCategoryTotal (FK incompatible with free-text category names)', () => {
    it('does NOT call monthCategoryTotal.deleteMany', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        makeTx({ id: 'tx-1', amount: -50, date: new Date('2024-03-15') }),
      ] as never)

      await computeMonthSummary('user-1', 2024, 3)

      expect(prisma.monthCategoryTotal.deleteMany).not.toHaveBeenCalled()
    })

    it('does NOT call monthCategoryTotal.createMany', async () => {
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([
        makeTx({ id: 'tx-1', amount: -50, date: new Date('2024-03-15') }),
      ] as never)

      await computeMonthSummary('user-1', 2024, 3)

      expect(prisma.monthCategoryTotal.createMany).not.toHaveBeenCalled()
    })
  })

  // pctOfSpending bonus tests ─────────────────────────────────────────────────

  describe('pctOfSpending calculation', () => {
    it('calculates each category as a percentage of totalSpending', async () => {
      const tx1 = makeTx({ id: 'tx-1', amount: -100, date: new Date('2024-03-01'), bankCategoryRaw: 'Groceries' })
      const tx2 = makeTx({
        id: 'tx-2',
        amount: -100,
        date: new Date('2024-03-10'),
        bankCategoryRaw: 'Entertainment',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([tx1, tx2] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      const grocery = result.categoryTotals.find(c => c.categoryId === 'Groceries')
      const ent     = result.categoryTotals.find(c => c.categoryId === 'Entertainment')
      expect(grocery?.pctOfSpending).toBeCloseTo(50)
      expect(ent?.pctOfSpending).toBeCloseTo(50)
    })

    it('sets pctOfSpending=0 for positive-amount (income) transactions when no other spending exists', async () => {
      const income = makeTx({
        id: 'tx-income',
        amount: 3000,
        bankCategoryRaw: 'Income',
      })
      vi.mocked(prisma.transaction.findMany).mockResolvedValue([income] as never)

      const result = await computeMonthSummary('user-1', 2024, 3)

      // totalSpending === 0, so every category's pctOfSpending must be 0
      expect(result.categoryTotals.every(c => c.pctOfSpending === 0)).toBe(true)
    })
  })
})

// ─── getAvailableMonths ───────────────────────────────────────────────────────

describe('getAvailableMonths', () => {
  describe('1. Calls $queryRaw with PostgreSQL EXTRACT syntax (not strftime)', () => {
    it('calls prisma.$queryRaw exactly once', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([])

      await getAvailableMonths('user-1')

      expect(prisma.$queryRaw).toHaveBeenCalledOnce()
    })

    it('SQL template contains EXTRACT(YEAR ...) and EXTRACT(MONTH ...)', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([])

      await getAvailableMonths('user-1')

      // $queryRaw is invoked as a tagged template literal.
      // Vitest records calls[0][0] as the TemplateStringsArray (raw SQL fragments).
      const callArgs  = vi.mocked(prisma.$queryRaw).mock.calls[0]
      const sqlParts  = Array.from(callArgs[0] as unknown as TemplateStringsArray)
      const joinedSql = sqlParts.join('?')

      expect(joinedSql).toMatch(/EXTRACT\s*\(\s*YEAR/i)
      expect(joinedSql).toMatch(/EXTRACT\s*\(\s*MONTH/i)
    })

    it('does NOT use SQLite-style strftime in the SQL', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([])

      await getAvailableMonths('user-1')

      const callArgs  = vi.mocked(prisma.$queryRaw).mock.calls[0]
      const sqlParts  = Array.from(callArgs[0] as unknown as TemplateStringsArray)
      const joinedSql = sqlParts.join('?')

      expect(joinedSql).not.toMatch(/strftime/i)
    })

    it('passes the userId as the first interpolated parameter', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([])

      await getAvailableMonths('user-specific')

      const callArgs   = vi.mocked(prisma.$queryRaw).mock.calls[0]
      const firstParam = callArgs[1]
      expect(firstParam).toBe('user-specific')
    })
  })

  describe('2. Returns array of { year, month } objects', () => {
    it('returns whatever $queryRaw resolves with', async () => {
      const mockRows = [
        { year: 2024, month: 3 },
        { year: 2024, month: 2 },
        { year: 2023, month: 12 },
      ]
      vi.mocked(prisma.$queryRaw).mockResolvedValue(mockRows)

      const result = await getAvailableMonths('user-1')

      expect(result).toEqual(mockRows)
    })

    it('returns empty array when no transactions exist', async () => {
      vi.mocked(prisma.$queryRaw).mockResolvedValue([])

      const result = await getAvailableMonths('user-1')

      expect(result).toEqual([])
    })

    it('each element has numeric year and month properties', async () => {
      const mockRows = [{ year: 2024, month: 3 }]
      vi.mocked(prisma.$queryRaw).mockResolvedValue(mockRows)

      const result = await getAvailableMonths('user-1')

      expect(typeof result[0].year).toBe('number')
      expect(typeof result[0].month).toBe('number')
    })
  })
})
