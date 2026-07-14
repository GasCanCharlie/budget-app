/**
 * QIF (Quicken Interchange Format) parser.
 *
 * QIF format:
 *   !Type:Bank          — header declares account type (Bank, CCard, Invst, etc.)
 *   D<date>             — transaction date
 *   T<amount>           — amount (signed; negative = debit for Bank; positive = debit for CCard)
 *   N<check/ref num>    — check number or reference
 *   P<payee>            — payee / merchant name
 *   M<memo>             — memo / description
 *   ^                   — end of record
 *
 * Date formats encountered in the wild:
 *   MM/DD/YYYY  MM/DD/YY  MM-DD-YYYY  YYYY-MM-DD  DD/MM/YYYY  M/D/YY
 *   Some exporters use ' (apostrophe) as a year separator: 1/15'2026
 */

export type QifAccountType = 'Bank' | 'CCard' | 'Invst' | 'Oth A' | 'Oth L' | 'Unknown'

export interface QifTransaction {
  date:       string          // raw date string as found in the file
  amount:     string          // signed decimal string, e.g. "-28.38"
  payee:      string          // P field
  memo:       string          // M field
  checkNum:   string | null   // N field
  parseOrder: number
}

export interface QifParseResult {
  transactions: QifTransaction[]
  accountType:  QifAccountType
}

// ─── Amount normalisation ─────────────────────────────────────────────────────

/** Strip commas from QIF amounts (e.g. "-1,234.56" → "-1234.56") */
function normalizeAmount(raw: string): string {
  return raw.replace(/,/g, '').trim()
}

// ─── Date normalisation ───────────────────────────────────────────────────────

/**
 * Best-effort QIF date parse → ISO string (YYYY-MM-DD).
 * Returns the raw string unchanged if no known pattern matches.
 */
export function parseQifDate(raw: string): string {
  const s = raw.trim().replace(/'/g, '-')  // some exporters use apostrophe as year separator

  // YYYY-MM-DD or YYYY/MM/DD
  if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split(/[-/]/)
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // MM/DD/YYYY or MM-DD-YYYY or M/D/YYYY
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) {
    const [m, d, y] = s.split(/[-/]/)
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // MM/DD/YY or M/D/YY  (pivot year: 00–49 → 2000s, 50–99 → 1900s)
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2}$/.test(s)) {
    const [m, d, yy] = s.split(/[-/]/)
    const y = parseInt(yy, 10) < 50 ? `20${yy.padStart(2, '0')}` : `19${yy.padStart(2, '0')}`
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // DD/MM/YYYY (detected when day > 12 — heuristic only)
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}$/.test(s)) {
    const [a, b, y] = s.split(/[-/]/)
    if (parseInt(a, 10) > 12) {
      return `${y}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
    }
  }

  return raw  // give up — return raw; the caller will handle date ambiguity
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseQif(text: string): QifParseResult {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')

  let accountType: QifAccountType = 'Unknown'
  const transactions: QifTransaction[] = []

  // Current record accumulator
  let date    = ''
  let amount  = ''
  let payee   = ''
  let memo    = ''
  let checkNum: string | null = null
  let hasData = false

  const flush = () => {
    if (!hasData) return
    transactions.push({
      date,
      amount:     normalizeAmount(amount),
      payee:      payee.trim(),
      memo:       memo.trim(),
      checkNum:   checkNum?.trim() || null,
      parseOrder: transactions.length,
    })
    date = ''; amount = ''; payee = ''; memo = ''; checkNum = null; hasData = false
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue

    const tag   = line[0].toUpperCase()
    const value = line.slice(1).trim()

    if (tag === '!') {
      // Header line — e.g. "!Type:Bank"
      const typeMatch = /^type:(.+)/i.exec(value)
      if (typeMatch) {
        const t = typeMatch[1].trim()
        if (t === 'Bank')        accountType = 'Bank'
        else if (t === 'CCard')  accountType = 'CCard'
        else if (t === 'Invst')  accountType = 'Invst'
        else if (t === 'Oth A')  accountType = 'Oth A'
        else if (t === 'Oth L')  accountType = 'Oth L'
      }
      continue
    }

    if (tag === '^') { flush(); continue }

    switch (tag) {
      case 'D': date     = value; hasData = true; break
      case 'T': amount   = value; hasData = true; break
      case 'P': payee    = value; hasData = true; break
      case 'M': memo     = value; break
      case 'N': checkNum = value; break
      // Skip investment-specific tags (Y, I, Q, O, $, etc.)
    }
  }

  flush()  // catch final record if no trailing ^

  // For CCard accounts, QIF amounts are typically positive for charges.
  // Normalise: charges → negative (consistent with how the app treats spending).
  if (accountType === 'CCard') {
    for (const tx of transactions) {
      const n = parseFloat(tx.amount)
      if (!isNaN(n) && n > 0) tx.amount = String(-n)
    }
  }

  return { transactions, accountType }
}
