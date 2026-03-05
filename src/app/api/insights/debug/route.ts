import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getUserFromRequest(req)
  const hasOpenAiKey = !!process.env.OPENAI_API_KEY
  const keyPrefix = process.env.OPENAI_API_KEY?.slice(0, 12) ?? 'NOT SET'

  return NextResponse.json({
    auth: user ? { userId: user.userId, ok: true } : { ok: false, reason: 'getUserFromRequest returned null' },
    openai: { configured: hasOpenAiKey, keyPrefix },
    env: process.env.NODE_ENV,
  })
}
