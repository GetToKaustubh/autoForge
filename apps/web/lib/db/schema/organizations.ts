import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { users } from './users'

export const planEnum = pgEnum('plan', [
  'free',
  'starter',
  'pro',
  'agency',
  'enterprise',
])

export const orgRoleEnum = pgEnum('org_role', ['owner', 'admin', 'editor', 'viewer'])

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkOrgId: text('clerk_org_id').unique().notNull(),
  name: text('name').notNull(),
  slug: text('slug').unique().notNull(),
  plan: planEnum('plan').default('free').notNull(),
  planExpiresAt: timestamp('plan_expires_at', { withTimezone: true }),
  maxChannels: integer('max_channels').default(1).notNull(),
  maxTeamMembers: integer('max_team_members').default(1).notNull(),
  monthlyVideoQuota: integer('monthly_video_quota').default(4).notNull(),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const organizationMembers = pgTable(
  'organization_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: orgRoleEnum('role').default('viewer').notNull(),
    invitedBy: uuid('invited_by').references(() => users.id),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.organizationId, t.userId)]
)

export const teamInvites = pgTable('team_invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  invitedBy: uuid('invited_by')
    .notNull()
    .references(() => users.id),
  email: text('email').notNull(),
  role: orgRoleEnum('role').default('viewer').notNull(),
  token: text('token').unique().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  invites: many(teamInvites),
}))

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}))

export const teamInvitesRelations = relations(teamInvites, ({ one }) => ({
  organization: one(organizations, {
    fields: [teamInvites.organizationId],
    references: [organizations.id],
  }),
  inviter: one(users, {
    fields: [teamInvites.invitedBy],
    references: [users.id],
  }),
}))
