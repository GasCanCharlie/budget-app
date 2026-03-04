/**
 * CSV Parser — handles top bank formats + generic fallback
 * Phase 2 / Phase 8 requirements: warnings not errors, ambiguity surfaced to user
 */

import crypto from 'crypto'

export interface ParsedTransaction {
  rawDate: string
  rawDescription: string
  rawAmount: string
  rawCredit: string
  rawDebit: string
  rawBalance: string
  parsedDate: Date | null
  parsedDescription: string
  parsedAmount: number | null
  sourceRowHash: string
  lineIndex: number
  isForeignCurrency: boolean
  foreignAmount: string
  foreignCurrency: string
}

export interface ParseWarning {
  type: 'date_ambiguous' | 'amount_parse' | 'skipped_row' | 'foreign_currency' | 'extreme_amount'
  message: string
  lineIndex?: number
}

export interface ParseResult {
  transactions: ParsedTransaction[]
  warnings: ParseWarning[]
  formatDetected: string
  dateAmbiguous: boolean
  dateFormatSample: { line: number; rawDate: string; interpreted: string }[]
}

// ─── Bank format definitions ──────────────────────────────────────────────────

interface ColumnMap {
  date: number | string
  description: number | string
  amount?: number | string
  credit?: number | string
  debit?: number | string
  balance?: number | string
}

interface BankFormat {
  name: string
  headers: string[]   // all must match (lowercased, trimmed)
  columns: ColumnMap
}

const BANK_FORMATS: BankFormat[] = [
  {
    name: 'Chase',
    headers: ['transaction date', 'description', 'amount'],
    columns: { date: 'transaction date', description: 'description', amount: 'amount', balance: 'balance' }
  },
  {
    name: 'Bank of America',
    headers: ['date', 'description', 'amount', 'running bal.'],
    columns: { date: 'date', description: 'description', amount: 'amount', balance: 'running bal.' }
  },
  {
    name: 'Bank of America Alt',
    headers: ['date', 'payee', 'address', 'amount', 'running bal.'],
    columns: { date: 'date', description: 'payee', amount: 'amount', balance: 'running bal.' }
  },
  {
    name: 'Wells Fargo',
    headers: ['date', 'amount', 'description'],
    columns: { date: 'date', description: 'description', amount: 'amount' }
  },
  {
    name: 'Capital One',
    headers: ['transaction date', 'posted date', 'card no.', 'description', 'category', 'debit', 'credit'],
    columns: { date: 'transaction date', description: 'description', debit: 'debit', credit: 'credit' }
  },
  {
    name: 'Capital One Alt',
    headers: ['transaction date', 'posted date', 'description', 'debit', 'credit'],
    columns: { date: 'transaction date', description: 'description', debit: 'debit', credit: 'credit' }
  },
  {
    name: 'Citibank',
    headers: ['status', 'date', 'description', 'debit', 'credit'],
    columns: { date: 'date', description: 'description', debit: 'debit', credit: 'credit' }
  },
  {
    name: 'Discover',
    headers: ['trans. date', 'post date', 'description', 'amount', 'category'],
    columns: { date: 'trans. date', description: 'description', amount: 'amount' }
  },
  {
    name: 'American Express',
    headers: ['date', 'description', 'amount'],
    columns: { date: 'date', description: 'description', amount: 'amount' }
  },
  {
    name: 'US Bank',
    headers: ['date', 'transaction', 'name', 'memo', 'amount'],
    columns: { date: 'date', description: 'name', amount: 'amount' }
  },
  {
    name: 'TD Bank',
    headers: ['date', 'description', 'debit', 'credit', 'balance'],
    columns: { date: 'date', description: 'description', debit: 'debit', credit: 'credit', balance: 'balance' }
  },
  {
    name: 'PNC',
    headers: ['date', 'description', 'withdrawals', 'deposits', 'balance'],
    columns: { date: 'date', description: 'description', debit: 'withdrawals', credit: 'deposits', balance: 'balance' }
  },
  {
    name: 'USAA',
    headers: ['date', 'description', 'original description', 'category', 'amount', 'status'],
    columns: { date: 'date', description: 'description', amount: 'amount' }
  },
  {
    name: 'Ally',
    headers: ['date', 'time', 'amount', 'type', 'description'],
    columns: { date: 'date', description: 'description', amount: 'amount' }
  },
]

