import { normalizeCategoryName } from '@/lib/categories/mapping'
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

export function computeSignals(input: RawSignalInput): PersonalitySignals {
  const spendRatio  = input.income > 0 ? input.spending / input.income : 1
  const savingsRate = input.income > 0 ? input.net / input.income : 0

  const top    = input.categories[0]
  const second = input.categories[1]

  const topCatName    = top?.name    ?? ''
  const topCatPct     = top?.pctOfSpending   ?? 0
  const secondCatName = second?.name ?? ''
  const secondCatPct  = second?.pctOfSpending ?? 0

  // Resolve master key — use explicit masterKey if provided, fall back to substring match
  const resolveMaster = (c: { name: string; masterKey?: string | null }): MasterKey | null =>
    (c.masterKey !== undefined ? c.masterKey : normalizeCategoryName(c.name)) as MasterKey | null

  // Top discretionary category — excludes fixed obligations
  const EXCLUDED_FROM_SECONDARY = new Set(['HOME', 'FINANCIAL'])
  const topDiscretionary = input.categories.find(c => {
    const master = resolveMaster(c)
    return master !== null && !EXCLUDED_FROM_SECONDARY.has(master)
  })
  const topDiscretionaryCatMaster = topDiscretionary ? resolveMaster(topDiscretionary) : null

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
    subCount:                  input.subCount,
    anomalyCount:              input.anomalyCount,
    statementType:             input.statementType,
    interestDetected:          input.interestDetected  ?? false,
    balanceCarried:            input.balanceCarried    ?? false,
    utilizationRate:           input.utilizationRate   ?? 0,
  }
}
