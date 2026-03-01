/**
 * BudgetLens — Financial-Grade Ingestion Type System
 *
 * Design contract: every type here maps 1:1 to a DB column, JSON blob field,
 * or pipeline intermediate. Nothing is inferred or invented at runtime.
 *
 * SQLite storage notes:
 *  - All JSON fields are stored as String in DB (SQLite has no native Json type)
 *  - All Decimal/financial values are stored as String (e.g. "1234.56") to
 *    guarantee cent-level precision (SQLite REAL is floating-point)
 *  - Enum-like string fields are documented with their valid values above
 *    the field definition in schema.prisma
 */

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE LOCATORS
// Every TransactionRaw row carries a sourceLocator so it can be traced back
// to the exact position in the original file.
// ─────────────────────────────────────────────────────────────────────────────

export interface CsvXlsxSourceLocator {
  type: 'CSV' | 'XLSX'
  /** Sheet name; null for CSV (single-sheet) */
  sheetName: string | null
  /** 0-based row index in the raw file including header rows */
  rowIndex: number
  /** 0-based index among data rows only (header rows excluded) */
  dataRowIndex: number
}

export interface PdfSourceLocator {
  type: 'PDF'
  /** 1-based page number */
  pageNumber: number
  /** Deterministic line identifier: `p{page}_l{lineIndex}` */
  lineId: string
  /** Bounding box in the PDF coordinate system (optional, present when available) */
  boundingBox?: {
    top: number
    left: number
    width: number
    height: number
  }
  /**
   * OCR confidence 0.0–1.0.
   * null = text-based PDF (no OCR).
   * Values below OCR_CONFIDENCE_THRESHOLD cause the upload to be rejected.
   */
  ocrConfidence?: number
}

export type SourceLocator = CsvXlsxSourceLocator | PdfSourceLocator

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORMATION LOG
// Every normalization step (trim, date parse, amount parse, etc.) appends one
// TransformationStep to the transaction's transformations[] array.
// Nothing is normalized silently.
// ─────────────────────────────────────────────────────────────────────────────

/** Valid rule names for TransformationStep.rule */
export type TransformationRule =
  | 'STRIP_BOM'
  | 'TRIM_WHITESPACE'
  | 'COLLAPSE_WHITESPACE'
  | 'NORMALIZE_LINEBREAK'
  | 'STRIP_CURRENCY_SYMBOL'
  | 'STRIP_THOUSANDS_SEPARATOR'
  | 'PARSE_PARENTHETICAL_NEGATIVE'
  | 'PARSE_TRAILING_MINUS'
  | 'PARSE_EUROPEAN_DECIMAL'
  | 'SPLIT_DEBIT_CREDIT_COLUMNS'
  | 'DATE_RESOLVED_MM_DD'
  | 'DATE_RESOLVED_DD_MM'
  | 'DATE_RESOLVED_ISO'
  | 'DATE_RESOLVED_YYYY_MM_DD'
  | 'MERGE_LINE_WRAP'
  | 'STRIP_PENDING_FLAG'
  | (string & {}) // allow extension without breaking existing code

