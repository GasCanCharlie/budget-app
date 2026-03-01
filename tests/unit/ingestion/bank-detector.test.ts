import { describe, it, expect } from 'vitest'
import { detectBank } from '@/lib/ingestion/bank-detector'

const EMPTY_MAPPING = {}

describe('detectBank', () => {
  it('detects Chase checking by full header set', () => {
    const headers = ['Transaction Date', 'Description', 'Category', 'Type', 'Amount', 'Balance']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(true)
    expect(result.bankProfile?.bankKey).toBe('chase_checking_v1')
    expect(result.detectionConfidence).toBe('High')
    expect(result.bankProfile?.defaultDateOrder).toBe('MDY')
    expect(result.bankProfile?.authoritativeDateColumn).toBe('posting')
  })

  it('detects Capital One by card no. + debit/credit headers', () => {
    const headers = ['Transaction Date', 'Posted Date', 'Card No.', 'Description', 'Category', 'Debit', 'Credit']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(true)
    expect(result.bankProfile?.bankKey).toBe('capital_one_v1')
    expect(result.detectionConfidence).toBe('High')
    expect(result.bankProfile?.defaultDateOrder).toBe('MDY')
  })

  it('detects Bank of America by running bal. header', () => {
    const headers = ['Date', 'Description', 'Amount', 'Running Bal.']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(true)
    expect(result.bankProfile?.bankKey).toBe('bofa_checking_v1')
    expect(result.detectionConfidence).toBe('High')
  })

  it('detects Discover by trans. date + post date', () => {
    const headers = ['Trans. Date', 'Post Date', 'Description', 'Amount', 'Category']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(true)
    expect(result.bankProfile?.bankKey).toBe('discover_v1')
    expect(result.detectionConfidence).toBe('High')
  })

  it('is fully case-insensitive in header matching', () => {
    const headers = ['TRANSACTION DATE', 'DESCRIPTION', 'CATEGORY', 'TYPE', 'AMOUNT', 'BALANCE']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(true)
    expect(result.bankProfile?.bankKey).toBe('chase_checking_v1')
  })

  it('returns Low confidence and null bankProfile when no bank matches', () => {
    const headers = ['Date', 'Narration', 'Chq./Ref.No.', 'Value Dt', 'Withdrawal Amt.', 'Deposit Amt.']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(false)
    expect(result.bankProfile).toBeNull()
    expect(result.detectionConfidence).toBe('Low')
    expect(result.matchedPatterns).toHaveLength(0)
  })

  it('Barclays (UK) has DMY date order — European bank', () => {
    const headers = ['Date', 'Merchant Name', 'Amount', 'Closing Balance']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(true)
    expect(result.bankProfile?.bankKey).toBe('barclays_v1')
    expect(result.bankProfile?.defaultDateOrder).toBe('DMY')
  })

  it('HSBC UK has DMY date order', () => {
    const headers = ['Date', 'Description', 'Paid In', 'Paid Out', 'Balance']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(result.matched).toBe(true)
    expect(result.bankProfile?.bankKey).toBe('hsbc_uk_v1')
    expect(result.bankProfile?.defaultDateOrder).toBe('DMY')
  })

  it('returns matchedPatterns listing what was found', () => {
    const headers = ['Transaction Date', 'Description', 'Category', 'Type', 'Amount', 'Balance']
    const result = detectBank(headers, EMPTY_MAPPING)
    expect(Array.isArray(result.matchedPatterns)).toBe(true)
    expect(result.matchedPatterns.length).toBeGreaterThan(0)
  })
})
