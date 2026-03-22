import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const updates = [
  { name: 'Groceries',            masterKey: 'GROCERY'  },
  { name: 'Fast Food',            masterKey: 'FAST_FOOD'},
  { name: 'Alcohol',              masterKey: 'ALCOHOL'  },
  { name: 'Pets',                 masterKey: 'PETS'     },
  { name: 'Cigarettes & Tobacco', masterKey: 'TOBACCO'  },
]

for (const u of updates) {
  const r = await prisma.category.updateMany({
    where: { name: u.name, isSystem: true },
    data:  { masterKey: u.masterKey },
  })
  console.log(`${u.name} → ${u.masterKey}  (${r.count} updated)`)
}

await prisma.$disconnect()
