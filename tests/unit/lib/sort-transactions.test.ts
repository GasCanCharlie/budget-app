import { describe, it, expect } from 'vitest'
import { sortCategorizeTransactions } from '@/lib/sort-transactions'

// Minimal fixture factory
function tx(overrides: {
  id: string
  amount: number
  merchantNormalized?: string
  description?: string
  date?: string
}) {
  return {
    id: overrides.id,
    date: overrides.date ?? '2024-01-01',
    amount: overrides.amount,
    merchantNormalized: overrides.merchantNormalized ?? '',
    description: overrides.description ?? '',
  }
}

const TXNS = [
  tx({ id: 'a', amount: -50,  merchantNormalized: 'Costco',   date: '2024-01-03' }),
  tx({ id: 'b', amount: -10,  merchantNormalized: 'Amazon',   date: '2024-01-02' }),
  tx({ id: 'c', amount: -200, merchantNormalized: 'Whole Foods', date: '2024-01-01' }),
  tx({ id: 'd', amount:  100, merchantNormalized: 'Payroll',  date: '2024-01-04' }),
  tx({ id: 'e', amount: -50,  merchantNormalized: 'Costco',   date: '2024-01-05' }),
]

describe('sortCategorizeTransactions — amount', () => {
  it('asc: smallest (most negative) first', () => {
    const res = sortCategorizeTransactions(TXNS, 'amount', 'asc')
    const amounts = res.map(t => t.amount)
    expect(amounts).toEqual([-200, -50, -50, -10, 100])
  })

  it('desc: largest (most positive) first', () => {
    const res = sortCategorizeTransactions(TXNS, 'amount', 'desc')
    const amounts = res.map(t => t.amount)
    expect(amounts).toEqual([100, -10, -50, -50, -200])
  })

  it('handles negative amounts correctly (not absolute)', () => {
    const list = [
      tx({ id: '1', amount: -5 }),
      tx({ id: '2', amount: 3 }),
      tx({ id: '3', amount: -100 }),
    ]
    const asc = sortCategorizeTransactions(list, 'amount', 'asc')
    expect(asc.map(t => t.amount)).toEqual([-100, -5, 3])
  })
})

describe('sortCategorizeTransactions — vendor', () => {
  it('asc (A→Z): alphabetical case-insensitive', () => {
    const res = sortCategorizeTransactions(TXNS, 'vendor', 'asc')
    const names = res.map(t => t.merchantNormalized)
    expect(names).toEqual(['Amazon', 'Costco', 'Costco', 'Payroll', 'Whole Foods'])
  })

  it('desc (Z→A): reverse alphabetical', () => {
    const res = sortCategorizeTransactions(TXNS, 'vendor', 'desc')
    const names = res.map(t => t.merchantNormalized)
    expect(names).toEqual(['Whole Foods', 'Payroll', 'Costco', 'Costco', 'Amazon'])
  })

  it('case-insensitive: lowercase sorts same as uppercase', () => {
    const list = [
      tx({ id: '1', amount: 0, merchantNormalized: 'zebra' }),
      tx({ id: '2', amount: 0, merchantNormalized: 'Apple' }),
      tx({ id: '3', amount: 0, merchantNormalized: 'Banana' }),
    ]
    const res = sortCategorizeTransactions(list, 'vendor', 'asc')
    expect(res.map(t => t.merchantNormalized)).toEqual(['Apple', 'Banana', 'zebra'])
  })

  it('empty merchantNormalized falls back to description', () => {
    const list = [
      tx({ id: '1', amount: 0, merchantNormalized: '',      description: 'Zara' }),
      tx({ id: '2', amount: 0, merchantNormalized: 'Apple', description: 'Apple' }),
    ]
    const res = sortCategorizeTransactions(list, 'vendor', 'asc')
    // 'Apple' < 'Zara'
    expect(res[0].id).toBe('2')
    expect(res[1].id).toBe('1')
  })

  it('missing vendor (empty string) always sorts last regardless of direction', () => {
    const list = [
      tx({ id: '1', amount: 0, merchantNormalized: '',      description: '' }),
      tx({ id: '2', amount: 0, merchantNormalized: 'Apple', description: '' }),
      tx({ id: '3', amount: 0, merchantNormalized: 'Zebra', description: '' }),
    ]
    expect(sortCategorizeTransactions(list, 'vendor', 'asc').at(-1)!.id).toBe('1')
    expect(sortCategorizeTransactions(list, 'vendor', 'desc').at(-1)!.id).toBe('1')
  })
})

describe('sortCategorizeTransactions — date', () => {
  it('asc: oldest first', () => {
    const res = sortCategorizeTransactions(TXNS, 'date', 'asc')
    const dates = res.map(t => t.date)
    expect(dates).toEqual([
      '2024-01-01',
      '2024-01-02',
      '2024-01-03',
      '2024-01-04',
      '2024-01-05',
    ])
  })

  it('desc: newest first', () => {
    const res = sortCategorizeTransactions(TXNS, 'date', 'desc')
    expect(res[0].date).toBe('2024-01-05')
    expect(res.at(-1)!.date).toBe('2024-01-01')
  })
})

describe('sortCategorizeTransactions — stable sort', () => {
  it('equal vendors keep consistent secondary order (date desc then id asc)', () => {
    // Both 'Costco' entries; 'e' has a later date so it should come first
    const res = sortCategorizeTransactions(TXNS, 'vendor', 'asc')
    const costcos = res.filter(t => t.merchantNormalized === 'Costco')
    expect(costcos[0].id).toBe('e') // date '2024-01-05' > '2024-01-03'
    expect(costcos[1].id).toBe('a')
  })

  it('does not mutate the original array', () => {
    const original = [...TXNS]
    sortCategorizeTransactions(TXNS, 'amount', 'asc')
    expect(TXNS).toEqual(original)
  })
})
