/**
 * OFX / QFX parser — SGML v1.x (the format exported by most US banks).
 *
 * OFX SGML has:
 *   - A plain-text header block (KEY:VALUE lines, terminated by a blank line)
 *   - An SGML body where leaf tags carry their value inline with NO closing tag
 *     e.g.  <TRNAMT>-28.38   (no </TRNAMT>)
 *   - Container tags DO have matching closing tags
 *     e.g.  <STMTTRN>...</STMTTRN>
 *
 * OFX date format: YYYYMMDD[HHMMSS[.mmm]][[-|+]HH:TZ]
 *   e.g. "20260228000000.000[-10:HST]"  →  2026-02-28
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OfxTransaction {
  trnType:    string          // CREDIT | DEBIT | CHECK | DEP | PAYMENT | OTHER
  dtPosted:   string          // raw OFX date string
  trnAmt:     string          // signed decimal, e.g. "-28.38"
  fitId:      string          // bank's unique transaction ID
  name:       string          // payee / merchant short name
  memo:       string          // detailed description (often longer than name)
  checkNum:   string | null   // check number (checks only)
  rawBlock:   string          // full <STMTTRN>…</STMTTRN> text (used for hashing)
  parseOrder: number
}

export interface OfxParseResult {
  transactions:   OfxTransaction[]
  currency:       string        // CURDEF
  ofxAccountId:   string        // ACCTID from BANKACCTFROM
  accountType:    string        // CHECKING | SAVINGS | CREDITLINE | etc.
  bankId:         string        // BANKID
  dtStart:        string        // DTSTART
  dtEnd:          string        // DTEND
  ledgerBalance:  number | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse OFX date string → JS Date at local midnight. */
export function parseOfxDate(dtStr: string): Date {
  const s = dtStr.trim()
  const y = parseInt(s.slice(0, 4), 10)
  const m = parseInt(s.slice(4, 6), 10) - 1   // 0-based month
  const d = parseInt(s.slice(6, 8), 10)
  return new Date(y, m, d)
}

/** Extract the value of a leaf tag within a block (case-insensitive). */
function field(block: string, tag: string): string {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, 'i')
  const m = re.exec(block)
  return m ? m[1].trim() : ''
}

// ─── OFX merchant selection ───────────────────────────────────────────────────

/**
 * Bank-assigned generic labels that carry no merchant identity.
 * Exact lowercase match after trimming.
 */
const GENERIC_OFX_NAMES = new Set([
  'posted', 'pending', 'debit', 'credit', 'purchase', 'payment',
  'transaction', 'check', 'ach', 'wire', 'wire transfer', 'withdrawal',
  'deposit', 'transfer', 'undefined', 'unknown', 'n/a', 'not provided',
  'pos', 'atm', 'visa', 'mastercard', 'mc', 'card',
  'electronic', 'electronic payment', 'electronic transfer',
  'online', 'mobile', 'internet', 'bill', 'direct',
  'preauth', 'preauthorized', 'recurring',
])

/**
 * Multi-word generic bank patterns that contain meaningful words but still
 * describe the transaction type rather than the actual merchant.
 * Anchored at start, word-boundary at end so "POS DEBIT STARBUCKS" is NOT caught.
 */
const GENERIC_OFX_PATTERN = /^(pos\s+debit|pos\s+credit|atm\s+withdrawal|atm\s+deposit|visa\s+purchase|visa\s+debit|visa\s+credit|mastercard\s+purchase|debit\s+card\s+purchase|debit\s+card\s+payment|credit\s+card\s+payment|card\s+purchase|card\s+payment|online\s+transfer|online\s+payment|mobile\s+payment|bill\s+payment|direct\s+debit|direct\s+payment|point\s+of\s+sale|bank\s+transfer|electronic\s+payment|interbank\s+transfer|wire\s+transfer|ach\s+debit|ach\s+credit|ach\s+payment|recurring\s+payment|internet\s+banking|net\s+banking|preauthorized\s+(debit|payment|transfer))$/i

/** True when the OFX NAME field is a bank-assigned transaction-type label, not a merchant name. */
export function isGenericOfxName(name: string | null | undefined): boolean {
  if (!name) return true
  const normalized = name.trim().toLowerCase()
  if (normalized.length < 3) return true
  if (GENERIC_OFX_NAMES.has(normalized)) return true
  if (GENERIC_OFX_PATTERN.test(normalized)) return true
  return false
}

