/**
 * Generates and uploads a realistic sample CSV for demo purposes
 */
import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'
import { parseCSV } from '@/lib/parsers/csv'
import { categorizeBatch } from '@/lib/categorization/engine'
import { normalizeMerchant } from '@/lib/categorization/engine'
import { computeMonthSummary } from '@/lib/intelligence/summaries'
import { isTransferDescription as isTransfer } from '@/lib/intelligence/transfers'
import crypto from 'crypto'

const SAMPLE_TRANSACTIONS = [
  // Income
  { date: '2024-01-01', desc: 'DIRECT DEPOSIT EMPLOYER PAYROLL',      amount:  3500.00 },
  { date: '2024-01-15', desc: 'DIRECT DEPOSIT EMPLOYER PAYROLL',      amount:  3500.00 },
  // Food & Dining
  { date: '2024-01-02', desc: 'STARBUCKS #12345',                     amount:   -12.50 },
  { date: '2024-01-03', desc: 'CHIPOTLE MEXICAN GRILL',               amount:   -14.75 },
  { date: '2024-01-05', desc: 'DOORDASH ORDER',                       amount:   -38.20 },
  { date: '2024-01-07', desc: 'MCDONALD S #8822',                     amount:    -8.45 },
  { date: '2024-01-10', desc: 'LOCAL RESTAURANT DOWNTOWN',            amount:   -67.00 },
  { date: '2024-01-14', desc: 'DUNKIN DONUTS',                        amount:    -6.75 },
  { date: '2024-01-18', desc: 'PANERA BREAD #7651',                   amount:   -22.40 },
  { date: '2024-01-21', desc: 'UBER EATS ORDER',                      amount:   -45.30 },
  { date: '2024-01-25', desc: 'CHICK-FIL-A #3904',                   amount:   -18.60 },
  { date: '2024-01-28', desc: 'STARBUCKS #12345',                     amount:   -11.20 },
  // Groceries
  { date: '2024-01-04', desc: 'WHOLE FOODS MARKET #422',              amount:  -127.43 },
  { date: '2024-01-11', desc: 'TRADER JOES #123',                     amount:   -89.17 },
  { date: '2024-01-19', desc: 'KROGER #0892',                         amount:  -104.56 },
  { date: '2024-01-26', desc: 'WHOLE FOODS MARKET #422',              amount:   -78.90 },
  // Housing
  { date: '2024-01-01', desc: 'RENT PAYMENT JANUARY',                 amount: -1800.00 },
  { date: '2024-01-15', desc: 'HOME DEPOT #0543',                     amount:   -67.34 },
  // Transport
  { date: '2024-01-03', desc: 'SHELL STATION #4422',                  amount:   -58.00 },
  { date: '2024-01-06', desc: 'UBER TRIP',                            amount:   -18.50 },
  { date: '2024-01-09', desc: 'PARKING LOT DOWNTOWN',                 amount:   -24.00 },
  { date: '2024-01-17', desc: 'CHEVRON GAS STATION',                  amount:   -52.30 },
  { date: '2024-01-22', desc: 'LYFT RIDE',                            amount:   -14.75 },
  { date: '2024-01-29', desc: 'EZ PASS TOLL',                         amount:   -12.00 },
  // Entertainment
  { date: '2024-01-05', desc: 'NETFLIX SUBSCRIPTION',                 amount:   -15.99 },
  { date: '2024-01-08', desc: 'SPOTIFY PREMIUM',                      amount:    -9.99 },
  { date: '2024-01-12', desc: 'AMC THEATERS',                         amount:   -42.00 },
  { date: '2024-01-20', desc: 'TICKETMASTER CONCERT',                 amount:  -185.00 },
  { date: '2024-01-27', desc: 'HULU SUBSCRIPTION',                    amount:   -17.99 },
  // Shopping
  { date: '2024-01-06', desc: 'AMAZON.COM ORDER',                     amount:   -67.45 },
  { date: '2024-01-13', desc: 'AMAZON.COM ORDER',                     amount:  -112.30 },
  { date: '2024-01-16', desc: 'TARGET #2345',                         amount:   -89.44 },
  { date: '2024-01-23', desc: 'AMZN MKTP US ORDER',                   amount:   -34.99 },
  // Health
  { date: '2024-01-08', desc: 'CVS PHARMACY #7890',                   amount:   -23.45 },
  { date: '2024-01-15', desc: 'PLANET FITNESS MEMBERSHIP',            amount:   -24.99 },
  { date: '2024-01-22', desc: 'WALGREENS #1234',                      amount:   -45.67 },
  // Utilities
  { date: '2024-01-10', desc: 'XFINITY INTERNET BILL',                amount:   -79.99 },
  { date: '2024-01-12', desc: 'VERIZON WIRELESS BILL',                amount:  -120.00 },
  { date: '2024-01-14', desc: 'ELECTRIC BILL PAYMENT',                amount:  -145.50 },
  // Subscriptions
  { date: '2024-01-05', desc: 'ADOBE CREATIVE CLOUD',                 amount:   -54.99 },
  { date: '2024-01-05', desc: 'AMAZON PRIME MEMBERSHIP',              amount:   -14.99 },
  { date: '2024-01-05', desc: 'ICLOUD STORAGE 200GB',                 amount:    -2.99 },
]

