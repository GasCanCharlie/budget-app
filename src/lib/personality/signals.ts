import { normalizeCategoryName } from '@/lib/categories/mapping'
import type { PersonalitySignals } from './types'

interface RawSignalInput {
  income:        number
  spending:      number
  net:           number
  categories:    Array<{ name: string; pctOfSpending: number }>  // sorted desc by pct
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

  return {
    income:           input.income,
    spending:         input.spending,
    net:              input.net,
    spendRatio,
    savingsRate,
    topCatName,
    topCatMaster:     normalizeCategoryName(topCatName),
    topCatPct,
    secondCatName,
    secondCatMaster:  normalizeCategoryName(secondCatName),
    secondCatPct,
    catSpread:        topCatPct - secondCatPct,
    subCount:         input.subCount,
    anomalyCount:     input.anomalyCount,
    statementType:    input.statementType,
    interestDetected: input.interestDetected  ?? false,
    balanceCarried:   input.balanceCarried    ?? false,
    utilizationRate:  input.utilizationRate   ?? 0,
  }
}