export interface TransformationStep {
  /** Which field was transformed: "date" | "amount" | "description" | ... */
  field: string
  /** The rule applied (see TransformationRule) */
  rule: TransformationRule
  /** Raw value before transformation */
  before: string
  /** Value after transformation */
  after: string
  /** ISO 8601 timestamp of when this step ran */
  timestamp: string
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER CONFIGURATIONS
// Stored on Upload.parserConfig (JSON string) so the exact settings used for
// a parse can be reproduced. Same file + same parserConfig = identical output.
// ─────────────────────────────────────────────────────────────────────────────

export interface CsvParserConfig {
  type: 'CSV'
  /** Detected field delimiter: "," | "\t" | ";" | "|" */
  delimiter: string
  /** Quote character (RFC 4180 default: '"') */
  quoteChar: string
  /** Detected character encoding: "utf-8" | "utf-8-bom" | "utf-16-le" | "utf-16-be" | "latin1" */
  encoding: string
  /** 0-based row index of the header row */
  headerRowIndex: number
  /** 0-based row index of the first data row */
  dataStartIndex: number
  /** True if rows end with a trailing delimiter before the line break */
  hasTrailingDelimiter: boolean
  /** Detected line ending style */
  lineEnding: 'LF' | 'CRLF' | 'CR'
}

export interface XlsxParserConfig {
  type: 'XLSX'
  /** Name of the sheet that was parsed */
  sheetName: string
  /** 0-based row index of the header row */
  headerRowIndex: number
  /** 0-based row index of the first data row */
  dataStartIndex: number
  /** Number of hidden rows detected and skipped */
  hiddenRowsDetected: number
  /** Number of merged cells detected (may cause UNRESOLVED issues) */
  mergedCellsDetected: number
}

export interface PdfParserConfig {
  type: 'PDF'
  /** Total pages in the document */
  totalPages: number
  /** Page regions identified as transaction tables */
  tableRegions: Array<{
    pageNumber: number
    /** Y-coordinate of table top (PDF units) */
    topY: number
    /** Y-coordinate of table bottom (PDF units) */
    bottomY: number
  }>
  /** True if OCR was required (scanned document) */
  ocrRequired: boolean
  /**
   * Minimum acceptable OCR confidence threshold (0.0–1.0).
   * Default 0.95. Uploads below this are rejected with UNSUPPORTED status.
   */
  ocrConfidenceThreshold: number
}

export type ParserConfig = CsvParserConfig | XlsxParserConfig | PdfParserConfig

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN MAPPING
// Maps detected column header names to canonical field names.
// Stored on Upload so the mapping used is auditable.
// ─────────────────────────────────────────────────────────────────────────────

export interface ColumnMapping {
  /** Single date column (used when there is only one date) */
  date?: string
  /** "Posted date" column when bank provides both dates */
  postedDate?: string
  /** "Transaction date" column when bank provides both dates */
  transactionDate?: string
  /** Single signed amount column */
  amount?: string
  /** Debit column (one of a debit/credit split pair) */
  debit?: string
  /** Credit column (one of a debit/credit split pair) */
  credit?: string
  /** Description / memo / narration */
  description?: string
  /** Running balance column */
  runningBalance?: string
  /** Check number */
  checkNumber?: string
  /** Bank-provided unique transaction identifier */
  bankTransactionId?: string
  /** ISO 4217 currency code column (present in multi-currency exports) */
  currency?: string
  /** Pending / posted status indicator */
  pending?: string
}

export interface HeaderDetectionResult {
  /** 0.0–1.0 confidence in the header detection */
  confidence: number
  /** 0-based row index identified as the header */
  headerRowIndex: number
  /** Raw column header strings as they appear in the file */
  columns: string[]
  /** Best-guess mapping from detected headers to canonical fields */
  suggestedMapping: ColumnMapping
  /** Header columns that could not be mapped to any canonical field */
  unmappedColumns: string[]
  /**
   * Fields where multiple candidate columns matched.
   * These require user confirmation before parsing proceeds.
   */
  ambiguousFields: Array<{
    field: keyof ColumnMapping
    candidates: string[]
  }>
  /** True if any ambiguity or low confidence requires user confirmation before parsing */
  requiresUserConfirmation: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// RAW PARSE OUTPUT
// Stage 1 outputs RawParsedRow objects. All values are strings — no coercion.
// ─────────────────────────────────────────────────────────────────────────────

export interface RawParsedRow {
  sourceLocator: CsvXlsxSourceLocator | PdfSourceLocator
  /** All column values as raw strings, keyed by header name. Never coerced. */
  fields: Record<string, string>
  /** The literal text of this row as it appeared in the source file */
  rawLine: string
  /** SHA-256 of rawLine — used as sourceRowHash for dedup */
  rowHash: string
}

export interface ParseResult {
  success: boolean
  config: ParserConfig
  headerDetection: HeaderDetectionResult
  rows: RawParsedRow[]
  errors: ParseError[]
  warnings: ParseWarning[]
  metadata: {
    totalLinesInFile: number
    emptyLinesSkipped: number
    /** Number of rows before the first data row (header + any preamble) */
    headerLinesSkipped: number
  }
}

export interface ParseError {
  /** 0-based row index in the file; -1 = file-level error */
  rowIndex: number
  message: string
  /** FATAL errors abort the entire parse; ERROR allows partial results */
  severity: 'ERROR' | 'FATAL'
}

export interface ParseWarning {
  /** null = file-level warning */
  rowIndex: number | null
  message: string
  /** Machine-readable warning code (e.g. "COLUMN_COUNT_MISMATCH_UNDER") */
  code: string
}

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZED TRANSACTION
// Stage 2 output. Amounts are still strings here to preserve precision;
// they are persisted as strings in the DB.
// ─────────────────────────────────────────────────────────────────────────────

/** Valid values for Transaction.dateAmbiguity */
export type DateAmbiguityStatus = 'RESOLVED' | 'AMBIGUOUS_MMDD_DDMM' | 'UNPARSEABLE'

/** Valid values for Transaction.ingestionStatus */
export type IngestionStatus = 'VALID' | 'WARNING' | 'UNRESOLVED' | 'REJECTED'

export interface NormalizedDate {
  /** ISO string if resolved; null if ambiguous or unparseable */
  resolved: string | null
  ambiguity: DateAmbiguityStatus
  /**
   * MM/DD interpretation — stored as ISO string.
   * Set only when ambiguity = AMBIGUOUS_MMDD_DDMM.
   */
  interpretationA: string | null
  /**
   * DD/MM interpretation — stored as ISO string.
   * Set only when ambiguity = AMBIGUOUS_MMDD_DDMM.
   */
  interpretationB: string | null
  /** Original raw string from the source file */
  raw: string
  steps: TransformationStep[]
}

export interface NormalizedAmount {
  /**
   * Signed decimal string (e.g. "-12.34", "1234.56").
   * Negative = debit/expense. Positive = credit/income.
   * null = could not be parsed.
   */
  value: string | null
  /** Original raw string from the source file */
  raw: string
  /** ISO 4217 currency code detected in this field (null if not present) */
  currencyDetected: string | null
  steps: TransformationStep[]
}

export interface NormalizedTransaction {
  sourceLocator: SourceLocator
  rawLine: string
  rowHash: string
  parseOrder: number

