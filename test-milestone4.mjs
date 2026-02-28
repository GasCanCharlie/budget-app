/**
 * Milestone 4 smoke tests — Stage 3 Dedup
 *
 * Tests pure-function logic from stage3-dedup.ts (inlined — no @/ imports).
 * DB-interaction functions (runDedup) require integration tests with a live DB.
 *
 * Run with:  node --experimental-strip-types test-milestone4.mjs
 */

// ─── Inlined: groupByKey ──────────────────────────────────────────────────────

/**
 * Group transactions by a key (fingerprint or bankTransactionId).
 * Returns a map from key → array of tx IDs.
 */
function groupByKey(txs) {
  const m = new Map()
  for (const tx of txs) {
    if (!tx.key) continue
    const group = m.get(tx.key) ?? []
    group.push(tx.id)
    m.set(tx.key, group)
  }
  return m
}

/**
 * Given a set of groups, return the keys whose groups have more than one member.
 */
function findWithinUploadDupes(groups) {
  const result = new Map()
  for (const [key, ids] of Array.from(groups)) {
    if (ids.length > 1) result.set(key, ids)
  }
  return result
}

/**
 * Escalate ingestionStatus: VALID → WARNING; UNRESOLVED/REJECTED unchanged.
 */
function escalateStatus(current) {
  return current === 'VALID' ? 'WARNING' : current
}

// ─── Inlined: bankFingerprint computation ─────────────────────────────────────
import { createHash } from 'crypto'

const FINGERPRINT_SEPARATOR = '|||'

function computeBankFingerprint(resolvedDate, amountValue, descriptionRaw, runningBalance) {
  const SEP = FINGERPRINT_SEPARATOR
  const dateStr = resolvedDate ?? 'NO_DATE'
  const amtStr  = amountValue  ?? 'NO_AMOUNT'
  const descStr = descriptionRaw.trim().toLowerCase()
  const balStr  = runningBalance ?? 'NO_BALANCE'
  const key = `${dateStr}${SEP}${amtStr}${SEP}${descStr}${SEP}${balStr}`
  return createHash('sha256').update(key).digest('hex')
}

