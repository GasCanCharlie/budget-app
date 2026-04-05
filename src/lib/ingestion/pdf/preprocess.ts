/**
 * PDF Preprocessing
 *
 * Deterministic text cleaning before LLM extraction:
 * - Remove page numbers, bank logo text, legal boilerplate
 * - Group continuation lines with the transaction line they belong to
 * - Mark obvious amount and date patterns with annotations
 */

// Patterns for legal boilerplate and bank noise
const BOILERPLATE_PATTERNS: RegExp[] = [
  // Page number lines: "Page 1 of 5", "- 1 -", "1"
  /^page\s+\d+\s+of\s+\d+$/i,
  /^-\s*\d+\s*-$/,
  /^\d+\s*$/,
  // Common legal footers
  /^this\s+statement\s+is\s+provided\s+/i,
  /^please\s+review\s+this\s+statement\s+/i,
  /^if\s+you\s+have\s+questions\s+/i,
  /^member\s+fdic/i,
  /^equal\s+housing\s+(lender|opportunity)/i,
  /^continued\s+on\s+next\s+page$/i,
  /^continued\s+from\s+previous\s+page$/i,
  /^\*+\s*$/,    // lines of asterisks only
  /^-+\s*$/,    // lines of dashes only
  /^={3,}\s*$/,  // lines of equals only
]

// Amount patterns that indicate a financial value
const AMOUNT_PATTERN = /\$[\d,]+\.\d{2}|[\d,]+\.\d{2}\s*[CDR]?/g

// Date patterns commonly found in bank statements
const DATE_PATTERNS: RegExp[] = [
  /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/,   // MM/DD/YYYY or MM/DD/YY
  /\b\d{4}-\d{2}-\d{2}\b/,            // YYYY-MM-DD
  /\b\d{1,2}\/\d{1,2}\b/,             // MM/DD (no year, some banks)
]

/**
 * Check if a line starts with a date pattern.
 * Transaction lines in bank statements typically begin with the date.
 */
function startsWithDate(line: string): boolean {
  const trimmed = line.trim()
  return DATE_PATTERNS.some((pattern) => pattern.test(trimmed.slice(0, 12)))
}

/**
 * Check if a line is likely boilerplate (page number, legal text, etc.)
 */
function isBoilerplate(line: string): boolean {
  const trimmed = line.trim()
  if (trimmed.length === 0) return false
  return BOILERPLATE_PATTERNS.some((p) => p.test(trimmed))
}

/**
 * Annotate a line to mark obvious financial amounts and dates.
 * This helps the LLM parse values more reliably.
 */
function annotateLine(line: string): string {
  // Mark date patterns at start of line with [DATE] tag
  let annotated = line.replace(
    /^(\s*)(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/,
    (match) => `[DATE]${match}`,
  )

  // Mark amount patterns with [AMT] — avoid double-annotating
  annotated = annotated.replace(AMOUNT_PATTERN, (match) => `[AMT:${match}]`)

  return annotated
}

/**
 * Preprocess a single page's text:
 * 1. Remove boilerplate lines
 * 2. Group continuation lines with their parent transaction line
 * 3. Annotate amounts and dates
 *
 * Returns cleaned text ready for the LLM.
 */
export function preprocessPage(pageText: string): string {
  const lines = pageText.split('\n')
  const cleaned: string[] = []
  let lastTxLine = -1

  for (const raw of lines) {
    const line = raw.trimEnd()
    const trimmed = line.trim()

    // Keep page boundary markers intact
    if (trimmed.startsWith('--- PAGE')) {
      cleaned.push(line)
      continue
    }

    // Skip boilerplate
    if (isBoilerplate(trimmed)) continue

    // Skip empty lines (we'll re-add single blank lines as paragraph separators)
    if (trimmed.length === 0) {
      // Only add a blank line if we have content and the last line wasn't blank
      if (cleaned.length > 0 && cleaned[cleaned.length - 1]?.trim() !== '') {
        cleaned.push('')
      }
      continue
    }

    if (startsWithDate(trimmed)) {
      // New transaction line
      cleaned.push(annotateLine(line))
      lastTxLine = cleaned.length - 1
    } else if (
      lastTxLine >= 0 &&
      !trimmed.startsWith('---') &&
      cleaned.length > 0 &&
      cleaned[cleaned.length - 1]?.trim() !== ''
    ) {
      // Continuation line: merge with the last transaction line
      // (only if the line doesn't have its own date, indicating a new transaction)
      cleaned[cleaned.length - 1] += ' ' + trimmed
    } else {
      // Non-transaction line (headers, totals, etc.) — keep as-is
      cleaned.push(annotateLine(line))
    }
  }

  // Collapse multiple blank lines to a single one
  const result: string[] = []
  for (const line of cleaned) {
    if (line.trim() === '' && result[result.length - 1]?.trim() === '') continue
    result.push(line)
  }

  return result.join('\n').trim()
}

/**
 * Preprocess all pages' text.
 */
export function preprocessPages(pageTexts: string[]): string[] {
  return pageTexts.map(preprocessPage)
}
