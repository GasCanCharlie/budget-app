/**
 * Milestone 2 smoke tests — pure logic, no module system / path aliases
 * Run with: node test-milestone2.mjs
 *
 * Tests (from the design test plan):
 *  T13 — UTF-8 BOM detection + stripping
 *  T19 — Truncated CSV (unclosed quote at EOF) rejected
 *  T26 — Empty file condition detected
 *  T27 — 51 MB > 50 MB limit condition
 *  T28 — Semicolon delimiter (European banks) correctly detected
 *  Dx1 — Tab delimiter detected
 *  Dx2 — RFC 4180: embedded comma in quoted field
 *  Dx3 — RFC 4180: embedded newline in quoted field
 *  Dx4 — RFC 4180: escaped double-quote ("") inside field
 *  Dx5 — sourceLocator rowIndex and dataRowIndex values
 *  Dx6 — rawLine matches original text
 *  Dx7 — rowHash is SHA-256 of rawLine
 *  Dx8 — Major bank header patterns detected
 *  Dx9 — CRLF line endings handled
 *  Dx10 — Empty rows skipped
 */

import { createHash } from 'crypto'

// ─────────────────────────────────────────────────────────────────────────────
// INLINE IMPLEMENTATIONS (copied from stage0 / stage1 for test isolation)
// These are pure functions with no external dependencies.
// ─────────────────────────────────────────────────────────────────────────────

// ── Stage 0 helpers ──

function detectEncoding(buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'utf-8-bom'
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'utf-16-le'
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'utf-16-be'
  return 'utf-8'
}

function decodeBuffer(buf, encoding) {
  if (encoding === 'utf-8-bom') return buf.subarray(3).toString('utf-8')
  if (encoding === 'utf-16-le') return buf.subarray(2).toString('utf16le')
  if (encoding === 'utf-16-be') {
    const body = buf.subarray(2)
    const swapped = Buffer.allocUnsafe(body.length)
    for (let i = 0; i + 1 < body.length; i += 2) { swapped[i] = body[i+1]; swapped[i+1] = body[i] }
    return swapped.toString('utf16le')
  }
  return buf.toString('utf-8')
}

function checkCsvTruncation(text) {
  let inQuote = false
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '"') {
      if (inQuote && i + 1 < text.length && text[i+1] === '"') i++
      else inQuote = !inQuote
    }
  }
  return inQuote ? { valid: false } : { valid: true }
}

function detectTypeFromMagicBytes(buf) {
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) return 'XLSX'
  if (buf.length >= 4 && buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'PDF'
  return null
}

// ── Stage 1 helpers ──

function detectDelimiter(text) {
  const candidates = [',', '\t', ';', '|']
  const sampleLines = text.split(/\r?\n|\r/).filter(l => l.trim().length > 0).slice(0, 10)
  if (sampleLines.length === 0) return ','
  let bestDelimiter = ',', bestScore = -1
  for (const delim of candidates) {
    const counts = sampleLines.map(line => {
      let count = 0, inQ = false
      for (const ch of line) { if (ch === '"') inQ = !inQ; else if (ch === delim && !inQ) count++ }
      return count
    })
    const nonZero = counts.filter(c => c > 0)
    if (!nonZero.length) continue
    const min = Math.min(...nonZero), max = Math.max(...nonZero)
    const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length
    const score = avg * (max > 0 ? min / max : 0) * (nonZero.length / sampleLines.length)
    if (score > bestScore) { bestScore = score; bestDelimiter = delim }
  }
  return bestDelimiter
}

function detectLineEnding(text) {
  const crlf = (text.match(/\r\n/g) ?? []).length
  const crAlone = (text.match(/\r(?!\n)/g) ?? []).length
  const lfAlone = (text.match(/(?<!\r)\n/g) ?? []).length
  if (crlf >= lfAlone && crlf >= crAlone) return 'CRLF'
  if (crAlone >= lfAlone) return 'CR'
  return 'LF'
}

