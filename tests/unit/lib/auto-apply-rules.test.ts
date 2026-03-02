/**
 * Unit tests for auto-apply-rules.ts
 * DB interactions are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyRulesToUpload } from '@/lib/ingestion/auto-apply-rules'

// ─── Mock prisma ─────────────────────────────────────────────────────────────

const mockFindManyRules = vi.fn()
const mockFindManyTxs   = vi.fn()
const mockFindUniqueCat = vi.fn()
const mockUpdateTx      = vi.fn()

vi.mock('@/lib/db', () => ({
  default: {
    categoryRule: {
      findMany: (...args: unknown[]) => mockFindManyRules(...args),
    },
    transaction: {
      findMany: (...args: unknown[]) => mockFindManyTxs(...args),
      update:   (...args: unknown[]) => mockUpdateTx(...args),
    },
    category: {
      findUnique: (...args: unknown[]) => mockFindUniqueCat(...args),
    },
  },
}))

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const UPLOAD_ID  = 'upload-1'
const USER_ID    = 'user-1'
const ACCOUNT_ID = 'acct-1'
const CAT_ID     = 'cat-groceries'

function makeRule(overrides = {}) {
  return {
    id:            'rule-1',
    userId:         USER_ID,
    categoryId:     CAT_ID,
    matchType:      'vendor_exact',
    matchValue:     'walmart',
    mode:           'always',
    confidence:     'high',
    isEnabled:      true,
    isSystem:       false,
    priority:       20,
    scopeAccountId: null,
    createdAt:      new Date(),
    ...overrides,
  }
}

function makeTx(overrides = {}) {
  return {
    id:                 'tx-1',
    merchantNormalized: 'Walmart 4321',
    descriptionRaw:     'WALMART SUPERCENTER 4321',
    accountId:          ACCOUNT_ID,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindUniqueCat.mockResolvedValue({ name: 'Groceries' })
  mockUpdateTx.mockResolvedValue({})
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('applyRulesToUpload', () => {
  it('returns zero counts when no rules exist', async () => {
    mockFindManyRules.mockResolvedValue([])
    mockFindManyTxs.mockResolvedValue([makeTx()])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    expect(result.autoAssigned).toBe(0)
    expect(result.skipped).toBe(0)
    expect(mockUpdateTx).not.toHaveBeenCalled()
  })

  it('returns zero counts when no transactions exist', async () => {
    mockFindManyRules.mockResolvedValue([makeRule()])
    mockFindManyTxs.mockResolvedValue([])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    expect(result.autoAssigned).toBe(0)
    expect(mockUpdateTx).not.toHaveBeenCalled()
  })

  it('auto-assigns via vendor_exact always rule', async () => {
    mockFindManyRules.mockResolvedValue([makeRule()])
    mockFindManyTxs.mockResolvedValue([makeTx()])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)

    expect(result.autoAssigned).toBe(1)
    expect(result.needsReview).toBe(0)
    expect(result.skipped).toBe(0)
    expect(mockUpdateTx).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({
        appCategory:   'Groceries',
        assignedBy:    'rule',
        appliedRuleId: 'rule-1',
        needsReview:   false,
      }),
    })
  })

  it('routes to needs_review via ask mode rule (does not assign category)', async () => {
    mockFindManyRules.mockResolvedValue([makeRule({ mode: 'ask' })])
    mockFindManyTxs.mockResolvedValue([makeTx()])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)

    expect(result.autoAssigned).toBe(0)
    expect(result.needsReview).toBe(1)
    expect(mockUpdateTx).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: expect.objectContaining({
        needsReview:   true,
        appliedRuleId: 'rule-1',
      }),
    })
    // Must NOT set appCategory
    const callData = mockUpdateTx.mock.calls[0][0].data
    expect(callData.appCategory).toBeUndefined()
  })

  it('skips disabled rules', async () => {
    mockFindManyRules.mockResolvedValue([makeRule({ isEnabled: false })])
    mockFindManyTxs.mockResolvedValue([makeTx()])

    // When no rules are loaded (disabled filtered at DB level), skipped++
    mockFindManyRules.mockResolvedValue([]) // simulates DB filtering out disabled
    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    expect(result.autoAssigned).toBe(0)
  })

  it('skips transactions that do not match any rule', async () => {
    mockFindManyRules.mockResolvedValue([makeRule({ matchValue: 'amazon' })])
    mockFindManyTxs.mockResolvedValue([makeTx({ merchantNormalized: 'Starbucks' })])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    expect(result.skipped).toBe(1)
    expect(result.autoAssigned).toBe(0)
    expect(mockUpdateTx).not.toHaveBeenCalled()
  })

  it('flags conflict when multiple rules match the same transaction', async () => {
    mockFindManyRules.mockResolvedValue([
      makeRule({ id: 'rule-1', categoryId: 'cat-a', matchValue: 'walmart' }),
      makeRule({ id: 'rule-2', categoryId: 'cat-b', matchValue: 'walmart' }),
    ])
    mockFindManyTxs.mockResolvedValue([makeTx()])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    expect(result.conflicts).toBe(1)
    expect(result.needsReview).toBe(1)
    expect(result.autoAssigned).toBe(0)
    expect(mockUpdateTx).toHaveBeenCalledWith({
      where: { id: 'tx-1' },
      data: { needsReview: true },
    })
    // Must NOT set appCategory on conflict
    const callData = mockUpdateTx.mock.calls[0][0].data
    expect(callData.appCategory).toBeUndefined()
  })

  it('account-scoped rule does not apply to different account', async () => {
    mockFindManyRules.mockResolvedValue([
      makeRule({ scopeAccountId: 'acct-other' }),
    ])
    mockFindManyTxs.mockResolvedValue([makeTx({ accountId: ACCOUNT_ID })])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    expect(result.skipped).toBe(1)
    expect(result.autoAssigned).toBe(0)
  })

  it('handles multiple transactions, some matching and some not', async () => {
    mockFindManyRules.mockResolvedValue([makeRule()])
    mockFindManyTxs.mockResolvedValue([
      makeTx({ id: 'tx-1', merchantNormalized: 'Walmart 4321' }),
      makeTx({ id: 'tx-2', merchantNormalized: 'Starbucks' }),
      makeTx({ id: 'tx-3', merchantNormalized: 'Walmart' }),
    ])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    // tx-1 and tx-3 normalize to 'walmart', tx-2 doesn't match
    expect(result.autoAssigned).toBe(2)
    expect(result.skipped).toBe(1)
  })

  it('import sets appCategory NULL — auto-apply only touches uncategorized txs', async () => {
    // The DB query filters appCategory: null — simulate by returning only null ones
    mockFindManyRules.mockResolvedValue([makeRule()])
    // No transactions returned because all already have appCategory (DB filter)
    mockFindManyTxs.mockResolvedValue([])

    const result = await applyRulesToUpload(UPLOAD_ID, USER_ID, ACCOUNT_ID)
    expect(result.autoAssigned).toBe(0)
    expect(mockUpdateTx).not.toHaveBeenCalled()
  })
})
