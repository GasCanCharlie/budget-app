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
