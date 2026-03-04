/**
 * Vendor Normalization Utilities
 *
 * Provides deterministic normalization of raw bank transaction descriptions
 * into stable vendor keys used for rule matching. Also provides helpers
 * for converting between decimal amounts and integer cents.
 */

/**
 * Normalize a raw vendor/description string into a stable, lowercase vendor key.
 *
 * Steps applied in order:
 *  1. Lowercase
 *  2. Strip common bank prefixes (POS, ACH, DEBIT, TSQ*, SQ*, etc.)
 *  3. Remove special characters — keep only letters, digits, spaces, hyphens
 *  4. Collapse multiple spaces into one
 *  5. Trim leading/trailing whitespace
 *  6. Truncate to 80 characters
 */
export function normalizeVendor(raw: string): string {
  if (!raw || typeof raw !== 'string') return ''

  let key = raw

  // Step 1: Lowercase
  key = key.toLowerCase()

  // Step 2: Strip common bank prefixes
  key = key.replace(
    /^(pos |ach |debit |credit |purchase |tsq?\*|sq \*|sq\*|tst\*|dda |wdrl |wd |chk |chkcd |preauth |preauthorized |online |recurring )/gi,
    '',
  )

  // Step 3: Remove special chars — keep letters, digits, spaces, hyphens
  key = key.replace(/[^\w\s-]/g, '')

  // Step 4: Collapse multiple spaces
  key = key.replace(/\s+/g, ' ')

  // Step 5: Trim
  key = key.trim()

  // Step 6: Truncate to 80 chars
  key = key.slice(0, 80)

  return key
}

/**
 * Convert a decimal dollar amount to integer cents.
 * Multiplies by 100 and rounds to the nearest integer.
 *
 * @param amount - decimal dollar amount (e.g. 12.34 or -9.99)
 * @returns signed integer cents (e.g. 1234 or -999)
 */
export function amountToCents(amount: number): number {
  return Math.round(amount * 100)
}

/**
 * Convert integer cents back to a decimal dollar amount.
 *
 * @param cents - signed integer cents (e.g. 1234 or -999)
 * @returns decimal dollar amount (e.g. 12.34 or -9.99)
 */
export function centsToAmount(cents: number): number {
  return cents / 100
}