/**
 * Format-specific mapper for OFX transactions.
 * Returns { descRaw, descNorm } where:
 *   descRaw  — best raw text for storage (what the bank actually said)
 *   descNorm — best display text (merchant-oriented, used for merchantNormalized)
 *
 * Priority when NAME is generic: MEMO → trnType → NAME
 * Priority when NAME is real:    NAME for display, MEMO for raw context
 */
export function chooseOfxDescription(
  name: string,
  memo: string,
  trnType: string,
): { descRaw: string; descNorm: string } {
  const nameT = name.trim()
  const memoT = memo.trim()

  if (isGenericOfxName(nameT)) {
    // NAME is a bank label — real merchant is in MEMO (or trnType as last resort)
    const best = memoT || trnType.trim() || nameT
    return { descRaw: best, descNorm: best }
  }

  // NAME looks like a real merchant name.
  // Keep MEMO as the raw description (often longer/more detailed),
  // but use NAME as the normalized display value.
  return { descRaw: memoT || nameT, descNorm: nameT || memoT }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect OFX family variant from file extension.
 * All three share the same SGML structure — variant is purely cosmetic.
 *   .ofx  → standard bank export (Chase, BofA, etc.)
 *   .qfx  → Quicken WebConnect
 *   .qbo  → QuickBooks Online bank download (same SGML, different extension)
 */
export function detectOfxVariant(fileName: string): 'OFX' | 'QFX' | 'QBO' {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  if (ext === '.qfx') return 'QFX'
  if (ext === '.qbo') return 'QBO'
  return 'OFX'
}

/** Content-sniff: does the first 2 KB look like OFX SGML? */
export function sniffIsOfxContent(text: string): boolean {
  const head = text.slice(0, 2048)
  return head.includes('OFXHEADER') || head.includes('<OFX>') || head.includes('<STMTTRN>')
}

/** Returns true if the file looks like OFX/QFX/QBO (by extension or content). */
export function isOfxFile(buffer: Buffer, fileName: string): boolean {
  const ext = fileName.slice(fileName.lastIndexOf('.')).toLowerCase()
  if (ext === '.ofx' || ext === '.qfx' || ext === '.qbo') return true
  const head = buffer.slice(0, 20).toString('ascii')
  return head.startsWith('OFXHEADER') || head.startsWith('<OFX>')
}

/**
 * Parse OFX text into structured transactions.
 * Works with both SGML v1 and XML v2 (XML is valid SGML for our purposes).
 */
export function parseOfx(text: string): OfxParseResult {
  // Skip the key:value header block — body starts at <OFX>
  const bodyStart = text.indexOf('<OFX>')
  const body = bodyStart >= 0 ? text.slice(bodyStart) : text

  // Envelope fields
  const currency      = field(body, 'CURDEF') || 'USD'
  const ofxAccountId  = field(body, 'ACCTID')
  const accountType   = field(body, 'ACCTTYPE')
  const bankId        = field(body, 'BANKID')
  const dtStart       = field(body, 'DTSTART')
  const dtEnd         = field(body, 'DTEND')

  // Ledger balance (first <BALAMT> inside <LEDGERBAL>)
  const ledgerBalStr  = field(body, 'BALAMT')
  const ledgerBalance = ledgerBalStr ? parseFloat(ledgerBalStr) : null

  // Extract all <STMTTRN>…</STMTTRN> blocks
  const transactions: OfxTransaction[] = []
  const blockRe = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/gi
  let match: RegExpExecArray | null
  let parseOrder = 0

  while ((match = blockRe.exec(body)) !== null) {
    const rawBlock = match[0]
    const block    = match[1]

    const dtPosted = field(block, 'DTPOSTED')
    const trnAmt   = field(block, 'TRNAMT')

    // Skip malformed entries that lack essential fields
    if (!dtPosted || !trnAmt) continue

    transactions.push({
      trnType:  field(block, 'TRNTYPE'),
      dtPosted,
      trnAmt,
      fitId:    field(block, 'FITID'),
      name:     field(block, 'NAME'),
      memo:     field(block, 'MEMO'),
      checkNum: field(block, 'CHECKNUM') || null,
      rawBlock,
      parseOrder,
    })
    parseOrder++
  }

  return { transactions, currency, ofxAccountId, accountType, bankId, dtStart, dtEnd, ledgerBalance }
}
