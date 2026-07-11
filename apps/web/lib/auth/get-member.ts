import { db } from '@/lib/db'
import { organizations, organizationMembers, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'

export type OrgRole = 'owner' | 'admin' | 'editor' | 'viewer'

export interface OrgMember {
  orgDbId: string
  userDbId: string
  role: OrgRole
}

export async function getOrgMember(
  clerkOrgId: string,
  clerkUserId: string
): Promise<OrgMember | null> {
  const [member] = await db
    .select({
      orgDbId: organizations.id,
      userDbId: users.id,
      role: organizationMembers.role,
    })
    .from(organizations)
    .innerJoin(organizationMembers, eq(organizationMembers.organizationId, organizations.id))
    .innerJoin(users, eq(users.id, organizationMembers.userId))
    .where(and(eq(organizations.clerkOrgId, clerkOrgId), eq(users.clerkId, clerkUserId)))
    .limit(1)

  return member ?? null
}

export function canWrite(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin' || role === 'editor'
}

export function canAdmin(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin'
}
