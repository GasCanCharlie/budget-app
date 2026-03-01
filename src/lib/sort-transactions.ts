export type CatSortKey = 'date' | 'amount' | 'vendor'
export type CatSortDir = 'asc' | 'desc'

interface SortableTx {
  id: string
  date: string
  amount: number
  merchantNormalized: string
  description: string
}

/**
 * Stable sort for the categorize queue.
 * - amount: signed numeric (negative = expense, positive = income)
 * - vendor: case-insensitive; missing vendor/description sorts last
 * - date: ISO string comparison
 * Tie-breaker: date desc then id asc (deterministic).
 */
export function sortCategorizeTransactions<T extends SortableTx>(
  txs: T[],
  sortKey: CatSortKey,
  sortDir: CatSortDir,
): T[] {
  return [...txs].sort((a, b) => {
    let cmp = 0

    if (sortKey === 'amount') {
      cmp = a.amount - b.amount
    } else if (sortKey === 'vendor') {
      const va = (a.merchantNormalized || a.description || '').toLowerCase()
      const vb = (b.merchantNormalized || b.description || '').toLowerCase()
      // Empty vendor always sorts last, regardless of direction
      if (!va && vb) return 1
      if (va && !vb) return -1
      cmp = va.localeCompare(vb, undefined, { sensitivity: 'base' })
    } else {
      // date
      cmp = new Date(a.date).getTime() - new Date(b.date).getTime()
    }

    // Apply direction
    const directed = sortDir === 'asc' ? cmp : -cmp

    // Stable tie-breaker: date desc → id asc
    if (directed !== 0) return directed
    const dateCmp = new Date(b.date).getTime() - new Date(a.date).getTime()
    if (dateCmp !== 0) return dateCmp
    return a.id.localeCompare(b.id)
  })
}