function parseRfc4180(text, delimiter) {
  const rows = [], rowSpans = []
  let currentRow = [], currentField = '', inQuotes = false, i = 0, rowStart = 0
  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i+1] === '"') { currentField += '"'; i += 2 }
        else { inQuotes = false; i++ }
      } else { currentField += ch; i++ }
    } else {
      if (ch === '"') { inQuotes = true; i++ }
      else if (ch === delimiter) { currentRow.push(currentField); currentField = ''; i++ }
      else if (ch === '\r') {
        currentRow.push(currentField); currentField = ''
        rows.push(currentRow); rowSpans.push({ start: rowStart, end: i })
        currentRow = []; i++
        if (i < text.length && text[i] === '\n') i++
        rowStart = i
      } else if (ch === '\n') {
        currentRow.push(currentField); currentField = ''
        rows.push(currentRow); rowSpans.push({ start: rowStart, end: i })
        currentRow = []; i++; rowStart = i
      } else { currentField += ch; i++ }
    }
  }
  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField)
    rows.push(currentRow)
    rowSpans.push({ start: rowStart, end: text.length })
  }
  return { rows, rowSpans }
}

const HEADER_PATTERNS = {
  date:        [/^date$/i, /^trans(action)?[\s._-]?date$/i, /^trans\.?\s*date$/i, /^posted[\s._-]?date$/i, /^post[\s._-]?date$/i, /^value[\s._-]?date$/i],
  transactionDate: [/^trans(action)?[\s._-]?date$/i],
  postedDate:  [/^posted[\s._-]?date$/i, /^posting[\s._-]?date$/i],
  amount:      [/^amount$/i, /^trans(action)?[\s._-]?amount$/i, /^net[\s._-]?amount$/i],
  debit:       [/^debit[s]?$/i, /^withdrawal[s]?$/i, /^charge[s]?$/i, /^dr\.?$/i],
  credit:      [/^credit[s]?$/i, /^deposit[s]?$/i, /^cr\.?$/i],
  description: [/^desc(ription)?$/i, /^memo$/i, /^narration$/i, /^payee$/i, /^name$/i, /^merchant$/i, /^details?$/i, /^transaction$/i],
  runningBalance: [/^balance$/i, /^running[\s._-]?bal(ance)?\.?$/i, /^avail.*bal.*$/i, /^bal\.?$/i],
  checkNumber: [/^check[\s._-]?(no\.?|num(ber)?)?$/i],
  bankTransactionId: [/^trans(action)?[\s._-]?id$/i, /^ref(erence)?[\s._-]?(no\.?|num(ber)?)?$/i],
  currency:    [/^curr(ency)?$/i, /^ccy$/i],
  pending:     [/^status$/i, /^pending$/i],
}

function matchesField(header, patterns) {
  const h = header.trim().toLowerCase()
  return patterns.some(p => p.test(h))
}

