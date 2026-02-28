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
      // Issues summary
      issueBreakdown,
      // Warnings from parser
      warnings,
      // Transaction count from relation
      transactionCount:      upload._count.transactions,
    },
  })
}
