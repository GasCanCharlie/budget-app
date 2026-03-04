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
  const displayCategory = searchParams.get('displayCategory') || null
  const search          = searchParams.get('search')          || null
  const ingestionFilter = searchParams.get('ingestionFilter') || null   // 'flagged' | 'duplicate'
  const sortBy          = searchParams.get('sortBy')  || 'date'          // 'date' | 'vendor' | 'amount'
  const sortDir         = searchParams.get('sortDir') || 'desc'          // 'asc' | 'desc'
  const page            = parseInt(searchParams.get('page')   || '1')
  const limit           = Math.min(parseInt(searchParams.get('limit') || '100'), 500)
  const skip            = (page - 1) * limit

  const safeDir = sortDir === 'asc' ? 'asc' : 'desc'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderBy: any =
    sortBy === 'vendor' ? { merchantNormalized: safeDir } :
    sortBy === 'amount' ? { amount: safeDir }             :
    { date: safeDir }

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
    // Legacy FK-based filter (old categoryId UUIDs)
    where['OR'] = [
      { userOverrideCategoryId: category },
      { categoryId: category, userOverrideCategoryId: null },
    ]
  }

  if (displayCategory) {
    // New display-category filter: appCategory takes priority, falls back to bankCategoryRaw
    where['OR'] = [
      { appCategory: displayCategory },
      { appCategory: null, bankCategoryRaw: displayCategory },
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
  // 'same-price' is applied below after computing shared amounts

  try {
  // Base where (without ingestionFilter-specific keys) for sidebar counts + groupBy
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const baseWhere: any = { ...where }
  delete baseWhere['ingestionStatus']
  delete baseWhere['isPossibleDuplicate']

  // Find amounts shared by 2+ transactions within the current filter context
  const amountGroups = await prisma.transaction.groupBy({
    by: ['amount'],
    where: baseWhere,
    _count: { _all: true },
  })
  const sharedPriceAmounts = amountGroups.filter(g => g._count._all > 1).map(g => g.amount)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const whereClause: any = ingestionFilter === 'same-price'
    ? { ...where, amount: { in: sharedPriceAmounts } }
    : where

  const [transactions, total, flaggedCount, duplicateCount, uncategorizedCount, samePriceCount] = await Promise.all([
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
      orderBy,
      skip,
      take: limit,
    }),
    prisma.transaction.count({ where: whereClause }),
    prisma.transaction.count({ where: { ...baseWhere, ingestionStatus: { in: ['UNRESOLVED', 'WARNING'] } } }),
    prisma.transaction.count({ where: { ...baseWhere, isPossibleDuplicate: true } }),
    // Global uncategorized count (not filtered by current view)
    prisma.transaction.count({
      where: { account: { userId: payload.userId }, isExcluded: false, appCategory: null },
    }),
    // Transactions that share an exact amount with at least one other transaction
    prisma.transaction.count({
      where: { ...baseWhere, amount: { in: sharedPriceAmounts } },
    }),
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
      appCategory:           tx.appCategory,
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
    uncategorizedCount,
    samePriceCount,
  })
  } catch (e) {
    console.error('[/api/transactions] ERROR:', e)
    return NextResponse.json({ error: 'Internal server error', detail: String(e) }, { status: 500 })
  }
}
