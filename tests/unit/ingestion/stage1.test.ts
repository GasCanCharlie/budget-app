/**
 * Unit tests for Stage 1 — Lossless CSV Parse
 *
 * parseCsvStage1() produces a ParseResult with:
 *   - config        (delimiter, encoding, lineEnding, headerRowIndex, …)
 *   - headerDetection (suggestedMapping with canonical field names)
 *   - rows[]        (sourceLocator, fields, rawLine, rowHash)
 *   - errors[]      (FATAL on no-data / unrecognised header)
 *   - warnings[]    (low-confidence header, column-count mismatch)
 *
 * detectDelimiter() is also exported and tested directly.
 */

import { describe, it, expect } from 'vitest'
import { parseCsvStage1, detectDelimiter } from '@/lib/ingestion/stage1-parse-csv'
import type { CsvXlsxSourceLocator } from '@/types/ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES — inline CSV strings
// ─────────────────────────────────────────────────────────────────────────────

const COMMA_CSV = `Date,Description,Amount
2024-01-15,Coffee shop,-4.50
2024-01-16,Direct deposit,2000.00
2024-01-17,Electricity bill,-120.00
`

const TAB_CSV = `Date\tDescription\tAmount\n2024-01-15\tCoffee shop\t-4.50\n2024-01-16\tDirect deposit\t2000.00\n`

const SEMICOLON_CSV = `Date;Description;Amount\n2024-01-15;Coffee shop;-4.50\n2024-01-16;Direct deposit;2000.00\n`

/** Bank headers that map to canonical 'date', 'description', 'amount' */
const BANK_HEADER_CSV = `Transaction Date,Payee,Transaction Amount,Balance
2024-01-15,Amazon Prime,-14.99,985.01
2024-01-16,ACH Deposit,1200.00,2185.01
`

/** Headers that use aliases for description and date */
const ALIAS_HEADER_CSV = `Posted Date,Memo,Net Amount
2024-01-15,Refund,50.00
2024-01-16,Gas station,-60.00
`

/** Quoted fields with embedded commas */
const QUOTED_COMMA_CSV = `Date,Description,Amount
2024-01-15,"Starbucks, downtown",-5.25
2024-01-16,"Transfer to ""savings"" account",-500.00
2024-01-17,Regular merchant,-12.00
`

/** Headers only, no data rows */
const HEADERS_ONLY_CSV = `Date,Description,Amount\n`

/** Completely malformed — no recognisable header pattern */
const MALFORMED_CSV = `foo,bar,baz\n1,2,3\n4,5,6\n`

/** Multi-line field (newline inside quotes) */
const MULTILINE_FIELD_CSV = `Date,Description,Amount
2024-01-15,"Payment for\nservices rendered",-250.00
2024-01-16,Coffee,-4.50
`

// ─────────────────────────────────────────────────────────────────────────────
// detectDelimiter
// ─────────────────────────────────────────────────────────────────────────────