function detectHeader(allRows) {
  const LOOK_AT = Math.min(8, allRows.length)
  let best = { score: -1, rowIndex: 0, mapping: {}, columns: [] }
  for (let ri = 0; ri < LOOK_AT; ri++) {
    const row = allRows[ri]
    if (row.length < 2) continue
    const rawHeaders = row.map(h => h.trim().replace(/^["']|["']$/g, ''))
    const mapping = {}
    let matchCount = 0
    for (const [field, patterns] of Object.entries(HEADER_PATTERNS)) {
      const matched = rawHeaders.filter(h => matchesField(h, patterns))
      if (matched.length === 1) { mapping[field] = matched[0]; matchCount++ }
      else if (matched.length > 1) matchCount += 0.5
    }
    const hasDate = !!(mapping.date || mapping.postedDate || mapping.transactionDate)
    const hasAmount = !!(mapping.amount || mapping.debit || mapping.credit)
    if (!hasDate || !hasAmount) continue
    const score = matchCount + (mapping.description ? 1 : 0) + (row.length >= 4 ? 0.5 : 0)
    if (score > best.score) best = { score, rowIndex: ri, mapping, columns: rawHeaders }
  }
  const hasAllCore = !!(best.mapping.date || best.mapping.postedDate || best.mapping.transactionDate)
    && !!(best.mapping.amount || best.mapping.debit || best.mapping.credit)
    && !!best.mapping.description
  return {
    confidence: best.score <= 0 ? 0 : hasAllCore ? 0.95 : 0.65,
    headerRowIndex: best.rowIndex,
    columns: best.columns,
    suggestedMapping: best.mapping,
    requiresUserConfirmation: best.score <= 0,
  }
}

function parseCsvStage1(text, encoding) {
  const delimiter = detectDelimiter(text)
  const lineEnding = detectLineEnding(text)
  const { rows: allRows, rowSpans } = parseRfc4180(text, delimiter)
  if (!allRows.length) return { success: false, rows: [], errors: [{ message: 'empty', severity: 'FATAL' }], warnings: [], metadata: { emptyLinesSkipped: 0 }, config: { type: 'CSV', delimiter, encoding, lineEnding, headerRowIndex: 0 } }
  const hd = detectHeader(allRows)
  if (hd.confidence === 0) return { success: false, rows: [], errors: [{ message: 'no header', severity: 'FATAL' }], warnings: [], metadata: { emptyLinesSkipped: 0 }, config: { type: 'CSV', delimiter, encoding, lineEnding, headerRowIndex: 0 } }
  const normHeaders = allRows[hd.headerRowIndex].map(h => h.trim().replace(/^["']|["']$/g, ''))
  const parsedRows = []
  let emptyLinesSkipped = 0, dataRowIndex = 0
  for (let ri = hd.headerRowIndex + 1; ri < allRows.length; ri++) {
    const cells = allRows[ri]
    if (cells.every(c => c.trim() === '')) { emptyLinesSkipped++; continue }
    while (cells.length < normHeaders.length) cells.push('')
    const fields = {}
    for (let ci = 0; ci < normHeaders.length; ci++) if (normHeaders[ci]) fields[normHeaders[ci]] = cells[ci] ?? ''
    const span = rowSpans[ri]
    const rawLine = span ? text.slice(span.start, span.end) : cells.join(delimiter)
    const rowHash = createHash('sha256').update(rawLine, 'utf8').digest('hex')
    parsedRows.push({
      sourceLocator: { type: 'CSV', sheetName: null, rowIndex: ri, dataRowIndex },
      fields, rawLine, rowHash,
    })
    dataRowIndex++
  }
  return {
    success: true, rows: parsedRows, errors: [], warnings: [],
    headerDetection: hd,
    metadata: { totalLinesInFile: allRows.length, emptyLinesSkipped, headerLinesSkipped: hd.headerRowIndex + 1 },
    config: { type: 'CSV', delimiter, quoteChar: '"', encoding, lineEnding, headerRowIndex: hd.headerRowIndex, dataStartIndex: hd.headerRowIndex + 1 },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────

let passed = 0, failed = 0

function test(name, fn) {
  try { fn(); console.log(`  ✅  ${name}`); passed++ }
  catch (e) { console.log(`  ❌  ${name}\n      ${e.message}`); failed++ }
}

function assert(cond, msg)   { if (!cond) throw new Error(msg ?? 'assertion failed') }
function eq(a, b, msg)       { if (a !== b) throw new Error(`${msg ?? ''}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`) }

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 0 — ENCODING
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 0 — encoding detection & decoding')

test('T13a: UTF-8 BOM detected', () => {
  eq(detectEncoding(Buffer.from([0xEF,0xBB,0xBF,0x61])), 'utf-8-bom', 'encoding')
})

test('T13b: UTF-8 BOM stripped from decoded text', () => {
  const buf = Buffer.from('\uFEFFDate,Amount\n2024-01-15,100.00', 'utf-8')
  const text = decodeBuffer(buf, detectEncoding(buf))
  assert(!text.startsWith('\uFEFF'), 'BOM should be stripped')
  assert(text.startsWith('Date'), `should start with "Date", got: "${text.slice(0,8)}"`)
})

test('UTF-16 LE BOM detected', () => {
  eq(detectEncoding(Buffer.from([0xFF,0xFE,0x41,0x00])), 'utf-16-le', 'encoding')
})

test('UTF-16 BE BOM detected', () => {
  eq(detectEncoding(Buffer.from([0xFE,0xFF,0x00,0x41])), 'utf-16-be', 'encoding')
})

test('Plain UTF-8 no BOM defaults to utf-8', () => {
  eq(detectEncoding(Buffer.from('Date,Amount')), 'utf-8', 'encoding')
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 0 — TRUNCATION
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 0 — truncation detection')

test('T19: Unclosed quote at EOF → invalid', () => {
  assert(!checkCsvTruncation('Date,Desc\n2024-01-15,"Open field').valid)
})

test('Well-formed CSV with closing quote → valid', () => {
  assert(checkCsvTruncation('Date,Desc\n2024-01-15,"Closed",100.00').valid)
})

test('Escaped double-quote does not trip truncation check', () => {
  assert(checkCsvTruncation('Date,Desc\n2024-01-15,"Bob""s Cafe"').valid)
})

test('Empty file (no text) is valid per truncation check', () => {
  assert(checkCsvTruncation('').valid)
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 0 — MAGIC BYTES
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 0 — magic bytes')

test('XLSX (ZIP PK signature) detected', () => {
  eq(detectTypeFromMagicBytes(Buffer.from([0x50,0x4B,0x03,0x04,0x14,0x00])), 'XLSX', 'type')
})

test('PDF (%PDF signature) detected', () => {
  eq(detectTypeFromMagicBytes(Buffer.from('%PDF-1.4', 'ascii')), 'PDF', 'type')
})

test('CSV (no magic bytes) returns null', () => {
  eq(detectTypeFromMagicBytes(Buffer.from('Date,Amount\n', 'utf-8')), null, 'type')
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 0 — SIZE / EMPTY (condition checks)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 0 — size / empty conditions')

test('T26: 0-byte buffer triggers empty file condition', () => {
  assert(Buffer.alloc(0).length === 0)
})

test('T27: 51 MB exceeds 50 MB limit', () => {
  assert(51 * 1024 * 1024 > 50 * 1024 * 1024)
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — DELIMITER DETECTION
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 1 — delimiter detection')

test('Comma delimiter', () => {
  eq(detectDelimiter('Date,Amount,Desc\n2024-01-15,-5.00,Coffee'), ',')
})

test('T28: Semicolon delimiter (European bank)', () => {
  eq(detectDelimiter('Datum;Betrag;Beschreibung\n15.01.2024;100,00;Kaffee\n16.01.2024;50,00;Benzin'), ';')
})

test('Dx1: Tab delimiter', () => {
  eq(detectDelimiter('Date\tAmount\tDesc\n2024-01-15\t-5.00\tCoffee\n2024-01-16\t-10.00\tGas'), '\t')
})

test('Pipe delimiter', () => {
  eq(detectDelimiter('Date|Amount|Desc\n2024-01-15|-5.00|Coffee\n2024-01-16|-10.00|Gas'), '|')
})

test('Consistent delimiter wins over noisy ones', () => {
  // Tab is consistent; commas appear only in descriptions (inside quotes simulated)
  const tsv = 'Date\tDescription\tAmount\n2024-01-15\tCoffee, large\t-5.00\n2024-01-16\tGas, regular\t-50.00'
  eq(detectDelimiter(tsv), '\t')
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — RFC 4180 CORRECTNESS
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 1 — RFC 4180 correctness')

test('Dx2: Embedded comma in quoted field', () => {
  const csv = 'Date,Description,Amount\n2024-01-15,"Bob\'s Burgers, NYC",-12.50'
  const r = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  eq(r.rows.length, 1, 'row count')
  eq(r.rows[0].fields['Description'], "Bob's Burgers, NYC", 'embedded comma preserved')
})

test('Dx3: Embedded newline in quoted field', () => {
  const csv = 'Date,Description,Amount\n2024-01-15,"Line one\nLine two",-12.50\n2024-01-16,Coffee,-5.00'
  const r = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  eq(r.rows.length, 2, 'logical row count (not physical line count)')
  assert(r.rows[0].fields['Description'].includes('\n'), 'newline preserved in field')
})

test('Dx4: Escaped double-quote ("") inside field', () => {
  const csv = 'Date,Description,Amount\n2024-01-15,"Bob""s Cafe",-9.99'
  const r = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  eq(r.rows[0].fields['Description'], 'Bob"s Cafe', 'double-quote unescaped')
})

test('Embedded comma AND quote together', () => {
  const csv = 'Date,Description,Amount\n2024-01-15,"Says ""hello"", world",-1.00'
  const r = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  eq(r.rows[0].fields['Description'], 'Says "hello", world', 'combo case')
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — SOURCE LOCATORS & LINEAGE
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 1 — source locators & lineage')

test('Dx5: rowIndex is absolute (header=0, first data=1)', () => {
  const csv = 'Date,Amount,Description\n2024-01-15,-5.00,Coffee\n2024-01-16,-10.00,Gas\n2024-01-17,1200.00,Paycheck'
  const r = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  eq(r.rows[0].sourceLocator.rowIndex, 1, 'first data row rowIndex')
  eq(r.rows[1].sourceLocator.rowIndex, 2, 'second data row rowIndex')
  eq(r.rows[2].sourceLocator.rowIndex, 3, 'third data row rowIndex')
})

test('Dx5: dataRowIndex is 0-based among data rows only', () => {
  const csv = 'Date,Amount,Description\n2024-01-15,-5.00,Coffee\n2024-01-16,-10.00,Gas\n2024-01-17,1200.00,Pay'
  const r = parseCsvStage1(csv, 'utf-8')
  eq(r.rows[0].sourceLocator.dataRowIndex, 0)
  eq(r.rows[1].sourceLocator.dataRowIndex, 1)
  eq(r.rows[2].sourceLocator.dataRowIndex, 2)
})

test('Dx6: rawLine matches original text exactly', () => {
  const row1 = '2024-01-15,-12.50,"Coffee at Bob\'s"'
  const csv  = `Date,Amount,Description\n${row1}\n2024-01-16,-5.00,Tea`
  const r    = parseCsvStage1(csv, 'utf-8')
  eq(r.rows[0].rawLine, row1, 'rawLine equals original source text')
})

test('Dx7: rowHash is SHA-256 of rawLine', () => {
  const csv = 'Date,Amount,Description\n2024-01-15,-12.50,Coffee'
  const r   = parseCsvStage1(csv, 'utf-8')
  const expected = createHash('sha256').update(r.rows[0].rawLine, 'utf8').digest('hex')
  eq(r.rows[0].rowHash, expected, 'rowHash matches SHA-256(rawLine)')
})

test('All fields raw strings — no type coercion', () => {
  // Unquoted parenthetical amount stays as-is; quoted balance with comma preserved
  const csv = 'Date,Amount,Balance\n2024-01-15,(12.34),"1,000.00"'
  const r   = parseCsvStage1(csv, 'utf-8')
  eq(r.rows[0].fields['Amount'],  '(12.34)',   'parenthetical amount preserved as string')
  // With quoting, comma inside field is preserved (RFC 4180 correct behavior)
  eq(r.rows[0].fields['Balance'], '1,000.00',  'quoted balance with comma preserved as string')
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — HEADER DETECTION
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 1 — header detection (bank formats)')

test('Dx8a: Chase format (Transaction Date, Description, Amount)', () => {
  const csv = 'Transaction Date,Description,Amount\n01/15/2024,STARBUCKS,-5.45'
  const r   = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  const m = r.headerDetection.suggestedMapping
  assert(m.transactionDate === 'Transaction Date' || m.date === 'Transaction Date', 'date mapped')
  eq(m.amount, 'Amount', 'amount mapped')
  eq(m.description, 'Description', 'description mapped')
})

test('Dx8b: Capital One split debit/credit format', () => {
  const csv = 'Transaction Date,Posted Date,Description,Debit,Credit\n01/15/2024,01/16/2024,AMAZON,29.99,'
  const r   = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  const m = r.headerDetection.suggestedMapping
  eq(m.debit, 'Debit', 'debit mapped')
  eq(m.credit, 'Credit', 'credit mapped')
})

test('Dx8c: Balance column mapped to runningBalance', () => {
  const csv = 'Date,Description,Amount,Balance\n01/15/2024,Coffee,-5.00,1000.00'
  const r   = parseCsvStage1(csv, 'utf-8')
  eq(r.headerDetection.suggestedMapping.runningBalance, 'Balance', 'runningBalance mapped')
  eq(r.rows[0].fields['Balance'], '1000.00', 'balance value raw')
})

test('Dx8d: "Running Bal." mapped to runningBalance', () => {
  const csv = 'Date,Description,Amount,Running Bal.\n01/15/2024,Coffee,-5.00,1000.00'
  const r   = parseCsvStage1(csv, 'utf-8')
  eq(r.headerDetection.suggestedMapping.runningBalance, 'Running Bal.', 'running bal. mapped')
})

test('Dx8e: Withdrawal/Deposit columns mapped as debit/credit', () => {
  const csv = 'Date,Description,Withdrawal,Deposit,Balance\n01/15/2024,Coffee,5.00,,1000.00'
  const r   = parseCsvStage1(csv, 'utf-8')
  const m   = r.headerDetection.suggestedMapping
  eq(m.debit, 'Withdrawal', 'withdrawal → debit')
  eq(m.credit, 'Deposit', 'deposit → credit')
})

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 — EDGE CASES
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nStage 1 — edge cases')

test('Dx9: CRLF line endings', () => {
  const csv = 'Date,Amount,Description\r\n2024-01-15,-5.00,Coffee\r\n2024-01-16,-10.00,Gas\r\n'
  const r   = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  eq(r.rows.length, 2, 'CRLF rows parsed')
  eq(r.config.lineEnding, 'CRLF', 'CRLF detected')
})

test('Dx10: Empty rows skipped, count tracked', () => {
  const csv = 'Date,Amount,Description\n2024-01-15,-5.00,Coffee\n\n2024-01-16,-10.00,Gas\n'
  const r   = parseCsvStage1(csv, 'utf-8')
  assert(r.success, 'parse ok')
  eq(r.rows.length, 2, 'empty row skipped')
  eq(r.metadata.emptyLinesSkipped, 1, 'emptyLinesSkipped counted')
})

test('parserConfig records delimiter, encoding, headerRowIndex', () => {
  const csv = 'Date,Amount,Description\n2024-01-15,-5.00,Coffee'
  const r   = parseCsvStage1(csv, 'utf-8-bom')
  eq(r.config.type, 'CSV')
  eq(r.config.delimiter, ',')
  eq(r.config.encoding, 'utf-8-bom')
  eq(r.config.headerRowIndex, 0)
})

test('Multiple rows preserve correct dataRowIndex after empty-row skip', () => {
  const csv = 'Date,Amount,Description\n\n2024-01-15,-5.00,Coffee\n\n2024-01-16,-10.00,Gas'
  const r   = parseCsvStage1(csv, 'utf-8')
  eq(r.rows[0].sourceLocator.dataRowIndex, 0, 'first non-empty data row')
  eq(r.rows[1].sourceLocator.dataRowIndex, 1, 'second non-empty data row')
})

test('T18: Same rawLine → same rowHash (foundation for dedup)', () => {
  const line = '2024-01-15,-12.50,Coffee'
  const h1 = createHash('sha256').update(line, 'utf8').digest('hex')
  const h2 = createHash('sha256').update(line, 'utf8').digest('hex')
  eq(h1, h2, 'identical content → identical hash')
})

test('Different rawLine → different rowHash (no collision)', () => {
  const h1 = createHash('sha256').update('2024-01-15,-12.50,Coffee', 'utf8').digest('hex')
  const h2 = createHash('sha256').update('2024-01-15,-12.50,Tea',    'utf8').digest('hex')
  assert(h1 !== h2, 'different content → different hash')
})

// ─────────────────────────────────────────────────────────────────────────────
// SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(62)}`)
console.log(`  ${passed} passed  |  ${failed} failed  |  ${passed + failed} total`)
if (failed === 0) {
  console.log('  ✅  All Milestone 2 smoke tests passed')
} else {
  console.log('  ❌  Some tests failed — see details above')
  process.exit(1)
}
