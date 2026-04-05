/**
 * PDF Classification
 *
 * Determines whether a PDF is text-based or scanned, detects page count,
 * account number, statement date range, and multi-account structure.
 */

import { PDFParse } from 'pdf-parse'
import type { PdfClassification } from './types'
import { PDF_LIMITS } from './types'

// Minimum average chars per page to consider a PDF text-based (not scanned)
const MIN_CHARS_PER_PAGE = 100

// Patterns for account number detection (last 4 digits)
const ACCOUNT_LAST4_PATTERNS = [
  /account\s+(?:number|#|no\.?)[\s:]*(?:\S+\s+)*?(\d{4})\b/i,
  /acct[\s.:]*(?:\S+\s+)*?(\d{4})\b/i,
  /\*{3,}(\d{4})\b/,
  /x{3,}(\d{4})\b/i,
  /ending\s+(?:in\s+)?(\d{4})\b/i,
]

// Patterns for statement date range detection
const DATE_RANGE_PATTERNS = [
  // "Statement Period: 01/01/2024 - 01/31/2024"
  /statement\s+period[\s:]+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–to]+\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  // "From: 01/01/2024 To: 01/31/2024"
  /from[\s:]+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+to[\s:]+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  // "01/01/2024 - 01/31/2024" (bare date range)
  /(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/,
  // "2024-01-01 to 2024-01-31" ISO style
  /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i,
]

// Multi-account detection: look for repeated section markers
const MULTI_ACCOUNT_PATTERNS: RegExp[] = [
  /account\s+(?:number|summary|details?)[\s:]+/gi,
  /account\s+ending\s+in\s+\d{4}/gi,
]

/**
 * Parse a date string in common bank statement formats to ISO string.
 * Returns null if unparseable.
 */
function parseDateToIso(raw: string): string | null {
  const trimmed = raw.trim()

  // ISO already: 2024-01-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed
  }

  // MM/DD/YYYY or MM/DD/YY
  const mdyMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (mdyMatch) {
    let [, m, d, y] = mdyMatch
    if (y.length === 2) y = parseInt(y, 10) >= 50 ? `19${y}` : `20${y}`
    const month = m.padStart(2, '0')
    const day = d.padStart(2, '0')
    return `${y}-${month}-${day}`
  }

  return null
}

/**
 * Classify a PDF buffer before extraction.
 *
 * Throws if the PDF cannot be parsed at all (corrupt/unreadable).
 */
export async function classifyPdf(buffer: Buffer): Promise<PdfClassification> {
  let pageCount = 0
  let isEncrypted = false

  try {
    const parser = new PDFParse({ data: buffer })
    const textResult = await parser.getText()
    await parser.destroy()

    const pages = textResult.pages
    pageCount = textResult.total

    // Determine if text-based: average chars per page must exceed threshold
    const avgCharsPerPage = pages.length > 0
      ? pages.reduce((sum, p) => sum + p.text.length, 0) / pages.length
      : 0

    const isText = avgCharsPerPage >= MIN_CHARS_PER_PAGE

    const fullText = textResult.text || ''

    // Try to find account last 4 digits in full text
    let estimatedAccount: string | null = null
    for (const pattern of ACCOUNT_LAST4_PATTERNS) {
      const match = fullText.match(pattern)
      if (match?.[1]) {
        estimatedAccount = match[1]
        break
      }
    }

    // Try to find statement date range
    let statementStart: string | null = null
    let statementEnd: string | null = null
    for (const pattern of DATE_RANGE_PATTERNS) {
      const match = fullText.match(pattern)
      if (match?.[1] && match?.[2]) {
        statementStart = parseDateToIso(match[1])
        statementEnd = parseDateToIso(match[2])
        if (statementStart && statementEnd) break
      }
    }

    // Detect multi-account: count occurrences of account section markers
    let multiAccountSignals = 0
    for (const pattern of MULTI_ACCOUNT_PATTERNS) {
      // Reset lastIndex for global patterns before each use
      pattern.lastIndex = 0
      const matches = fullText.match(pattern) ?? []
      multiAccountSignals += matches.length
    }
    // If we see 3+ account section markers, flag as multi-account
    const isMultiAccount = multiAccountSignals >= 3

    return {
      isText,
      isEncrypted: false,
      pageCount,
      estimatedAccount,
      statementStart,
      statementEnd,
      isMultiAccount,
    }
  } catch (err: unknown) {
    // Detect encrypted PDF errors
    const message = err instanceof Error ? err.message : String(err)
    if (message.toLowerCase().includes('encrypt') || message.toLowerCase().includes('password')) {
      isEncrypted = true
      return {
        isText: false,
        isEncrypted: true,
        pageCount,
        estimatedAccount: null,
        statementStart: null,
        statementEnd: null,
        isMultiAccount: false,
      }
    }

    // Rethrow unknown errors
    throw new Error(`PDF classification failed: ${message}`)
  }
}

/**
 * Validate classification result and throw with user-friendly message
 * if the PDF is not processable.
 */
export function assertPdfProcessable(
  classification: PdfClassification,
  fileName: string,
): void {
  if (classification.isEncrypted) {
    throw new Error(
      `PDF_ENCRYPTED: "${fileName}" is password-protected. Remove the password and re-upload, or export a CSV from your bank instead.`,
    )
  }

  if (!classification.isText) {
    throw new Error(
      `PDF_SCANNED: "${fileName}" appears to be a scanned image rather than a text-based PDF. ` +
      `BudgetLens can only read text PDFs. Log into your bank and download a fresh statement — ` +
      `banks generate text-based PDFs by default when you export directly.`,
    )
  }

  if (classification.pageCount > PDF_LIMITS.MAX_PAGES) {
    throw new Error(
      `PDF_TOO_LONG: "${fileName}" has ${classification.pageCount} pages, but the limit is ${PDF_LIMITS.MAX_PAGES}. ` +
      `Split the statement into smaller date ranges and upload each separately.`,
    )
  }

  if (classification.isMultiAccount) {
    throw new Error(
      `PDF_MULTI_ACCOUNT: "${fileName}" appears to contain multiple accounts. ` +
      `Upload one account statement at a time, or export a CSV that contains only one account.`,
    )
  }
}