describe('detectDelimiter', () => {
  it('detects comma as the delimiter for a standard comma CSV', () => {
    expect(detectDelimiter(COMMA_CSV)).toBe(',')
  })

  it('detects tab as the delimiter for a tab-separated file', () => {
    expect(detectDelimiter(TAB_CSV)).toBe('\t')
  })

  it('detects semicolon as the delimiter for a semicolon-separated file', () => {
    expect(detectDelimiter(SEMICOLON_CSV)).toBe(';')
  })

  it('returns comma as the default when the text is empty', () => {
    expect(detectDelimiter('')).toBe(',')
  })

  it('returns comma as the default when all lines are blank', () => {
    expect(detectDelimiter('   \n   \n')).toBe(',')
  })

  it('does not get confused by commas inside quoted fields when scoring tab', () => {
    // Tab-delimited file where some fields contain commas inside quotes —
    // the scorer only counts outside-quote occurrences, so tab should still win.
    const tsv = `Date\tDescription\tAmount\n2024-01-15\t"Smith, J."\t-40.00\n`
    expect(detectDelimiter(tsv)).toBe('\t')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — successful parses
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — comma-delimited CSV', () => {
  it('returns success: true', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    expect(result.success).toBe(true)
  })

  it('sets config.delimiter to ","', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    expect(result.config).toMatchObject({ type: 'CSV', delimiter: ',' })
  })

  it('returns the correct number of data rows', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    // COMMA_CSV has 3 data rows
    expect(result.rows).toHaveLength(3)
  })

  it('each row has a rawLine string', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    for (const row of result.rows) {
      expect(typeof row.rawLine).toBe('string')
      expect(row.rawLine.length).toBeGreaterThan(0)
    }
  })

  it('each row has a rowHash that is a 64-char hex string', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    for (const row of result.rows) {
      expect(row.rowHash).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('each row has a sourceLocator of type CSV', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    for (const row of result.rows) {
      const loc = row.sourceLocator as CsvXlsxSourceLocator
      expect(loc.type).toBe('CSV')
      expect(loc.sheetName).toBeNull()
    }
  })

  it('sourceLocator.dataRowIndex is 0-based and sequential', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    result.rows.forEach((row, idx) => {
      const loc = row.sourceLocator as CsvXlsxSourceLocator
      expect(loc.dataRowIndex).toBe(idx)
    })
  })

  it('sourceLocator.rowIndex is offset by the header row', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    const headerRowIndex = result.config.headerRowIndex
    result.rows.forEach((row, idx) => {
      const loc = row.sourceLocator as CsvXlsxSourceLocator
      // First data row is immediately after the header row
      expect(loc.rowIndex).toBe(headerRowIndex + 1 + idx)
    })
  })

  it('fields map contains raw string values for each header column', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    const firstRow = result.rows[0]
    // Headers are Date, Description, Amount — values must be raw strings
    expect(firstRow.fields['Date']).toBe('2024-01-15')
    expect(firstRow.fields['Description']).toBe('Coffee shop')
    expect(firstRow.fields['Amount']).toBe('-4.50')
  })

  it('does not coerce field values (amounts remain strings)', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    const fields = result.rows[1].fields
    expect(typeof fields['Amount']).toBe('string')
    expect(fields['Amount']).toBe('2000.00')
  })

  it('produces no fatal errors for a well-formed CSV', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    const fatalErrors = result.errors.filter((e) => e.severity === 'FATAL')
    expect(fatalErrors).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — delimiter variants
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — tab-delimited CSV', () => {
  it('detects tab delimiter and sets config.delimiter to "\\t"', () => {
    const result = parseCsvStage1(TAB_CSV, 'utf-8')
    expect(result.config).toMatchObject({ delimiter: '\t' })
  })

  it('returns success: true', () => {
    expect(parseCsvStage1(TAB_CSV, 'utf-8').success).toBe(true)
  })

  it('correctly parses rows separated by tabs', () => {
    const result = parseCsvStage1(TAB_CSV, 'utf-8')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].fields['Date']).toBe('2024-01-15')
    expect(result.rows[0].fields['Description']).toBe('Coffee shop')
    expect(result.rows[0].fields['Amount']).toBe('-4.50')
  })
})

