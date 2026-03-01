/**
 * Stage 1 — Lossless CSV Parse
 *
 * Produces a ParseResult where every data row has:
 *   - sourceLocator  — exact position in the file (rowIndex, dataRowIndex)
 *   - rawLine        — the literal characters of that row as they appear in the file
 *   - fields         — Record<headerName, rawStringValue> — NO type coercion
 *   - rowHash        — SHA-256 of rawLine (pure content fingerprint)
 *
 * Nothing in this stage modifies, trims, or interprets field values.
 * Date and amount parsing happen in Stage 2 (Normalize).
 *
 * RFC 4180 compliance:
 *   - Handles embedded commas, quotes ("" escape), and newlines inside quoted fields
 *   - Handles CRLF, LF, and CR line endings
 *   - Handles all four detected delimiter characters: , \t ; |
 *   - Handles UTF-8 BOM (already stripped by Stage 0 / decodeBuffer)
 */

import { createHash } from 'crypto'
import type {
  ParseResult,
  ParseError,
  ParseWarning,
  RawParsedRow,
  CsvParserConfig,
  HeaderDetectionResult,
  ColumnMapping,
  CsvXlsxSourceLocator,
} from '@/types/ingestion'
import { PARSER_VERSION } from '@/types/ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// DELIMITER DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score each candidate delimiter by counting occurrences per line (outside
 * quotes) across the first 10 non-empty lines.  The winner has the highest
 * consistent count across the most lines.
 */
export function detectDelimiter(text: string): string {
  const candidates = [',', '\t', ';', '|']
  const sampleLines = text
    .split(/\r?\n|\r/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 10)

  if (sampleLines.length === 0) return ','

  let bestDelimiter = ','
  let bestScore = -1

  for (const delim of candidates) {
    const counts = sampleLines.map((line) => {
      let count = 0
      let inQ = false
      for (const ch of line) {
        if (ch === '"') inQ = !inQ
        else if (ch === delim && !inQ) count++
      }
      return count
    })

    const nonZero = counts.filter((c) => c > 0)
    if (nonZero.length === 0) continue

    const min = Math.min(...nonZero)
    const max = Math.max(...nonZero)
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length

    // Prefer: high average column count, consistent across all sample lines
    const consistency = max > 0 ? min / max : 0
    const coverage = nonZero.length / sampleLines.length
    const score = avg * consistency * coverage

    if (score > bestScore) {
      bestScore = score
      bestDelimiter = delim
    }
  }

  return bestDelimiter
}

function detectLineEnding(text: string): 'LF' | 'CRLF' | 'CR' {
  const crlfCount = (text.match(/\r\n/g) ?? []).length
  const crAloneCount = (text.match(/\r(?!\n)/g) ?? []).length
  const lfAloneCount = (text.match(/(?<!\r)\n/g) ?? []).length
  if (crlfCount >= lfAloneCount && crlfCount >= crAloneCount) return 'CRLF'
  if (crAloneCount >= lfAloneCount) return 'CR'
  return 'LF'
}

// ─────────────────────────────────────────────────────────────────────────────
// RFC 4180 PARSER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse the full CSV text into a 2D array of raw strings.
 * Works on the whole text at once (not line-by-line) so embedded newlines
 * inside quoted fields are handled correctly.
 *
 * Returns: rows where each row is an array of raw cell strings (un-trimmed).
 * Also returns the start/end character position of each row for rawLine extraction.
 */
