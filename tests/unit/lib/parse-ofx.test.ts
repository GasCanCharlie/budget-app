/**
 * Unit tests for parse-ofx.ts
 * Covers: parseOfxDate, detectOfxVariant, sniffIsOfxContent, isOfxFile, parseOfx,
 *         isGenericOfxName, chooseOfxDescription
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  parseOfxDate,
  detectOfxVariant,
  sniffIsOfxContent,
  isOfxFile,
  parseOfx,
  isGenericOfxName,
  chooseOfxDescription,
} from '@/lib/ingestion/parse-ofx'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Minimal valid OFX SGML body with two transactions */
const SAMPLE_OFX = `
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<LANGUAGE>ENG
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1001
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>321175261
<ACCTID>123456789
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260101
<DTEND>20260228
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260115000000.000[-10:HST]
<TRNAMT>-28.38
<FITID>20260115001
<NAME>WALMART STORE 4321
<MEMO>WALMART SUPERCENTER
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260120
<TRNAMT>1500.00
<FITID>20260120002
<NAME>DIRECT DEPOSIT
<MEMO>PAYROLL
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>3421.67
<DTASOF>20260228
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`.trim()

/** OFX with a check transaction */
const OFX_WITH_CHECK = `
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<ACCTID>9999
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>CHECK
<DTPOSTED>20260205
<TRNAMT>-250.00
<FITID>20260205003
<NAME>CHECK
<MEMO>CHECK #1042
<CHECKNUM>1042
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`.trim()

/** OFX with a malformed transaction missing DTPOSTED */
const OFX_MALFORMED = `
<OFX>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<TRNAMT>-10.00
<FITID>bad001
<NAME>NO DATE TXN
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260301
<TRNAMT>-5.00
<FITID>good001
<NAME>VALID TXN
</STMTTRN>
</BANKTRANLIST>
</OFX>
`.trim()

// ─── parseOfxDate ─────────────────────────────────────────────────────────────

describe('parseOfxDate', () => {
  it('parses 8-digit YYYYMMDD', () => {
    const d = parseOfxDate('20260115')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)   // 0-based January
    expect(d.getDate()).toBe(15)
  })

  it('parses full timestamp with timezone offset', () => {
    const d = parseOfxDate('20260228000000.000[-10:HST]')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(1)   // February
    expect(d.getDate()).toBe(28)
  })

  it('parses timestamp without timezone', () => {
    const d = parseOfxDate('20261231120000')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(11)  // December
    expect(d.getDate()).toBe(31)
  })

  it('handles leading/trailing whitespace', () => {
    const d = parseOfxDate('  20260120  ')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(20)
  })
})

// ─── detectOfxVariant ─────────────────────────────────────────────────────────

describe('detectOfxVariant', () => {
  it('returns OFX for .ofx extension', () => {
    expect(detectOfxVariant('statement.ofx')).toBe('OFX')
  })

  it('returns QFX for .qfx extension', () => {
    expect(detectOfxVariant('statement.qfx')).toBe('QFX')
  })

  it('returns QBO for .qbo extension', () => {
    expect(detectOfxVariant('statement.qbo')).toBe('QBO')
  })

  it('returns OFX as default for unknown extension', () => {
    expect(detectOfxVariant('statement.txt')).toBe('OFX')
  })

  it('is case-insensitive', () => {
    expect(detectOfxVariant('STATEMENT.QFX')).toBe('QFX')
    expect(detectOfxVariant('EXPORT.QBO')).toBe('QBO')
  })

  it('handles filenames with multiple dots', () => {
    expect(detectOfxVariant('my.bank.export.ofx')).toBe('OFX')
  })
})

// ─── sniffIsOfxContent ────────────────────────────────────────────────────────

