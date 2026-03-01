import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { categoryOrder: true },
  })

  if (!user) return NextResponse.json({ order: [] })

  try {
    const order = JSON.parse(user.categoryOrder || '[]') as string[]
    return NextResponse.json({ order })
  } catch {
    return NextResponse.json({ order: [] })
  }
}

export async function PUT(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: unknown
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }) }

  const raw = (body as Record<string, unknown>)?.order
  const order = Array.isArray(raw)
    ? raw.filter((id): id is string => typeof id === 'string')
    : []

  await prisma.user.update({
    where: { id: payload.userId },
    data: { categoryOrder: JSON.stringify(order) },
  })

  return NextResponse.json({ ok: true })
}