function parseRfc4180(
  text: string,
  delimiter: string,
): { rows: string[][]; rowSpans: Array<{ start: number; end: number }> } {
  const rows: string[][] = []
  const rowSpans: Array<{ start: number; end: number }> = []

  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false
  let i = 0
  let rowStart = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          // Escaped double-quote inside quoted field
          currentField += '"'
          i += 2
        } else {
          // End of quoted field
          inQuotes = false
          i++
        }
      } else {
        // Any character (including newlines) is literal inside quotes
        currentField += ch
        i++
      }
    } else {
      if (ch === '"') {
        inQuotes = true
        i++
      } else if (ch === delimiter) {
        currentRow.push(currentField)
        currentField = ''
        i++
      } else if (ch === '\r') {
        // Row terminator: CR or CRLF
        currentRow.push(currentField)
        currentField = ''
        const end = i
        rows.push(currentRow)
        rowSpans.push({ start: rowStart, end })
        currentRow = []
        i++
        if (i < text.length && text[i] === '\n') i++ // consume the LF in CRLF
        rowStart = i
      } else if (ch === '\n') {
        // Row terminator: LF
        currentRow.push(currentField)
        currentField = ''
        const end = i
        rows.push(currentRow)
        rowSpans.push({ start: rowStart, end })
        currentRow = []
        i++
        rowStart = i
      } else {
        currentField += ch
        i++
      }
    }
  }

  // Last row (file may not end with newline)
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
    rowSpans.push({ start: rowStart, end: text.length })
  }

  return { rows, rowSpans }
}

// ─────────────────────────────────────────────────────────────────────────────
// HEADER DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/** Patterns for each canonical field name. */
const HEADER_PATTERNS: Record<keyof ColumnMapping, RegExp[]> = {
  date: [
    /^date$/i,
    /^trans(action)?[\s._-]?date$/i,
    /^trans\.?\s*date$/i,
    /^posted[\s._-]?date$/i,
    /^posting[\s._-]?date$/i,
    /^post[\s._-]?date$/i,
    /^value[\s._-]?date$/i,
    /^settlement[\s._-]?date$/i,
    /^effective[\s._-]?date$/i,
    /^activity[\s._-]?date$/i,
  ],
  postedDate: [
    /^posted[\s._-]?date$/i,
    /^posting[\s._-]?date$/i,
    /^post[\s._-]?date$/i,
  ],
  transactionDate: [
    /^trans(action)?[\s._-]?date$/i,
    /^trans\.?\s*date$/i,
  ],
  amount: [
    /^amount$/i,
    /^trans(action)?[\s._-]?amount$/i,
    /^net[\s._-]?amount$/i,
    /^total[\s._-]?amount$/i,
  ],
  debit: [
    /^debit[s]?$/i,
    /^withdrawal[s]?$/i,
    /^withdraw[s]?$/i,
    /^charge[s]?$/i,
    /^payment[s]?[\s._-]?out$/i,
    /^money[\s._-]?out$/i,
    /^dr\.?$/i,
  ],
  credit: [
    /^credit[s]?$/i,
    /^deposit[s]?$/i,
    /^payment[s]?[\s._-]?in$/i,
    /^money[\s._-]?in$/i,
    /^cr\.?$/i,
  ],
  description: [
    /^desc(ription)?$/i,
    /^memo$/i,
    /^narration$/i,
    /^particulars?$/i,
    /^payee$/i,
    /^name$/i,
    /^merchant$/i,
    /^details?$/i,
    /^original[\s._-]?desc(ription)?$/i,
    /^transaction[\s._-]?desc(ription)?$/i,
    /^transaction$/i,
    /^remarks?$/i,
    /^reference[\s._-]?text$/i,
    /^narrative$/i,
    /^merchant[\s._-]?name$/i,
    /^payee[\s._-]?name$/i,
    /^transaction[\s._-]?details?$/i,
    /^extended[\s._-]?details?$/i,
    /^vendor[\s._-]?name?$/i,
    /^counterparty[\s._-]?name?$/i,
    /^beneficiary[\s._-]?name?$/i,
    /^desc(ription)?[\s._-]?\/?[\s._-]?memo$/i,
    /^additional[\s._-]?info(rmation)?$/i,
    /^label$/i,
    /^note[s]?$/i,
    /^text$/i,
    /^info(rmation)?$/i,
    /^transaction[\s._-]?name$/i,
    /^account[\s._-]?description$/i,
    /^payment[\s._-]?detail[s]?$/i,
    /^entry[\s._-]?detail[s]?$/i,
  ],
  runningBalance: [
    /^balance$/i,
    /^running[\s._-]?bal(ance)?\.?$/i,
    /^avail(able)?[\s._-]?bal(ance)?$/i,
    /^ledger[\s._-]?bal(ance)?$/i,
    /^closing[\s._-]?bal(ance)?$/i,
    /^end[\s._-]?bal(ance)?$/i,
    /^bal\.?$/i,
  ],
  checkNumber: [
    /^check[\s._-]?(no\.?|num(ber)?)?$/i,
    /^cheque[\s._-]?(no\.?|num(ber)?)?$/i,
    /^chk[\s._-]?(no\.?|num(ber)?)?$/i,
    /^ck[\s._-]?no\.?$/i,
  ],
  bankTransactionId: [
    /^trans(action)?[\s._-]?id$/i,
    /^reference[\s._-]?id$/i,
    /^ref(erence)?[\s._-]?(no\.?|num(ber)?)?$/i,
    /^unique[\s._-]?id$/i,
    /^transaction[\s._-]?ref(erence)?$/i,
    /^confirmation[\s._-]?(no\.?|num(ber)?)?$/i,
    /^seq(uence)?[\s._-]?(no\.?|num(ber)?)?$/i,
  ],
  currency: [
    /^curr(ency)?$/i,
    /^currency[\s._-]?code$/i,
    /^iso[\s._-]?curr(ency)?$/i,
    /^ccy$/i,
  ],
  pending: [
    /^status$/i,
    /^pending$/i,
    /^posted[\s._-]?status$/i,
    /^type$/i,
    /^state$/i,
  ],
  transactionType: [
    /^transaction[\s._-]?type$/i,
    /^trans(action)?[\s._-]?type$/i,
    /^txn[\s._-]?type$/i,
    /^debit[\s._-]?\/[\s._-]?credit$/i,
    /^dr[\s._-]?\/[\s._-]?cr$/i,
  ],
  referenceNumber: [
    /^ref(erence)?[\s._-]?num(ber)?$/i,
    /^reference[\s._-]?#$/i,
    /^ref[\s._-]?no\.?$/i,
    /^seq(uence)?[\s._-]?no\.?$/i,
  ],
  bankCategory: [
    /^transaction[\s._-]?category$/i,
    /^category$/i,
    /^bank[\s._-]?category$/i,
    /^tx[\s._-]?category$/i,
    /^spending[\s._-]?category$/i,
    /^merchant[\s._-]?category$/i,
  ],
}

