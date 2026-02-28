/**
 * Stage 2 — Normalize unit tests
 *
 * Tests normalizeRow, normalizeDate, and normalizeAmount in isolation.
 * No DB access. No mocks needed — all functions are pure.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { normalizeRow, normalizeDate, normalizeAmount } from '@/lib/ingestion/stage2-normalize'
import type { RawParsedRow, ColumnMapping, CsvXlsxSourceLocator } from '@/types/ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

const baseLocator: CsvXlsxSourceLocator = {
  type: 'CSV',
  sheetName: null,
  rowIndex: 1,
  dataRowIndex: 0,
}

/** Build a minimal RawParsedRow with arbitrary fields. */
function makeRow(fields: Record<string, string>): RawParsedRow {
  return {
    sourceLocator: baseLocator,
    fields,
    rawLine: Object.values(fields).join(','),
    rowHash: 'abc123',
  }
}

/** Standard single-column mapping covering date, amount, and description. */
const stdMapping: ColumnMapping = {
  date: 'Date',
  amount: 'Amount',
  description: 'Description',
}

/** Build a standard row using stdMapping column names. */
function stdRow(date: string, amount: string, description = 'Test transaction'): RawParsedRow {
  return makeRow({ Date: date, Amount: amount, Description: description })
}

// ─────────────────────────────────────────────────────────────────────────────
// normalizeDate — date parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeDate', () => {
  it('parses standard MM/DD/YYYY date correctly', () => {
    // "03/15/2024" — month=3 > 12 is impossible for DD, so unambiguously MM/DD
    const result = normalizeDate('03/15/2024')
    expect(result.ambiguity).toBe('RESOLVED')
    expect(result.resolved).toBe('2024-03-15')
  })

  it('parses DD/MM/YYYY date correctly when only DD/MM interpretation is valid', () => {
    // "20/01/2024" — first part 20 > 12 so cannot be MM; forced to DD/MM
    const result = normalizeDate('20/01/2024')
    expect(result.ambiguity).toBe('RESOLVED')
    expect(result.resolved).toBe('2024-01-20')
  })

  it('detects ambiguous date where both MM/DD and DD/MM are valid', () => {
    // "04/05/2024" — could be Apr 5 (MM/DD) or May 4 (DD/MM); both valid
    const result = normalizeDate('04/05/2024')
    expect(result.ambiguity).toBe('AMBIGUOUS_MMDD_DDMM')
    expect(result.resolved).toBeNull()
    // interpretationA = MM/DD = Apr 5
    expect(result.interpretationA).toBe('2024-04-05')
    // interpretationB = DD/MM = May 4
    expect(result.interpretationB).toBe('2024-05-04')
  })

  it('parses ISO YYYY-MM-DD directly', () => {
    const result = normalizeDate('2024-11-28')
    expect(result.ambiguity).toBe('RESOLVED')
    expect(result.resolved).toBe('2024-11-28')
  })

  it('returns UNPARSEABLE for an empty string', () => {
    const result = normalizeDate('')
    expect(result.ambiguity).toBe('UNPARSEABLE')
    expect(result.resolved).toBeNull()
  })

  it('returns UNPARSEABLE for a non-date string', () => {
    const result = normalizeDate('not-a-date')
    expect(result.ambiguity).toBe('UNPARSEABLE')
    expect(result.resolved).toBeNull()
  })

  it('returns UNPARSEABLE for a date with an invalid month (month 13)', () => {
    // 13/14/2024 — month 13 and month 14 are both invalid
    const result = normalizeDate('13/14/2024')
    expect(result.ambiguity).toBe('UNPARSEABLE')
  })

  it('records a transformation step when a date is resolved', () => {
    const result = normalizeDate('2024-06-01', 'postedDate')
    expect(result.steps.length).toBeGreaterThan(0)
    expect(result.steps[0].field).toBe('postedDate')
    expect(result.steps[0].before).toBe('2024-06-01')
    expect(result.steps[0].after).toBe('2024-06-01')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// normalizeAmount — amount parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeAmount', () => {
  it('parses parenthetical negative (12.34) → -12.34', () => {
    const result = normalizeAmount('(12.34)')
    expect(result.value).toBe('-12.34')
    expect(result.currencyDetected).toBeNull()
  })

  it('strips dollar sign from $1234.56', () => {
    const result = normalizeAmount('$1,234.56')
    expect(result.value).toBe('1234.56')
    expect(result.currencyDetected).toBeNull() // $ does not set currencyDetected
  })

  it('strips pound sign and sets currency to GBP', () => {
    const result = normalizeAmount('£50.00')
    expect(result.value).toBe('50.00')
    expect(result.currencyDetected).toBe('GBP')
  })

  it('strips euro sign and sets currency to EUR', () => {
    const result = normalizeAmount('€99.99')
    expect(result.value).toBe('99.99')
    expect(result.currencyDetected).toBe('EUR')
  })

  it('handles European decimal format 1.234,56 → 1234.56', () => {
    const result = normalizeAmount('1.234,56')
    expect(result.value).toBe('1234.56')
  })

  it('handles simple European decimal 12,34 → 12.34', () => {
    const result = normalizeAmount('12,34')
    expect(result.value).toBe('12.34')
  })

  it('strips US thousands separator from 1,234.56 → 1234.56', () => {
    const result = normalizeAmount('1,234.56')
    expect(result.value).toBe('1234.56')
  })

  it('parses trailing minus 56.78- → -56.78', () => {
    const result = normalizeAmount('56.78-')
    expect(result.value).toBe('-56.78')
  })

  it('returns null value for unparseable amount', () => {
    const result = normalizeAmount('not-a-number')
    expect(result.value).toBeNull()
  })

  it('returns null value for empty string', () => {
    const result = normalizeAmount('')
    expect(result.value).toBeNull()
  })

  it('records a STRIP_CURRENCY_SYMBOL step when currency is stripped', () => {
    const result = normalizeAmount('£42.00')
    const step = result.steps.find((s) => s.rule === 'STRIP_CURRENCY_SYMBOL')
    expect(step).toBeDefined()
    expect(step!.before).toBe('£42.00')
    expect(step!.after).toBe('42.00')
  })

  it('records a PARSE_PARENTHETICAL_NEGATIVE step for parens notation', () => {
    const result = normalizeAmount('(99.00)')
    const step = result.steps.find((s) => s.rule === 'PARSE_PARENTHETICAL_NEGATIVE')
    expect(step).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// normalizeRow — full row normalization
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeRow', () => {
  // ── Date tests ──────────────────────────────────────────────────────────────

  it('produces VALID status for a clean MM/DD/YYYY row', () => {
    const row = stdRow('03/15/2024', '250.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.ingestionStatus).toBe('VALID')
    expect(result.postedDate?.resolved).toBe('2024-03-15')
    expect(result.amount.value).toBe('250.00')
  })

  it('produces VALID status for a clean DD/MM/YYYY row (day > 12)', () => {
    const row = stdRow('20/01/2024', '100.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.ingestionStatus).toBe('VALID')
    expect(result.postedDate?.resolved).toBe('2024-01-20')
  })

  it('produces UNRESOLVED status for an ambiguous date', () => {
    const row = stdRow('04/05/2024', '100.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.ingestionStatus).toBe('UNRESOLVED')
    const issue = result.issues.find((i) => i.issueType === 'DATE_AMBIGUOUS')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('ERROR')
  })

  it('produces REJECTED status for a missing date', () => {
    const row = stdRow('', '100.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.ingestionStatus).toBe('REJECTED')
    const issue = result.issues.find((i) => i.issueType === 'DATE_UNPARSEABLE')
    expect(issue).toBeDefined()
  })

  it('produces REJECTED status for an unparseable date string', () => {
    const row = stdRow('not-a-date', '100.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.ingestionStatus).toBe('REJECTED')
  })

  // ── Amount tests ─────────────────────────────────────────────────────────────

  it('parses parenthetical negative amount (12.34) → -12.34', () => {
    const row = stdRow('2024-01-15', '(12.34)')
    const result = normalizeRow(row, stdMapping)
    expect(result.amount.value).toBe('-12.34')
    expect(result.ingestionStatus).toBe('VALID')
  })

  it('parses debit/credit split columns — debit becomes negative', () => {
    const row = makeRow({
      Date: '2024-01-15',
      Debit: '75.00',
      Credit: '',
      Description: 'ATM withdrawal',
    })
    const mapping: ColumnMapping = {
      date: 'Date',
      debit: 'Debit',
      credit: 'Credit',
      description: 'Description',
    }
    const result = normalizeRow(row, mapping)
    expect(result.amount.value).toBe('-75.00')
    expect(result.ingestionStatus).toBe('VALID')
  })

  it('parses debit/credit split columns — credit becomes positive', () => {
    const row = makeRow({
      Date: '2024-01-16',
      Debit: '',
      Credit: '300.00',
      Description: 'Direct deposit',
    })
    const mapping: ColumnMapping = {
      date: 'Date',
      debit: 'Debit',
      credit: 'Credit',
      description: 'Description',
    }
    const result = normalizeRow(row, mapping)
    expect(result.amount.value).toBe('300.00')
    expect(result.ingestionStatus).toBe('VALID')
  })

  it('strips currency symbols from amount field', () => {
    const row = stdRow('2024-03-01', '$500.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.amount.value).toBe('500.00')
  })

  it('handles European decimal amount format 1.234,56 → 1234.56', () => {
    const row = stdRow('2024-03-01', '1.234,56')
    const result = normalizeRow(row, stdMapping)
    expect(result.amount.value).toBe('1234.56')
  })

  it('produces UNRESOLVED status when amount is unparseable', () => {
    const row = stdRow('2024-01-15', 'abc')
    const result = normalizeRow(row, stdMapping)
    expect(result.ingestionStatus).toBe('UNRESOLVED')
    const issue = result.issues.find((i) => i.issueType === 'AMOUNT_PARSE_FAIL')
    expect(issue).toBeDefined()
    expect(issue!.severity).toBe('ERROR')
  })

  it('produces UNRESOLVED status when amount field is empty with no debit/credit', () => {
    const row = stdRow('2024-01-15', '')
    const result = normalizeRow(row, stdMapping)
    expect(result.ingestionStatus).toBe('UNRESOLVED')
    const issue = result.issues.find((i) => i.issueType === 'AMOUNT_PARSE_FAIL')
    expect(issue).toBeDefined()
  })

  // ── Description tests ────────────────────────────────────────────────────────

  it('normalizes description by trimming leading and trailing whitespace', () => {
    const row = stdRow('2024-01-15', '10.00', '  grocery store  ')
    const result = normalizeRow(row, stdMapping)
    expect(result.descriptionNormalized).toBe('grocery store')
  })

  it('normalizes description by collapsing internal whitespace runs', () => {
    const row = stdRow('2024-01-15', '10.00', 'WHOLE   FOODS   MARKET')
    const result = normalizeRow(row, stdMapping)
    expect(result.descriptionNormalized).toBe('WHOLE FOODS MARKET')
  })

  it('preserves descriptionRaw unchanged while normalizing descriptionNormalized', () => {
    const raw = '  AMAZON   PRIME  '
    const row = stdRow('2024-01-15', '14.99', raw)
    const result = normalizeRow(row, stdMapping)
    expect(result.descriptionRaw).toBe(raw)
    expect(result.descriptionNormalized).toBe('AMAZON PRIME')
  })

  // ── allTransformations audit log ─────────────────────────────────────────────

  it('records transformation steps in allTransformations array', () => {
    // Using a $ amount ensures STRIP_CURRENCY_SYMBOL is logged
    const row = stdRow('03/15/2024', '$100.00', '  cafe  ')
    const result = normalizeRow(row, stdMapping)
    // Must have at least one step
    expect(result.allTransformations.length).toBeGreaterThan(0)
    // Every step must have the required fields
    for (const step of result.allTransformations) {
      expect(step).toHaveProperty('field')
      expect(step).toHaveProperty('rule')
      expect(step).toHaveProperty('before')
      expect(step).toHaveProperty('after')
      expect(step).toHaveProperty('timestamp')
    }
  })

  it('records a DATE_RESOLVED_MM_DD step for an unambiguous MM/DD date', () => {
    const row = stdRow('03/15/2024', '1.00')
    const result = normalizeRow(row, stdMapping)
    const step = result.allTransformations.find((s) => s.rule === 'DATE_RESOLVED_MM_DD')
    expect(step).toBeDefined()
  })

  it('records a STRIP_CURRENCY_SYMBOL step when a $ is stripped', () => {
    const row = stdRow('2024-01-01', '$9.99')
    const result = normalizeRow(row, stdMapping)
    const step = result.allTransformations.find((s) => s.rule === 'STRIP_CURRENCY_SYMBOL')
    expect(step).toBeDefined()
  })

  it('records a TRIM_WHITESPACE step when description has leading/trailing space', () => {
    const row = stdRow('2024-01-01', '1.00', '  padded  ')
    const result = normalizeRow(row, stdMapping)
    const step = result.allTransformations.find((s) => s.rule === 'TRIM_WHITESPACE')
    expect(step).toBeDefined()
  })

  // ── bankFingerprint ───────────────────────────────────────────────────────────

  it('produces a non-empty bankFingerprint hex string', () => {
    const row = stdRow('2024-01-15', '42.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.bankFingerprint).toMatch(/^[0-9a-f]{64}$/)
  })

  it('produces the same bankFingerprint for identical input (deterministic)', () => {
    const row1 = stdRow('2024-01-15', '42.00', 'STARBUCKS')
    const row2 = stdRow('2024-01-15', '42.00', 'STARBUCKS')
    const r1 = normalizeRow(row1, stdMapping)
    const r2 = normalizeRow(row2, stdMapping)
    expect(r1.bankFingerprint).toBe(r2.bankFingerprint)
  })

  it('produces different bankFingerprints for rows with different amounts', () => {
    const row1 = stdRow('2024-01-15', '10.00', 'STARBUCKS')
    const row2 = stdRow('2024-01-15', '20.00', 'STARBUCKS')
    const r1 = normalizeRow(row1, stdMapping)
    const r2 = normalizeRow(row2, stdMapping)
    expect(r1.bankFingerprint).not.toBe(r2.bankFingerprint)
  })

  // ── currencyCode ──────────────────────────────────────────────────────────────

  it('defaults currencyCode to USD when no currency symbol or column is present', () => {
    const row = stdRow('2024-01-15', '100.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.currencyCode).toBe('USD')
  })

  it('sets currencyCode to GBP when pound sign is detected', () => {
    const row = stdRow('2024-01-15', '£100.00')
    const result = normalizeRow(row, stdMapping)
    expect(result.currencyCode).toBe('GBP')
  })

  // ── parseOrder ────────────────────────────────────────────────────────────────

  it('sets parseOrder from sourceLocator.dataRowIndex', () => {
    const locator: CsvXlsxSourceLocator = { ...baseLocator, dataRowIndex: 7 }
    const row: RawParsedRow = {
      ...makeRow({ Date: '2024-01-15', Amount: '1.00', Description: 'test' }),
      sourceLocator: locator,
    }
    const result = normalizeRow(row, stdMapping)
    expect(result.parseOrder).toBe(7)
  })
})
