import { describe, it, expect } from 'vitest'
import { rankPersonalities, detectPersonality } from '@/lib/personality/detect'
import { computeSignals } from '@/lib/personality/signals'
import { isIncomeCategory, resolveMasterKey } from '@/lib/categories/mapping'
import type { PersonalitySignals } from '@/lib/personality/types'

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeSignals(overrides: Partial<PersonalitySignals> = {}): PersonalitySignals {
  return {
    income:                    5000,
    spending:                  3500,
    net:                       1500,
    spendRatio:                0.70,
    savingsRate:               0.30,
    topCatName:                'Transport',
    topCatMaster:              'TRANSPORT',
    topCatPct:                 38,
    secondCatName:             'Food & Dining',
    secondCatMaster:           'FOOD',
    secondCatPct:              22,
    topDiscretionaryCatMaster: 'TRANSPORT',
    categoryPct:               { TRANSPORT: 38, FOOD: 22 },
    unresolvedCategories:      [],
    catSpread:                 16,
    subCount:                  0,
    anomalyCount:              0,
    statementType:             'bank',
    interestDetected:          false,
    balanceCarried:            false,
    utilizationRate:           0,
    ...overrides,
  }
}

// ─── Core ranking invariants ─────────────────────────────────────────────────

describe('rankPersonalities()', () => {
  it('returns a non-empty array sorted by score descending', () => {
    const ranked = rankPersonalities(makeSignals())
    expect(ranked.length).toBeGreaterThan(0)
    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].score).toBeGreaterThanOrEqual(ranked[i + 1].score)
    }
  })

  it('assigns rank 1 to the highest scorer', () => {
    const ranked = rankPersonalities(makeSignals())
    expect(ranked[0].rank).toBe(1)
    expect(ranked[1].rank).toBe(2)
  })

  it('normalizedScore for rank #1 is always 100', () => {
    const ranked = rankPersonalities(makeSignals({ spendRatio: 1.2 }))
    expect(ranked[0].normalizedScore).toBe(100)
  })

  it('no duplicate personalities in the ranked list', () => {
    const ranked = rankPersonalities(makeSignals())
    const ids = ranked.map(r => r.meta.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(ids.length)
  })

  it('every entry has matchedRules (may be empty for score=0)', () => {
    const ranked = rankPersonalities(makeSignals())
    for (const entry of ranked) {
      expect(Array.isArray(entry.matchedRules)).toBe(true)
    }
  })
})

// ─── detectPersonality() canonical fields ─────────────────────────────────────

describe('detectPersonality()', () => {
  it('mainPersonality is always the rank-#1 eligible personality', () => {
    const signals = makeSignals({ spendRatio: 1.15, net: -500 })
    const results = detectPersonality(signals)
    const ranked = rankPersonalities(signals)
    const eligible = ranked.filter(r => r.eligible && r.score > 0)
    expect(results.mainPersonality.id).toBe(eligible[0].meta.id)
  })

  it('alterEgo is the rank-#2 eligible personality', () => {
    const signals = makeSignals()
    const results = detectPersonality(signals)
    const ranked = rankPersonalities(signals)
    const eligible = ranked.filter(r => r.eligible && r.score > 0)
    expect(results.alterEgo?.id).toBe(eligible[1]?.meta.id)
  })

  it('mainPersonality !== alterEgo — no duplicate personalities', () => {
    const results = detectPersonality(makeSignals())
    if (results.alterEgo) {
      expect(results.mainPersonality.id).not.toBe(results.alterEgo.id)
    }
  })

  it('legacy .core mirrors .mainPersonality', () => {
    const results = detectPersonality(makeSignals())
    expect(results.core.id).toBe(results.mainPersonality.id)
  })

  it('legacy .trait mirrors .alterEgo', () => {
    const results = detectPersonality(makeSignals())
    expect(results.trait?.id).toBe(results.alterEgo?.id)
  })

  it('display string includes mainPersonality.name', () => {
    const results = detectPersonality(makeSignals())
    expect(results.display).toContain(results.mainPersonality.name)
  })

  it('rankedPersonalities is present and non-empty', () => {
    const results = detectPersonality(makeSignals())
    expect(results.rankedPersonalities.length).toBeGreaterThan(0)
  })
})

// ─── Specific personality scoring cases ──────────────────────────────────────

describe('scoring — full_send gets #1 when spending far exceeds income', () => {
  it('spendRatio > 1.15 → full_send is top personality', () => {
    const results = detectPersonality(makeSignals({
      spendRatio: 1.25, net: -2000, spending: 7500, income: 6000,
      statementType: 'unknown',
    }))
    expect(results.mainPersonality.id).toBe('full_send')
  })
})

describe('scoring — quiet_millionaire wins on high income + low spend', () => {
  it('income 15k + spendRatio 0.35 + savingsRate 0.55 → quiet_millionaire #1', () => {
    const results = detectPersonality(makeSignals({
      income: 15000, spending: 5250, net: 9750,
      spendRatio: 0.35, savingsRate: 0.65,
      statementType: 'bank',
    }))
    expect(results.mainPersonality.id).toBe('quiet_millionaire')
    expect(results.mainPersonality.isPremium).toBe(true)
  })
})

