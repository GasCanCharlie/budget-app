import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/uploads/[id]
// Returns full upload detail: metadata, reconciliation report, issue counts.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    include: {
      account: { select: { id: true, name: true, institution: true, accountType: true } },
      _count: {
        select: {
          ingestionIssues:  true,
          transactions:     true,
        },
      },
    },
  })

  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  // Break down issue counts by severity and resolved state
  const issueCounts = await prisma.ingestionIssue.groupBy({
    by: ['severity', 'resolved'],
    where: { uploadId: params.id },
    _count: { id: true },
  })

  const issueBreakdown = {
    total:       upload._count.ingestionIssues,
    unresolved:  0,
    resolved:    0,
    byType:      {} as Record<string, number>,
  }
  for (const row of issueCounts) {
    if (row.resolved) issueBreakdown.resolved  += row._count.id
    else              issueBreakdown.unresolved += row._count.id
  }

  // Count by issueType (separate query)
  const issuesByType = await prisma.ingestionIssue.groupBy({
    by: ['issueType'],
    where: { uploadId: params.id, resolved: false },
    _count: { id: true },
  })
  for (const row of issuesByType) {
    issueBreakdown.byType[row.issueType] = row._count.id
  }

  // Parse stored JSON fields
  let reconciliationReport: unknown = null
  if (upload.reconciliationReport) {
    try { reconciliationReport = JSON.parse(upload.reconciliationReport) } catch { /* leave null */ }
  }
  let importReport: unknown = null
  if (upload.importReport) {
    try { importReport = JSON.parse(upload.importReport) } catch { /* leave null */ }
  }
  let warnings: unknown[] = []
  try { warnings = JSON.parse(upload.warnings) } catch { /* leave [] */ }

  return NextResponse.json({
    upload: {
      id:                    upload.id,
      filename:              upload.filename,
      fileHash:              upload.fileHash,
      formatDetected:        upload.formatDetected,
      status:                upload.status,
      createdAt:             upload.createdAt,
      completedAt:           upload.completedAt,
      account:               upload.account,
      rowCountRaw:           upload.rowCountRaw,
      rowCountParsed:        upload.rowCountParsed,
      rowCountAccepted:      upload.rowCountAccepted,
      rowCountRejected:      upload.rowCountRejected,
      totalRowsUnresolved:   upload.totalRowsUnresolved,
      dateRangeStart:        upload.dateRangeStart,
      dateRangeEnd:          upload.dateRangeEnd,
      parserVersion:         upload.parserVersion,
      // Statement-level totals (if provided at upload time)
      statementOpenBalance:  upload.statementOpenBalance,
      statementCloseBalance: upload.statementCloseBalance,
      statementTotalCredits: upload.statementTotalCredits,
      statementTotalDebits:  upload.statementTotalDebits,
      // Reconciliation
      reconciliationStatus:  upload.reconciliationStatus,
      reconciliationReport,
      // Import report
      importReport,
      // Issues summary
      issueBreakdown,
      // Warnings from parser
      warnings,
      // Transaction count from relation
      transactionCount:      upload._count.transactions,
    },
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/uploads/[id]
// Deletes an upload and all dependent records in the correct FK order.
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership via userId on Upload
  const upload = await prisma.upload.findFirst({
    where: { id: params.id, userId: payload.userId },
    select: { id: true, accountId: true },
  })
  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  const result = await prisma.$transaction(async tx => {
    // 1. Get all transaction IDs + merchants for this upload
    const txRows = await tx.transaction.findMany({
      where: { uploadId: params.id },
      select: { id: true, date: true, merchantNormalized: true },
    })
    const txIds = txRows.map(t => t.id)
    const deletedMerchants = [...new Set(txRows.map(t => t.merchantNormalized).filter(Boolean))]

    // 2. Delete CategoryHistory (depends on transactionId)
    if (txIds.length > 0) {
      await tx.categoryHistory.deleteMany({ where: { transactionId: { in: txIds } } })
    }

    // 3. Delete TransactionLinks (both directions)
    if (txIds.length > 0) {
      await tx.transactionLink.deleteMany({ where: { transactionAId: { in: txIds } } })
      await tx.transactionLink.deleteMany({ where: { transactionBId: { in: txIds } } })
    }

    // 4. Delete IngestionIssues (depends on uploadId and transactionId)
    await tx.ingestionIssue.deleteMany({ where: { uploadId: params.id } })

    // 5. Delete AuditLogEntries (depends on uploadId)
    await tx.auditLogEntry.deleteMany({ where: { uploadId: params.id } })

    // 5b. Delete RuleHits → StagingTransactions → StagingUpload (FK constraints)
    const stagingTxIds = (await tx.stagingTransaction.findMany({
      where: { uploadId: params.id },
      select: { id: true },
    })).map(s => s.id)
    if (stagingTxIds.length > 0) {
      await tx.ruleHit.deleteMany({ where: { stagingTxId: { in: stagingTxIds } } })
    }
    await tx.stagingTransaction.deleteMany({ where: { uploadId: params.id } })
    await tx.stagingUpload.deleteMany({ where: { uploadId: params.id } })

    // 6. Delete Transactions (depends on categoryId, uploadId)
    const { count: deletedTransactions } = await tx.transaction.deleteMany({ where: { uploadId: params.id } })

    // 7. Delete TransactionRaw (depends on uploadId)
    await tx.transactionRaw.deleteMany({ where: { uploadId: params.id } })

    // 8. Delete the Upload record itself
    await tx.upload.delete({ where: { id: params.id } })

    // 8b. Clean up rules for merchants that no longer have any transactions
    if (deletedMerchants.length > 0) {
      const stillPresent = await tx.transaction.findMany({
        where: {
          account: { userId: payload.userId },
          merchantNormalized: { in: deletedMerchants },
        },
        select: { merchantNormalized: true },
        distinct: ['merchantNormalized'],
      })
      const stillPresentSet = new Set(stillPresent.map(t => t.merchantNormalized))
      const orphanedMerchants = deletedMerchants.filter(m => !stillPresentSet.has(m))
      if (orphanedMerchants.length > 0) {
        const lowerMerchants = orphanedMerchants.map(m => m.toLowerCase())
        await tx.categoryRule.deleteMany({
          where: {
            userId: payload.userId,
            isSystem: false,
            OR: [
              { matchValue: { in: lowerMerchants } },
              { vendorKey:  { in: lowerMerchants } },
            ],
          },
        })
      }
    }

    // 9. Recompute or clean up monthly summaries for affected months
    // If no other transactions remain for a given month/user, remove the summary
    const months = new Set(txRows.map(t => {
      const d = new Date(t.date)
      return `${d.getFullYear()}-${d.getMonth() + 1}`
    }))
    for (const key of Array.from(months)) {
      const [y, m] = key.split('-').map(Number)
      const remaining = await tx.transaction.count({
        where: {
          account: { userId: payload.userId },
          date: { gte: new Date(y, m - 1, 1), lt: new Date(y, m, 1) },
          isExcluded: false,
        },
      })
      if (remaining === 0) {
        await tx.monthCategoryTotal.deleteMany({ where: { userId: payload.userId, year: y, month: m } })
        await tx.monthSummary.deleteMany({ where: { userId: payload.userId, year: y, month: m } })
      } else {
        // Mark stale so next dashboard load recomputes
        await tx.monthSummary.updateMany({
          where: { userId: payload.userId, year: y, month: m },
          data: { isStale: true },
        })
      }
    }

    return { deletedTransactions }
  })

  return NextResponse.json({ success: true, ...result })
}
