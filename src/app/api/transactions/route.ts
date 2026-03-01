import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const year            = searchParams.get('year')            ? parseInt(searchParams.get('year')!)    : null
  const month           = searchParams.get('month')           ? parseInt(searchParams.get('month')!)   : null
  const category        = searchParams.get('category')        || null
  const search          = searchParams.get('search')          || null
  const ingestionFilter = searchParams.get('ingestionFilter') || null   // 'flagged' | 'duplicate'
  const page            = parseInt(searchParams.get('page')   || '1')
  const limit           = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const skip            = (page - 1) * limit

  const where: Record<string, unknown> = {
    account: { userId: payload.userId },
    isExcluded: false,
  }

  if (year && month) {
    const start = new Date(year, month - 1, 1)
    const end   = new Date(year, month, 0, 23, 59, 59)
    where['date'] = { gte: start, lte: end }
  }

  if (category) {
    // Effective category = userOverrideCategoryId when set, otherwise categoryId.
    // A transaction belongs to this category if:
    //   • the user explicitly moved it here (userOverrideCategoryId = category), OR
    //   • it was auto-categorized here AND hasn't been moved (categoryId = category AND no override)
    where['OR'] = [
      { userOverrideCategoryId: category },
      { categoryId: category, userOverrideCategoryId: null },
    ]
  }

  if (search) {
    where['OR'] = [
      { description: { contains: search } },
      { merchantNormalized: { contains: search } },
    ]
  }

  // Ingestion-quality filters (independent of category/search OR conditions)
  if (ingestionFilter === 'flagged') {
    where['ingestionStatus'] = { in: ['UNRESOLVED', 'WARNING'] }
  } else if (ingestionFilter === 'duplicate') {
    where['isPossibleDuplicate'] = true
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause = where as any

  // Base where (without ingestionFilter) for sidebar counts
  const baseWhere = { ...where }
  delete (baseWhere as Record<string, unknown>)['ingestionStatus']
  delete (baseWhere as Record<string, unknown>)['isPossibleDuplicate']

  try {
  const [transactions, total, flaggedCount, duplicateCount] = await Promise.all([
    prisma.transaction.findMany({
      where: whereClause,
      include: {
        category: { select: { id: true, name: true, color: true, icon: true } },
        overrideCategory: { select: { id: true, name: true, color: true, icon: true } },
        historyEntries: {
          orderBy: { changedAt: 'desc' },
          take: 3,
          include: {
            oldCategory: { select: { name: true } },
            newCategory: { select: { name: true } },
          }
        },
      },
      orderBy: { date: 'desc' },
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where: whereClause }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.transaction.count({ where: { ...(baseWhere as any), ingestionStatus: { in: ['UNRESOLVED', 'WARNING'] } } }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    prisma.transaction.count({ where: { ...(baseWhere as any), isPossibleDuplicate: true } }),
  ])

  const formatted = transactions.map(tx => {
    const effectiveCat = tx.overrideCategory ?? tx.category
    return {
      id:                    tx.id,
      date:                  tx.date,
      description:           tx.description,
      merchantNormalized:    tx.merchantNormalized,
      descriptionDisplay:    tx.merchantNormalized?.trim() || tx.description?.trim() || '',
      amount:                tx.amount,
      isTransfer:            tx.isTransfer,
      isDuplicate:           tx.isDuplicate,
      isForeignCurrency:     tx.isForeignCurrency,
      foreignAmount:         tx.foreignAmount,
      foreignCurrency:       tx.foreignCurrency,
      reviewedByUser:        tx.reviewedByUser,
      categorizationSource:  tx.userOverrideCategoryId ? 'user' : tx.categorizationSource,
      confidenceScore:       tx.confidenceScore,
      // Ingestion quality fields
      ingestionStatus:       tx.ingestionStatus,
      isPossibleDuplicate:   tx.isPossibleDuplicate,
      dateAmbiguity:         tx.dateAmbiguity,
      dateInterpretationA:   tx.dateInterpretationA,
      dateInterpretationB:   tx.dateInterpretationB,
      bankCategoryRaw:       tx.bankCategoryRaw,
      category: effectiveCat ? {
        id:    effectiveCat.id,
        name:  effectiveCat.name,
        color: effectiveCat.color,
        icon:  effectiveCat.icon,
      } : null,
      history: tx.historyEntries.map(h => ({
        oldCategory: h.oldCategory?.name,
        newCategory: h.newCategory.name,
        changedBy:   h.changedBy,
        changedAt:   h.changedAt,
      })),
    }
  })

  return NextResponse.json({
    transactions: formatted,
    total,
    page,
    pages:          Math.ceil(total / limit),
    flaggedCount,
    duplicateCount,
  })
  } catch (e) {
    console.error('[/api/transactions] ERROR:', e)
    return NextResponse.json({ error: 'Internal server error', detail: String(e) }, { status: 500 })
  }
}
