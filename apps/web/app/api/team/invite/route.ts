import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { teamInvites, organizations, organizationMembers, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { z } from 'zod'
import { getOrgMember, canAdmin } from '@/lib/auth/get-member'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'
import { Resend } from 'resend'
import { randomBytes } from 'crypto'
import { enforceTeamMemberLimit } from '@/lib/utils/plan-enforcement'

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['admin', 'editor', 'viewer']),
})

export async function POST(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.teamInvites, orgId)
  if (rateLimitRes) return rateLimitRes

  const body = await req.json().catch(() => null)
  const parsed = inviteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 })
  }

  const member = await getOrgMember(orgId, userId)
  if (!member) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  if (!canAdmin(member.role)) {
    return NextResponse.json({ error: 'Only admins can invite team members' }, { status: 403 })
  }

  const limitErr = await enforceTeamMemberLimit(member.orgDbId)
  if (limitErr) return limitErr

  const { email, role } = parsed.data

  // Check if user is already a member
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email.toLowerCase()))
    .limit(1)

  if (existingUser) {
    const [existingMember] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(and(
        eq(organizationMembers.organizationId, member.orgDbId),
        eq(organizationMembers.userId, existingUser.id),
      ))
      .limit(1)

    if (existingMember) {
      return NextResponse.json({ error: 'User is already a team member' }, { status: 409 })
    }
  }

  const token = randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days

  const [invite] = await db
    .insert(teamInvites)
    .values({
      organizationId: member.orgDbId,
      invitedBy: member.userDbId,
      email: email.toLowerCase(),
      role,
      token,
      expiresAt,
    })
    .returning()

  // Fetch org name for email
  const [org] = await db
    .select({ name: organizations.name })
    .from(organizations)
    .where(eq(organizations.id, member.orgDbId))
    .limit(1)

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const inviteUrl = `${appUrl}/team/accept-invite?token=${token}`

  const resend = new Resend(process.env.RESEND_API_KEY)
  await resend.emails.send({
    from: process.env.EMAIL_FROM ?? 'noreply@tubeforge.app',
    to: email,
    subject: `You've been invited to join ${org?.name ?? 'TubeForge'}`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Team Invitation</h2>
        <p>You've been invited to join <strong>${org?.name ?? 'TubeForge'}</strong> as a <strong>${role}</strong>.</p>
        <p>Click the button below to accept your invitation. This link expires in 7 days.</p>
        <a href="${inviteUrl}" style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;margin:16px 0;">
          Accept Invitation
        </a>
        <p style="color:#666;font-size:12px;">If you didn't expect this invitation, you can safely ignore this email.</p>
      </div>
    `,
  })

  return NextResponse.json({ id: invite?.id, email, role, expiresAt }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const { userId, orgId } = await auth()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const member = await getOrgMember(orgId, userId)
  if (!member || !canAdmin(member.role)) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })

  const invites = await db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.organizationId, member.orgDbId))
    .orderBy(teamInvites.createdAt)

  return NextResponse.json({ invites })
}
