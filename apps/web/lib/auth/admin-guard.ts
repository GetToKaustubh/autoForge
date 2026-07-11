import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

function getAdminIds(): Set<string> {
  const raw = process.env.ADMIN_USER_IDS ?? ''
  return new Set(raw.split(',').map((s) => s.trim()).filter(Boolean))
}

export async function isAdmin(): Promise<boolean> {
  const { userId } = await auth()
  if (!userId) return false
  return getAdminIds().has(userId)
}

export async function requireAdmin(): Promise<NextResponse | null> {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!getAdminIds().has(userId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}
