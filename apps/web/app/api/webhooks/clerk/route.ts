import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { Webhook } from 'svix'
import { db } from '@/lib/db'
import { users, organizations, organizationMembers } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { logger } from '@/lib/utils/logger'
import { auditLogs } from '@/lib/db/schema'

type ClerkWebhookEvent =
  | { type: 'user.created' | 'user.updated'; data: ClerkUser }
  | { type: 'user.deleted'; data: { id: string } }
  | { type: 'organization.created' | 'organization.updated'; data: ClerkOrganization }
  | { type: 'organizationMembership.created' | 'organizationMembership.deleted'; data: ClerkOrgMembership }

interface ClerkUser {
  id: string
  email_addresses: Array<{ email_address: string; id: string }>
  primary_email_address_id: string
  first_name: string | null
  last_name: string | null
  image_url: string
}

interface ClerkOrganization {
  id: string
  name: string
  slug: string
}

interface ClerkOrgMembership {
  id: string
  role: string
  organization: ClerkOrganization
  public_user_data: { user_id: string }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const headerPayload = await headers()
  const svixId = headerPayload.get('svix-id')
  const svixTimestamp = headerPayload.get('svix-timestamp')
  const svixSignature = headerPayload.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: 'Missing svix headers' }, { status: 400 })
  }

  const body = await request.text()

  const wh = new Webhook(webhookSecret)
  let event: ClerkWebhookEvent

  try {
    event = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    }) as ClerkWebhookEvent
  } catch {
    logger.warn({ svixId }, 'Clerk webhook signature verification failed')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  try {
    await handleClerkEvent(event)
    return NextResponse.json({ received: true })
  } catch (error) {
    logger.error({ error, event: event.type }, 'Clerk webhook handler error')
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

async function handleClerkEvent(event: ClerkWebhookEvent) {
  switch (event.type) {
    case 'user.created':
    case 'user.updated': {
      const clerkUser = event.data
      const primaryEmail = clerkUser.email_addresses.find(
        (e) => e.id === clerkUser.primary_email_address_id
      )?.email_address

      if (!primaryEmail) {
        logger.warn({ userId: clerkUser.id }, 'Clerk user has no primary email')
        return
      }

      await db
        .insert(users)
        .values({
          clerkId: clerkUser.id,
          email: primaryEmail,
          fullName:
            [clerkUser.first_name, clerkUser.last_name].filter(Boolean).join(' ') || null,
          avatarUrl: clerkUser.image_url || null,
        })
        .onConflictDoUpdate({
          target: users.clerkId,
          set: {
            email: primaryEmail,
            fullName:
              [clerkUser.first_name, clerkUser.last_name].filter(Boolean).join(' ') || null,
            avatarUrl: clerkUser.image_url || null,
            updatedAt: new Date(),
          },
        })

      logger.info({ clerkId: clerkUser.id }, `User ${event.type}`)
      break
    }

    case 'user.deleted': {
      // Soft-delete or anonymize — do not hard delete (audit trail)
      await db
        .update(users)
        .set({ email: `deleted_${event.data.id}@deleted.invalid`, updatedAt: new Date() })
        .where(eq(users.clerkId, event.data.id))
      break
    }

    case 'organization.created':
    case 'organization.updated': {
      const org = event.data
      await db
        .insert(organizations)
        .values({
          clerkOrgId: org.id,
          name: org.name,
          slug: org.slug,
        })
        .onConflictDoUpdate({
          target: organizations.clerkOrgId,
          set: {
            name: org.name,
            slug: org.slug,
            updatedAt: new Date(),
          },
        })

      logger.info({ clerkOrgId: org.id }, `Organization ${event.type}`)
      break
    }

    case 'organizationMembership.created': {
      const membership = event.data
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, membership.organization.id))
        .limit(1)

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, membership.public_user_data.user_id))
        .limit(1)

      if (!org || !user) {
        logger.warn({ membership }, 'Org or user not found for membership.created')
        return
      }

      const role = mapClerkRoleToAppRole(membership.role)
      await db
        .insert(organizationMembers)
        .values({
          organizationId: org.id,
          userId: user.id,
          role,
        })
        .onConflictDoNothing()

      await db.insert(auditLogs).values({
        organizationId: org.id,
        userId: user.id,
        action: 'team.member_joined',
        resourceType: 'organization_member',
        metadata: { clerkRole: membership.role },
      })
      break
    }

    case 'organizationMembership.deleted': {
      const membership = event.data
      const [org] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.clerkOrgId, membership.organization.id))
        .limit(1)

      const [user] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.clerkId, membership.public_user_data.user_id))
        .limit(1)

      if (!org || !user) return

      await db
        .delete(organizationMembers)
        .where(
          eq(organizationMembers.organizationId, org.id) &&
          eq(organizationMembers.userId, user.id)
        )
      break
    }
  }
}

function mapClerkRoleToAppRole(clerkRole: string): 'owner' | 'admin' | 'editor' | 'viewer' {
  switch (clerkRole) {
    case 'org:admin':
      return 'admin'
    case 'org:member':
      return 'editor'
    default:
      return clerkRole.includes('owner') ? 'owner' : 'viewer'
  }
}
