/**
 * PDF Ingestion — Intermediate Types
 *
 * CandidateTransaction is the rich intermediate type preserving provenance
 * from raw LLM extraction through to NormalizedTransaction mapping.
 */

// CandidateTransaction — rich intermediate type preserving provenance
export interface CandidateTransaction {
  id: string
  statementId: string
  pageSpan: { start: number; end: number }
  sourceLines: string[]
  rawDate: string | null
  rawDescription: string | null
  rawAmount: string | null
  rawBalance: string | null
  parsedDate: string | null        // ISO date string
  parsedDescription: string | null
  parsedAmount: number | null
  parsedBalance: number | null
  direction: 'debit' | 'credit' | 'unknown'
  confidence: number               // 0–1
  flags: string[]
  extractionMethod: 'deterministic' | 'llm'
}

export interface PdfClassification {
  isText: boolean                  // false = scanned/image
  isEncrypted: boolean
  pageCount: number
  estimatedAccount: string | null  // last 4 digits if detectable
  statementStart: string | null    // ISO date
  statementEnd: string | null      // ISO date
  isMultiAccount: boolean
}

export interface PdfExtractionResult {
  candidates: CandidateTransaction[]
  classification: PdfClassification
  pageTexts: string[]
  reconciliationIssues: ReconciliationIssue[]
  reviewRequired: boolean
}

export interface ReconciliationIssue {
  code: 'BALANCE_MISMATCH' | 'DUPLICATE_TRANSACTION' | 'OUT_OF_RANGE_DATE' | 'SIGN_INCONSISTENT' | 'MISSING_AMOUNT' | 'PARTIAL_ROW' | 'LOW_CONFIDENCE'
  severity: 'info' | 'warning' | 'error'
  candidateIds: string[]
  message: string
}

export const PDF_LIMITS = {
  MAX_PAGES: 30,
  CHUNK_SIZE: 5,          // pages per LLM chunk
  OVERLAP_LINES: 3,       // lines of overlap between chunks
  MIN_CONFIDENCE: 0.75,   // below this → review queue
  MAX_MODEL_CALLS: 10,    // hard cap on LLM calls per upload
} as const