// ─── Date parsing ─────────────────────────────────────────────────────────────

const DATE_FORMATS = [
  { regex: /^(\d{4})-(\d{2})-(\d{2})$/, parse: (m: RegExpMatchArray) => new Date(+m[1], +m[2]-1, +m[3]), name: 'YYYY-MM-DD', ambiguous: false },
  { regex: /^(\d{2})\/(\d{2})\/(\d{4})$/, parse: (m: RegExpMatchArray) => new Date(+m[3], +m[1]-1, +m[2]), name: 'MM/DD/YYYY', ambiguous: true },
  { regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/, parse: (m: RegExpMatchArray) => new Date(+m[3], +m[1]-1, +m[2]), name: 'M/D/YYYY', ambiguous: true },
  { regex: /^(\d{4})\/(\d{2})\/(\d{2})$/, parse: (m: RegExpMatchArray) => new Date(+m[1], +m[2]-1, +m[3]), name: 'YYYY/MM/DD', ambiguous: false },
  { regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/, parse: (m: RegExpMatchArray) => new Date(+m[3], +m[1]-1, +m[2]), name: 'M-D-YYYY', ambiguous: true },
  { regex: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/, parse: (m: RegExpMatchArray) => new Date(`${m[1]} ${m[2]}, ${m[3]}`), name: 'Month D, YYYY', ambiguous: false },
  { regex: /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/, parse: (m: RegExpMatchArray) => new Date(`${m[2]} ${m[1]}, ${m[3]}`), name: 'D Month YYYY', ambiguous: false },
  { regex: /^(\d{4})(\d{2})(\d{2})$/, parse: (m: RegExpMatchArray) => new Date(+m[1], +m[2]-1, +m[3]), name: 'YYYYMMDD', ambiguous: false },
]

export function parseDate(raw: string): { date: Date | null; ambiguous: boolean; formatName: string } {
  const cleaned = raw.trim()
  for (const fmt of DATE_FORMATS) {
    const m = cleaned.match(fmt.regex)
    if (m) {
      const d = fmt.parse(m)
      if (!isNaN(d.getTime())) {
        // Sanity: reject dates more than 10 years in past or any in future
        const now = new Date()
        const tenYearsAgo = new Date(now.getFullYear() - 10, 0, 1)
        if (d < tenYearsAgo || d > now) continue
        return { date: d, ambiguous: fmt.ambiguous, formatName: fmt.name }
      }
    }
  }
  return { date: null, ambiguous: false, formatName: 'unknown' }
}

// ─── Amount parsing ───────────────────────────────────────────────────────────

const FOREIGN_CURRENCY_RE = /([A-Z]{3})\s+([\d,]+\.?\d*)|([\d,]+\.?\d*)\s*([A-Z]{3})/

export function parseAmount(raw: string, isCredit = false, isDebit = false): {
  amount: number | null
  isForeign: boolean
  foreignAmount: string
  foreignCurrency: string
} {
  if (!raw || raw.trim() === '' || raw.trim() === '-') {
    return { amount: null, isForeign: false, foreignAmount: '', foreignCurrency: '' }
  }

  let str = raw.trim()

  // Detect foreign currency
  const foreignMatch = str.match(FOREIGN_CURRENCY_RE)
  const isForeign = !!(foreignMatch && foreignMatch[0] !== str.replace(/[^A-Za-z]/g, ''))
  const foreignCurrency = foreignMatch ? (foreignMatch[1] || foreignMatch[4] || '') : ''

  // Determine sign from parentheses (accounting negative notation)
  const isNegativeParens = str.startsWith('(') && str.endsWith(')')
  if (isNegativeParens) str = str.slice(1, -1)

  // Strip currency symbols, spaces
  str = str.replace(/[$£€¥₹]/g, '').trim()

  // Handle European decimal format (1.234,56 → 1234.56)
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(str)) {
    str = str.replace(/\./g, '').replace(',', '.')
  } else {
    // Strip commas (thousands separator)
    str = str.replace(/,/g, '')
  }

  const num = parseFloat(str)
  if (isNaN(num)) return { amount: null, isForeign, foreignAmount: raw, foreignCurrency }

  let amount: number
  if (isDebit) {
    amount = -Math.abs(num)
  } else if (isCredit) {
    amount = Math.abs(num)
  } else if (isNegativeParens) {
    amount = -Math.abs(num)
  } else {
    amount = num
  }

  return { amount, isForeign, foreignAmount: isForeign ? raw : '', foreignCurrency }
}