describe('scoring — currency_combustion can rank #1 when TRANSPORT dominates', () => {
  it('TRANSPORT at 55% of spending → currency_combustion scores 90', () => {
    const ranked = rankPersonalities(makeSignals({
      topCatPct: 55, topCatMaster: 'TRANSPORT',
      topDiscretionaryCatMaster: 'TRANSPORT',
      categoryPct: { TRANSPORT: 55 },
      statementType: 'unknown',
    }))
    const cc = ranked.find(r => r.meta.id === 'currency_combustion')
    expect(cc).toBeDefined()
    expect(cc!.score).toBe(90)
  })

  it('currency_combustion at 55% beats steady_builder', () => {
    const ranked = rankPersonalities(makeSignals({
      topCatPct: 55, topCatMaster: 'TRANSPORT',
      topDiscretionaryCatMaster: 'TRANSPORT',
      categoryPct: { TRANSPORT: 55 },
      spendRatio: 0.70, net: 1500, anomalyCount: 0,
      statementType: 'unknown',
    }))
    const ccRank = ranked.findIndex(r => r.meta.id === 'currency_combustion')
    const sbRank = ranked.findIndex(r => r.meta.id === 'steady_builder')
    expect(ccRank).toBeLessThan(sbRank)
  })
})

describe('scoring — subscription_collector', () => {
  it('subCount 8 → score 80', () => {
    const ranked = rankPersonalities(makeSignals({ subCount: 8 }))
    const sc = ranked.find(r => r.meta.id === 'subscription_collector')
    expect(sc!.score).toBe(80)
  })

  it('subCount 5 → score 62', () => {
    const ranked = rankPersonalities(makeSignals({ subCount: 5 }))
    const sc = ranked.find(r => r.meta.id === 'subscription_collector')
    expect(sc!.score).toBe(62)
  })
})

describe('scoring — bank/credit personalities are ineligible for wrong statement type', () => {
  it('cash_keeper is ineligible when statementType is credit', () => {
    const ranked = rankPersonalities(makeSignals({ statementType: 'credit', spendRatio: 0.2 }))
    const ck = ranked.find(r => r.meta.id === 'cash_keeper')
    expect(ck!.eligible).toBe(false)
    expect(ck!.score).toBe(0)
  })

  it('minimum_payer is ineligible when statementType is bank', () => {
    const ranked = rankPersonalities(makeSignals({ statementType: 'bank', utilizationRate: 0.97 }))
    const mp = ranked.find(r => r.meta.id === 'minimum_payer')
    expect(mp!.eligible).toBe(false)
  })

  it('minimum_payer scores 95 on credit with utilizationRate 0.97', () => {
    const ranked = rankPersonalities(makeSignals({ statementType: 'credit', utilizationRate: 0.97 }))
    const mp = ranked.find(r => r.meta.id === 'minimum_payer')
    expect(mp!.eligible).toBe(true)
    expect(mp!.score).toBe(95)
  })
})

describe('scoring — wire_dancer', () => {
  it('surplus 1.5% → score 95', () => {
    const ranked = rankPersonalities(makeSignals({
      income: 4000, net: 60, spending: 3940, spendRatio: 0.985,
      statementType: 'unknown',
    }))
    const wd = ranked.find(r => r.meta.id === 'wire_dancer')
    expect(wd!.score).toBe(95)
  })
})

describe('computeSignals() integration', () => {
  it('category masterKey flows through to trait scoring', () => {
    const signals = computeSignals({
      income: 4000, spending: 3200, net: 800,
      categories: [
        { name: 'Transport', pctOfSpending: 45, masterKey: 'TRANSPORT' },
        { name: 'Food & Dining', pctOfSpending: 20, masterKey: 'FOOD' },
      ],
      subCount: 0, anomalyCount: 0, statementType: 'unknown',
    })
    expect(signals.topDiscretionaryCatMaster).toBe('TRANSPORT')
    // categoryPct is now rescaled to discretionary total (TRANSPORT 45 + FOOD 20 = 65)
    expect(signals.categoryPct['TRANSPORT']).toBeCloseTo(69.2, 0)
    const results = detectPersonality(signals)
    // currency_combustion should be visible in the top 5
    const top5 = results.rankedPersonalities.slice(0, 5).map(r => r.meta.id)
    expect(top5).toContain('currency_combustion')
  })
})

// ─── isIncomeCategory() ───────────────────────────────────────────────────────

describe('isIncomeCategory()', () => {
  it('returns true for "Income" regardless of any debit transactions', () => {
    expect(isIncomeCategory('Income')).toBe(true)
    expect(isIncomeCategory('income')).toBe(true)
  })

  it('returns true for salary/paycheck names', () => {
    expect(isIncomeCategory('Salary')).toBe(true)
    expect(isIncomeCategory('Paycheck')).toBe(true)
  })

  it('returns false for normal spending categories', () => {
    expect(isIncomeCategory('Transport')).toBe(false)
    expect(isIncomeCategory('Coffee')).toBe(false)
    expect(isIncomeCategory('Credit Card')).toBe(false)
  })
})

