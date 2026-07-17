import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { youtubeChannels } from './channels'
import { workflowRuns } from './workflows'

export const channelAutopilotRunStatusEnum = pgEnum('channel_autopilot_run_status', [
  'running',
  'completed',
  'failed',
  'skipped',
  'awaiting_review',
  'discarded',
])

export const channelAutopilotRuns = pgTable('channel_autopilot_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => youtubeChannels.id, { onDelete: 'cascade' }),
  workflowRunId: uuid('workflow_run_id').references(() => workflowRuns.id),
  status: channelAutopilotRunStatusEnum('status').default('running').notNull(),
  stage: text('stage'),
  ideaId: uuid('idea_id'),
  scriptId: uuid('script_id'),
  videoId: uuid('video_id'),
  costUsd: numeric('cost_usd', { precision: 10, scale: 6 }),
  errorMessage: text('error_message'),
  approvalToken: text('approval_token').unique(),
  approvalTokenExpiresAt: timestamp('approval_token_expires_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

export const channelAutopilotRunsRelations = relations(channelAutopilotRuns, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelAutopilotRuns.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [channelAutopilotRuns.channelId],
    references: [youtubeChannels.id],
  }),
  workflowRun: one(workflowRuns, {
    fields: [channelAutopilotRuns.workflowRunId],
    references: [workflowRuns.id],
  }),
}))
