import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { contentCalendar, youtubeChannels } from '@/lib/db/schema'
import { eq, and, desc, gte, lte, isNull } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canWrite } from '@/lib/auth/get-member'

const createSchema = z.object({
  channelId: z.string().uuid(),
  ideaId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  plannedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
  plannedTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().max(50).optional(),
  type: z.enum(['video', 'short', 'live', 'community_post']).optional(),
  notes: z.string().max(1000).optional(),
  color: z.string().max(20).optional(),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canWrite(member.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

  const { channelId, ...data } = parsed.data

  const [channel] = await db
    .select({ id: youtubeChannels.id })
    .from(youtubeChannels)
    .where(and(
      eq(youtubeChannels.id, channelId),
      eq(youtubeChannels.organizationId, member.orgDbId),
      isNull(youtubeChannels.deletedAt),
    ))
    .limit(1)
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 })

  const [entry] = await db
    .insert(contentCalendar)
    .values({
      organizationId: member.orgDbId,
      channelId,
      createdBy: member.userDbId,
      title: data.title,
      plannedDate: data.plannedDate,
      plannedTime: data.plannedTime,
      timezone: data.timezone ?? 'UTC',
      type: data.type ?? 'video',
      notes: data.notes,
      color: data.color,
      ideaId: data.ideaId,
    })
    .returning()

  return NextResponse.json(entry, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')
  const from = url.searchParams.get('from') // YYYY-MM-DD
  const to = url.searchParams.get('to')     // YYYY-MM-DD

  const conditions = [eq(contentCalendar.organizationId, member.orgDbId)]
  if (channelId) conditions.push(eq(contentCalendar.channelId, channelId))
  if (from) conditions.push(gte(contentCalendar.plannedDate, from))
  if (to) conditions.push(lte(contentCalendar.plannedDate, to))

  const entries = await db
    .select()
    .from(contentCalendar)
    .where(and(...conditions))
    .orderBy(contentCalendar.plannedDate, contentCalendar.plannedTime)
    .limit(200)

  return NextResponse.json({ entries })
}
