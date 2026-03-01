// ─────────────────────────────────────────────────────────────────────────────
// ImportReport — generated after the full ingestion pipeline completes.
// Stored as JSON in Upload.importReport.
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportReport {
  generatedAt: string          // ISO timestamp
  parserVersion: string
  bankProfileDetected: string | null
  columnMapping: Record<string, string>  // fieldName → detected column header

  dateFormat: {
    detected: string          // "MDY" | "DMY" | "YMD" | "unknown"
    ambiguousCount: number
    needsConfirmation: boolean
    samples: Array<{ line: number; raw: string; interpretedAs: string }>
  }

  rowCounts: {
    source: number            // total rows in file
    parsed: number            // after header detection
    committed: number         // successfully stored
    rejected: number          // REJECTED status
    pendingReview: number     // UNRESOLVED status
  }

  amounts: {
    committedTotal: string    // signed decimal string (exact), e.g. "-4521.33"
    currencyCode: string
  }

  categoryPreservation: {
    columnDetected: boolean
    columnHeader: string | null
    rowsWithValue: number
    rowsMissingValue: number
    preservedCount: number    // rows where bankCategoryRaw is non-null
    uniqueValues: string[]    // all distinct bank category values found
  }

  integrity: {
    hashesComputed: number
    // canonical hash = SHA-256(rawDate|rawDesc|rawAmount|bankCategoryRaw|rowIndex)
    // verified = re-computed hash matches what was stored
    hashesVerified: number
    hashMismatches: number
  }

  issues: Array<{
    type: string              // DATE_PARSE | AMOUNT_PARSE | MISSING_REQUIRED | etc.
    count: number
    samples: string[]         // up to 3 example descriptions
  }>
}

/**
 * Build a canonical string for hashing a transaction row.
 * Uses ONLY raw values — never parsed/normalized ones.
 */
export function buildCanonicalString(
  rawDate: string,
  rawDescription: string,
  rawAmount: string,
  bankCategoryRaw: string | null | undefined,
  rowIndex: number,
): string {
  return [rawDate, rawDescription, rawAmount, bankCategoryRaw ?? '', String(rowIndex)].join('|')
}

/**
 * Compute SHA-256 canonical hash for a transaction row.
 */
export function computeCanonicalRowHash(
  rawDate: string,
  rawDescription: string,
  rawAmount: string,
  bankCategoryRaw: string | null | undefined,
  rowIndex: number,
): string {
  const { createHash } = require('crypto') as typeof import('crypto')
  const canonical = buildCanonicalString(rawDate, rawDescription, rawAmount, bankCategoryRaw, rowIndex)
  return createHash('sha256').update(canonical).digest('hex')
}
