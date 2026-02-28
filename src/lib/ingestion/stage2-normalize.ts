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
 *      - If both produce valid but different dates → AMBIGUOUS_MMDD_DDMM
 *      - If neither is valid → UNPARSEABLE
 *
 * @param raw       Raw string from the source file
 * @param fieldName Label for transformation steps (e.g. "postedDate")
 */
export function normalizeDate(raw: string, fieldName = 'date'): NormalizedDate {
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

    // Both valid and different → genuine ambiguity
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
 * @param row     Output row from Stage 1
 * @param mapping Column mapping detected by Stage 1 header detection
 */
export function normalizeRow(row: RawParsedRow, mapping: ColumnMapping): NormalizedRow {
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
  const rawBalance    = getField(fields, mapping, 'runningBalance')
  const rawCheckNum   = getField(fields, mapping, 'checkNumber')
  const rawBankTxId   = getField(fields, mapping, 'bankTransactionId')
  const rawPending    = getField(fields, mapping, 'pending')
  const rawCurrency   = getField(fields, mapping, 'currency')

  // ── Normalize dates ────────────────────────────────────────────────────────
  const postedDate      = rawPostedDate ? normalizeDate(rawPostedDate, 'postedDate') : null
  const transactionDate = rawTransDate  ? normalizeDate(rawTransDate,  'transactionDate') : null
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

  // ── Normalize description ──────────────────────────────────────────────────
  const { normalized: descriptionNormalized, steps: descSteps } = normalizeDescription(rawDesc)
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
    rawDesc,
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
    descriptionRaw:            rawDesc,
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
