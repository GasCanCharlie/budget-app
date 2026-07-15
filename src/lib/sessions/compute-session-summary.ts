/**
 * Session-level financial summary — same logic as computeMonthSummary
 * but scoped to an AnalysisSession instead of a calendar month.
 */

import prisma from '@/lib/db'
import { resolveMasterKey, isIncomeCategory } from '@/lib/categories/mapping'
import type { CategoryTotal } from '@/lib/intelligence/summaries'

const CATEGORY_STYLES: Record<string, { color: string; icon: string; isIncome: boolean; masterKey: string | null }> = {
  'Food & Dining':        { color: '#f97316', icon: 'UtensilsCrossed', isIncome: false, masterKey: 'FOOD'          },
  'Groceries':            { color: '#22c55e', icon: 'ShoppingCart',    isIncome: false, masterKey: 'GROCERY'       },
  'Housing':              { color: '#f59e0b', icon: 'Home',            isIncome: false, masterKey: 'HOME'          },
  'Transport':            { color: '#3b82f6', icon: 'Car',             isIncome: false, masterKey: 'TRANSPORT'     },
  'Entertainment':        { color: '#ec4899', icon: 'Film',            isIncome: false, masterKey: 'ENTERTAINMENT' },
  'Shopping':             { color: '#f59e0b', icon: 'ShoppingBag',     isIncome: false, masterKey: 'SHOPPING'      },
  'Health':               { color: '#10b981', icon: 'HeartPulse',      isIncome: false, masterKey: 'HEALTH'        },
  'Utilities':            { color: '#6366f1', icon: 'Zap',             isIncome: false, masterKey: 'HOME'          },
  'Subscriptions':        { color: '#6366f1', icon: 'CreditCard',      isIncome: false, masterKey: 'DIGITAL'       },
  'Personal Care':        { color: '#f472b6', icon: 'Scissors',        isIncome: false, masterKey: 'PERSONAL_CARE' },
  'Education':            { color: '#06b6d4', icon: 'BookOpen',        isIncome: false, masterKey: 'EDUCATION'     },
  'Travel':               { color: '#06b6d4', icon: 'Plane',           isIncome: false, masterKey: 'TRAVEL'        },
  'Insurance':            { color: '#64748b', icon: 'Shield',          isIncome: false, masterKey: 'FINANCIAL'     },
  'Fees & Charges':       { color: '#ef4444', icon: 'DollarSign',      isIncome: false, masterKey: 'FINANCIAL'     },
  'Gifts & Charity':      { color: '#8794ff', icon: 'Gift',            isIncome: false, masterKey: 'SOCIAL'        },
  'Income':               { color: '#16a34a', icon: 'TrendingUp',      isIncome: true,  masterKey: null            },
  'Transfer':             { color: '#64748b', icon: 'ArrowLeftRight',  isIncome: false, masterKey: null            },
  'Transfers':            { color: '#64748b', icon: 'ArrowLeftRight',  isIncome: false, masterKey: null            },
  'Other':                { color: '#94a3b8', icon: 'Package',         isIncome: false, masterKey: null            },
  'Uncategorized':        { color: '#94a3b8', icon: 'Package',         isIncome: false, masterKey: null            },
  'Fast Food':            { color: '#f97316', icon: 'Utensils',        isIncome: false, masterKey: 'FAST_FOOD'     },
  'Alcohol':              { color: '#8b5cf6', icon: 'Wine',            isIncome: false, masterKey: 'ALCOHOL'       },
  'Coffee':               { color: '#d97706', icon: 'Coffee',          isIncome: false, masterKey: 'COFFEE'        },
  'Restaurants':          { color: '#f97316', icon: 'UtensilsCrossed', isIncome: false, masterKey: 'FOOD'          },
  'Gas/Fuel':             { color: '#3b82f6', icon: 'Zap',             isIncome: false, masterKey: 'TRANSPORT'     },
  'Gasoline/Fuel':        { color: '#3b82f6', icon: 'Zap',             isIncome: false, masterKey: 'TRANSPORT'     },
  'Cigarettes & Tobacco': { color: '#78716c', icon: 'Ban',             isIncome: false, masterKey: 'TOBACCO'       },
  'Pets':                 { color: '#a3e635', icon: 'PawPrint',        isIncome: false, masterKey: 'PETS'          },
  'Credit Card Payment':  { color: '#6366f1', icon: 'CreditCard',      isIncome: false, masterKey: 'FINANCIAL'     },
}

