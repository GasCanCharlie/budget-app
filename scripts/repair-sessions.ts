/**
 * Session integrity repair — CLI runner
 *
 * Usage:
 *   npx tsx scripts/repair-sessions.ts
 *   npx tsx scripts/repair-sessions.ts --user=<userId>
 *   npx tsx scripts/repair-sessions.ts --check      (integrity check only, no writes)
 */

import { repairSessionIntegrity, type RepairReport, type UserRepairResult } from '../src/lib/sessions/repair-session-integrity'
import { checkSessionIntegrity } from '../src/lib/sessions/integrity-check'

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const userArg  = args.find(a => a.startsWith('--user='))
const userId   = userArg ? userArg.split('=')[1] : undefined

const DIVIDER = '─'.repeat(44)

function fmt(n: number): string {
  return n.toLocaleString()
}

async function runCheck() {
  console.log(`\n${DIVIDER}`)
  console.log('  Session Integrity Check')
  console.log(DIVIDER)
  const report = await checkSessionIntegrity()
  if (report.clean) {
    console.log('  ✓ All clear — no integrity issues found')
  } else {
    console.log(`  ✗ ${report.issues.length} issue(s) found:\n`)
    for (const issue of report.issues) {
      console.log(`  [${issue.type}] ${issue.detail}`)
    }
  }
  console.log(`\n  Checked at: ${report.checkedAt}`)
  console.log(DIVIDER + '\n')
  return report.clean
}

function printUserTable(users: UserRepairResult[]) {
  if (users.length === 0) return
  const pad = (s: string | number, w: number) => String(s).padEnd(w)

  console.log()
  console.log(
    pad('User', 24) + pad('Uploads', 9) + pad('Txns', 8) +
    pad('Xfers', 8) + pad('Catgd', 8) + pad('Months', 8) + 'Status'
  )
  console.log('─'.repeat(80))

  for (const u of users) {
    if (u.status === 'error') {
      console.log(pad(u.userId.slice(0, 22), 24) + pad('—', 9) + pad('—', 8) + pad('—', 8) + pad('—', 8) + pad('—', 8) + `ERROR: ${u.error}`)
    } else {
      console.log(
        pad(u.userId.slice(0, 22), 24) +
        pad(u.uploadsAttached, 9) +
        pad(u.txCount, 8) +
        pad(u.transferCount, 8) +
        pad(u.categorizedCount, 8) +
        pad(u.monthsRecomputed, 8) +
        'OK'
      )
    }
  }
}

function printSummary(report: RepairReport) {
  console.log(`\n${DIVIDER}`)
  console.log('  Session Integrity Report')
  console.log(DIVIDER)
  console.log(`  Users processed          ${fmt(report.usersProcessed)}`)
  console.log(`  Sessions created         ${fmt(report.sessionsCreated)}`)
  console.log(`  Uploads repaired         ${fmt(report.uploadsRepaired)}`)
  console.log(`  Transactions reprocessed ${fmt(report.txReprocessed)}`)
  console.log(`  Transfers detected       ${fmt(report.transfersDetected)}`)
  console.log(`  Duplicate sessions fixed ${fmt(report.duplicateSessionsRemoved)}`)
  console.log(`  Failures                 ${fmt(report.failures)}`)
  console.log()
  if (report.failures === 0) {
    console.log('  Completed successfully')
  } else {
    console.log(`  Completed with ${report.failures} failure(s)`)
  }
  console.log(DIVIDER + '\n')
}

async function main() {
  if (checkOnly) {
    const clean = await runCheck()
    process.exit(clean ? 0 : 1)
  }

  if (userId) {
    console.log(`\nRepairing session integrity for user: ${userId}`)
  } else {
    console.log('\nRepairing session integrity for all affected users…')
  }

  const report = await repairSessionIntegrity({ userId })

  printUserTable(report.users)
  printSummary(report)

  process.exit(report.failures > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('\nFatal error:', err)
  process.exit(1)
})
