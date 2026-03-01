/**
 * Date-order scoring — chooses MDY vs DMY for an upload.
 *
 * Pipeline:
 *  1. Bank detection (if High confidence) → use bank default unless scoring says otherwise
 *  2. Score both MDY and DMY against the ambiguous dates
 *  3. Pick the order with the lowest total score
 *  4. If scores are tied (or no ambiguous dates), and bank default is available → use bank default
 *  5. If scores are close (delta < CONFIDENCE_THRESHOLD) and no bank default → needsUserConfirmation = true
 */

import type {
  DateOrder,
  DateOrderScore,
  DateOrderSelectionResult,
  BankDetectionResult,
} from '@/types/ingestion'

// Score difference below this triggers user confirmation
const CONFIDENCE_THRESHOLD = 10

// ─────────────────────────────────────────────────────────────────────────────
// Internal date parsing (no-dependency, minimal)
// ─────────────────────────────────────────────────────────────────────────────

/** Pattern for ambiguous numeric dates: D{1,2}/D{1,2}/YYYY (separator: / - .) */
const AMBIG_RE = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/

/**
 * Try to build a UTC Date from year/month/day.
 * Returns null if the calendar date is invalid (e.g. Feb 30, month 13).
 */
function tryParseDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  return d
}

/**
 * Given an ambiguous date string and a desired order, return the parsed Date or null.
 * Non-ambiguous dates (ISO, month-name, YYYYMMDD) are skipped (return null).
 *
 * MDY: first component = month, second = day
 * DMY: first component = day,   second = month
 */
function parseAmbigWithOrder(raw: string, order: 'MDY' | 'DMY'): Date | null {
  const trimmed = raw.trim()
  const m = trimmed.match(AMBIG_RE)
  if (!m) return null // not an ambiguous date

  const aNum = +m[1]
  const bNum = +m[2]
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3]

  if (order === 'MDY') {
    return tryParseDate(year, aNum, bNum)
  } else {
    return tryParseDate(year, bNum, aNum)
  }
}

/**
 * Determine if a raw date string is ambiguous (both MDY and DMY interpretations
 * produce valid, different calendar dates).
 */
