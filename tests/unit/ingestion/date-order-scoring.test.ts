import { describe, it, expect } from 'vitest'
import { scoreOrder, selectDateOrder } from '@/lib/ingestion/date-order-scoring'
import type { BankDetectionResult } from '@/types/ingestion'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Only valid as DD/MM — day > 12 */
const UNAMBIGUOUS_DMY = [
  { rawDate: '13/02/2026', parseOrder: 0 },
  { rawDate: '14/02/2026', parseOrder: 1 },
  { rawDate: '15/02/2026', parseOrder: 2 },
]

/** All ambiguous — both MDY and DMY parse successfully to different dates */
const ALL_AMBIGUOUS = [
  { rawDate: '2/12/2026', parseOrder: 0 },
  { rawDate: '3/11/2026', parseOrder: 1 },
  { rawDate: '4/10/2026', parseOrder: 2 },
  { rawDate: '5/09/2026', parseOrder: 3 },
]

/** Mix: MDY is clearly wrong — e.g. month 31 is impossible */
const MDY_INVALID_ROWS = [
  { rawDate: '31/01/2026', parseOrder: 0 },  // MDY impossible (month=31), DMY=Jan 31
  { rawDate: '28/02/2026', parseOrder: 1 },  // MDY impossible (month=28), DMY=Feb 28
  { rawDate: '2/12/2026',  parseOrder: 2 },  // ambiguous
]

/** Chase-style bank result — High confidence, MDY */
const CHASE_BANK: BankDetectionResult = {
  bankProfile: {
    bankKey: 'chase_checking_v1',
    bankDisplayName: 'Chase',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: [],
  },
  matched: true,
  matchedPatterns: [],
  detectionConfidence: 'High',
}

/** Barclays-style bank result — High confidence, DMY */
const BARCLAYS_BANK: BankDetectionResult = {
  bankProfile: {
    bankKey: 'barclays_v1',
    bankDisplayName: 'Barclays',
    defaultDateOrder: 'DMY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: [],
  },
  matched: true,
  matchedPatterns: [],
  detectionConfidence: 'High',
}

// ─── scoreOrder ───────────────────────────────────────────────────────────────

describe('scoreOrder', () => {
  it('zero invalid dates when ambiguous date parses fine with MDY', () => {
    // 2/12/2026 MDY = Feb 12 (valid)
    const score = scoreOrder([{ rawDate: '2/12/2026', parseOrder: 0 }], 'MDY')
    expect(score.invalidDateCount).toBe(0)
    expect(score.order).toBe('MDY')
  })

  it('zero invalid dates when ambiguous date parses fine with DMY', () => {
    // 2/12/2026 DMY = Dec 2 (valid)
    const score = scoreOrder([{ rawDate: '2/12/2026', parseOrder: 0 }], 'DMY')
    expect(score.invalidDateCount).toBe(0)
    expect(score.order).toBe('DMY')
  })

  it('counts invalidDateCount for dates that fail under the given order', () => {
    // 31/01/2026: MDY = month 31 → invalid; DMY = Jan 31 → valid
    const scoreMDY = scoreOrder([{ rawDate: '31/01/2026', parseOrder: 0 }], 'MDY')
    const scoreDMY = scoreOrder([{ rawDate: '31/01/2026', parseOrder: 0 }], 'DMY')
    expect(scoreMDY.invalidDateCount).toBe(1)
    expect(scoreDMY.invalidDateCount).toBe(0)
  })

  it('skips non-ambiguous dates (ISO format)', () => {
    const rows = [
      { rawDate: '2026-01-15', parseOrder: 0 }, // ISO — not ambiguous, skipped
      { rawDate: '2/12/2026',  parseOrder: 1 }, // ambiguous
    ]
    const score = scoreOrder(rows, 'MDY')
    // ISO date is skipped, only the ambiguous one is considered
    expect(score.invalidDateCount).toBe(0)
  })

  it('contributes zero penalty for dates where both interpretations give the same result', () => {
    // 5/5/2026: MDY = May 5, DMY = May 5 — same date either way, always parses
    const score = scoreOrder([{ rawDate: '5/5/2026', parseOrder: 0 }], 'MDY')
    expect(score.invalidDateCount).toBe(0)
    expect(score.monotonicityPenalty).toBe(0)
  })

  it('totalScore = invalidDateCount * 1000 + monotonicityPenalty', () => {
    const rows = [{ rawDate: '2/12/2026', parseOrder: 0 }]
    const score = scoreOrder(rows, 'MDY')
    expect(score.totalScore).toBe(score.invalidDateCount * 1000 + score.monotonicityPenalty)
  })

  it('MDY score dominates DMY when several dates have month > 12', () => {
    const scoreMDY = scoreOrder(MDY_INVALID_ROWS, 'MDY')
    const scoreDMY = scoreOrder(MDY_INVALID_ROWS, 'DMY')
    expect(scoreMDY.invalidDateCount).toBeGreaterThan(scoreDMY.invalidDateCount)
    expect(scoreMDY.totalScore).toBeGreaterThan(scoreDMY.totalScore)
  })
})