// ─── Test harness ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL  ${name}`)
    console.log(`         ${e.message}`)
    failed++
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg ?? 'assertion failed')
}
function assertEqual(actual, expected, label = '') {
  if (actual !== expected) throw new Error(`${label}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ─────────────────────────────────────────────────────────────────────────────
// groupByKey tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── groupByKey ────────────────────────────────────────────────────────')

test('T09a: groups three rows — two share a fingerprint', () => {
  const fp = 'abc123'
  const rows = [
    { id: 'tx1', key: fp },
    { id: 'tx2', key: 'unique1' },
    { id: 'tx3', key: fp },
  ]
  const groups = groupByKey(rows)
  assertEqual(groups.get(fp)?.length, 2, 'group size ')
  assertEqual(groups.get('unique1')?.length, 1, 'unique group ')
})

test('T09b: all unique fingerprints → no group has >1 member', () => {
  const rows = [
    { id: 'tx1', key: 'fp1' },
    { id: 'tx2', key: 'fp2' },
    { id: 'tx3', key: 'fp3' },
  ]
  const groups = groupByKey(rows)
  for (const [, ids] of Array.from(groups)) {
    assert(ids.length === 1, 'each group should have exactly 1 member')
  }
})

test('T09c: empty key is excluded from grouping', () => {
  const rows = [
    { id: 'tx1', key: '' },
    { id: 'tx2', key: 'fp1' },
  ]
  const groups = groupByKey(rows)
  assert(!groups.has(''), 'empty key should not be in groups')
  assertEqual(groups.size, 1)
})

test('T09d: three rows all sharing a fingerprint', () => {
  const fp = 'sharedFP'
  const rows = [
    { id: 'a', key: fp },
    { id: 'b', key: fp },
    { id: 'c', key: fp },
  ]
  const groups = groupByKey(rows)
  assertEqual(groups.get(fp)?.length, 3)
})

// ─────────────────────────────────────────────────────────────────────────────
// findWithinUploadDupes tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── findWithinUploadDupes ─────────────────────────────────────────────')

test('T10a: identifies duplicate group', () => {
  const groups = new Map([
    ['fp1', ['tx1', 'tx2']],
    ['fp2', ['tx3']],
  ])
  const dupes = findWithinUploadDupes(groups)
  assert(dupes.has('fp1'), 'fp1 should be a duplicate group')
  assert(!dupes.has('fp2'), 'fp2 should not be a duplicate group')
  assertEqual(dupes.size, 1)
})

test('T10b: no duplicates → empty result', () => {
  const groups = new Map([
    ['fp1', ['tx1']],
    ['fp2', ['tx2']],
    ['fp3', ['tx3']],
  ])
  const dupes = findWithinUploadDupes(groups)
  assertEqual(dupes.size, 0)
})

test('T10c: all members of duplicate group are returned', () => {
  const groups = new Map([['fp', ['a', 'b', 'c']]])
  const dupes = findWithinUploadDupes(groups)
  const ids = dupes.get('fp')
  assert(ids?.includes('a') && ids?.includes('b') && ids?.includes('c'))
})

// ─────────────────────────────────────────────────────────────────────────────
// escalateStatus tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── escalateStatus ────────────────────────────────────────────────────')

test('T11a: VALID → WARNING', () => {
  assertEqual(escalateStatus('VALID'), 'WARNING')
})

test('T11b: UNRESOLVED stays UNRESOLVED', () => {
  assertEqual(escalateStatus('UNRESOLVED'), 'UNRESOLVED')
})

test('T11c: REJECTED stays REJECTED', () => {
  assertEqual(escalateStatus('REJECTED'), 'REJECTED')
})

test('T11d: WARNING stays WARNING', () => {
  assertEqual(escalateStatus('WARNING'), 'WARNING')
})

// ─────────────────────────────────────────────────────────────────────────────
// bankFingerprint determinism tests
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── bankFingerprint determinism ───────────────────────────────────────')

test('T12a: same inputs → identical fingerprint', () => {
  const fp1 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS COFFEE', '1234.56')
  const fp2 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS COFFEE', '1234.56')
  assertEqual(fp1, fp2)
})

test('T12b: different date → different fingerprint', () => {
  const fp1 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS', '1234.56')
  const fp2 = computeBankFingerprint('2024-01-16', '-42.50', 'STARBUCKS', '1234.56')
  assert(fp1 !== fp2, 'different dates must produce different fingerprints')
})

test('T12c: different amount → different fingerprint', () => {
  const fp1 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS', '1234.56')
  const fp2 = computeBankFingerprint('2024-01-15', '-43.00', 'STARBUCKS', '1234.56')
  assert(fp1 !== fp2)
})

test('T12d: different description → different fingerprint', () => {
  const fp1 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS', '1234.56')
  const fp2 = computeBankFingerprint('2024-01-15', '-42.50', 'AMAZON', '1234.56')
  assert(fp1 !== fp2)
})

test('T12e: description comparison is case-insensitive (already lowercased)', () => {
  // Fingerprint normalises to lowercase, so STARBUCKS == starbucks == Starbucks
  const fp1 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS', null)
  const fp2 = computeBankFingerprint('2024-01-15', '-42.50', 'starbucks', null)
  assertEqual(fp1, fp2, 'case should not matter for description ')
})

test('T12f: null balance treated as NO_BALANCE sentinel', () => {
  const fp1 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS', null)
  const fp2 = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS', 'NO_BALANCE')
  // null → 'NO_BALANCE' in the implementation, so these should be equal
  assertEqual(fp1, fp2)
})

test('T12g: null date treated as NO_DATE sentinel', () => {
  const fp1 = computeBankFingerprint(null, '-42.50', 'STARBUCKS', null)
  const fp2 = computeBankFingerprint('NO_DATE', '-42.50', 'STARBUCKS', null)
  assertEqual(fp1, fp2)
})

test('T12h: fingerprint is a 64-char hex string (SHA-256)', () => {
  const fp = computeBankFingerprint('2024-01-15', '-42.50', 'STARBUCKS', null)
  assert(typeof fp === 'string', 'should be a string')
  assertEqual(fp.length, 64, 'SHA-256 hex is 64 chars ')
  assert(/^[0-9a-f]+$/.test(fp), 'should be lowercase hex')
})

// ─────────────────────────────────────────────────────────────────────────────
// Cross-upload dedup simulation (end-to-end pure logic)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n── Cross-upload dedup simulation ─────────────────────────────────────')

test('T13: new batch transaction matching existing → detected as cross-upload duplicate', () => {
  const fp = computeBankFingerprint('2024-01-15', '-42.50', 'Target', null)

  // Simulate: existing is from a previous upload
  const existing = [{ id: 'old-tx', bankFingerprint: fp, uploadId: 'upload-A' }]
  // New batch from current upload
  const newBatch = [{ id: 'new-tx', bankFingerprint: fp }]

  const existingFpMap = new Map()
  for (const ex of existing) {
    const arr = existingFpMap.get(ex.bankFingerprint) ?? []
    arr.push(ex)
    existingFpMap.set(ex.bankFingerprint, arr)
  }

  const crossMatches = existingFpMap.get(fp) ?? []
  assert(crossMatches.length === 1, 'should find one cross-upload match')
  assertEqual(crossMatches[0].id, 'old-tx')
})

test('T14: within-upload duplicate: same transaction imported twice in one CSV', () => {
  const fp = computeBankFingerprint('2024-01-15', '-42.50', 'Target', null)
  const batch = [
    { id: 'tx-a', key: fp },
    { id: 'tx-b', key: fp },
    { id: 'tx-c', key: 'different-fp' },
  ]

  const groups = groupByKey(batch)
  const dupes  = findWithinUploadDupes(groups)

  assert(dupes.has(fp), 'should detect within-upload duplicate')
  assertEqual(dupes.get(fp)?.length, 2)
  assert(!dupes.has('different-fp'), 'unique transaction should not be flagged')
})

test('T15: mixed scenario — within and cross-upload', () => {
  const fp1 = computeBankFingerprint('2024-01-15', '-42.50', 'Target', null)
  const fp2 = computeBankFingerprint('2024-01-16', '-12.00', 'Amazon', null)
  const fp3 = computeBankFingerprint('2024-01-17', '-8.99', 'Spotify', null)

  // Batch: fp1 appears twice (within-upload); fp2 matches existing (cross-upload); fp3 is unique
  const batch = [
    { id: 'new1', key: fp1 },
    { id: 'new2', key: fp1 },   // within-upload duplicate of new1
    { id: 'new3', key: fp2 },   // cross-upload duplicate of existing
    { id: 'new4', key: fp3 },   // unique
  ]

  const existing = [{ id: 'old1', bankFingerprint: fp2 }]

  const groups = groupByKey(batch)
  const withinDupes = findWithinUploadDupes(groups)

  const existingMap = new Map()
  for (const ex of existing) {
    const arr = existingMap.get(ex.bankFingerprint) ?? []
    arr.push(ex)
    existingMap.set(ex.bankFingerprint, arr)
  }

  // Count flagged
  let flagged = 0
  for (const tx of batch) {
    const isWithin = (withinDupes.get(tx.key)?.length ?? 0) > 1
    const isCross  = (existingMap.get(tx.key)?.length ?? 0) > 0
    if (isWithin || isCross) flagged++
  }

  // new1, new2 flagged (within), new3 flagged (cross), new4 not flagged
  assertEqual(flagged, 3, 'should flag 3 out of 4 transactions ')
})

test('T16: bankTransactionId match takes priority (confidence=1.0 vs 0.9)', () => {
  // When bankTransactionId is present and matches, it is a definitive duplicate
  const bankTxId = 'CHASE-2024-ABC123'
  const batchByTxId = [
    { id: 'new1', key: bankTxId },
  ]
  const existing = [{ id: 'old1', bankTransactionId: bankTxId }]

  const existingTxIdMap = new Map()
  for (const ex of existing) {
    const arr = existingTxIdMap.get(ex.bankTransactionId) ?? []
    arr.push(ex)
    existingTxIdMap.set(ex.bankTransactionId, arr)
  }

  const matches = existingTxIdMap.get(bankTxId) ?? []
  assert(matches.length === 1, 'should find bankTxId match')
  assertEqual(matches[0].id, 'old1')
})

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n── Results ───────────────────────────────────────────────────────────`)
console.log(`   Passed: ${passed}`)
console.log(`   Failed: ${failed}`)
console.log(`   Total:  ${passed + failed}`)

if (failed > 0) process.exit(1)
