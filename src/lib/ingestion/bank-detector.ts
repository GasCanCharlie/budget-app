/**
 * Bank Detector — matches upload column headers to known bank profiles.
 *
 * Each bank profile specifies:
 *  - headerPatterns: strings that MUST appear (case-insensitive) in the headers
 *  - defaultDateOrder: what date format this bank uses (MDY for US, DMY for EU)
 *  - authoritativeDateColumn: 'posting' or 'effective'
 *  - detectionConfidence: High | Medium | Low
 */

import type { BankProfile, BankDetectionResult } from '@/types/ingestion'
import type { ColumnMapping } from '@/types/ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// Bank profile registry
// Add new banks here. Each profile is tried in order; first full match wins.
// ─────────────────────────────────────────────────────────────────────────────

const BANK_PROFILES: BankProfile[] = [
  {
    bankKey: 'chase_checking_v1',
    bankDisplayName: 'Chase',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['transaction date', 'description', 'category', 'type', 'amount', 'balance'],
  },
  {
    bankKey: 'chase_credit_v1',
    bankDisplayName: 'Chase Credit',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['transaction date', 'post date', 'description', 'category', 'type', 'amount'],
  },
  {
    bankKey: 'bofa_checking_v1',
    bankDisplayName: 'Bank of America',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'description', 'amount', 'running bal.'],
  },
  {
    bankKey: 'capital_one_v1',
    bankDisplayName: 'Capital One',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['transaction date', 'posted date', 'card no.', 'description', 'category', 'debit', 'credit'],
  },
  {
    bankKey: 'discover_v1',
    bankDisplayName: 'Discover',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['trans. date', 'post date', 'description', 'amount', 'category'],
  },
  {
    bankKey: 'citi_v1',
    bankDisplayName: 'Citibank',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['status', 'date', 'description', 'debit', 'credit'],
  },
  {
    bankKey: 'wells_fargo_v1',
    bankDisplayName: 'Wells Fargo',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'amount', 'asterisk', 'check', 'description'],
  },
  {
    bankKey: 'amex_v1',
    bankDisplayName: 'American Express',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'description', 'amount', 'extended details', 'appears on your statement as'],
  },
  {
    bankKey: 'usaa_v1',
    bankDisplayName: 'USAA',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'description', 'original description', 'category', 'amount', 'status'],
  },
  {
    bankKey: 'ally_v1',
    bankDisplayName: 'Ally Bank',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'effective',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'time', 'amount', 'type', 'description', 'balance'],
  },
  {
    bankKey: 'pnc_v1',
    bankDisplayName: 'PNC Bank',
    defaultDateOrder: 'MDY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'description', 'withdrawals', 'deposits', 'balance'],
  },
  // European / Australian banks (DMY order)
  {
    bankKey: 'barclays_v1',
    bankDisplayName: 'Barclays',
    defaultDateOrder: 'DMY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'merchant name', 'amount', 'closing balance'],
  },
  {
    bankKey: 'hsbc_uk_v1',
    bankDisplayName: 'HSBC UK',
    defaultDateOrder: 'DMY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'description', 'paid in', 'paid out', 'balance'],
  },
  {
    bankKey: 'commonwealth_au_v1',
    bankDisplayName: 'Commonwealth Bank (AU)',
    defaultDateOrder: 'DMY',
    authoritativeDateColumn: 'posting',
    detectionConfidence: 'High',
    headerPatterns: ['date', 'description', 'debit', 'credit', 'balance'],
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Detection logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect which bank profile (if any) matches the given column headers.
 *
 * Algorithm:
 *  1. Normalise all headers to lowercase.
 *  2. For each bank profile in BANK_PROFILES (first match wins):
 *     - Count how many headerPatterns are present in the normalised headers.
 *     - If ALL patterns match → return that profile as a High-confidence match.
 *     - If ≥ 60% of patterns match → record as a partial (Medium) match.
 *  3. If no High match, return the best partial match as Medium confidence.
 *  4. If no match at all, return { matched: false, bankProfile: null, detectionConfidence: 'Low' }.
 *
 * @param headers  Raw column header strings from the CSV (from Stage 1 headerDetection.columns)
 * @param mapping  Column mapping (not used in matching but available for future use)
 */
export function detectBank(headers: string[], _mapping: ColumnMapping): BankDetectionResult {
  const normalised = headers.map((h) => h.trim().toLowerCase())

  let bestPartial: { profile: BankProfile; matchCount: number } | null = null

  for (const profile of BANK_PROFILES) {
    const patterns = profile.headerPatterns.map((p) => p.toLowerCase())
    const matchCount = patterns.filter((p) => normalised.some((h) => h.includes(p))).length
    const matchRatio = matchCount / patterns.length

    if (matchRatio === 1) {
      // Full match — High confidence
      return {
        bankProfile: profile,
        matched: true,
        matchedPatterns: patterns.filter((p) => normalised.some((h) => h.includes(p))),
        detectionConfidence: 'High',
      }
    }

    if (matchRatio >= 0.6) {
      // Partial match candidate
      if (!bestPartial || matchCount > bestPartial.matchCount) {
        bestPartial = { profile, matchCount }
      }
    }
  }

  if (bestPartial) {
    const { profile, matchCount } = bestPartial
    const patterns = profile.headerPatterns.map((p) => p.toLowerCase())
    return {
      bankProfile: { ...profile, detectionConfidence: 'Medium' },
      matched: true,
      matchedPatterns: patterns.filter((p) => normalised.some((h) => h.includes(p))),
      detectionConfidence: 'Medium',
    }
  }

  return {
    bankProfile: null,
    matched: false,
    matchedPatterns: [],
    detectionConfidence: 'Low',
  }
}