  postedDate: NormalizedDate | null
  transactionDate: NormalizedDate | null
  amount: NormalizedAmount
  descriptionRaw: string
  descriptionNormalized: string
  descriptionTransformations: TransformationStep[]

  runningBalance: string | null // decimal string or null
  runningBalanceRaw: string | null
  checkNumber: string | null
  bankTransactionId: string | null
  pendingFlag: boolean

  /** All transformation steps across all fields for this row */
  allTransformations: TransformationStep[]

  ingestionStatus: IngestionStatus
  issues: PendingIssue[]
}

/** An issue detected during normalization, before DB write */
export interface PendingIssue {
  issueType: IngestionIssueType
  severity: 'ERROR' | 'WARNING' | 'INFO'
  description: string
  suggestedAction?: string
}

// ─────────────────────────────────────────────────────────────────────────────
// INGESTION ISSUE TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type IngestionIssueType =
  | 'DATE_AMBIGUOUS'
  | 'DATE_UNPARSEABLE'
  | 'AMOUNT_PARSE_FAIL'
  | 'AMOUNT_CONTRADICTION'      // both debit and credit columns have values
  | 'BALANCE_CHAIN_BREAK'
  | 'POSSIBLE_DUPLICATE'
  | 'MERGED_CELL'
  | 'HEADER_AMBIGUOUS'
  | 'TRUNCATED_FILE'
  | 'OCR_CONFIDENCE_LOW'
  | 'COLUMN_COUNT_MISMATCH'
  | 'MULTI_CURRENCY'            // row has a non-default currency, user should confirm
  | 'PENDING_TRANSACTION'       // bank marked as pending — amount may change

// ─────────────────────────────────────────────────────────────────────────────
// DEDUPLICATION
// ─────────────────────────────────────────────────────────────────────────────

export interface BankFingerprintComponents {
  /** ISO date string or 'NO_DATE' */
  postedDate: string
  /** Signed decimal string, always 2 decimal places e.g. "-12.34" */
  amountExact: string
  /** Raw description trimmed and lowercased */
  descriptionRawNormalized: string
  /** Decimal string or 'NO_BALANCE' */
  runningBalance: string
}

// ─────────────────────────────────────────────────────────────────────────────
// RECONCILIATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconciliation modes (evaluated in order; first applicable mode is used):
 * A) STATEMENT_TOTALS — bank export includes summary totals
 * B) RUNNING_BALANCE  — per-row running balance allows chain validation
 * C) UNVERIFIABLE     — no totals, no balances; completeness cannot be proven
 */
export type ReconciliationMode =
  | 'STATEMENT_TOTALS'
  | 'RUNNING_BALANCE'
  | 'UNVERIFIABLE'

/** Valid values for Upload.reconciliationStatus */
export type ReconciliationStatus =
  | 'PENDING'
  | 'PASS'
  | 'PASS_WITH_WARNINGS'
  | 'FAIL'
  | 'UNVERIFIABLE'

export interface ReconciliationCheck {
  name: string
  passed: boolean
  /** What the value should be (decimal string) */
  expected: string
  /** What the value actually is (decimal string) */
  actual: string
  /**
   * 'EXACT' = must match to the cent with zero tolerance.
   * null = informational check, no tolerance applied.
   */
  tolerance: 'EXACT' | null
  details?: string
}

export interface Discrepancy {
  type:
    | 'BALANCE_CHAIN_BREAK'
    | 'TOTAL_MISMATCH'
    | 'MISSING_ROW'
    | 'EXTRA_ROW'
  /** 0-based data row index; null = file-level discrepancy */
  rowIndex: number | null
  sourceLocator?: SourceLocator
  field: string
  /** Expected value (decimal string) */
  expected: string
  /** Actual value (decimal string) */
  actual: string
  /** Absolute difference (decimal string, always non-negative) */
  magnitude: string
  description: string
}

