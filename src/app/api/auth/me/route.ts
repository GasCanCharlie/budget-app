import { NextRequest, NextResponse } from 'next/server'
import { getUserFromRequest } from '@/lib/auth'
import prisma from '@/lib/db'

export async function GET(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, createdAt: true },
  })
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ user })
}

export async function DELETE(req: NextRequest) {
  const payload = getUserFromRequest(req)
  if (!payload) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Schedule deletion (30-day guarantee — for now immediate in dev)
  await prisma.user.update({
    where: { id: payload.userId },
    data: { deletedAt: new Date() },
  })

  const res = NextResponse.json({ message: 'Account deletion scheduled' })
  res.cookies.delete('token')
  return res
}
