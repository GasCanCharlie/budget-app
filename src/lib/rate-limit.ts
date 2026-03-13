import prisma from '@/lib/db'
import { NextRequest } from 'next/server'

interface RateLimitConfig {
  maxRequests: number
  windowMs:    number  // milliseconds
}

const PRESETS: Record<string, RateLimitConfig> = {
  login:          { maxRequests: 10, windowMs: 10 * 60 * 1000 },   // 10/10min
  register:       { maxRequests: 5,  windowMs: 60 * 60 * 1000 },   // 5/hr
  forgotPassword: { maxRequests: 5,  windowMs: 60 * 60 * 1000 },   // 5/hr
  upload:         { maxRequests: 20, windowMs: 60 * 60 * 1000 },   // 20/hr
}

export function getClientIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  )
}

export async function checkRateLimit(
  key: string,
  preset: keyof typeof PRESETS
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const config  = PRESETS[preset]
  const now     = new Date()
  const rlKey   = `${preset}:${key}`

  // Clean up expired entries periodically (1% chance per request)
  if (Math.random() < 0.01) {
    await prisma.rateLimit.deleteMany({ where: { windowEnd: { lt: now } } }).catch(() => {})
  }

  const existing = await prisma.rateLimit.findUnique({ where: { key: rlKey } })

  if (!existing || existing.windowEnd < now) {
    // New window
    const windowEnd = new Date(now.getTime() + config.windowMs)
    await prisma.rateLimit.upsert({
      where:  { key: rlKey },
      create: { key: rlKey, count: 1, windowEnd },
      update: { count: 1, windowEnd },
    })
    return { allowed: true, remaining: config.maxRequests - 1, resetAt: windowEnd }
  }

  if (existing.count >= config.maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.windowEnd }
  }

  await prisma.rateLimit.update({
    where: { key: rlKey },
    data:  { count: { increment: 1 } },
  })

  return {
    allowed:   true,
    remaining: config.maxRequests - existing.count - 1,
    resetAt:   existing.windowEnd,
  }
}