/**
 * Test whether a raw header string matches a canonical field.
 */
function matchesField(header: string, patterns: RegExp[]): boolean {
  const h = header.trim().toLowerCase()
  return patterns.some((p) => p.test(h))
}

/**
 * Detect the header row from the first N rows and produce a ColumnMapping.
 * Returns the header row index and confidence score.
 */
function detectHeader(allRows: string[][]): HeaderDetectionResult {
  const LOOK_AT_ROWS = Math.min(8, allRows.length)

  let bestScore = -1
  let bestRowIndex = 0
  let bestMapping: ColumnMapping = {}
  let bestColumns: string[] = []

  for (let ri = 0; ri < LOOK_AT_ROWS; ri++) {
    const row = allRows[ri]
    if (row.length < 2) continue

    const rawHeaders = row.map((h) => h.trim().replace(/^["']|["']$/g, ''))
    const mapping: ColumnMapping = {}
    let matchCount = 0
    const ambiguous: Record<string, string[]> = {}

    for (const field of Object.keys(HEADER_PATTERNS) as Array<keyof ColumnMapping>) {
      const patterns = HEADER_PATTERNS[field]
      const matched = rawHeaders.filter((h) => matchesField(h, patterns))
      if (matched.length === 1) {
        mapping[field] = matched[0]
        matchCount++
      } else if (matched.length > 1) {
        ambiguous[field] = matched
        matchCount += 0.5 // partial credit for ambiguous match
      }
    }

    // Row must have at least date + (amount OR debit/credit) + description
    const hasDate = !!(mapping.date || mapping.postedDate || mapping.transactionDate)
    const hasAmount = !!(mapping.amount || mapping.debit || mapping.credit)
    const hasDescription = !!mapping.description

    if (!hasDate || !hasAmount) continue

    // Bonus for having description; penalty for very few columns
    const score = matchCount + (hasDescription ? 1 : 0) + (row.length >= 4 ? 0.5 : 0)

    if (score > bestScore) {
      bestScore = score
      bestRowIndex = ri
      bestMapping = mapping
      bestColumns = rawHeaders
    }
  }

  // Build ambiguous fields list
  const ambiguousFields: HeaderDetectionResult['ambiguousFields'] = []
  for (const field of Object.keys(HEADER_PATTERNS) as Array<keyof ColumnMapping>) {
    const patterns = HEADER_PATTERNS[field]
    const matched = bestColumns.filter((h) => matchesField(h, patterns))
    if (matched.length > 1) {
      ambiguousFields.push({ field, candidates: matched })
    }
  }

  const unmappedColumns = bestColumns.filter(
    (h) =>
      !Object.values(bestMapping).includes(h) &&
      h.trim().length > 0,
  )

  // Confidence: 1.0 if we have date + amount + description; lower otherwise
  const hasAllCore =
    !!(bestMapping.date || bestMapping.postedDate || bestMapping.transactionDate) &&
    !!(bestMapping.amount || bestMapping.debit || bestMapping.credit) &&
    !!bestMapping.description
  const confidence = bestScore <= 0 ? 0 : hasAllCore ? 0.95 : 0.65

  return {
    confidence,
    headerRowIndex: bestRowIndex,
    columns: bestColumns,
    suggestedMapping: bestMapping,
    unmappedColumns,
    ambiguousFields,
    requiresUserConfirmation: confidence < 0.7 || ambiguousFields.length > 0,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PARSE FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a decoded CSV string into a ParseResult.
 *
 * @param text     Decoded string (BOM already stripped by Stage 0 / decodeBuffer)
 * @param encoding The encoding detected by Stage 0 (stored in config for determinism)
 */
export function parseCsvStage1(text: string, encoding: string): ParseResult {
  const errors: ParseError[] = []
  const warnings: ParseWarning[] = []

  // ── Detect delimiter and line ending ──
  const delimiter = detectDelimiter(text)
  const lineEnding = detectLineEnding(text)

  // ── Full RFC 4180 parse ──
  const { rows: allRows, rowSpans } = parseRfc4180(text, delimiter)

  if (allRows.length === 0) {
    return {
      success: false,
      config: buildConfig(delimiter, encoding, 0, 1, lineEnding),
      headerDetection: emptyHeaderDetection(),
      rows: [],
      errors: [{ rowIndex: -1, message: 'File contains no data rows.', severity: 'FATAL' }],
      warnings: [],
      metadata: { totalLinesInFile: 0, emptyLinesSkipped: 0, headerLinesSkipped: 0 },
    }
  }

  // ── Detect header row ──
  const headerDetection = detectHeader(allRows)
  const headerRowIndex = headerDetection.headerRowIndex

  if (headerDetection.confidence === 0) {
    errors.push({
      rowIndex: -1,
      message:
        'Could not detect a valid header row. ' +
        'Expected columns like "Date", "Amount", "Description" or equivalents.',
      severity: 'FATAL',
    })
    return {
      success: false,
      config: buildConfig(delimiter, encoding, headerRowIndex, headerRowIndex + 1, lineEnding),
      headerDetection,
      rows: [],
      errors,
      warnings,
      metadata: {
        totalLinesInFile: allRows.length,
        emptyLinesSkipped: 0,
        headerLinesSkipped: 0,
      },
    }
  }

  if (headerDetection.requiresUserConfirmation) {
    warnings.push({
      rowIndex: headerRowIndex,
      message:
        `Header row detection has low confidence (${(headerDetection.confidence * 100).toFixed(0)}%). ` +
        'Verify that columns are mapped correctly before accepting the import.',
      code: 'HEADER_LOW_CONFIDENCE',
    })
  }

  const headerCells = allRows[headerRowIndex]
  // Normalise header names for field lookup: trim, strip surrounding quotes
  const normalisedHeaders = headerCells.map((h) => h.trim().replace(/^["']|["']$/g, ''))
  const expectedColCount = normalisedHeaders.length

  // ── Build RawParsedRow array ──
  const parsedRows: RawParsedRow[] = []
  let emptyLinesSkipped = 0
  let dataRowIndex = 0

  for (let ri = headerRowIndex + 1; ri < allRows.length; ri++) {
    const rawCells = allRows[ri]

    // Skip rows that are completely empty
    if (rawCells.every((c) => c.trim() === '')) {
      emptyLinesSkipped++
      continue
    }

    // ── Column count check ──
    if (rawCells.length < expectedColCount) {
      warnings.push({
        rowIndex: ri,
        message:
          `Row has ${rawCells.length} columns, expected ${expectedColCount}. ` +
          `Missing cells treated as empty strings.`,
        code: 'COLUMN_COUNT_MISMATCH_UNDER',
      })
      while (rawCells.length < expectedColCount) rawCells.push('')
    } else if (rawCells.length > expectedColCount) {
      warnings.push({
        rowIndex: ri,
        message:
          `Row has ${rawCells.length} columns, expected ${expectedColCount}. ` +
          `Extra columns preserved in rawFields.`,
        code: 'COLUMN_COUNT_MISMATCH_OVER',
      })
    }

    // ── Build fields map — raw strings only, no coercion ──
    const fields: Record<string, string> = {}
    for (let ci = 0; ci < normalisedHeaders.length; ci++) {
      const header = normalisedHeaders[ci]
      if (header.length > 0) {
        fields[header] = rawCells[ci] ?? ''
      }
    }
    // Preserve any extra columns beyond the header under numeric keys
    for (let ci = normalisedHeaders.length; ci < rawCells.length; ci++) {
      fields[`__col${ci}__`] = rawCells[ci]
    }

    // ── rawLine: reconstruct the raw text of this row ──
    //  We use rowSpans to slice the exact original text (preserves original
    //  quoting and spacing exactly as they appeared in the file).
    const span = rowSpans[ri]
    const rawLine = span ? text.slice(span.start, span.end) : rawCells.join(delimiter)

    // ── rowHash: SHA-256 of rawLine ──
    const rowHash = createHash('sha256').update(rawLine, 'utf8').digest('hex')

    const sourceLocator: CsvXlsxSourceLocator = {
      type: 'CSV',
      sheetName: null,
      rowIndex: ri,          // 0-based absolute row index in file
      dataRowIndex,          // 0-based index among data rows only
    }

    parsedRows.push({ sourceLocator, fields, rawLine, rowHash })
    dataRowIndex++
  }

  const hasFatalErrors = errors.some((e) => e.severity === 'FATAL')

  return {
    success: !hasFatalErrors,
    config: buildConfig(delimiter, encoding, headerRowIndex, headerRowIndex + 1, lineEnding),
    headerDetection,
    rows: parsedRows,
    errors,
    warnings,
    metadata: {
      totalLinesInFile: allRows.length,
      emptyLinesSkipped,
      headerLinesSkipped: headerRowIndex + 1,
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function buildConfig(
  delimiter: string,
  encoding: string,
  headerRowIndex: number,
  dataStartIndex: number,
  lineEnding: 'LF' | 'CRLF' | 'CR',
): CsvParserConfig {
  return {
    type: 'CSV',
    delimiter,
    quoteChar: '"',
    encoding,
    headerRowIndex,
    dataStartIndex,
    hasTrailingDelimiter: false, // detected per-row during parse if needed
    lineEnding,
  }
}

function emptyHeaderDetection(): HeaderDetectionResult {
  return {
    confidence: 0,
    headerRowIndex: 0,
    columns: [],
    suggestedMapping: {},
    unmappedColumns: [],
    ambiguousFields: [],
    requiresUserConfirmation: true,
  }
}

// Re-export PARSER_VERSION so route.ts can store it without importing types directly
export { PARSER_VERSION }
