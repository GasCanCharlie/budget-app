import { resolveMasterKey } from '@/lib/categories/mapping'
import type { MasterKey } from '@/lib/categories/masters'
import type { PersonalitySignals } from './types'

interface RawSignalInput {
  income:        number
  spending:      number
  net:           number
  categories:    Array<{ name: string; pctOfSpending: number; masterKey?: string | null }>  // sorted desc by pct
  subCount:      number
  anomalyCount:  number
  statementType: 'bank' | 'credit' | 'unknown'
  // credit-specific (optional)
  interestDetected?: boolean
  balanceCarried?:   boolean
  utilizationRate?:  number
}

// Fixed-cost categories excluded from personality trait percentages.
// These are obligations, not discretionary choices — they dilute trait signals.
const PERSONALITY_EXCLUDED: Set<MasterKey> = new Set(['HOME', 'FINANCIAL'])

export function computeSignals(input: RawSignalInput): PersonalitySignals {
  const spendRatio  = input.income > 0 ? input.spending / input.income : 1
  const savingsRate = input.income > 0 ? input.net / input.income : 0

  const top    = input.categories[0]
  const second = input.categories[1]

  const topCatName    = top?.name    ?? ''
  const topCatPct     = top?.pctOfSpending   ?? 0
  const secondCatName = second?.name ?? ''
  const secondCatPct  = second?.pctOfSpending ?? 0

  // Resolve master key using canonical resolver
  const resolveMaster = (c: { name: string; masterKey?: string | null }): MasterKey | null =>
    resolveMasterKey(c.masterKey, c.name)

  // Top discretionary category — excludes HOME and FINANCIAL
  const topDiscretionary = input.categories.find(c => {
    const master = resolveMaster(c)
    return master !== null && !PERSONALITY_EXCLUDED.has(master)
  })
  const topDiscretionaryCatMaster = topDiscretionary ? resolveMaster(topDiscretionary) : null

  // Discretionary spend per master key (excludes HOME and FINANCIAL).
  // Percentages are share of discretionary total — not diluted by rent/mortgage/fees.
  const discretionaryRaw: Partial<Record<MasterKey, number>> = {}
  const unresolvedCategories: string[] = []

  for (const cat of input.categories) {
    const master = resolveMaster(cat)
    if (!master) {
      unresolvedCategories.push(cat.name)
      continue
    }
    if (PERSONALITY_EXCLUDED.has(master)) continue
    discretionaryRaw[master] = (discretionaryRaw[master] ?? 0) + cat.pctOfSpending
  }

  const discretionaryTotal = Object.values(discretionaryRaw).reduce((s, v) => s + v, 0)

  const categoryPct: Partial<Record<MasterKey, number>> = {}
  if (discretionaryTotal > 0) {
    for (const [k, v] of Object.entries(discretionaryRaw)) {
      categoryPct[k as MasterKey] = (v / discretionaryTotal) * 100
    }
  }

  if (process.env.NODE_ENV === 'development' && unresolvedCategories.length > 0) {
    console.warn('[signals] unresolved categories (no masterKey):', unresolvedCategories)
  }

  return {
    income:                    input.income,
    spending:                  input.spending,
    net:                       input.net,
    spendRatio,
    savingsRate,
    topCatName,
    topCatMaster:              resolveMaster(top ?? { name: topCatName }),
    topCatPct,
    secondCatName,
    secondCatMaster:           resolveMaster(second ?? { name: secondCatName }),
    secondCatPct,
    catSpread:                 topCatPct - secondCatPct,
    topDiscretionaryCatMaster,
    categoryPct,
    unresolvedCategories,
    subCount:                  input.subCount,
    anomalyCount:              input.anomalyCount,
    statementType:             input.statementType,
    interestDetected:          input.interestDetected  ?? false,
    balanceCarried:            input.balanceCarried    ?? false,
    utilizationRate:           input.utilizationRate   ?? 0,
  }
}
