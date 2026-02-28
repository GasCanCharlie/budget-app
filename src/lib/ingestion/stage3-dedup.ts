/**
 * Stage 3 — Dedup
 *
 * Detects possible duplicate transactions by comparing bankFingerprint values
 * and (when available) bankTransactionId values across uploads for the same account.
 *
 * Two detection passes:
 *   Pass A — bankTransactionId: exact match of bank-provided IDs (highest confidence, 1.0)
 *   Pass B — bankFingerprint:   SHA-256(date|||amount|||desc|||balance) (high confidence, 0.9)
 *
 * Within each pass, duplicates can be:
 *   - Within-upload: same fingerprint appears more than once in this upload's batch
 *   - Cross-upload: fingerprint matches a transaction from a previous upload (same account)
 *
 * Side effects:
 *   - Updates Transaction.isPossibleDuplicate, .duplicateGroupId, .ingestionStatus
 *   - Creates IngestionIssue records (type = POSSIBLE_DUPLICATE)
 *   - Creates TransactionLink records for each duplicate pair (linkType = POSSIBLE_DUPLICATE)
 *   - Writes one AuditLogEntry for the DEDUP stage
 *   - Cross-upload: also flags the original (already-imported) transaction
 *
 * Design contracts:
 *   - Idempotent: running twice produces the same result
 *   - ingestionStatus is only escalated (VALID → WARNING), never demoted
 *   - duplicateGroupId = bankFingerprint (deterministic — same fingerprint always maps to same group)
 */

import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface DedupResult {
  /** Total transactions flagged as possible duplicates (in this upload) */
  possibleDuplicatesFound: number
  /** Transactions matched against a previously-imported transaction */
  crossUploadMatches: number
  /** Transactions matched within this upload's batch */
  withinUploadMatches: number
  /** Transactions matched via bankTransactionId (definitive duplicates) */
  bankTxIdMatches: number
}

/** Minimal transaction shape fetched from DB during dedup */
interface TxMinimal {
  id: string
  bankFingerprint: string
  bankTransactionId: string | null
  ingestionStatus: string
  isPossibleDuplicate: boolean
}

/** Minimal shape for an existing (previous-upload) transaction */
interface TxExisting {
  id: string
  bankFingerprint: string
  bankTransactionId: string | null
  uploadId: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (testable without DB)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group transactions by a key (fingerprint or bankTransactionId).
 * Returns a map from key → array of tx IDs.
 */
export function groupByKey(
  txs: Array<{ id: string; key: string }>,
): Map<string, string[]> {
  const m = new Map<string, string[]>()
  for (const tx of txs) {
    if (!tx.key) continue
    const group = m.get(tx.key) ?? []
    group.push(tx.id)
    m.set(tx.key, group)
  }
  return m
}

/**
 * Given a set of groups, return the IDs of all groups with more than one member.
 * These are the within-upload duplicates.
 */
export function findWithinUploadDupes(
  groups: Map<string, string[]>,
): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [key, ids] of Array.from(groups)) {
    if (ids.length > 1) result.set(key, ids)
  }
  return result
}

/**
 * Escalate ingestionStatus: VALID → WARNING; UNRESOLVED/REJECTED unchanged.
 */
export function escalateStatus(current: string): string {
  return current === 'VALID' ? 'WARNING' : current
}

// ─────────────────────────────────────────────────────────────────────────────
// DB helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a TransactionLink pair between two transactions (only if not already linked).
 * Enforces canonical order (smaller id first) to prevent duplicate link rows.
 */
async function linkTransactions(
  idA: string,
  idB: string,
  confidence: number,
): Promise<void> {
  const [a, b] = idA < idB ? [idA, idB] : [idB, idA]
  // Check existing link to keep idempotency
  const existing = await prisma.transactionLink.findFirst({
    where: { transactionAId: a, transactionBId: b, linkType: 'POSSIBLE_DUPLICATE' },
  })
  if (!existing) {
    await prisma.transactionLink.create({
      data: {
        transactionAId:  a,
        transactionBId:  b,
        linkType:        'POSSIBLE_DUPLICATE',
        confidence,
        confirmedByUser: false,
      },
    })
  }
}

/**
 * Flag a transaction as a possible duplicate and update its ingestionStatus.
 * Skips if already flagged (idempotent).
 */
