/**
 * Unit tests for parse-ofx.ts
 * Covers: parseOfxDate, detectOfxVariant, sniffIsOfxContent, isOfxFile, parseOfx
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  parseOfxDate,
  detectOfxVariant,
  sniffIsOfxContent,
  isOfxFile,
  parseOfx,
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