describe('sniffIsOfxContent', () => {
  it('detects OFXHEADER in first 2KB', () => {
    expect(sniffIsOfxContent('OFXHEADER:100\nDATA:OFXSGML')).toBe(true)
  })

  it('detects <OFX> tag', () => {
    expect(sniffIsOfxContent('<OFX>\n<BANKMSGSRSV1>')).toBe(true)
  })

  it('detects <STMTTRN> tag', () => {
    expect(sniffIsOfxContent('some preamble\n<STMTTRN>\n<TRNTYPE>DEBIT')).toBe(true)
  })

  it('returns false for plain CSV text', () => {
    expect(sniffIsOfxContent('Date,Description,Amount\n2026-01-15,Coffee,-4.50')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(sniffIsOfxContent('')).toBe(false)
  })

  it('only checks first 2048 chars', () => {
    // OFX content buried past 2KB should not be detected
    const padding = 'x'.repeat(2048)
    expect(sniffIsOfxContent(padding + 'OFXHEADER:100')).toBe(false)
    // OFX content within first 2KB is detected
    expect(sniffIsOfxContent('OFXHEADER:100' + padding)).toBe(true)
  })
})

// ─── isOfxFile ────────────────────────────────────────────────────────────────

describe('isOfxFile', () => {
  it('returns true for .ofx extension', () => {
    expect(isOfxFile(Buffer.from('hello'), 'export.ofx')).toBe(true)
  })

  it('returns true for .qfx extension', () => {
    expect(isOfxFile(Buffer.from('hello'), 'export.qfx')).toBe(true)
  })

  it('returns true for .qbo extension', () => {
    expect(isOfxFile(Buffer.from('hello'), 'export.qbo')).toBe(true)
  })

  it('returns true for buffer starting with OFXHEADER', () => {
    const buf = Buffer.from('OFXHEADER:100\nDATA:OFXSGML')
    expect(isOfxFile(buf, 'export.csv')).toBe(true)
  })

  it('returns true for buffer starting with <OFX>', () => {
    const buf = Buffer.from('<OFX>\n<BANKMSGSRSV1>')
    expect(isOfxFile(buf, 'export.csv')).toBe(true)
  })

  it('returns false for CSV file with no OFX markers', () => {
    const buf = Buffer.from('Date,Description,Amount\n2026-01-15,Coffee,-4.50')
    expect(isOfxFile(buf, 'transactions.csv')).toBe(false)
  })
})

// ─── parseOfx ─────────────────────────────────────────────────────────────────

describe('parseOfx', () => {
  describe('sample OFX with two transactions', () => {
    let result: ReturnType<typeof parseOfx>
    beforeAll(() => { result = parseOfx(SAMPLE_OFX) })

    it('extracts two transactions', () => {
      expect(result.transactions).toHaveLength(2)
    })

    it('parses envelope fields', () => {
      expect(result.currency).toBe('USD')
      expect(result.ofxAccountId).toBe('123456789')
      expect(result.accountType).toBe('CHECKING')
      expect(result.bankId).toBe('321175261')
      expect(result.dtStart).toBe('20260101')
      expect(result.dtEnd).toBe('20260228')
    })

    it('parses ledger balance', () => {
      expect(result.ledgerBalance).toBeCloseTo(3421.67)
    })

    it('parses first transaction (debit)', () => {
      const tx = result.transactions[0]
      expect(tx.trnType).toBe('DEBIT')
      expect(tx.dtPosted).toBe('20260115000000.000[-10:HST]')
      expect(tx.trnAmt).toBe('-28.38')
      expect(tx.fitId).toBe('20260115001')
      expect(tx.name).toBe('WALMART STORE 4321')
      expect(tx.memo).toBe('WALMART SUPERCENTER')
      expect(tx.checkNum).toBeNull()
      expect(tx.parseOrder).toBe(0)
    })

    it('parses second transaction (credit)', () => {
      const tx = result.transactions[1]
      expect(tx.trnType).toBe('CREDIT')
      expect(tx.dtPosted).toBe('20260120')
      expect(tx.trnAmt).toBe('1500.00')
      expect(tx.fitId).toBe('20260120002')
      expect(tx.name).toBe('DIRECT DEPOSIT')
      expect(tx.memo).toBe('PAYROLL')
      expect(tx.parseOrder).toBe(1)
    })

    it('includes rawBlock for each transaction', () => {
      for (const tx of result.transactions) {
        expect(tx.rawBlock).toContain('<STMTTRN>')
        expect(tx.rawBlock).toContain('</STMTTRN>')
      }
    })
  })

  describe('check transaction', () => {
    it('parses checkNum', () => {
      const result = parseOfx(OFX_WITH_CHECK)
      expect(result.transactions).toHaveLength(1)
      const tx = result.transactions[0]
      expect(tx.checkNum).toBe('1042')
      expect(tx.trnAmt).toBe('-250.00')
    })
  })

  describe('malformed transactions', () => {
    it('skips entries missing DTPOSTED or TRNAMT', () => {
      const result = parseOfx(OFX_MALFORMED)
      // Only the valid transaction (with DTPOSTED) should be included
      expect(result.transactions).toHaveLength(1)
      expect(result.transactions[0].fitId).toBe('good001')
    })
  })

  describe('empty / no transactions', () => {
    it('returns empty array for OFX with no STMTTRN blocks', () => {
      const result = parseOfx('<OFX><BANKMSGSRSV1></BANKMSGSRSV1></OFX>')
      expect(result.transactions).toHaveLength(0)
    })

    it('defaults currency to USD when CURDEF absent', () => {
      const result = parseOfx('<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260101<TRNAMT>-1.00<FITID>x</STMTTRN></BANKTRANLIST></OFX>')
      expect(result.currency).toBe('USD')
    })
  })

  describe('FITID uniqueness (dedup key)', () => {
    it('each transaction has a distinct fitId', () => {
      const result = parseOfx(SAMPLE_OFX)
      const ids = result.transactions.map(t => t.fitId)
      expect(new Set(ids).size).toBe(ids.length)
    })
  })

  describe('amount parsing', () => {
    it('preserves sign of negative amounts', () => {
      const result = parseOfx(SAMPLE_OFX)
      expect(parseFloat(result.transactions[0].trnAmt)).toBeLessThan(0)
    })

    it('preserves positive amounts', () => {
      const result = parseOfx(SAMPLE_OFX)
      expect(parseFloat(result.transactions[1].trnAmt)).toBeGreaterThan(0)
    })
  })
})

// ─── isGenericOfxName ─────────────────────────────────────────────────────────

describe('isGenericOfxName', () => {
  it('treats null/undefined/empty as generic', () => {
    expect(isGenericOfxName(null)).toBe(true)
    expect(isGenericOfxName(undefined)).toBe(true)
    expect(isGenericOfxName('')).toBe(true)
    expect(isGenericOfxName('  ')).toBe(true)
  })

  it('treats names shorter than 3 chars as generic', () => {
    expect(isGenericOfxName('AB')).toBe(true)
    expect(isGenericOfxName('x')).toBe(true)
  })

  // Exact single-word generics
  it.each([
    'Posted', 'POSTED', 'posted',
    'Pending', 'Debit', 'Credit', 'Purchase', 'Payment',
    'Transaction', 'Check', 'ACH', 'Wire', 'Wire Transfer',
    'Withdrawal', 'Deposit', 'Transfer',
    'POS', 'ATM', 'VISA', 'Mastercard',
    'Unknown', 'undefined',
  ])('treats "%s" as generic', name => {
    expect(isGenericOfxName(name)).toBe(true)
  })

  // Multi-word bank patterns
  it.each([
    'POS DEBIT', 'POS CREDIT',
    'ATM WITHDRAWAL', 'ATM DEPOSIT',
    'VISA PURCHASE', 'VISA DEBIT', 'VISA CREDIT',
    'MASTERCARD PURCHASE',
    'DEBIT CARD PURCHASE', 'CARD PURCHASE', 'CARD PAYMENT',
    'ONLINE TRANSFER', 'ONLINE PAYMENT',
    'MOBILE PAYMENT', 'BILL PAYMENT',
    'DIRECT DEBIT', 'DIRECT PAYMENT',
    'POINT OF SALE',
    'ACH DEBIT', 'ACH CREDIT', 'ACH PAYMENT',
    'WIRE TRANSFER',
    'RECURRING PAYMENT',
    'PREAUTHORIZED DEBIT', 'PREAUTHORIZED PAYMENT',
  ])('treats "%s" as generic', name => {
    expect(isGenericOfxName(name)).toBe(true)
  })

  // Real merchant names — must NOT be treated as generic
  it.each([
    'STARBUCKS',
    'Walmart Supercenter',
    'Amazon.com',
    'COSTCO WHSE #1234',
    'NETFLIX.COM',
    'Apple Store',
    'SHELL OIL',
    'MCDONALD S',
    'TARGET STORE',
    'WHOLE FOODS MKT',
    'CHEVRON',
    'HAWAIIAN AIRLINES',
  ])('does NOT treat "%s" as generic', name => {
    expect(isGenericOfxName(name)).toBe(false)
  })
})

// ─── chooseOfxDescription ─────────────────────────────────────────────────────

describe('chooseOfxDescription', () => {
  it('uses MEMO when NAME is "Posted" (Hawaii credit union pattern)', () => {
    const { descNorm } = chooseOfxDescription('Posted', 'STARBUCKS KANEOHE HI', 'DEBIT')
    expect(descNorm).toBe('STARBUCKS KANEOHE HI')
  })

  it('uses MEMO when NAME is "POS DEBIT"', () => {
    const { descNorm } = chooseOfxDescription('POS DEBIT', 'AMAZON.COM PURCHASE', 'DEBIT')
    expect(descNorm).toBe('AMAZON.COM PURCHASE')
  })

  it('uses MEMO when NAME is "ATM WITHDRAWAL"', () => {
    const { descNorm } = chooseOfxDescription('ATM WITHDRAWAL', 'FIRST HAWAIIAN BANK ATM', 'DEBIT')
    expect(descNorm).toBe('FIRST HAWAIIAN BANK ATM')
  })

  it('uses NAME when it is a real merchant', () => {
    const { descNorm } = chooseOfxDescription('COSTCO WHSE', 'COSTCO WHOLESALE WAREHOUSE 0133', 'DEBIT')
    expect(descNorm).toBe('COSTCO WHSE')
  })

  it('uses MEMO as raw desc even when NAME is real', () => {
    const { descRaw } = chooseOfxDescription('NETFLIX', 'NETFLIX.COM MONTHLY SUBSCRIPTION', 'DEBIT')
    expect(descRaw).toBe('NETFLIX.COM MONTHLY SUBSCRIPTION')
  })

  it('falls back to trnType when NAME and MEMO are both empty', () => {
    const { descNorm } = chooseOfxDescription('', '', 'DEBIT')
    expect(descNorm).toBe('DEBIT')
  })

  it('falls back to trnType when NAME is generic and MEMO is empty', () => {
    const { descNorm } = chooseOfxDescription('Posted', '', 'CREDIT')
    expect(descNorm).toBe('CREDIT')
  })

  it('uses MEMO when NAME is "VISA PURCHASE"', () => {
    const { descNorm } = chooseOfxDescription('VISA PURCHASE', 'TARGET STORE #0441', 'DEBIT')
    expect(descNorm).toBe('TARGET STORE #0441')
  })

  it('uses MEMO when NAME is "DIRECT DEBIT"', () => {
    const { descNorm } = chooseOfxDescription('DIRECT DEBIT', 'HAWAIIAN ELECTRIC CO', 'DEBIT')
    expect(descNorm).toBe('HAWAIIAN ELECTRIC CO')
  })

  it('is case-insensitive for NAME matching', () => {
    const { descNorm } = chooseOfxDescription('pos debit', 'WHOLE FOODS MKT', 'DEBIT')
    expect(descNorm).toBe('WHOLE FOODS MKT')
  })
})
