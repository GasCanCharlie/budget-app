/**
 * PDF Classification
 *
 * Basic pre-flight checks before sending to Claude.
 * We skip pdf-parse entirely — Claude handles the content natively.
 */

import type { PdfClassification } from './types'
import { PDF_LIMITS } from './types'

// Rough byte-size proxy for page count: ~50KB per page is conservative
const BYTES_PER_PAGE_ESTIMATE = 50_000

/**
 * Classify a PDF buffer using basic heuristics only.
 * No text extraction — Claude handles that natively.
 */
export function classifyPdf(buffer: Buffer): PdfClassification {
  const text = buffer.toString('latin1')

  // Encrypted PDF detection
  const isEncrypted = /\/Encrypt\b/.test(text)

  // Estimate page count from PDF page markers
  const pageMatches = text.match(/\/Type\s*\/Page\b/g) ?? []
  const pageCount = pageMatches.length > 0
    ? pageMatches.length
    : Math.ceil(buffer.length / BYTES_PER_PAGE_ESTIMATE)

  // Scanned PDF detection: if almost no text streams, it's likely scanned
  // Look for BT (begin text) operators which indicate text content
  const textStreamCount = (text.match(/\bBT\b/g) ?? []).length
  const isText = textStreamCount > 0

  return {
    isText,
    isEncrypted,
    pageCount,
    estimatedAccount: null,   // Claude extracts this during parsing
    statementStart: null,     // Claude extracts this during parsing
    statementEnd: null,       // Claude extracts this during parsing
    isMultiAccount: false,    // Default — Claude can flag this
  }
}

/**
 * Validate classification and throw with user-friendly message if not processable.
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
      `PDF_TOO_LONG: "${fileName}" has approximately ${classification.pageCount} pages, but the limit is ${PDF_LIMITS.MAX_PAGES}. ` +
      `Split the statement into smaller date ranges and upload each separately.`,
    )
  }
}
