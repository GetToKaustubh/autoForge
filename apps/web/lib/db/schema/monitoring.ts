import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  numeric,
  timestamp,
  pgEnum,
  inet,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { users } from './users'

export const apiServiceEnum = pgEnum('api_service', [
  'openai',
  'anthropic',
  'elevenlabs',
  'runway',
  'pika',
  'veo',
  'imagen',
  'cloudinary',
  'youtube',
  'resend',
  'stripe',
])

// --- API Usage tracking (per request) ---
export const apiUsage = pgTable('api_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  service: apiServiceEnum('service').notNull(),
  endpoint: text('endpoint'),
  unitsUsed: numeric('units_used', { precision: 12, scale: 4 }).notNull(),
  unitType: text('unit_type').notNull(), // 'tokens', 'chars', 'seconds', 'credits', 'units'
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  resourceType: text('resource_type'), // 'script', 'voice', 'video', etc.
  resourceId: uuid('resource_id'),
  metadata: jsonb('metadata').default({}),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- Audit logs ---
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  // e.g., 'channel.connected', 'video.published', 'team.invited'
  resourceType: text('resource_type'),
  resourceId: uuid('resource_id'),
  ipAddress: inet('ip_address'),
  userAgent: text('user_agent'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const apiUsageRelations = relations(apiUsage, ({ one }) => ({
  organization: one(organizations, {
    fields: [apiUsage.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [apiUsage.userId],
    references: [users.id],
  }),
}))

export const auditLogsRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [auditLogs.userId],
    references: [users.id],
  }),
}))
