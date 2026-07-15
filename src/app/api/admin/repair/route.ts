import { NextRequest, NextResponse } from 'next/server'
import { repairSessionIntegrity } from '@/lib/sessions/repair-session-integrity'
import { checkSessionIntegrity } from '@/lib/sessions/integrity-check'

function authorized(req: NextRequest): boolean {
  const secret = req.headers.get('x-admin-secret')
  return !!secret && secret === process.env.ADMIN_SECRET
}

// GET /api/admin/repair — integrity check only, no writes
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const report = await checkSessionIntegrity()
  return NextResponse.json(report)
}

// POST /api/admin/repair — run repair (optionally scoped to one user)
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { userId?: string }
  const report = await repairSessionIntegrity({ userId: body.userId })
  return NextResponse.json(report)
}
