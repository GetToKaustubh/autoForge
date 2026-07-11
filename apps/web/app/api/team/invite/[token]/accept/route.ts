import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { teamInvites, organizationMembers, users } from '@/lib/db/schema'
import { eq, and, isNull, gt } from 'drizzle-orm'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Sign in to accept this invitation' }, { status: 401 })

  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(and(
      eq(teamInvites.token, token),
      isNull(teamInvites.acceptedAt),
      gt(teamInvites.expiresAt, new Date()),
    ))
    .limit(1)

  if (!invite) {
    return NextResponse.json({ error: 'Invite not found or expired' }, { status: 404 })
  }

  // Get the user's DB record
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)

  if (!user) {
    return NextResponse.json({ error: 'User account not found — please complete sign up' }, { status: 404 })
  }

  // Verify email matches the invite
  if (user.email.toLowerCase() !== invite.email.toLowerCase()) {
    return NextResponse.json({
      error: `This invitation was sent to ${invite.email}. Sign in with that email address.`,
    }, { status: 403 })
  }

  // Check not already a member
  const [existing] = await db
    .select({ id: organizationMembers.id })
    .from(organizationMembers)
    .where(and(
      eq(organizationMembers.organizationId, invite.organizationId),
      eq(organizationMembers.userId, user.id),
    ))
    .limit(1)

  if (existing) {
    // Already a member — mark invite as accepted anyway
    await db.update(teamInvites).set({ acceptedAt: new Date() }).where(eq(teamInvites.id, invite.id))
    return NextResponse.json({ success: true, alreadyMember: true })
  }

  // Add to org
  await db.insert(organizationMembers).values({
    organizationId: invite.organizationId,
    userId: user.id,
    role: invite.role,
    invitedBy: invite.invitedBy,
  })

  await db.update(teamInvites).set({ acceptedAt: new Date() }).where(eq(teamInvites.id, invite.id))

  return NextResponse.json({ success: true, organizationId: invite.organizationId })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const [invite] = await db
    .select({
      id: teamInvites.id,
      email: teamInvites.email,
      role: teamInvites.role,
      expiresAt: teamInvites.expiresAt,
      acceptedAt: teamInvites.acceptedAt,
      organizationId: teamInvites.organizationId,
    })
    .from(teamInvites)
    .where(eq(teamInvites.token, token))
    .limit(1)

  if (!invite) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (invite.expiresAt < new Date()) return NextResponse.json({ error: 'Invite expired' }, { status: 410 })

  return NextResponse.json(invite)
}
