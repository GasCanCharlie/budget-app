/**
 * Stage 2 — Normalize
 *
 * Takes RawParsedRow output from Stage 1 and produces NormalizedTransaction.
 *
 * Design contracts:
 *  - Every transformation is appended to allTransformations[] — nothing is silent
 *  - No invented data: if a field can't be parsed, status → UNRESOLVED or REJECTED
 *  - Amounts are stored as decimal strings; arithmetic never uses parseFloat
 *  - Date ambiguity (MM/DD vs DD/MM) is surfaced, not silently resolved
 *  - Results are deterministic: same input → same output always
 */

import { createHash } from 'crypto'
import type {
  RawParsedRow,
  ColumnMapping,
  NormalizedTransaction,
  NormalizedDate,
  NormalizedAmount,
  TransformationStep,
  TransformationRule,
  PendingIssue,
  IngestionStatus,
  CsvXlsxSourceLocator,
} from '@/types/ingestion'
import { FINGERPRINT_SEPARATOR } from '@/types/ingestion'

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeStep(
  field: string,
  rule: TransformationRule,
  before: string,
  after: string,
): TransformationStep {
  return { field, rule, before, after, timestamp: new Date().toISOString() }
}

/**
 * Extract a mapped field value from a row's raw fields using the ColumnMapping.
 * Returns '' if none of the supplied keys are mapped or have a value.
 */
function getField(
  fields: Record<string, string>,
  mapping: ColumnMapping,
  ...keys: Array<keyof ColumnMapping>
): string {
  for (const key of keys) {
    const col = mapping[key]
    if (col && fields[col] !== undefined) return fields[col]
  }
  return ''
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construct a UTC Date from year/month/day (all 1-based).
 * Returns null if the date is invalid (month > 12, day > 31, or JS Date rolls over).
 */
function tryParseDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12) return null
  if (day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, month - 1, day))
  // JS auto-corrects overflows (e.g. Feb 31 → Mar 3); detect and reject
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day
  ) {
    return null
  }
  return d
}

function toISODate(d: Date): string {
  return d.toISOString().split('T')[0]
}

/** Map of month name (lowercase) → 1-based month number */
const MONTH_NAMES: Record<string, number> = {
  jan: 1,  january: 1,
  feb: 2,  february: 2,
  mar: 3,  march: 3,
  apr: 4,  april: 4,
  may: 5,
  jun: 6,  june: 6,
  jul: 7,  july: 7,
  aug: 8,  august: 8,
  sep: 9,  sept: 9,  september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
}

/**
 * Normalize a raw date string from a bank CSV export into a NormalizedDate.
 *
 * Handles (in order):
 *   1. ISO YYYY-MM-DD
 *   2. YYYY/MM/DD
 *   3. YYYYMMDD compact
 *   4. Month-name formats: "Jan 15, 2024", "January 15, 2024", "15-Jan-2024", "15 Jan 2024"
 *   5. Ambiguous numeric: MM/DD/YYYY vs DD/MM/YYYY (separator: / - .)
 *      - If only one interpretation produces a valid calendar date → resolve it
 *      - If both produce valid but different dates:
 *          - If formatHint is provided → resolve using hint, set ambiguity 'RESOLVED'
 *          - Otherwise → AMBIGUOUS_MMDD_DDMM
 *      - If neither is valid → UNPARSEABLE
 *
 * @param raw        Raw string from the source file
 * @param fieldName  Label for transformation steps (e.g. "postedDate")
 * @param formatHint Optional file-level format hint derived from unambiguous dates
 */