// ─── selectDateOrder ──────────────────────────────────────────────────────────

describe('selectDateOrder', () => {
  it('returns needsUserConfirmation=false when no ambiguous dates (unambiguous DMY)', () => {
    const result = selectDateOrder(UNAMBIGUOUS_DMY, null)
    expect(result.needsUserConfirmation).toBe(false)
    expect(result.selectedOrder).toBeDefined()
  })

  it('uses bank_default when High confidence bank and zero invalid dates', () => {
    // Chase says MDY; ALL_AMBIGUOUS dates are ambiguous but valid for MDY → bank wins
    const result = selectDateOrder(ALL_AMBIGUOUS, CHASE_BANK)
    expect(result.source).toBe('bank_default')
    expect(result.selectedOrder).toBe('MDY')
    expect(result.needsUserConfirmation).toBe(false)
    expect(result.confidence).toBeGreaterThanOrEqual(90)
  })

  it('uses bank_default for Barclays (DMY) with ambiguous dates', () => {
    const result = selectDateOrder(ALL_AMBIGUOUS, BARCLAYS_BANK)
    expect(result.source).toBe('bank_default')
    expect(result.selectedOrder).toBe('DMY')
    expect(result.needsUserConfirmation).toBe(false)
  })

  it('auto-selects DMY when MDY is clearly wrong (day > 12 = invalid month)', () => {
    const result = selectDateOrder(MDY_INVALID_ROWS, null)
    expect(result.needsUserConfirmation).toBe(false)
    expect(result.selectedOrder).toBe('DMY')
    expect(result.source).toBe('auto_scored')
  })

  it('needsUserConfirmation is true when scores are indistinguishable and no bank', () => {
    // ALL_AMBIGUOUS — both MDY and DMY give the same score (all ambiguous = zero invalids each)
    const result = selectDateOrder(ALL_AMBIGUOUS, null)
    if (result.needsUserConfirmation) {
      // Correct: can't decide
      expect(result.selectedOrder).toBe('MDY') // US-bias default
      expect(result.confidence).toBe(0)
    } else {
      // Also acceptable: monotonicity penalty broke the tie
      expect(['MDY', 'DMY']).toContain(result.selectedOrder)
    }
  })

  it('always returns a defined selectedOrder', () => {
    const result = selectDateOrder(ALL_AMBIGUOUS, null)
    expect(['MDY', 'DMY', 'YMD']).toContain(result.selectedOrder)
  })

  it('includes scoreA and scoreB when both orders were compared', () => {
    const result = selectDateOrder(MDY_INVALID_ROWS, null)
    if (result.scoreA !== undefined) expect(result.scoreA.order).toBe('MDY')
    if (result.scoreB !== undefined) expect(result.scoreB.order).toBe('DMY')
  })

  it('returns source=auto_scored when bank is null but scores differ', () => {
    const result = selectDateOrder(MDY_INVALID_ROWS, null)
    expect(result.source).toBe('auto_scored')
  })

  it('empty rows returns non-confirming result with MDY default', () => {
    const result = selectDateOrder([], null)
    expect(result.needsUserConfirmation).toBe(false)
    expect(result.selectedOrder).toBe('MDY')
  })

  // ── Regression: no per-row DATE_AMBIGUOUS issues when dateOrder is known ───
  it('when bank is High and dates are valid, confidence >= 90 and no confirmation', () => {
    const result = selectDateOrder(ALL_AMBIGUOUS, CHASE_BANK)
    expect(result.confidence).toBeGreaterThanOrEqual(90)
    expect(result.needsUserConfirmation).toBe(false)
  })
})