// ─── Row hash ────────────────────────────────────────────────────────────────

function rowHash(accountId: string, date: string, description: string, amount: string, lineIndex: number): string {
  const data = `${accountId}|${date}|${description}|${amount}|${lineIndex}`
  return crypto.createHash('sha256').update(data).digest('hex')
}

// ─── Parse CSV rows ───────────────────────────────────────────────────────────

function splitCsvRow(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i+1] === '"') { current += '"'; i++ }
      else inQuotes = !inQuotes
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

// ─── Main parser ─────────────────────────────────────────────────────────────

export function parseCSV(rawText: string, accountId: string): ParseResult {
  const warnings: ParseWarning[] = []
  const transactions: ParsedTransaction[] = []

  // Strip BOM
  const text = rawText.replace(/^\uFEFF/, '')
  // Normalize line endings
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  // Find header row (first row that has non-numeric first cell)
  let headerIdx = -1
  let headerRow: string[] = []

  for (let i = 0; i < Math.min(10, lines.length); i++) {
    const row = splitCsvRow(lines[i])
    if (row.length >= 3 && isNaN(parseFloat(row[0])) && row[0].length > 0) {
      headerIdx = i
      headerRow = row.map(h => h.toLowerCase().replace(/["']/g, '').trim())
      break
    }
  }

  // Detect bank format
  let formatDetected = 'Generic'
  let colMap: ColumnMap | null = null

  if (headerIdx >= 0) {
    for (const fmt of BANK_FORMATS) {
      const allMatch = fmt.headers.every(h => headerRow.includes(h))
      if (allMatch) {
        formatDetected = fmt.name
        colMap = fmt.columns
        break
      }
    }

    // Generic fallback: look for date, description, amount columns
    if (!colMap) {
      const dateCol = headerRow.findIndex(h => h.includes('date'))
      const descCol = headerRow.findIndex(h =>
        h.includes('description') || h.includes('payee') || h.includes('merchant') || h.includes('name') || h.includes('memo')
      )
      const amtCol = headerRow.findIndex(h => h.includes('amount') || h.includes('debit') || h.includes('credit'))
      const debitCol = headerRow.findIndex(h => h.includes('debit') || h.includes('withdrawal'))
      const creditCol = headerRow.findIndex(h => h.includes('credit') || h.includes('deposit'))

      if (dateCol >= 0 && descCol >= 0) {
        colMap = {
          date: headerRow[dateCol],
          description: headerRow[descCol],
          ...(amtCol >= 0 && !headerRow[amtCol].includes('debit') ? { amount: headerRow[amtCol] } : {}),
          ...(debitCol >= 0 ? { debit: headerRow[debitCol] } : {}),
          ...(creditCol >= 0 ? { credit: headerRow[creditCol] } : {}),
        }
        formatDetected = 'Generic (auto-detected)'
      }
    }
  }

  // No header or no format — try positional
  if (!colMap) {
    formatDetected = 'Positional (no header)'
    warnings.push({ type: 'skipped_row', message: 'No header row detected — using positional column detection' })
    colMap = { date: 0, description: 1, amount: 2 }
    headerIdx = -1
  }

  // Resolve column name to index
  function colIndex(col: number | string): number {
    if (typeof col === 'number') return col
    return headerRow.indexOf(col)
  }

  const dateIdx = colIndex(colMap.date)
  const descIdx = colIndex(colMap.description)
  const amtIdx  = colMap.amount !== undefined ? colIndex(colMap.amount) : -1
  const debitIdx = colMap.debit !== undefined ? colIndex(colMap.debit) : -1
  const creditIdx = colMap.credit !== undefined ? colIndex(colMap.credit) : -1
  const balIdx   = colMap.balance !== undefined ? colIndex(colMap.balance) : -1

  let dateAmbiguous = false
  const dateFormatSample: ParseResult['dateFormatSample'] = []

  // Process rows
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line) continue

    const cells = splitCsvRow(line)
    if (cells.length < 2) continue

    const rawDate = dateIdx >= 0 ? (cells[dateIdx] || '') : ''
    const rawDesc = descIdx >= 0 ? (cells[descIdx] || '') : ''
    const rawAmt  = amtIdx >= 0  ? (cells[amtIdx]  || '') : ''
    const rawDebt = debitIdx >= 0  ? (cells[debitIdx]  || '') : ''
    const rawCred = creditIdx >= 0 ? (cells[creditIdx] || '') : ''
    const rawBal  = balIdx >= 0   ? (cells[balIdx]   || '') : ''

    // Skip summary rows (no valid date, or row is clearly a total)
    if (!rawDate && !rawDesc) { continue }
    if (rawDesc.toLowerCase().includes('total') && !rawDate) { continue }
    if (rawDesc.toLowerCase().includes('beginning balance')) { continue }

    // Parse date
    const { date, ambiguous, formatName } = parseDate(rawDate)
    if (!date) {
      warnings.push({ type: 'skipped_row', message: `Line ${i+1}: could not parse date "${rawDate}"`, lineIndex: i+1 })
      continue
    }
    if (ambiguous && !dateAmbiguous) {
      dateAmbiguous = true
      if (dateFormatSample.length < 3) {
        dateFormatSample.push({ line: i+1, rawDate, interpreted: date.toLocaleDateString('en-US') })
      }
    }

    // Parse amount
    let amountResult
    if (amtIdx >= 0 && rawAmt) {
      amountResult = parseAmount(rawAmt)
    } else if (debitIdx >= 0 || creditIdx >= 0) {
      // Debit = negative, credit = positive
      const debtResult  = parseAmount(rawDebt, false, true)
      const credResult  = parseAmount(rawCred, true, false)
      const debtAmt = debtResult.amount !== null ? -Math.abs(debtResult.amount) : null
      const credAmt = credResult.amount !== null ?  Math.abs(credResult.amount) : null

      if (debtAmt !== null || credAmt !== null) {
        amountResult = {
          amount: debtAmt ?? credAmt,
          isForeign: debtResult.isForeign || credResult.isForeign,
          foreignAmount: debtResult.foreignAmount || credResult.foreignAmount,
          foreignCurrency: debtResult.foreignCurrency || credResult.foreignCurrency,
        }
      } else {
        amountResult = { amount: null, isForeign: false, foreignAmount: '', foreignCurrency: '' }
      }
    } else {
      amountResult = { amount: null, isForeign: false, foreignAmount: '', foreignCurrency: '' }
    }

    if (amountResult.amount === null) {
      warnings.push({ type: 'amount_parse', message: `Line ${i+1}: could not parse amount`, lineIndex: i+1 })
      continue
    }

    // Reject extreme amounts (>$1,000,000)
    if (Math.abs(amountResult.amount) > 1_000_000) {
      warnings.push({ type: 'extreme_amount', message: `Line ${i+1}: amount ${amountResult.amount} exceeds $1M limit — skipped`, lineIndex: i+1 })
      continue
    }

    // Flag foreign currency
    if (amountResult.isForeign) {
      warnings.push({ type: 'foreign_currency', message: `Line ${i+1}: foreign currency detected — excluded from totals`, lineIndex: i+1 })
    }

    const hash = rowHash(accountId, rawDate, rawDesc, rawAmt || rawDebt || rawCred, i)

    transactions.push({
      rawDate,
      rawDescription: rawDesc,
      rawAmount:  rawAmt,
      rawCredit:  rawCred,
      rawDebit:   rawDebt,
      rawBalance: rawBal,
      parsedDate: date,
      parsedDescription: rawDesc,
      parsedAmount: amountResult.amount,
      sourceRowHash: hash,
      lineIndex: i,
      isForeignCurrency: amountResult.isForeign,
      foreignAmount: amountResult.foreignAmount,
      foreignCurrency: amountResult.foreignCurrency,
    })
  }

  return { transactions, warnings, formatDetected, dateAmbiguous, dateFormatSample }
}