function isAmbiguous(raw: string): boolean {
  const trimmed = raw.trim()
  const m = trimmed.match(AMBIG_RE)
  if (!m) return false

  const aNum = +m[1]
  const bNum = +m[2]
  // Same either way → not ambiguous
  if (aNum === bNum) return false
  const year = m[3].length === 2 ? 2000 + +m[3] : +m[3]

  const dMDY = tryParseDate(year, aNum, bNum)
  const dDMY = tryParseDate(year, bNum, aNum)
  return dMDY !== null && dDMY !== null
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring row interface
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal row data needed for scoring */
export interface ScoringRow {
  /** Raw date string from the CSV */
  rawDate: string
  /** 0-based position in the file */
  parseOrder: number
}

// ─────────────────────────────────────────────────────────────────────────────
// scoreOrder — compute total penalty for a given order against ambiguous dates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score how well `order` (MDY or DMY) fits the numeric dates in `rows`.
 *
 * All D{1,2}/D{1,2}/YYYY numeric-pattern dates participate in scoring — both
 * ambiguous dates (both interpretations valid) and unambiguous ones (e.g.
 * 31/01/2026 which can only be DD/MM). Non-numeric dates (ISO, month-name,
 * YYYYMMDD) are skipped as they parse unambiguously regardless of order.
 *
 * Scoring components:
 *  - invalidDateCount  (weight 1000): numeric dates that fail to parse with this order
 *  - monotonicityPenalty (weight 1): backward jumps between adjacent parsed dates (by parseOrder)
 *
 * Lower score = better fit.
 */
export function scoreOrder(rows: ScoringRow[], order: 'MDY' | 'DMY'): DateOrderScore {
  // Include ALL rows matching the numeric D/D/YYYY pattern — unambiguous dates
  // (e.g. 31/01/2026 where month=31 is impossible) are the strongest signal.
  const numericRows = rows.filter((r) => AMBIG_RE.test(r.rawDate.trim()))

  let invalidDateCount = 0
  const parsedPairs: Array<{ parseOrder: number; date: Date }> = []

  for (const row of numericRows) {
    const d = parseAmbigWithOrder(row.rawDate, order)
    if (!d) {
      invalidDateCount++
    } else {
      parsedPairs.push({ parseOrder: row.parseOrder, date: d })
    }
  }

  // Sort by parseOrder to check monotonicity
  parsedPairs.sort((a, b) => a.parseOrder - b.parseOrder)

  // Count backward jumps between consecutive parsed ambiguous dates
  let monotonicityPenalty = 0
  for (let i = 1; i < parsedPairs.length; i++) {
    if (parsedPairs[i].date.getTime() < parsedPairs[i - 1].date.getTime()) {
      monotonicityPenalty++
    }
  }

  const totalScore = invalidDateCount * 1000 + monotonicityPenalty

  return { order, invalidDateCount, monotonicityPenalty, totalScore }
}

// ─────────────────────────────────────────────────────────────────────────────
// selectDateOrder — main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Select the best date order for an upload.
 *
 * Decision tree:
 *  1. Count genuinely ambiguous dates in `rows`.
 *  2. If zero ambiguous dates → no scoring needed. Use bank default if available, else MDY.
 *  3. If bank confidence is 'High':
 *     a. Score the bank's defaultDateOrder.
 *     b. If invalidDateCount === 0 for the bank's order → use bank_default, confidence=95.
 *     c. Otherwise fall through to scoring.
 *  4. Score both MDY and DMY.
 *  5. If one score is strictly lower → auto_scored (confidence proportional to gap).
 *  6. If scores are equal or gap < CONFIDENCE_THRESHOLD:
 *     - If bank result is available → use bank default.
 *     - Else → needsUserConfirmation = true, selectedOrder = MDY (best-effort default).
 *
 * @param rows         Array of scoring rows (rawDate + parseOrder) for this upload
 * @param bankResult   Result from detectBank(); null if bank detection was not run
 * @param ambiguousDateCount  Pre-computed count of ambiguous dates (optional optimisation;
 *                            pass -1 to let this function compute it)
 */
export function selectDateOrder(
  rows: ScoringRow[],
  bankResult: BankDetectionResult | null,
  ambiguousDateCount = -1,
): DateOrderSelectionResult {
  // Count ambiguous dates if not pre-supplied
  const ambigCount = ambiguousDateCount >= 0
    ? ambiguousDateCount
    : rows.filter((r) => isAmbiguous(r.rawDate)).length

  // ── Case 1: No ambiguous dates — no scoring needed ───────────────────────
  if (ambigCount === 0) {
    const bankOrder = bankResult?.bankProfile?.defaultDateOrder ?? 'MDY'
    return {
      selectedOrder: bankOrder,
      source: bankResult?.matched ? 'bank_default' : 'auto_scored',
      confidence: bankResult?.matched ? 95 : 70,
      needsUserConfirmation: false,
      bankResult: bankResult ?? undefined,
    }
  }

  // ── Case 2: High-confidence bank match — trust it if it produces no invalids ─
  if (bankResult?.detectionConfidence === 'High' && bankResult.bankProfile) {
    const bankOrder = bankResult.bankProfile.defaultDateOrder
    if (bankOrder === 'YMD') {
      // YMD is unambiguous — no scoring needed
      return {
        selectedOrder: 'YMD',
        source: 'bank_default',
        confidence: 99,
        needsUserConfirmation: false,
        bankResult,
      }
    }
    const bankScore = scoreOrder(rows, bankOrder as 'MDY' | 'DMY')
    if (bankScore.invalidDateCount === 0) {
      // Bank default fits perfectly → use it
      return {
        selectedOrder: bankOrder,
        source: 'bank_default',
        confidence: 95,
        needsUserConfirmation: false,
        scoreA: bankOrder === 'MDY' ? bankScore : undefined,
        scoreB: bankOrder === 'DMY' ? bankScore : undefined,
        bankResult,
      }
    }
    // Bank default has invalid dates → fall through to full scoring
  }

  // ── Case 3: Score both orders ─────────────────────────────────────────────
  const scoreA = scoreOrder(rows, 'MDY')
  const scoreB = scoreOrder(rows, 'DMY')
  const delta  = Math.abs(scoreA.totalScore - scoreB.totalScore)

  if (scoreA.totalScore < scoreB.totalScore && delta >= CONFIDENCE_THRESHOLD) {
    // MDY wins clearly
    const confidence = Math.min(99, Math.round((delta / Math.max(1, scoreA.totalScore + scoreB.totalScore)) * 100 + 50))
    return {
      selectedOrder: 'MDY',
      source: 'auto_scored',
      confidence,
      needsUserConfirmation: false,
      scoreA,
      scoreB,
      bankResult: bankResult ?? undefined,
    }
  }

  if (scoreB.totalScore < scoreA.totalScore && delta >= CONFIDENCE_THRESHOLD) {
    // DMY wins clearly
    const confidence = Math.min(99, Math.round((delta / Math.max(1, scoreA.totalScore + scoreB.totalScore)) * 100 + 50))
    return {
      selectedOrder: 'DMY',
      source: 'auto_scored',
      confidence,
      needsUserConfirmation: false,
      scoreA,
      scoreB,
      bankResult: bankResult ?? undefined,
    }
  }

  // ── Scores are too close — check bank default as tiebreaker ───────────────
  if (bankResult?.matched && bankResult.bankProfile) {
    const bankOrder = bankResult.bankProfile.defaultDateOrder
    if (bankOrder !== 'YMD') {
      return {
        selectedOrder: bankOrder as 'MDY' | 'DMY',
        source: 'bank_default',
        confidence: 60, // low confidence — scores were close
        needsUserConfirmation: false,
        scoreA,
        scoreB,
        bankResult,
      }
    }
  }

  // ── No clear winner, no bank default — ask the user ──────────────────────
  return {
    selectedOrder: 'MDY', // best-effort default (US bias)
    source: 'auto_scored',
    confidence: 0,
    needsUserConfirmation: true,
    scoreA,
    scoreB,
    bankResult: bankResult ?? undefined,
  }
}
