/**
 * Server-side autopsy trigger.
 *
 * Called after any categorization save. Checks if the upload has reached
 * 100% categorization and, if so, fires computeInsights() in the background and
 * persists the result status on the Upload row.
 *
 * Safe to call frequently — uses an atomic DB update as a lock so only one
 * invocation proceeds to generation even under concurrent requests.
 */

import prisma from '@/lib/db'
import { computeInsights } from './compute'

const THRESHOLD = 1.0

export async function triggerAutopsyIfReady(userId: string, uploadId: string): Promise<void> {
  try {
    // Get upload status and date range
    const upload = await prisma.upload.findFirst({
      where: { id: uploadId, userId },
      select: { id: true, dateRangeEnd: true, financialAutopsyStatus: true },
    })
    if (!upload) return

    // Already done — nothing to do
    if (upload.financialAutopsyStatus === 'ready') return
    // Already in progress — don't double-run
    if (upload.financialAutopsyStatus === 'generating') return

    // Check categorization progress for this upload's transactions
    const [total, categorized] = await Promise.all([
      prisma.transaction.count({ where: { uploadId, isExcluded: false } }),
      prisma.transaction.count({ where: { uploadId, isExcluded: false, appCategory: { not: null } } }),
    ])
    if (total === 0 || categorized / total < THRESHOLD) return

    // Determine year/month — prefer dateRangeEnd, fall back to max tx date
    let year: number
    let month: number
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
      if (!latest) return
      year  = latest.date.getFullYear()
      month = latest.date.getMonth() + 1
    }

    // Atomic lock — only proceed if we win the race to set 'generating'
    const locked = await prisma.upload.updateMany({
      where: {
        id: uploadId,
        financialAutopsyStatus: { notIn: ['generating', 'ready'] },
      },
      data: { financialAutopsyStatus: 'generating' },
    })
    if (locked.count === 0) return // another request already claimed the lock

    // Fire generation in the background — don't await so the save response is instant
    void computeInsights(userId, year, month)
      .then(async () => {
        await prisma.upload.update({
          where: { id: uploadId },
          data: {
            financialAutopsyStatus: 'ready',
            financialAutopsyGeneratedAt: new Date(),
          },
        })
      })
      .catch(async (err) => {
        console.error('[autopsy-trigger] generation failed:', err)
        await prisma.upload.update({
          where: { id: uploadId },
          data: { financialAutopsyStatus: 'failed' },
        })
      })
  } catch (err) {
    // Never let autopsy trigger errors break the save flow
    console.error('[autopsy-trigger] unexpected error:', err)
  }
}