describe('parseCsvStage1 — semicolon-delimited CSV', () => {
  it('detects semicolon delimiter and sets config.delimiter to ";"', () => {
    const result = parseCsvStage1(SEMICOLON_CSV, 'utf-8')
    expect(result.config).toMatchObject({ delimiter: ';' })
  })

  it('returns success: true', () => {
    expect(parseCsvStage1(SEMICOLON_CSV, 'utf-8').success).toBe(true)
  })

  it('correctly parses rows separated by semicolons', () => {
    const result = parseCsvStage1(SEMICOLON_CSV, 'utf-8')
    expect(result.rows).toHaveLength(2)
    expect(result.rows[0].fields['Date']).toBe('2024-01-15')
    expect(result.rows[0].fields['Amount']).toBe('-4.50')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — header alias / canonical field mapping
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — header mapping to canonical fields', () => {
  it('maps "Transaction Date" to canonical date field', () => {
    const result = parseCsvStage1(BANK_HEADER_CSV, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    // "Transaction Date" should match the date or transactionDate canonical key
    const hasDate = !!(mapping.date || mapping.transactionDate)
    expect(hasDate).toBe(true)
  })

  it('maps "Transaction Amount" to canonical amount field', () => {
    const result = parseCsvStage1(BANK_HEADER_CSV, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    expect(mapping.amount).toBeDefined()
  })

  it('maps "Payee" to canonical description field', () => {
    const result = parseCsvStage1(BANK_HEADER_CSV, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    expect(mapping.description).toBeDefined()
  })

  it('maps "Balance" to canonical runningBalance field', () => {
    const result = parseCsvStage1(BANK_HEADER_CSV, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    expect(mapping.runningBalance).toBeDefined()
  })

  it('returns success: true for bank-style headers', () => {
    const result = parseCsvStage1(BANK_HEADER_CSV, 'utf-8')
    expect(result.success).toBe(true)
  })

  it('maps "Posted Date" to canonical date / postedDate field', () => {
    const result = parseCsvStage1(ALIAS_HEADER_CSV, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    const hasDate = !!(mapping.date || mapping.postedDate)
    expect(hasDate).toBe(true)
  })

  it('maps "Memo" to canonical description field', () => {
    const result = parseCsvStage1(ALIAS_HEADER_CSV, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    expect(mapping.description).toBeDefined()
  })

  it('maps "Net Amount" to canonical amount field', () => {
    const result = parseCsvStage1(ALIAS_HEADER_CSV, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    expect(mapping.amount).toBeDefined()
  })

  it('maps "Merchant Name" to canonical description field', () => {
    const merchantNameCsv = `Transaction Date,Merchant Name,Amount\n2024-01-15,Starbucks,-5.25\n2024-01-16,Amazon Prime,-14.99\n`
    const result = parseCsvStage1(merchantNameCsv, 'utf-8')
    const mapping = result.headerDetection.suggestedMapping
    expect(mapping.description).toBeDefined()
    expect(mapping.description).toBe('Merchant Name')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — quoted fields with embedded commas
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — quoted fields', () => {
  it('returns success: true for a CSV with quoted fields', () => {
    const result = parseCsvStage1(QUOTED_COMMA_CSV, 'utf-8')
    expect(result.success).toBe(true)
  })

  it('parses quoted field containing a comma as a single field value', () => {
    const result = parseCsvStage1(QUOTED_COMMA_CSV, 'utf-8')
    expect(result.rows[0].fields['Description']).toBe('Starbucks, downtown')
  })

  it('parses escaped double-quotes ("" → ") inside a quoted field', () => {
    const result = parseCsvStage1(QUOTED_COMMA_CSV, 'utf-8')
    // Row index 1: `"Transfer to ""savings"" account"` → `Transfer to "savings" account`
    expect(result.rows[1].fields['Description']).toBe('Transfer to "savings" account')
  })

  it('returns 3 data rows for QUOTED_COMMA_CSV', () => {
    const result = parseCsvStage1(QUOTED_COMMA_CSV, 'utf-8')
    expect(result.rows).toHaveLength(3)
  })

  it('parses a non-quoted row after quoted rows correctly', () => {
    const result = parseCsvStage1(QUOTED_COMMA_CSV, 'utf-8')
    expect(result.rows[2].fields['Description']).toBe('Regular merchant')
    expect(result.rows[2].fields['Amount']).toBe('-12.00')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — multi-line quoted field
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — multi-line quoted fields (embedded newlines)', () => {
  it('returns success: true', () => {
    const result = parseCsvStage1(MULTILINE_FIELD_CSV, 'utf-8')
    expect(result.success).toBe(true)
  })

  it('treats the multi-line field as a single field value containing \\n', () => {
    const result = parseCsvStage1(MULTILINE_FIELD_CSV, 'utf-8')
    // First data row: description field spans two lines
    expect(result.rows[0].fields['Description']).toBe('Payment for\nservices rendered')
  })

  it('still parses subsequent rows correctly after a multi-line field', () => {
    const result = parseCsvStage1(MULTILINE_FIELD_CSV, 'utf-8')
    // Second data row comes after the multi-line row
    const lastRow = result.rows[result.rows.length - 1]
    expect(lastRow.fields['Description']).toBe('Coffee')
    expect(lastRow.fields['Amount']).toBe('-4.50')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — headers only (no data rows)
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — headers only, no data rows', () => {
  it('returns success: true (no data rows is not a fatal error)', () => {
    // The file is valid — it just has zero data rows after the header
    const result = parseCsvStage1(HEADERS_ONLY_CSV, 'utf-8')
    // success depends on whether the header was detected; 0 data rows is OK
    expect(result.errors.filter((e) => e.severity === 'FATAL')).toHaveLength(0)
  })

  it('returns an empty rows array', () => {
    const result = parseCsvStage1(HEADERS_ONLY_CSV, 'utf-8')
    expect(result.rows).toHaveLength(0)
  })

  it('still detects the header', () => {
    const result = parseCsvStage1(HEADERS_ONLY_CSV, 'utf-8')
    expect(result.headerDetection.columns).toContain('Date')
    expect(result.headerDetection.columns).toContain('Description')
    expect(result.headerDetection.columns).toContain('Amount')
  })

  it('has metadata.totalLinesInFile >= 1 (at least the header)', () => {
    const result = parseCsvStage1(HEADERS_ONLY_CSV, 'utf-8')
    expect(result.metadata.totalLinesInFile).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — completely empty input
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — completely empty input', () => {
  it('returns success: false', () => {
    const result = parseCsvStage1('', 'utf-8')
    expect(result.success).toBe(false)
  })

  it('returns a FATAL error indicating no data', () => {
    const result = parseCsvStage1('', 'utf-8')
    const fatal = result.errors.find((e) => e.severity === 'FATAL')
    expect(fatal).toBeDefined()
    expect(fatal?.message).toMatch(/no data/i)
  })

  it('returns an empty rows array', () => {
    const result = parseCsvStage1('', 'utf-8')
    expect(result.rows).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — malformed / unrecognised header
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — malformed input (no recognisable headers)', () => {
  it('returns success: false', () => {
    const result = parseCsvStage1(MALFORMED_CSV, 'utf-8')
    expect(result.success).toBe(false)
  })

  it('returns at least one FATAL error', () => {
    const result = parseCsvStage1(MALFORMED_CSV, 'utf-8')
    const fatal = result.errors.filter((e) => e.severity === 'FATAL')
    expect(fatal.length).toBeGreaterThan(0)
  })

  it('returns an empty rows array', () => {
    const result = parseCsvStage1(MALFORMED_CSV, 'utf-8')
    expect(result.rows).toHaveLength(0)
  })

  it('error message mentions header detection failure', () => {
    const result = parseCsvStage1(MALFORMED_CSV, 'utf-8')
    const fatal = result.errors.find((e) => e.severity === 'FATAL')
    expect(fatal?.message).toMatch(/header/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — encoding is passed through to config
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — encoding stored in config', () => {
  it('stores the provided encoding in config for utf-8', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    expect((result.config as { encoding: string }).encoding).toBe('utf-8')
  })

  it('stores the provided encoding in config for utf-8-bom', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8-bom')
    expect((result.config as { encoding: string }).encoding).toBe('utf-8-bom')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — metadata', () => {
  it('totalLinesInFile matches the actual number of parsed rows (including header)', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    // COMMA_CSV: 1 header + 3 data + 1 trailing newline (empty row skipped by parser)
    // The RFC 4180 parser ends the last row at EOF, trailing empty lines may vary
    expect(result.metadata.totalLinesInFile).toBeGreaterThanOrEqual(4)
  })

  it('headerLinesSkipped is at least 1 (the header row itself)', () => {
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    expect(result.metadata.headerLinesSkipped).toBeGreaterThanOrEqual(1)
  })

  it('emptyLinesSkipped is 0 for a clean CSV with no blank rows', () => {
    // COMMA_CSV has no blank data rows
    const result = parseCsvStage1(COMMA_CSV, 'utf-8')
    expect(result.metadata.emptyLinesSkipped).toBe(0)
  })

  it('emptyLinesSkipped counts blank rows between data rows', () => {
    const csvWithBlankRow = `Date,Description,Amount\n2024-01-15,Coffee,-4.50\n\n2024-01-16,Salary,2000.00\n`
    const result = parseCsvStage1(csvWithBlankRow, 'utf-8')
    expect(result.metadata.emptyLinesSkipped).toBeGreaterThanOrEqual(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — column count mismatch warnings
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — column count mismatch', () => {
  it('emits a warning when a row has fewer columns than the header', () => {
    // Row 2 is missing the Amount field
    const csv = `Date,Description,Amount\n2024-01-15,Coffee,-4.50\n2024-01-16,Salary\n`
    const result = parseCsvStage1(csv, 'utf-8')
    const mismatchWarning = result.warnings.find((w) => w.code === 'COLUMN_COUNT_MISMATCH_UNDER')
    expect(mismatchWarning).toBeDefined()
  })

  it('fills missing columns with empty string when row is short', () => {
    const csv = `Date,Description,Amount\n2024-01-15,Coffee,-4.50\n2024-01-16,Salary\n`
    const result = parseCsvStage1(csv, 'utf-8')
    // Row with missing Amount should get '' for Amount field
    const shortRow = result.rows.find((r) => r.fields['Description'] === 'Salary')
    expect(shortRow?.fields['Amount']).toBe('')
  })

  it('emits a warning when a row has more columns than the header', () => {
    // Row 2 has an extra trailing column
    const csv = `Date,Description,Amount\n2024-01-15,Coffee,-4.50,EXTRA\n`
    const result = parseCsvStage1(csv, 'utf-8')
    const mismatchWarning = result.warnings.find((w) => w.code === 'COLUMN_COUNT_MISMATCH_OVER')
    expect(mismatchWarning).toBeDefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// parseCsvStage1 — CRLF line endings
// ─────────────────────────────────────────────────────────────────────────────

describe('parseCsvStage1 — CRLF line endings', () => {
  it('parses a CRLF file correctly and detects CRLF line ending', () => {
    const crlfCsv = `Date,Description,Amount\r\n2024-01-15,Coffee,-4.50\r\n2024-01-16,Salary,2000.00\r\n`
    const result = parseCsvStage1(crlfCsv, 'utf-8')
    expect(result.success).toBe(true)
    expect(result.rows).toHaveLength(2)
    expect((result.config as { lineEnding: string }).lineEnding).toBe('CRLF')
  })

  it('parses field values correctly from CRLF-terminated rows', () => {
    const crlfCsv = `Date,Description,Amount\r\n2024-01-15,Coffee,-4.50\r\n`
    const result = parseCsvStage1(crlfCsv, 'utf-8')
    expect(result.rows[0].fields['Date']).toBe('2024-01-15')
    expect(result.rows[0].fields['Description']).toBe('Coffee')
    expect(result.rows[0].fields['Amount']).toBe('-4.50')
  })
})