export function normalizeDate(
  raw: string,
  fieldName = 'date',
  formatHint: 'MM/DD' | 'DD/MM' | null = null,
  dateOrder: 'MDY' | 'DMY' | 'YMD' | null = null,
): NormalizedDate {
  const steps: TransformationStep[] = []
  const trimmed = raw.trim()

  const unparseable = (): NormalizedDate => ({
    resolved: null,
    ambiguity: 'UNPARSEABLE',
    interpretationA: null,
    interpretationB: null,
    raw,
    steps,
  })

  if (!trimmed) return unparseable()

  // ── 1. ISO YYYY-MM-DD ────────────────────────────────────────────────────
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (isoMatch) {
    const d = tryParseDate(+isoMatch[1], +isoMatch[2], +isoMatch[3])
    if (d) {
      const iso = toISODate(d)
      steps.push(makeStep(fieldName, 'DATE_RESOLVED_ISO', raw, iso))
      return { resolved: iso, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }
  }

  // ── 2. YYYY/MM/DD ─────────────────────────────────────────────────────────
  const ymdSlashMatch = trimmed.match(/^(\d{4})\/(\d{2})\/(\d{2})$/)
  if (ymdSlashMatch) {
    const d = tryParseDate(+ymdSlashMatch[1], +ymdSlashMatch[2], +ymdSlashMatch[3])
    if (d) {
      const iso = toISODate(d)
      steps.push(makeStep(fieldName, 'DATE_RESOLVED_YYYY_MM_DD', raw, iso))
      return { resolved: iso, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }
  }

  // ── 3. YYYYMMDD compact ───────────────────────────────────────────────────
  const compactMatch = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (compactMatch) {
    const d = tryParseDate(+compactMatch[1], +compactMatch[2], +compactMatch[3])
    if (d) {
      const iso = toISODate(d)
      steps.push(makeStep(fieldName, 'DATE_RESOLVED_ISO', raw, iso))
      return { resolved: iso, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }
  }

  // ── 4a. Month-name first: "Jan 15, 2024" / "January 15, 2024" ────────────
  const monthFirstMatch = trimmed.match(/^([A-Za-z]+)[\s\-\/,]+(\d{1,2})[\s,]+(\d{2,4})$/)
  if (monthFirstMatch) {
    const monthNum = MONTH_NAMES[monthFirstMatch[1].toLowerCase()]
    if (monthNum) {
      const year = monthFirstMatch[3].length === 2 ? 2000 + +monthFirstMatch[3] : +monthFirstMatch[3]
      const d = tryParseDate(year, monthNum, +monthFirstMatch[2])
      if (d) {
        const iso = toISODate(d)
        steps.push(makeStep(fieldName, 'DATE_RESOLVED_ISO', raw, iso))
        return { resolved: iso, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
      }
    }
  }

  // ── 4b. Day-first month-name: "15-Jan-2024" / "15 Jan 2024" ──────────────
  const dayFirstMatch = trimmed.match(/^(\d{1,2})[\s\-\/]+([A-Za-z]+)[\s\-\/]+(\d{2,4})$/)
  if (dayFirstMatch) {
    const monthNum = MONTH_NAMES[dayFirstMatch[2].toLowerCase()]
    if (monthNum) {
      const year = dayFirstMatch[3].length === 2 ? 2000 + +dayFirstMatch[3] : +dayFirstMatch[3]
      const d = tryParseDate(year, monthNum, +dayFirstMatch[1])
      if (d) {
        const iso = toISODate(d)
        steps.push(makeStep(fieldName, 'DATE_RESOLVED_ISO', raw, iso))
        return { resolved: iso, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
      }
    }
  }

  // ── 5. Ambiguous numeric: MM/DD/YYYY vs DD/MM/YYYY ───────────────────────
  //    Separator may be / - or .
  //    Also handles 2-digit years (expanded to 20xx)
  const ambigMatch = trimmed.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/)
  if (ambigMatch) {
    const aNum = +ambigMatch[1]
    const bNum = +ambigMatch[2]
    const year = ambigMatch[3].length === 2 ? 2000 + +ambigMatch[3] : +ambigMatch[3]

    // Interpretation A: MM/DD/YYYY
    const dA = tryParseDate(year, aNum, bNum)
    // Interpretation B: DD/MM/YYYY
    const dB = tryParseDate(year, bNum, aNum)

    const isoA = dA ? toISODate(dA) : null
    const isoB = dB ? toISODate(dB) : null

    if (!isoA && !isoB) return unparseable()

    if (isoA && !isoB) {
      steps.push(makeStep(fieldName, 'DATE_RESOLVED_MM_DD', raw, isoA))
      return { resolved: isoA, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }

    if (!isoA && isoB) {
      steps.push(makeStep(fieldName, 'DATE_RESOLVED_DD_MM', raw, isoB))
      return { resolved: isoB, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }

    if (isoA === isoB) {
      // Same date either way (e.g., 05/05/2024) — no ambiguity
      steps.push(makeStep(fieldName, 'DATE_RESOLVED_MM_DD', raw, isoA!))
      return { resolved: isoA, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }

    // Both valid and different → check dateOrder (upload-level) first, then hint (file-level)
    if (dateOrder === 'MDY') {
      steps.push(makeStep(fieldName, 'DATE_FORMAT_HINT_APPLIED', raw, isoA!))
      return { resolved: isoA, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }

    if (dateOrder === 'DMY') {
      steps.push(makeStep(fieldName, 'DATE_FORMAT_HINT_APPLIED', raw, isoB!))
      return { resolved: isoB, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }

    // Fall through to legacy formatHint
    if (formatHint === 'MM/DD') {
      // Interpretation A is MM/DD
      steps.push(makeStep(fieldName, 'DATE_FORMAT_HINT_APPLIED', raw, isoA!))
      return { resolved: isoA, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }

    if (formatHint === 'DD/MM') {
      // Interpretation B is DD/MM
      steps.push(makeStep(fieldName, 'DATE_FORMAT_HINT_APPLIED', raw, isoB!))
      return { resolved: isoB, ambiguity: 'RESOLVED', interpretationA: null, interpretationB: null, raw, steps }
    }

    // No hint available → genuine ambiguity, surface to user
    return {
      resolved: null,
      ambiguity: 'AMBIGUOUS_MMDD_DDMM',
      interpretationA: isoA,
      interpretationB: isoB,
      raw,
      steps,
    }
  }

  return unparseable()
}

// ─────────────────────────────────────────────────────────────────────────────
// AMOUNT NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Maps currency symbol strings → ISO 4217 codes.
 * Multi-character prefixes are checked before single-character ones.
 */
const CURRENCY_SYMBOL_MAP: Array<[string, string]> = [
  ['R$', 'BRL'],  ['A$', 'AUD'],  ['C$', 'CAD'],  ['HK$', 'HKD'],
  ['S$', 'SGD'],  ['NZ$', 'NZD'],
  ['€',  'EUR'],  ['£',  'GBP'],  ['¥',  'JPY'],  ['₹',  'INR'],
  ['₩',  'KRW'],  ['₽',  'RUB'],  ['฿',  'THB'],  ['₺',  'TRY'],
  ['₴',  'UAH'],  ['₫',  'VND'],  ['₦',  'NGN'],  ['₱',  'PHP'],
  ['₨',  'PKR'],  ['Rp', 'IDR'],
]

/**
 * Normalize a raw amount string from a bank CSV export into a NormalizedAmount.
 *
 * Handles (in order):
 *   1. Strip currency symbol (€, £, ¥, etc.) → set currencyDetected
 *   2. Strip $ (USD default — currencyDetected stays null)
 *   3. Parenthetical negative: (12.34) → -12.34
 *   4. Trailing minus: 12.34- → -12.34
 *   5. European decimal: 1.234,56 → 1234.56
 *   6. US thousands separator: 1,234.56 → 1234.56
 *   7. Simple European decimal (no thousands): 12,34 → 12.34
 *   8. Validate result is numeric; return null if not
 *
 * @param raw Raw string from the source file
 */
export function normalizeAmount(raw: string): NormalizedAmount {
  const steps: TransformationStep[] = []
  let value = raw.trim()
  let currencyDetected: string | null = null

  if (!value) {
    return { value: null, raw, currencyDetected: null, steps }
  }

  // ── 1. Non-$ currency symbols ─────────────────────────────────────────────
  for (const [sym, code] of CURRENCY_SYMBOL_MAP) {
    if (value.startsWith(sym) || value.endsWith(sym)) {
      const before = value
      currencyDetected = code
      value = value.startsWith(sym)
        ? value.slice(sym.length).trimStart()
        : value.slice(0, -sym.length).trimEnd()
      steps.push(makeStep('amount', 'STRIP_CURRENCY_SYMBOL', before, value))
      break
    }
  }

  // ── 2. $ (USD — don't set currencyDetected) ────────────────────────────────
  if (!currencyDetected && value.startsWith('$')) {
    const before = value
    value = value.slice(1).trimStart()
    steps.push(makeStep('amount', 'STRIP_CURRENCY_SYMBOL', before, value))
  }

  // ── 3. Parenthetical negative: (12.34) → -12.34 ──────────────────────────
  const parenMatch = value.match(/^\((.+)\)$/)
  if (parenMatch) {
    const before = value
    value = `-${parenMatch[1]}`
    steps.push(makeStep('amount', 'PARSE_PARENTHETICAL_NEGATIVE', before, value))
  }

  // ── 4. Trailing minus: 12.34- → -12.34 ────────────────────────────────────
  if (value.endsWith('-') && !value.startsWith('-')) {
    const before = value
    value = `-${value.slice(0, -1)}`
    steps.push(makeStep('amount', 'PARSE_TRAILING_MINUS', before, value))
  }

  // ── 5. European decimal: 1.234,56 → 1234.56 ──────────────────────────────
  //    Pattern: optional leading minus, digits (with . as thousands), comma + 2 decimals
  const europeanMatch = value.match(/^(-?)(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/)
  if (europeanMatch) {
    const before = value
    const sign     = europeanMatch[1]
    const intPart  = europeanMatch[2].replace(/\./g, '')
    const decPart  = europeanMatch[3]
    value = `${sign}${intPart}.${decPart}`
    steps.push(makeStep('amount', 'PARSE_EUROPEAN_DECIMAL', before, value))
  } else {
    // ── 6. US thousands comma: 1,234.56 → 1234.56 ──────────────────────────
    //    Pattern: digits with commas every 3, optional decimal
    const thousandsMatch = value.match(/^-?\d{1,3}(,\d{3})+(\.\d+)?$/)
    if (thousandsMatch) {
      const before = value
      value = value.replace(/,/g, '')
      steps.push(makeStep('amount', 'STRIP_THOUSANDS_SEPARATOR', before, value))
    } else {
      // ── 7. Simple European decimal: 12,34 → 12.34 ────────────────────────
      //    Pattern: digits, comma, exactly 2 decimal digits (no period anywhere)
      const simpleEuropeanMatch = value.match(/^(-?\d+),(\d{2})$/)
      if (simpleEuropeanMatch && !value.includes('.')) {
        const before = value
        value = `${simpleEuropeanMatch[1]}.${simpleEuropeanMatch[2]}`
        steps.push(makeStep('amount', 'PARSE_EUROPEAN_DECIMAL', before, value))
      }
    }
  }

  // ── 8. Validate: must be a parseable numeric string ────────────────────────
  if (value === '' || value === '-' || isNaN(Number(value))) {
    return { value: null, raw, currencyDetected, steps }
  }

  return { value, raw, currencyDetected, steps }
}

// ─────────────────────────────────────────────────────────────────────────────
// DESCRIPTION NORMALIZATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a raw transaction description string.
 * Logs each change as a TransformationStep.
 */
export function normalizeDescription(raw: string): {
  normalized: string
  steps: TransformationStep[]
} {
  const steps: TransformationStep[] = []
  let value = raw

  // ── 1. Trim leading/trailing whitespace ────────────────────────────────────
  const trimmed = value.trim()
  if (trimmed !== value) {
    steps.push(makeStep('description', 'TRIM_WHITESPACE', value, trimmed))
    value = trimmed
  }

  // ── 2. Normalize embedded line breaks → single space ──────────────────────
  const delined = value.replace(/[\r\n]+/g, ' ')
  if (delined !== value) {
    steps.push(makeStep('description', 'NORMALIZE_LINEBREAK', value, delined))
    value = delined
  }

  // ── 3. Collapse internal whitespace runs ──────────────────────────────────
  const collapsed = value.replace(/[ \t]{2,}/g, ' ')
  if (collapsed !== value) {
    steps.push(makeStep('description', 'COLLAPSE_WHITESPACE', value, collapsed))
    value = collapsed
  }

  return { normalized: value, steps }
}

// ─────────────────────────────────────────────────────────────────────────────
// BANK FINGERPRINT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a deterministic SHA-256 fingerprint for deduplication.
 * Combines resolved date + amount + raw description + running balance.
 * Scoped so the same transaction in two overlapping exports hashes to the same value.
 */
function computeBankFingerprint(
  resolvedDate: string | null,
  amountValue: string | null,
  descriptionRaw: string,
  runningBalance: string | null,
): string {
  const SEP = FINGERPRINT_SEPARATOR
  const dateStr  = resolvedDate  ?? 'NO_DATE'
  const amtStr   = amountValue   ?? 'NO_AMOUNT'
  const descStr  = descriptionRaw.trim().toLowerCase()
  const balStr   = runningBalance ?? 'NO_BALANCE'
  const key = `${dateStr}${SEP}${amtStr}${SEP}${descStr}${SEP}${balStr}`
  return createHash('sha256').update(key).digest('hex')
}

// ─────────────────────────────────────────────────────────────────────────────
// ROW NORMALIZATION (main entry point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * NormalizedTransaction extended with bankFingerprint and currencyCode
 * (fields that live on the Transaction DB row but are computed here).
 */
export interface NormalizedRow extends NormalizedTransaction {
  bankFingerprint: string
  currencyCode: string
}

/**
 * Normalize a single RawParsedRow into a NormalizedRow.
 *
 * @param row        Output row from Stage 1
 * @param mapping    Column mapping detected by Stage 1 header detection
 * @param formatHint Optional file-level date format hint from detectDateFormatHint()
 */
export function normalizeRow(
  row: RawParsedRow,
  mapping: ColumnMapping,
  formatHint: 'MM/DD' | 'DD/MM' | null = null,
  dateOrder: 'MDY' | 'DMY' | 'YMD' | null = null,
): NormalizedRow {
  const { fields, sourceLocator, rawLine, rowHash } = row
  const allTransformations: TransformationStep[] = []
  const issues: PendingIssue[] = []

  // ── Extract raw field strings via mapping ──────────────────────────────────
  const rawPostedDate = getField(fields, mapping, 'postedDate', 'date')
  const rawTransDate  = getField(fields, mapping, 'transactionDate')
  const rawAmount     = getField(fields, mapping, 'amount')
  const rawDebit      = getField(fields, mapping, 'debit')
  const rawCredit     = getField(fields, mapping, 'credit')
  const rawDesc       = getField(fields, mapping, 'description')

  // Fallback: if no description column was mapped, find the most text-like unmapped column
  let effectiveRawDesc = rawDesc
  if (!effectiveRawDesc) {
    // Build set of already-mapped column names (to skip them)
    const mappedCols = new Set(
      Object.values(mapping).filter((v): v is string => typeof v === 'string')
    )
    // Look for a text-rich unmapped field
    for (const [colName, colValue] of Object.entries(fields)) {
      if (mappedCols.has(colName)) continue
      const v = (colValue ?? '').trim()
      if (v.length < 2) continue
      // Skip if it looks like a pure number or date
      if (/^[\d.,\-+$£€¥%\s]+$/.test(v)) continue
      if (/^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(v)) continue
      // First good text candidate wins
      effectiveRawDesc = v
      break
    }
  }

  const rawBalance    = getField(fields, mapping, 'runningBalance')
  const rawCheckNum   = getField(fields, mapping, 'checkNumber')
  const rawBankTxId   = getField(fields, mapping, 'bankTransactionId')
  const rawPending    = getField(fields, mapping, 'pending')
  const rawCurrency   = getField(fields, mapping, 'currency')

  // ── Normalize dates ────────────────────────────────────────────────────────
  const postedDate      = rawPostedDate ? normalizeDate(rawPostedDate, 'postedDate',      formatHint, dateOrder) : null
  const transactionDate = rawTransDate  ? normalizeDate(rawTransDate,  'transactionDate', formatHint, dateOrder) : null
  if (postedDate)      allTransformations.push(...postedDate.steps)
  if (transactionDate) allTransformations.push(...transactionDate.steps)

  // The "primary" date we use for fingerprinting and the Transaction.date column
  const primaryDate = postedDate ?? transactionDate

  // ── Normalize amount ───────────────────────────────────────────────────────
  let amount: NormalizedAmount

  if (rawAmount) {
    amount = normalizeAmount(rawAmount)
    allTransformations.push(...amount.steps)
  } else if (rawDebit || rawCredit) {
    // Split debit/credit columns
    const debitResult  = rawDebit  ? normalizeAmount(rawDebit)  : null
    const creditResult = rawCredit ? normalizeAmount(rawCredit) : null

    const debitVal  = debitResult?.value
    const creditVal = creditResult?.value

    // Both have non-zero values → contradiction
    const debitNonZero  = debitVal  != null && debitVal  !== '0.00' && debitVal  !== '0'
    const creditNonZero = creditVal != null && creditVal !== '0.00' && creditVal !== '0'

    if (debitNonZero && creditNonZero) {
      issues.push({
        issueType: 'AMOUNT_CONTRADICTION',
        severity: 'ERROR',
        description: `Both debit ("${rawDebit}") and credit ("${rawCredit}") have values`,
        suggestedAction: 'Manually assign the correct signed amount for this row',
      })
    }

    // Determine signed value: debit = force negative, credit = force positive
    let signedValue: string | null = null
    let stepSource = ''
    let currencyDetected: string | null = null
    const mergedSteps: TransformationStep[] = []

    if (debitResult) mergedSteps.push(...debitResult.steps)
    if (creditResult) mergedSteps.push(...creditResult.steps)

    if (debitNonZero) {
      const absVal = debitVal!.replace(/^-/, '')
      signedValue  = `-${absVal}`
      stepSource   = rawDebit
      currencyDetected = debitResult?.currencyDetected ?? null
      if (!debitVal!.startsWith('-')) {
        mergedSteps.push(makeStep('amount', 'SPLIT_DEBIT_CREDIT_COLUMNS', debitVal!, signedValue))
      }
    } else if (creditNonZero) {
      const absVal = creditVal!.replace(/^-/, '')
      signedValue  = absVal           // credits are positive
      stepSource   = rawCredit
      currencyDetected = creditResult?.currencyDetected ?? null
      if (creditVal!.startsWith('-')) {
        mergedSteps.push(makeStep('amount', 'SPLIT_DEBIT_CREDIT_COLUMNS', creditVal!, signedValue))
      }
    }

    allTransformations.push(...mergedSteps)
    amount = {
      value: signedValue,
      raw: rawDebit || rawCredit || stepSource,
      currencyDetected,
      steps: mergedSteps,
    }
  } else {
    amount = { value: null, raw: '', currencyDetected: null, steps: [] }
  }

  // ── Transaction Type sign enforcement ─────────────────────────────────────
  // If a Transaction Type column is present (e.g., "Debit" / "Credit"),
  // use it to enforce the sign of the amount — overrides the raw sign.
  // This handles banks that export unsigned amounts with a separate type column.
  const rawTransType = getField(fields, mapping, 'transactionType')
  if (rawTransType && amount.value !== null) {
    const typeNorm = rawTransType.trim().toLowerCase()
    if (/^(debit|dr|d)$/.test(typeNorm)) {
      const absVal    = amount.value.replace(/^-/, '')
      const enforced  = `-${absVal}`
      if (enforced !== amount.value) {
        const step = makeStep('amount', 'TRANSACTION_TYPE_SIGN_ENFORCE', amount.value, enforced)
        allTransformations.push(step)
        amount = { ...amount, value: enforced, steps: [...amount.steps, step] }
      }
    } else if (/^(credit|cr|c)$/.test(typeNorm)) {
      const absVal   = amount.value.replace(/^-/, '')
      if (absVal !== amount.value) {
        const step = makeStep('amount', 'TRANSACTION_TYPE_SIGN_ENFORCE', amount.value, absVal)
        allTransformations.push(step)
        amount = { ...amount, value: absVal, steps: [...amount.steps, step] }
      }
    }
  }

  // ── Normalize description ──────────────────────────────────────────────────
  const { normalized: descriptionNormalized, steps: descSteps } = normalizeDescription(effectiveRawDesc)
  allTransformations.push(...descSteps)

  // ── Optional fields ────────────────────────────────────────────────────────
  const parseOrder = (sourceLocator as CsvXlsxSourceLocator).dataRowIndex ?? 0

  // Pending flag
  const pendingFlag = !!rawPending && /^(pending|p)$/i.test(rawPending.trim())
  if (pendingFlag) {
    const before = rawPending
    allTransformations.push(makeStep('description', 'STRIP_PENDING_FLAG', before, ''))
    issues.push({
      issueType: 'PENDING_TRANSACTION',
      severity: 'WARNING',
      description: 'Transaction is marked as pending; amount may change when posted',
    })
  }

  // Running balance (strip currency, keep decimal string)
  let runningBalance: string | null = null
  if (rawBalance) {
    const balResult = normalizeAmount(rawBalance)
    runningBalance = balResult.value
    // Tag balance steps with their field name
    allTransformations.push(...balResult.steps.map((s) => ({ ...s, field: 'runningBalance' })))
  }

  // Currency code: from detected symbol > from dedicated column > USD default
  let currencyCode = amount.currencyDetected
    ?? (rawCurrency.trim().length === 3 ? rawCurrency.trim().toUpperCase() : null)
    ?? 'USD'
  if (currencyCode.length !== 3) currencyCode = 'USD'

  // Multi-currency warning
  if (currencyCode !== 'USD') {
    issues.push({
      issueType: 'MULTI_CURRENCY',
      severity: 'WARNING',
      description: `Non-USD currency detected: ${currencyCode}`,
      suggestedAction: 'Verify the currency and converted amount are correct',
    })
  }

  // ── Determine ingestionStatus ──────────────────────────────────────────────
  let ingestionStatus: IngestionStatus = 'VALID'

  if (!primaryDate || primaryDate.ambiguity === 'UNPARSEABLE') {
    ingestionStatus = 'REJECTED'
    issues.push({
      issueType: 'DATE_UNPARSEABLE',
      severity: 'ERROR',
      description: `Could not parse date: "${rawPostedDate || rawTransDate}"`,
      suggestedAction: 'Verify that the date column is correctly mapped',
    })
  } else if (primaryDate.ambiguity === 'AMBIGUOUS_MMDD_DDMM') {
    if (ingestionStatus === 'VALID') ingestionStatus = 'UNRESOLVED'
    issues.push({
      issueType: 'DATE_AMBIGUOUS',
      severity: 'ERROR',
      description: `Ambiguous date "${primaryDate.raw}": could be ${primaryDate.interpretationA} (MM/DD) or ${primaryDate.interpretationB} (DD/MM)`,
      suggestedAction: 'Confirm whether dates in this file use MM/DD/YYYY or DD/MM/YYYY format',
    })
  }

  if (amount.value === null) {
    if (ingestionStatus === 'VALID') ingestionStatus = 'UNRESOLVED'
    issues.push({
      issueType: 'AMOUNT_PARSE_FAIL',
      severity: 'ERROR',
      description: `Could not parse amount: "${rawAmount || rawDebit || rawCredit}"`,
      suggestedAction: 'Verify that the amount column contains a valid numeric value',
    })
  }

  if (pendingFlag && ingestionStatus === 'VALID') {
    ingestionStatus = 'WARNING'
  }

  // ── Compute bank fingerprint ───────────────────────────────────────────────
  const resolvedDate = primaryDate?.resolved ?? primaryDate?.interpretationA ?? null
  const bankFingerprint = computeBankFingerprint(
    resolvedDate,
    amount.value,
    effectiveRawDesc,
    runningBalance,
  )

  return {
    sourceLocator,
    rawLine,
    rowHash,
    parseOrder,
    postedDate:      postedDate ?? null,
    transactionDate: transactionDate ?? null,
    amount,
    descriptionRaw:            effectiveRawDesc,
    descriptionNormalized,
    descriptionTransformations: descSteps,
    runningBalance,
    runningBalanceRaw: rawBalance || null,
    checkNumber:      rawCheckNum  || null,
    bankTransactionId: rawBankTxId || null,
    pendingFlag,
    allTransformations,
    ingestionStatus,
    issues,
    bankFingerprint,
    currencyCode,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DATE FORMAT HINT DETECTION (file-level holistic pass)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect whether a collection of raw date strings uses MM/DD or DD/MM ordering.
 *
 * Algorithm:
 *   1. For each raw date string, attempt to match the ambiguous numeric pattern
 *      (D{1,2}/D{1,2}/YYYY with separator / - .).
 *   2. If the first component (aNum) > 12 → that date can only be DD/MM.
 *      Increment ddmmVotes.
 *   3. If the second component (bNum) > 12 → that date can only be MM/DD.
 *      Increment mmddVotes.
 *   4. If both components ≤ 12 (genuinely ambiguous) → skip (no vote cast).
 *   5. Non-matching strings (ISO, month-name, etc.) are ignored.
 *   6. After scanning all dates:
 *      - If ddmmVotes > 0 and mmddVotes === 0 → return 'DD/MM'
 *      - If mmddVotes > 0 and ddmmVotes === 0 → return 'MM/DD'
 *      - If both > 0 (conflicting signals) → return majority; tie → null
 *      - If neither > 0 (all genuinely ambiguous or no matches) → return null
 *
 * @param rawDates Array of raw date strings extracted from the date column
 * @returns 'MM/DD' | 'DD/MM' | null
 */
export function detectDateFormatHint(rawDates: string[]): 'MM/DD' | 'DD/MM' | null {
  if (rawDates.length === 0) return null

  const AMBIG_RE = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/

  let mmddVotes = 0
  let ddmmVotes = 0

  for (const raw of rawDates) {
    const trimmed = raw.trim()
    const m = trimmed.match(AMBIG_RE)
    if (!m) continue // ISO, month-name, compact — format is unambiguous; skip for voting

    const aNum = +m[1]
    const bNum = +m[2]

    if (aNum > 12 && bNum > 12) continue // neither interpretation is valid; skip
    if (aNum > 12) {
      // First component cannot be a month → must be DD/MM
      ddmmVotes++
    } else if (bNum > 12) {
      // Second component cannot be a month → must be MM/DD
      mmddVotes++
    }
    // aNum ≤ 12 && bNum ≤ 12 → genuinely ambiguous; cast no vote
  }

  if (mmddVotes === 0 && ddmmVotes === 0) return null
  if (ddmmVotes > 0 && mmddVotes === 0) return 'DD/MM'
  if (mmddVotes > 0 && ddmmVotes === 0) return 'MM/DD'

  // Conflicting signals — return majority; exact tie → null (can't determine)
  if (mmddVotes > ddmmVotes) return 'MM/DD'
  if (ddmmVotes > mmddVotes) return 'DD/MM'
  return null
}
