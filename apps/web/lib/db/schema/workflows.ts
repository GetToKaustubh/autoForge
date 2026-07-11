import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { users } from './users'
import { youtubeChannels } from './channels'

export const workflowTriggerEnum = pgEnum('workflow_trigger', [
  'manual',
  'scheduled',
  'on_idea_approved',
  'on_script_approved',
  'webhook',
])

export const workflowRunStatusEnum = pgEnum('workflow_run_status', [
  'running',
  'completed',
  'failed',
  'cancelled',
])

export const workflows = pgTable('workflows', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => youtubeChannels.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  name: text('name').notNull(),
  description: text('description'),
  triggerType: workflowTriggerEnum('trigger_type').notNull(),
  triggerConfig: jsonb('trigger_config').default({}).notNull(),
  // { cron: '0 9 * * 1', webhook_secret: 'xxx' }
  steps: jsonb('steps').default([]).notNull(),
  // [{ id, type, config, depends_on: string[], retry: { max, delay_ms } }]
  // step types: generate_script, generate_voice, generate_thumbnail,
  //             generate_video, optimize_seo, schedule_upload, notify
  isActive: boolean('is_active').default(true).notNull(),
  runCount: integer('run_count').default(0).notNull(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const workflowRuns = pgTable('workflow_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  workflowId: uuid('workflow_id')
    .notNull()
    .references(() => workflows.id),
  triggeredBy: uuid('triggered_by').references(() => users.id),
  status: workflowRunStatusEnum('status').default('running').notNull(),
  context: jsonb('context').default({}).notNull(),
  stepResults: jsonb('step_results').default({}).notNull(),
  // { step_id: { status, output, error } }
  triggerJobIds: text('trigger_job_ids').array(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
})

export const workflowsRelations = relations(workflows, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [workflows.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [workflows.channelId],
    references: [youtubeChannels.id],
  }),
  creator: one(users, {
    fields: [workflows.createdBy],
    references: [users.id],
  }),
  runs: many(workflowRuns),
}))

export const workflowRunsRelations = relations(workflowRuns, ({ one }) => ({
  organization: one(organizations, {
    fields: [workflowRuns.organizationId],
    references: [organizations.id],
  }),
  workflow: one(workflows, {
    fields: [workflowRuns.workflowId],
    references: [workflows.id],
  }),
  triggeredByUser: one(users, {
    fields: [workflowRuns.triggeredBy],
    references: [users.id],
  }),
}))