// ─── resolveMasterKey() ───────────────────────────────────────────────────────

describe('resolveMasterKey()', () => {
  it('DB value wins over everything', () => {
    expect(resolveMasterKey('TRANSPORT', 'Coffee')).toBe('TRANSPORT')
  })

  it('exact system name resolves when DB is null', () => {
    expect(resolveMasterKey(null, 'Transport')).toBe('TRANSPORT')
    expect(resolveMasterKey(null, 'Food & Dining')).toBe('FOOD')
    expect(resolveMasterKey(null, 'Credit Card Payment')).toBe('FINANCIAL')
  })

  it('known null categories return null (not fuzzied)', () => {
    expect(resolveMasterKey(null, 'Income')).toBeNull()
    expect(resolveMasterKey(null, 'Transfer')).toBeNull()
    expect(resolveMasterKey(null, 'Other')).toBeNull()
  })

  it('fuzzy typo mapping: Coffe → COFFEE', () => {
    expect(resolveMasterKey(null, 'Coffe')).toBe('COFFEE')
  })

  it('fuzzy match: "Gas Station" → TRANSPORT', () => {
    expect(resolveMasterKey(null, 'Gas Station')).toBe('TRANSPORT')
  })
})

// ─── categoryPct — discretionary accumulation ─────────────────────────────────

describe('computeSignals() categoryPct', () => {
  it('excludes HOME and FINANCIAL from categoryPct', () => {
    const signals = computeSignals({
      income: 5000, spending: 4000, net: 1000,
      categories: [
        { name: 'Housing',   pctOfSpending: 50, masterKey: 'HOME'      },
        { name: 'Transport', pctOfSpending: 30, masterKey: 'TRANSPORT' },
        { name: 'Food & Dining', pctOfSpending: 20, masterKey: 'FOOD'  },
      ],
      subCount: 0, anomalyCount: 0, statementType: 'unknown',
    })
    expect(signals.categoryPct['HOME']).toBeUndefined()
    expect(signals.categoryPct['FINANCIAL']).toBeUndefined()
    // TRANSPORT and FOOD share the discretionary total (30+20=50)
    expect(signals.categoryPct['TRANSPORT']).toBeCloseTo(60) // 30/50*100
    expect(signals.categoryPct['FOOD']).toBeCloseTo(40)     // 20/50*100
  })

  it('sums duplicate master keys (e.g. two coffee categories)', () => {
    const signals = computeSignals({
      income: 3000, spending: 2000, net: 1000,
      categories: [
        { name: 'Coffee',   pctOfSpending: 15, masterKey: 'COFFEE' },
        { name: 'Coffe',    pctOfSpending: 10, masterKey: null },  // typo — resolves via fuzzy
        { name: 'Transport', pctOfSpending: 75, masterKey: 'TRANSPORT' },
      ],
      subCount: 0, anomalyCount: 0, statementType: 'unknown',
    })
    // COFFEE should be ~25% of total raw → in discretionary it's 25/100*100=25%
    expect(signals.categoryPct['COFFEE']).toBeCloseTo(25)
  })

  it('unresolved categories are listed in unresolvedCategories', () => {
    const signals = computeSignals({
      income: 3000, spending: 2000, net: 1000,
      categories: [
        { name: 'Mystery Category', pctOfSpending: 100, masterKey: null },
      ],
      subCount: 0, anomalyCount: 0, statementType: 'unknown',
    })
    expect(signals.unresolvedCategories).toContain('Mystery Category')
  })
})

// ─── big_ticket_player guards ─────────────────────────────────────────────────

describe('big_ticket_player scoring guards', () => {
  it('does not fire when topCatMaster is null (Income/Uncategorized)', () => {
    const ranked = rankPersonalities(makeSignals({
      topCatPct: 100, topCatMaster: null,
      topDiscretionaryCatMaster: null,
      categoryPct: {},
    }))
    const btp = ranked.find(r => r.meta.id === 'big_ticket_player')
    expect(btp!.score).toBe(0)
  })

  it('does not fire when topCatMaster is HOME (rent dominating)', () => {
    const ranked = rankPersonalities(makeSignals({
      topCatPct: 75, topCatMaster: 'HOME',
      topDiscretionaryCatMaster: null,
      categoryPct: {},
    }))
    const btp = ranked.find(r => r.meta.id === 'big_ticket_player')
    expect(btp!.score).toBe(0)
  })

  it('fires normally when topCatMaster is a valid discretionary key', () => {
    const ranked = rankPersonalities(makeSignals({
      topCatPct: 75, topCatMaster: 'TRANSPORT',
      topDiscretionaryCatMaster: 'TRANSPORT',
      categoryPct: { TRANSPORT: 75 },
    }))
    const btp = ranked.find(r => r.meta.id === 'big_ticket_player')
    expect(btp!.score).toBe(95)
  })
})
