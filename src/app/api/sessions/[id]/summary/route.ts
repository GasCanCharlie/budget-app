import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import { computeSessionSummary } from '@/lib/sessions/compute-session-summary'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const summary = await computeSessionSummary(params.id, payload.userId)
  if (!summary) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  return NextResponse.json({ summary })
}