export interface ReconciliationSummary {
  /** Total of all positive (credit) amounts — decimal string */
  totalCredits: string
  /** Total of all negative (debit) amounts — decimal string, negative */
  totalDebits: string
  /** totalCredits + totalDebits — decimal string */
  netChange: string
  /** Opening balance from statement; null if not available */
  startBalance: string | null
  /** Closing balance from statement; null if not available */
  endBalance: string | null
  /** startBalance + netChange; null if startBalance not available */
  computedEndBalance: string | null
}

export interface ReconciliationResult {
  mode: ReconciliationMode
  status: ReconciliationStatus
  checks: ReconciliationCheck[]
  discrepancies: Discrepancy[]
  summary: ReconciliationSummary
}

// ─────────────────────────────────────────────────────────────────────────────
// USER-FACING RECONCILIATION REPORT
// This is the structure serialized to Upload.reconciliationReport (JSON string).
// ─────────────────────────────────────────────────────────────────────────────

export interface ReconciliationReport {
  uploadId: string
  /** Display name only — the original filename as uploaded */
  fileName: string
  /** First 16 hex chars of SHA-256 (never the full hash in UI) */
  fileHashTruncated: string
  sourceType: 'CSV' | 'XLSX' | 'PDF'
  /** ISO date string or null if period could not be detected */
  periodStart: string | null
  /** ISO date string or null */
  periodEnd: string | null

  counts: {
    totalParsed: number
    imported: number
    unresolved: number
    rejected: number
    possibleDuplicates: number
  }

  sums: {
    /** Decimal string */
    totalCredits: string
    /** Decimal string (negative) */
    totalDebits: string
    /** Decimal string */
    netChange: string
  }

  reconciliation: ReconciliationResult

  /**
   * Items that block "complete" status.
   * Each requires an explicit user action before the import can be finalized.
   */
  unresolvedItems: Array<{
    /** DB id of the IngestionIssue */
    issueId: string
    /** DB id of the Transaction (null for file-level issues) */
    transactionId: string | null
    rowIndex: number
    sourceLocator: SourceLocator
    issueType: IngestionIssueType
    description: string
    /** Plain-English instruction for what the user must do */
    requiredAction: string
  }>

  /** Non-blocking warnings shown for information */
  warnings: Array<{
    code: string
    message: string
    /** 0-based data row indices affected */
    affectedRows: number[]
  }>

  auditLogAvailable: boolean
  /** Semver string from Upload.parserVersion */
  parserVersion: string
  /** ISO 8601 timestamp */
  processedAt: string
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE ACCEPTANCE (Stage 0)
// ─────────────────────────────────────────────────────────────────────────────

export interface FileAcceptanceResult {
  accepted: boolean
  fileHash: string
  sourceType: 'CSV' | 'XLSX' | 'PDF' | null
  /** Human-readable rejection reason; null if accepted */
  rejectionReason: string | null
  /**
   * true = same SHA-256 was seen before, but processing is still ALLOWED.
   * A new Upload will be created with an incremented version.
   */
  isDuplicate: boolean
  /** DB id of the previous Upload when isDuplicate = true (reprocessing path) */
  previousUploadId: string | null
  /** Kept for backward compatibility — same value as previousUploadId */
  existingUploadId: string | null
  fileSize: number
  /** Detected character encoding (CSV only); null for binary formats */
  encoding: string | null
}

// ─────────────────────────────────────────────────────────────────────────────
// PIPELINE STAGE RESULT WRAPPER
// Uniform result shape returned by each stage.
// ─────────────────────────────────────────────────────────────────────────────

export interface StageResult<T> {
  /** True = stage completed without fatal errors */
  success: boolean
  data: T | null
  /** Errors that prevented completion (FATAL) or flagged issues (ERROR) */
  errors: Array<{ code: string; message: string; rowIndex?: number }>
  /** Non-blocking advisory messages */
  warnings: Array<{ code: string; message: string; rowIndex?: number }>
  /** Wall-clock duration of this stage in milliseconds */
  durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const PARSER_VERSION = '1.0.0' as const

/** Maximum file size accepted at Stage 0 */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 // 50 MB

/** Minimum OCR confidence for scanned PDFs; below this → UNSUPPORTED */
export const OCR_CONFIDENCE_THRESHOLD = 0.95

/** Tolerance for reconciliation amount checks: 'EXACT' means zero tolerance */
export const RECONCILIATION_TOLERANCE = 'EXACT' as const

/**
 * Bank fingerprint separator — chosen to be unlikely to appear in any
 * individual component, preventing cross-component collisions.
 */
export const FINGERPRINT_SEPARATOR = '|||' as const
