import { describe, it, expect } from 'vitest'
import { normalizeVendorKey, normalizeForRule } from '@/lib/ingestion/vendor-normalize'

describe('normalizeVendorKey', () => {
  it('uppercases input', () => {
    expect(normalizeVendorKey('walmart')).toBe('WALMART')
  })

  it('trims whitespace', () => {
    expect(normalizeVendorKey('  AMAZON  ')).toBe('AMAZON')
  })

  it('removes punctuation', () => {
    expect(normalizeVendorKey("McDonald's")).toBe('MCDONALDS')
    expect(normalizeVendorKey('COSTCO #123')).toBe('COSTCO')
    expect(normalizeVendorKey('AT&T')).toBe('ATT')
  })

  it('collapses internal whitespace', () => {
    expect(normalizeVendorKey('BEST   BUY')).toBe('BEST BUY')
  })

  it('strips trailing store numbers by default', () => {
    expect(normalizeVendorKey('WALMART 4321')).toBe('WALMART')
    expect(normalizeVendorKey('TARGET STORE 01234')).toBe('TARGET STORE')
    expect(normalizeVendorKey('SHELL 56789')).toBe('SHELL')
  })

  it('keeps non-store-number trailing digits if too short', () => {
    // "AB" is only 2 chars after stripping "12", so we keep the original "AB 12" → "AB 12"
    expect(normalizeVendorKey('AB 12')).toBe('AB 12')
  })

  it('does not strip when stripTrailingNumbers is false', () => {
    expect(normalizeVendorKey('WALMART 4321', false)).toBe('WALMART 4321')
  })

  it('handles empty string', () => {
    expect(normalizeVendorKey('')).toBe('')
  })

  it('handles non-string gracefully', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeVendorKey(null as any)).toBe('')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(normalizeVendorKey(undefined as any)).toBe('')
  })

  it('removes forward slashes and special chars', () => {
    expect(normalizeVendorKey('CHEVRON/SHELL')).toBe('CHEVRONSHELL')
    expect(normalizeVendorKey('UBER* EATS')).toBe('UBER EATS')
  })

  it('produces identical keys for the same merchant despite formatting', () => {
    const a = normalizeVendorKey('Starbucks #4521')
    const b = normalizeVendorKey('STARBUCKS #4521')
    const c = normalizeVendorKey('STARBUCKS   4521')
    // All should produce "STARBUCKS" after normalization
    expect(a).toBe('STARBUCKS')
    expect(b).toBe('STARBUCKS')
    expect(c).toBe('STARBUCKS')
  })
})

describe('normalizeForRule', () => {
  it('returns lowercase result', () => {
    expect(normalizeForRule('WALMART 4321')).toBe('walmart')
  })

  it('matches normalizeVendorKey output lowercased', () => {
    const raw = "McDonald's Store 999"
    expect(normalizeForRule(raw)).toBe(normalizeVendorKey(raw).toLowerCase())
  })
})
