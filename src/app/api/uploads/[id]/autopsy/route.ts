/**
 * GET /api/uploads/[uploadId]/autopsy
 *
 * Returns the Financial Autopsy status and cards for a specific upload.
 * If the upload has hit the categorization threshold but autopsy hasn't
 * started, kicks off generation automatically.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { triggerAutopsyIfReady } from '@/lib/insights/autopsy-trigger'

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const uploadId = params.id

  // Verify ownership and get autopsy state
  const upload = await prisma.upload.findFirst({
    where: { id: uploadId, userId: payload.userId },
    select: {
      id: true,
      dateRangeEnd: true,
      financialAutopsyStatus: true,
      financialAutopsyGeneratedAt: true,
    },
  })
  if (!upload) return NextResponse.json({ error: 'Upload not found' }, { status: 404 })

  // Determine year/month for this upload
  let year: number | null = null
  let month: number | null = null

  if (upload.dateRangeEnd) {
    const d = new Date(upload.dateRangeEnd)
    year  = d.getFullYear()
    month = d.getMonth() + 1
  } else {
    const latest = await prisma.transaction.findFirst({
      where: { uploadId },
      orderBy: { date: 'desc' },
      select: { date: true },
    })
    if (latest) {
      year  = latest.date.getFullYear()
      month = latest.date.getMonth() + 1
    }
  }

  // Check categorization progress
  const [total, categorized] = await Promise.all([
    prisma.transaction.count({ where: { uploadId, isExcluded: false } }),
    prisma.transaction.count({ where: { uploadId, isExcluded: false, appCategory: { not: null } } }),
  ])
  const progress = total > 0 ? categorized / total : 0
  const thresholdMet = progress >= 1.0

  // If threshold is met and autopsy hasn't started, kick it off now (refresh heal)
  const currentStatus = upload.financialAutopsyStatus ?? 'pending'
  if (thresholdMet && currentStatus !== 'generating' && currentStatus !== 'ready') {
    void triggerAutopsyIfReady(payload.userId, uploadId)
    // Return 'generating' optimistically — trigger just fired
    return NextResponse.json({
      status: 'generating',
      year,
      month,
      progress,
      thresholdMet,
      cards: [],
      generatedAt: null,
    })
  }

  // Fetch autopsy cards from InsightCard table
  let cards: object[] = []
  if (currentStatus === 'ready' && year !== null && month !== null) {
    const rows = await prisma.insightCard.findMany({
      where: {
        userId: payload.userId,
        year,
        month,
        cardType:    { startsWith: 'autopsy_' },
        isDismissed: false,
      },
      orderBy: { priority: 'asc' },
    })

    cards = rows.map(r => ({
      id:              r.id,
      card_type:       r.cardType,
      priority:        r.priority,
      title:           r.title,
      summary:         r.summary,
      supporting_data: r.supportingData,
      actions:         r.actions,
      confidence:      r.confidence,
      icon_suggestion: r.iconSuggestion,
      generated_at:    r.generatedAt.toISOString(),
      year:            r.year,
      month:           r.month,
      numbers_used:    r.numbersUsed,
      filters:         r.filters ?? undefined,
    }))

    // If status is ready but no cards generated, the analysis found nothing notable
    // (all thresholds were below trigger levels) — still treat as ready
  }

  return NextResponse.json({
    status:      currentStatus,
    year,
    month,
    progress,
    thresholdMet,
    cards,
    generatedAt: upload.financialAutopsyGeneratedAt?.toISOString() ?? null,
  })
}
