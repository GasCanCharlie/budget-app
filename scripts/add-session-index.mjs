import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

try {
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "analysis_sessions_one_active_per_user"
     ON analysis_sessions("userId")
     WHERE status IN ('ACTIVE', 'PROCESSING', 'READY')`
  )
  console.log('Index created (or already exists).')
} finally {
  await prisma.$disconnect()
}
