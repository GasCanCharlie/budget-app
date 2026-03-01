import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const upload = await prisma.upload.findFirst({
  orderBy: { createdAt: 'desc' },
  select: { id: true, filename: true, formatDetected: true, reconciliationStatus: true }
})

if (!upload) { console.log('No uploads'); process.exit(0) }
console.log('Upload:', upload.filename, '| format:', upload.formatDetected, '| status:', upload.reconciliationStatus)

// Check the first 8 rows BY parseOrder via TransactionRaw
const raws = await prisma.transactionRaw.findMany({
  where: { uploadId: upload.id },
  orderBy: { parseOrder: 'asc' },
  take: 8,
  select: { id: true, parseOrder: true }
})

const rawIds = raws.map(r => r.id)
const txns = await prisma.transaction.findMany({
  where: { rawId: { in: rawIds } },
  select: {
    id: true, rawId: true, amount: true, runningBalance: true,
    transactionDate: true, postedDate: true, bankTransactionId: true,
    description: true
  }
})

// Map rawId → parseOrder
const rawMap = new Map(raws.map(r => [r.id, r.parseOrder]))
const txByRaw = new Map(txns.map(t => [t.rawId, t]))

console.log('\n=== FIRST 8 ROWS BY PARSE ORDER ===')
for (const raw of raws) {
  const tx = txByRaw.get(raw.id)
  if (!tx) continue
  console.log(
    `parseOrder=${raw.parseOrder}`,
    `amount=${tx.amount}`,
    `bal=${tx.runningBalance}`,
    `txDate=${tx.transactionDate?.toISOString().split('T')[0] ?? 'null'}`,
    `postedDate=${tx.postedDate?.toISOString().split('T')[0] ?? 'null'}`,
    `bankTxId=${tx.bankTransactionId ?? 'null'}`,
    `desc=${tx.description?.slice(0, 25) ?? ''}`
  )
}

// Check last 3 rows
const lastRaws = await prisma.transactionRaw.findMany({
  where: { uploadId: upload.id },
  orderBy: { parseOrder: 'desc' },
  take: 3,
  select: { id: true, parseOrder: true }
})
const lastRawIds = lastRaws.map(r => r.id)
const lastTxns = await prisma.transaction.findMany({
  where: { rawId: { in: lastRawIds } },
  select: { rawId: true, amount: true, runningBalance: true, transactionDate: true, description: true }
})
const lastTxByRaw = new Map(lastTxns.map(t => [t.rawId, t]))

console.log('\n=== LAST 3 ROWS BY PARSE ORDER ===')
for (const raw of lastRaws) {
  const tx = lastTxByRaw.get(raw.id)
  if (!tx) continue
  console.log(
    `parseOrder=${raw.parseOrder}`,
    `amount=${tx.amount}`,
    `bal=${tx.runningBalance}`,
    `txDate=${tx.transactionDate?.toISOString().split('T')[0] ?? 'null'}`,
    `desc=${tx.description?.slice(0, 25) ?? ''}`
  )
}

await prisma.$disconnect()
