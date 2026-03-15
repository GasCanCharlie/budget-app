import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'
import { getUserFromRequest } from '@/lib/auth'

const schema = z.object({
  password: z.string().min(1),
})

/**
 * POST /api/auth/reset-data
 * Deletes all user data (uploads, transactions, rules, categories, insights)
 * but keeps the account itself. Requires password confirmation.
 */
export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({ where: { id: payload.userId } })
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const valid = await bcrypt.compare(parsed.data.password, user.passwordHash)
  if (!valid) {
    return NextResponse.json({ error: 'Incorrect password' }, { status: 400 })
  }

  try {
    // ── User-level derived data ──────────────────────────────────────────────
    await prisma.anomalyAlert.deleteMany({ where: { userId: payload.userId } })
    await prisma.insightCard.deleteMany({ where: { userId: payload.userId } })
    await prisma.subscriptionCandidate.deleteMany({ where: { userId: payload.userId } })
    await prisma.budgetTarget.deleteMany({ where: { userId: payload.userId } })
    await prisma.monthCategoryTotal.deleteMany({ where: { userId: payload.userId } })
    await prisma.monthSummary.deleteMany({ where: { userId: payload.userId } })

    // ── Gather IDs for cascade ───────────────────────────────────────────────
    const accounts = await prisma.account.findMany({
      where: { userId: payload.userId },
      select: { id: true },
    })
    const accountIds = accounts.map(a => a.id)

    const uploads = await prisma.upload.findMany({
      where: { accountId: { in: accountIds } },
      select: { id: true },
    })
    const uploadIds = uploads.map(u => u.id)

    const txs = await prisma.transaction.findMany({
      where: { uploadId: { in: uploadIds } },
      select: { id: true },
    })
    const txIds = txs.map(t => t.id)

    // ── Transaction-level dependants ─────────────────────────────────────────
    await prisma.ingestionIssue.deleteMany({ where: { uploadId: { in: uploadIds } } })
    await prisma.auditLogEntry.deleteMany({ where: { uploadId: { in: uploadIds } } })
    await prisma.ruleHit.deleteMany({ where: { stagingTx: { uploadId: { in: uploadIds } } } })
    await prisma.categoryHistory.deleteMany({ where: { transactionId: { in: txIds } } })
    await prisma.transactionLink.deleteMany({
      where: { OR: [{ transactionAId: { in: txIds } }, { transactionBId: { in: txIds } }] },
    })
    await prisma.transaction.deleteMany({ where: { id: { in: txIds } } })

    // ── Staging data ─────────────────────────────────────────────────────────
    await prisma.stagingTransaction.deleteMany({ where: { stagingUpload: { uploadId: { in: uploadIds } } } })
    await prisma.stagingUpload.deleteMany({ where: { uploadId: { in: uploadIds } } })

    // ── Upload data ──────────────────────────────────────────────────────────
    await prisma.transactionRaw.deleteMany({ where: { uploadId: { in: uploadIds } } })
    await prisma.upload.deleteMany({ where: { id: { in: uploadIds } } })

    // ── Rules, user-created categories, accounts ─────────────────────────────
    await prisma.categoryRule.deleteMany({ where: { userId: payload.userId } })
    await prisma.category.deleteMany({ where: { userId: payload.userId } })
    await prisma.account.deleteMany({ where: { userId: payload.userId } })

    // ── Reset user preferences ───────────────────────────────────────────────
    await prisma.user.update({
      where: { id: payload.userId },
      data: { categoryOrder: '[]', hiddenCategories: '[]' },
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('reset-data error:', err)
    return NextResponse.json({ error: 'Failed to reset account data' }, { status: 500 })
  }
}