async function flagTransaction(
  tx: TxMinimal,
  groupId: string,
): Promise<void> {
  if (tx.isPossibleDuplicate) return // already flagged
  await prisma.transaction.update({
    where: { id: tx.id },
    data: {
      isPossibleDuplicate: true,
      duplicateGroupId:    groupId,
      ingestionStatus:     escalateStatus(tx.ingestionStatus),
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run Stage 3 dedup for the given upload.
 *
 * Should be called after all Transaction rows for this upload have been persisted.
 *
 * @param uploadId  The ID of the upload being processed
 * @param accountId The account the upload belongs to
 */
export async function runDedup(uploadId: string, accountId: string): Promise<DedupResult> {
  let possibleDuplicatesFound = 0
  let crossUploadMatches = 0
  let withinUploadMatches = 0
  let bankTxIdMatches = 0

  // ── Fetch all transactions for this upload ─────────────────────────────────
  const thisBatch: TxMinimal[] = await prisma.transaction.findMany({
    where: { uploadId },
    select: {
      id:                true,
      bankFingerprint:   true,
      bankTransactionId: true,
      ingestionStatus:   true,
      isPossibleDuplicate: true,
    },
  })

  if (thisBatch.length === 0) {
    await writeAuditLog(uploadId, 'INFO', 'Dedup: no transactions to check', {})
    return { possibleDuplicatesFound: 0, crossUploadMatches: 0, withinUploadMatches: 0, bankTxIdMatches: 0 }
  }

  // Collect unique non-empty fingerprints and bankTransactionIds
  const fingerprints   = Array.from(new Set(thisBatch.map((t) => t.bankFingerprint).filter(Boolean)))
  const bankTxIds      = Array.from(new Set(thisBatch.map((t) => t.bankTransactionId).filter((id): id is string => !!id)))

  // ── Fetch potentially matching existing transactions ───────────────────────
  const existingByFingerprint: TxExisting[] = fingerprints.length > 0
    ? await prisma.transaction.findMany({
        where: {
          accountId,
          bankFingerprint: { in: fingerprints },
          uploadId: { not: uploadId },
        },
        select: { id: true, bankFingerprint: true, bankTransactionId: true, uploadId: true },
      })
    : []

  const existingByBankTxId: TxExisting[] = bankTxIds.length > 0
    ? await prisma.transaction.findMany({
        where: {
          accountId,
          bankTransactionId: { in: bankTxIds },
          uploadId: { not: uploadId },
        },
        select: { id: true, bankFingerprint: true, bankTransactionId: true, uploadId: true },
      })
    : []

  // Build lookup maps for existing transactions
  const existingFpMap  = new Map<string, TxExisting[]>()
  for (const ex of existingByFingerprint) {
    const arr = existingFpMap.get(ex.bankFingerprint) ?? []
    arr.push(ex)
    existingFpMap.set(ex.bankFingerprint, arr)
  }

  const existingTxIdMap = new Map<string, TxExisting[]>()
  for (const ex of existingByBankTxId) {
    if (!ex.bankTransactionId) continue
    const arr = existingTxIdMap.get(ex.bankTransactionId) ?? []
    arr.push(ex)
    existingTxIdMap.set(ex.bankTransactionId, arr)
  }

  // ── Pass A: bankTransactionId duplicates (confidence = 1.0) ───────────────
  // Group within-upload by bankTransactionId
  const batchTxIdGroups = groupByKey(
    thisBatch
      .filter((t) => !!t.bankTransactionId)
      .map((t) => ({ id: t.id, key: t.bankTransactionId! })),
  )
  const withinTxIdDupes = findWithinUploadDupes(batchTxIdGroups)

  const processedForBankTxId = new Set<string>()

  for (const tx of thisBatch) {
    if (!tx.bankTransactionId) continue

    const withinGroup    = withinTxIdDupes.get(tx.bankTransactionId)
    const crossMatches   = existingTxIdMap.get(tx.bankTransactionId) ?? []
    const isWithinDupe   = withinGroup ? withinGroup.length > 1 : false
    const isCrossDupe    = crossMatches.length > 0

    if (!isWithinDupe && !isCrossDupe) continue
    if (processedForBankTxId.has(tx.id)) continue

    processedForBankTxId.add(tx.id)
    const groupId = tx.bankFingerprint || tx.bankTransactionId!

    await flagTransaction(tx, groupId)
    possibleDuplicatesFound++
    bankTxIdMatches++
    if (isWithinDupe)  withinUploadMatches++
    if (isCrossDupe)   crossUploadMatches++

    // Create IngestionIssue
    const descParts: string[] = []
    if (isWithinDupe)  descParts.push(`appears ${withinGroup!.length}× in this upload`)
    if (isCrossDupe)   descParts.push(`matches ${crossMatches.length} prior import(s)`)
    await prisma.ingestionIssue.create({
      data: {
        uploadId,
        transactionId:  tx.id,
        issueType:      'POSSIBLE_DUPLICATE',
        severity:       'WARNING',
        description:    `Bank transaction ID "${tx.bankTransactionId}" ${descParts.join(' and ')}`,
        suggestedAction: 'Review both transactions and delete one if it is a genuine duplicate',
        resolved:        false,
      },
    })

    // Link pairs
    if (isWithinDupe) {
      for (const otherId of withinGroup!) {
        if (otherId !== tx.id) await linkTransactions(tx.id, otherId, 1.0)
      }
    }
    for (const ex of crossMatches) {
      await linkTransactions(tx.id, ex.id, 1.0)
      // Also flag the existing transaction
      const existingTx = await prisma.transaction.findUnique({
        where: { id: ex.id },
        select: { id: true, bankFingerprint: true, bankTransactionId: true, ingestionStatus: true, isPossibleDuplicate: true },
      })
      if (existingTx) await flagTransaction(existingTx, groupId)
    }
  }

  // ── Pass B: bankFingerprint duplicates (confidence = 0.9) ─────────────────
  // Within-upload fingerprint groups
  const batchFpGroups = groupByKey(
    thisBatch
      .filter((t) => !!t.bankFingerprint)
      .map((t) => ({ id: t.id, key: t.bankFingerprint })),
  )
  const withinFpDupes = findWithinUploadDupes(batchFpGroups)

  const processedForFp = new Set<string>()

  for (const tx of thisBatch) {
    if (!tx.bankFingerprint) continue
    if (processedForBankTxId.has(tx.id)) continue // already handled by Pass A

    const withinGroup  = withinFpDupes.get(tx.bankFingerprint)
    const crossMatches = existingFpMap.get(tx.bankFingerprint) ?? []
    const isWithinDupe = withinGroup ? withinGroup.length > 1 : false
    const isCrossDupe  = crossMatches.length > 0

    if (!isWithinDupe && !isCrossDupe) continue
    if (processedForFp.has(tx.id)) continue

    processedForFp.add(tx.id)
    const groupId = tx.bankFingerprint

    await flagTransaction(tx, groupId)
    possibleDuplicatesFound++
    if (isWithinDupe) withinUploadMatches++
    if (isCrossDupe)  crossUploadMatches++

    // Create IngestionIssue
    const descParts: string[] = []
    if (isWithinDupe) descParts.push(`appears ${withinGroup!.length}× in this upload`)
    if (isCrossDupe)  descParts.push(`fingerprint matches ${crossMatches.length} prior import(s)`)
    await prisma.ingestionIssue.create({
      data: {
        uploadId,
        transactionId:  tx.id,
        issueType:      'POSSIBLE_DUPLICATE',
        severity:       'WARNING',
        description:    `Possible duplicate: ${descParts.join(' and ')}`,
        suggestedAction: 'Review both transactions and delete one if it is a genuine duplicate',
        resolved:        false,
      },
    })

    // Link pairs
    if (isWithinDupe) {
      for (const otherId of withinGroup!) {
        if (otherId !== tx.id) await linkTransactions(tx.id, otherId, 0.9)
      }
    }
    for (const ex of crossMatches) {
      await linkTransactions(tx.id, ex.id, 0.9)
      const existingTx = await prisma.transaction.findUnique({
        where: { id: ex.id },
        select: { id: true, bankFingerprint: true, bankTransactionId: true, ingestionStatus: true, isPossibleDuplicate: true },
      })
      if (existingTx) await flagTransaction(existingTx, groupId)
    }
  }

  // ── Audit log ──────────────────────────────────────────────────────────────
  const hasAny = possibleDuplicatesFound > 0
  await writeAuditLog(
    uploadId,
    hasAny ? 'WARN' : 'INFO',
    hasAny
      ? `Dedup: ${possibleDuplicatesFound} possible duplicate(s) found` +
        ` (${withinUploadMatches} within-upload, ${crossUploadMatches} cross-upload, ${bankTxIdMatches} by bankTxId)`
      : `Dedup: no duplicates detected across ${thisBatch.length} transaction(s)`,
    { possibleDuplicatesFound, crossUploadMatches, withinUploadMatches, bankTxIdMatches },
  )

  return { possibleDuplicatesFound, crossUploadMatches, withinUploadMatches, bankTxIdMatches }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit log helper
// ─────────────────────────────────────────────────────────────────────────────

async function writeAuditLog(
  uploadId: string,
  level: 'INFO' | 'WARN' | 'ERROR',
  message: string,
  context: Record<string, unknown>,
): Promise<void> {
  await prisma.auditLogEntry.create({
    data: {
      uploadId,
      stage:   'DEDUP',
      level,
      message,
      context: JSON.stringify(context),
    },
  })
}
