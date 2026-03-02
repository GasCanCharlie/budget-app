/**
 * Vendor Key Normalization
 *
 * Produces a stable, deterministic key from a raw transaction description
 * for use in rule matching.  Two descriptions that refer to the same merchant
 * should produce the same key.
 *
 * Rules applied in order:
 *  1. Uppercase
 *  2. Trim leading/trailing whitespace
 *  3. Remove all punctuation (keep alphanumeric + space)
 *  4. Collapse internal whitespace runs to a single space
 *  5. Strip trailing store/branch numbers (digits at the end, e.g. "WALMART 4321")
 *     — only when the result is still ≥ 3 characters
 *
 * The result is safe to store in DB and use as a rule matchValue.
 */

/**
 * Normalize a raw merchant description into a stable vendor key.
 *
 * @param raw - the raw description string from the bank statement
 * @param stripTrailingNumbers - when true (default), remove trailing store numbers
 * @returns uppercase alphanumeric-only key, e.g. "WALMART"
 */
export function normalizeVendorKey(raw: string, stripTrailingNumbers = true): string {
  if (!raw || typeof raw !== 'string') return ''

  let key = raw
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9\s]/g, '')   // remove all punctuation / symbols
    .replace(/\s+/g, ' ')          // collapse whitespace
    .trim()

  if (stripTrailingNumbers) {
    const stripped = key.replace(/\s+\d+$/, '').trim()
    if (stripped.length >= 3) key = stripped
  }

  return key
}

/**
 * Normalize for rule matching — same as normalizeVendorKey but also lowercased.
 * Used as matchValue in CategoryRule rows for case-insensitive comparison.
 */
export function normalizeForRule(raw: string): string {
  return normalizeVendorKey(raw).toLowerCase()
}