function generateSampleCSV(): string {
  const lines = ['Date,Description,Amount']
  for (const tx of SAMPLE_TRANSACTIONS) {
    lines.push(`${tx.date},"${tx.desc}",${tx.amount}`)
  }
  return lines.join('\n')
}

export async function POST(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Create or find a demo account
  let account = await prisma.account.findFirst({
    where: { userId: payload.userId, name: 'Sample Checking Account' }
  })
  if (!account) {
    account = await prisma.account.create({
      data: { userId: payload.userId, name: 'Sample Checking Account', institution: 'Demo Bank', accountType: 'checking' }
    })
  }

  const csvText = generateSampleCSV()
  const fileHash = crypto.createHash('sha256').update(csvText).digest('hex')

  // Check already loaded
  const existing = await prisma.upload.findFirst({ where: { accountId: account.id, fileHash } })
  if (existing) {
    return NextResponse.json({ message: 'Sample data already loaded', accountId: account.id })
  }

  const parseResult = parseCSV(csvText, account.id)
  const { transactions: parsed } = parseResult

  const upload = await prisma.upload.create({
    data: {
      userId: payload.userId, accountId: account.id,
      filename: 'sample_data.csv', fileHash, formatDetected: 'Sample',
      rowCountRaw: parsed.length, rowCountParsed: parsed.length,
      status: 'processing', warnings: '[]',
    }
  })

  const txInputs = parsed
    .filter(p => p.parsedDate && p.parsedAmount !== null)
    .map(p => ({ description: p.parsedDescription, amount: p.parsedAmount! }))

  const categories = await categorizeBatch(txInputs, payload.userId)
  let accepted = 0

  const validParsed = parsed.filter(p => p.parsedDate && p.parsedAmount !== null)

  for (let i = 0; i < validParsed.length; i++) {
    const p = validParsed[i]
    const cat = categories[i]
    if (!p.parsedDate || p.parsedAmount === null) continue

    const merchantNorm = normalizeMerchant(p.parsedDescription)
    const transferFlag = isTransfer(p.parsedDescription)

    try {
      const raw = await prisma.transactionRaw.create({
        data: {
          uploadId: upload.id, accountId: account.id,
          rawDate: p.rawDate, rawDescription: p.rawDescription,
          rawAmount: p.rawAmount, sourceRowHash: p.sourceRowHash,
        }
      })
      await prisma.transaction.create({
        data: {
          rawId: raw.id, accountId: account.id, uploadId: upload.id,
          date: p.parsedDate, description: p.parsedDescription,
          merchantNormalized: merchantNorm, amount: p.parsedAmount,
          categoryId: cat.categoryId, categorizationSource: cat.source,
          confidenceScore: cat.confidence, isTransfer: transferFlag,
        }
      })
      accepted++
    } catch { /* skip duplicates */ }
  }

  await prisma.upload.update({
    where: { id: upload.id },
    data: { rowCountAccepted: accepted, status: 'complete' }
  })

  // Compute summaries for January 2024
  await computeMonthSummary(payload.userId, 2024, 1)

  return NextResponse.json({ success: true, accepted, accountId: account.id })
}