function getStyle(name: string) {
  return CATEGORY_STYLES[name] ?? { color: '#94a3b8', icon: '📦', isIncome: false, masterKey: null }
}

export interface SessionAccount {
  id:          string
  name:        string
  accountType: string
  institution: string
  uploadCount: number
  txCount:     number
  dateStart:   Date | null
  dateEnd:     Date | null
}

export interface SessionSummary {
  sessionId:        string
  title:            string
  status:           string
  totalIncome:      number
  totalSpending:    number
  net:              number
  transactionCount: number
  incomeTxCount:    number
  dateRangeStart:   Date | null
  dateRangeEnd:     Date | null
  accountCount:     number
  accounts:         SessionAccount[]
  categoryTotals:   CategoryTotal[]
  topTransactions:  {
    id: string; date: Date; description: string;
    merchantNormalized: string; amount: number;
    categoryName: string; categoryColor: string; categoryIcon: string;
    accountName: string;
  }[]
  statementType:    'bank' | 'credit' | 'mixed' | 'unknown'
  interestDetected: boolean
  secondCatName:    string
  secondCatPct:     number
  uncategorizedCount: number
}

export async function computeSessionSummary(sessionId: string, userId: string): Promise<SessionSummary | null> {
  const session = await prisma.analysisSession.findFirst({
    where: { id: sessionId, userId },
    select: { id: true, title: true, status: true },
  })
  if (!session) return null

  // Fetch all transactions for this session's uploads
  const transactions = await prisma.transaction.findMany({
    where: {
      upload: { sessionId },
      isTransfer:        false,
      isExcluded:        false,
      isDuplicate:       false,
      isForeignCurrency: false,
      amount:            { not: 0 },
    },
    select: {
      id:                 true,
      date:               true,
      description:        true,
      merchantNormalized: true,
      amount:             true,
      appCategory:        true,
      account: { select: { id: true, name: true, accountType: true, institution: true } },
    },
    orderBy: { date: 'asc' },
  })

  const uncategorizedCount = await prisma.transaction.count({
    where: {
      upload: { sessionId },
      isTransfer:  false,
      isExcluded:  false,
      isDuplicate: false,
      amount:      { not: 0 },
      appCategory: null,
    },
  })

  // Build account metadata from the transactions themselves
  const accountMap = new Map<string, SessionAccount>()
  for (const tx of transactions) {
    const a = tx.account
    if (!accountMap.has(a.id)) {
      accountMap.set(a.id, {
        id: a.id, name: a.name, accountType: a.accountType,
        institution: a.institution, uploadCount: 0, txCount: 0,
        dateStart: null, dateEnd: null,
      })
    }
    const entry = accountMap.get(a.id)!
    entry.txCount++
    if (!entry.dateStart || tx.date < entry.dateStart) entry.dateStart = tx.date
    if (!entry.dateEnd   || tx.date > entry.dateEnd)   entry.dateEnd   = tx.date
  }

  // Upload counts per account
  const uploads = await prisma.upload.findMany({
    where: { sessionId },
    select: { accountId: true },
  })
  for (const u of uploads) {
    if (accountMap.has(u.accountId)) accountMap.get(u.accountId)!.uploadCount++
  }

  const accounts = Array.from(accountMap.values())

  if (transactions.length === 0) {
    return {
      sessionId: session.id, title: session.title, status: session.status,
      totalIncome: 0, totalSpending: 0, net: 0,
      transactionCount: 0, incomeTxCount: 0,
      dateRangeStart: null, dateRangeEnd: null,
      accountCount: accounts.length, accounts,
      categoryTotals: [], topTransactions: [],
      statementType: 'unknown', interestDetected: false,
      secondCatName: '', secondCatPct: 0, uncategorizedCount,
    }
  }

  const txDates        = transactions.map(t => t.date)
  const dateRangeStart = txDates.reduce((a, b) => a < b ? a : b)
  const dateRangeEnd   = txDates.reduce((a, b) => a > b ? a : b)

  let totalIncome   = 0
  let totalSpending = 0
  let incomeTxCount = 0

  const categoryMap = new Map<string, {
    spendingTotal: number; incomeTotal: number; count: number;
  }>()

  const CREDIT_ACCOUNT_TYPES = new Set(['credit', 'credit_card', 'creditcard'])
  const BANK_ACCOUNT_TYPES   = new Set(['checking', 'savings', 'bank'])
  const INTEREST_KEYWORDS    = /interest charge|finance charge|interest fee/i

  let hasCredit = false
  let hasBank   = false
  let interestDetected = false

  for (const tx of transactions) {
    const acctType = (tx.account.accountType ?? '').toLowerCase()
    if (CREDIT_ACCOUNT_TYPES.has(acctType)) hasCredit = true
    if (BANK_ACCOUNT_TYPES.has(acctType))   hasBank   = true
    if (INTEREST_KEYWORDS.test(tx.description ?? '')) interestDetected = true

    const catName = tx.appCategory?.trim() || 'Uncategorized'
    if (tx.amount > 0) { totalIncome += tx.amount; incomeTxCount++ }
    else               { totalSpending += Math.abs(tx.amount) }

    const existing = categoryMap.get(catName)
    if (existing) {
      if (tx.amount < 0) existing.spendingTotal += Math.abs(tx.amount)
      else               existing.incomeTotal   += tx.amount
      existing.count++
    } else {
      categoryMap.set(catName, {
        spendingTotal: tx.amount < 0 ? Math.abs(tx.amount) : 0,
        incomeTotal:   tx.amount > 0 ? tx.amount           : 0,
        count: 1,
      })
    }
  }

  const statementType: 'bank' | 'credit' | 'mixed' | 'unknown' =
    hasCredit && hasBank  ? 'mixed'  :
    hasCredit             ? 'credit' :
    hasBank               ? 'bank'   : 'unknown'

  const userCategories = await prisma.category.findMany({
    where: { OR: [{ isSystem: true, userId: null }, { userId }] },
    select: { name: true, masterKey: true },
  })
  const masterKeyByName = new Map(userCategories.map(c => [c.name, c.masterKey ?? null]))

  const categoryTotals: CategoryTotal[] = Array.from(categoryMap.entries())
    .map(([catName, { spendingTotal, incomeTotal, count }]) => {
      const style     = getStyle(catName)
      const dbKey     = masterKeyByName.has(catName) ? masterKeyByName.get(catName) : undefined
      const masterKey = resolveMasterKey(dbKey, catName)
      const isIncome  = isIncomeCategory(catName, masterKey) || style.isIncome
      const netSpend  = isIncome ? 0 : Math.max(0, spendingTotal - incomeTotal)
      const total     = isIncome ? incomeTotal : netSpend
      return {
        categoryId:       catName,
        categoryName:     catName,
        categoryColor:    style.color,
        categoryIcon:     style.icon,
        masterKey,
        total,
        transactionCount: count,
        pctOfSpending:    totalSpending > 0 && !isIncome ? (total / totalSpending) * 100 : 0,
        isIncome,
      }
    })
    .sort((a, b) => b.total - a.total)

  const topTransactions = [...transactions]
    .filter(t => t.amount < 0)
    .sort((a, b) => a.amount - b.amount)
    .slice(0, 10)
    .map(t => {
      const catName = t.appCategory?.trim() || 'Uncategorized'
      const style   = getStyle(catName)
      return {
        id: t.id, date: t.date, description: t.description,
        merchantNormalized: t.merchantNormalized, amount: t.amount,
        categoryName: catName, categoryColor: style.color, categoryIcon: style.icon,
        accountName: t.account.name,
      }
    })

  const spendingCats = categoryTotals.filter(c => !c.isIncome)
  const secondCatName = spendingCats[1]?.categoryName ?? ''
  const secondCatPct  = spendingCats[1]?.pctOfSpending ?? 0

  // Update session metadata
  await prisma.analysisSession.update({
    where: { id: sessionId },
    data: {
      dateRangeStart,
      dateRangeEnd,
      accountCount:  accounts.length,
      txCount:       transactions.length,
      status:        session.status === 'PROCESSING' ? 'READY' : session.status,
    },
  })

  return {
    sessionId: session.id, title: session.title,
    status: session.status === 'PROCESSING' ? 'READY' : session.status,
    totalIncome, totalSpending, net: totalIncome - totalSpending,
    transactionCount: transactions.length, incomeTxCount,
    dateRangeStart, dateRangeEnd,
    accountCount: accounts.length, accounts,
    categoryTotals, topTransactions,
    statementType, interestDetected,
    secondCatName, secondCatPct, uncategorizedCount,
  }
}
