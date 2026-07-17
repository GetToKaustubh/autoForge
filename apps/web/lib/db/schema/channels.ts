import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  pgEnum,
  unique,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { users } from './users'

export const channelStatusEnum = pgEnum('channel_status', [
  'active',
  'suspended',
  'disconnected',
  'quota_exceeded',
])

export const youtubeChannels = pgTable('youtube_channels', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  connectedBy: uuid('connected_by')
    .notNull()
    .references(() => users.id),
  // YouTube identifiers
  ytChannelId: text('yt_channel_id').notNull(),
  channelName: text('channel_name').notNull(),
  channelHandle: text('channel_handle'),
  channelThumbnail: text('channel_thumbnail'),
  description: text('description'),
  country: text('country'),
  language: text('language'),
  subscriberCount: bigint('subscriber_count', { mode: 'number' }).default(0),
  videoCount: integer('video_count').default(0),
  viewCount: bigint('view_count', { mode: 'number' }).default(0),
  // Upload defaults
  defaultCategory: text('default_category'),
  defaultTags: text('default_tags').array(),
  // Encrypted OAuth tokens (AES-256-GCM, base64 encoded)
  accessTokenEnc: text('access_token_enc').notNull(),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  tokenScope: text('token_scope').notNull(),
  // GCP project for quota tracking (for agencies using multiple projects)
  gcpProjectId: text('gcp_project_id'),
  // Quota tracking (resets daily at Pacific Time midnight)
  quotaUsedToday: integer('quota_used_today').default(0).notNull(),
  quotaLimitDaily: integer('quota_limit_daily').default(10000).notNull(),
  quotaResetAt: timestamp('quota_reset_at', { withTimezone: true }),
  // Autopilot
  autopilotEnabled: boolean('autopilot_enabled').default(false).notNull(),
  autopilotNichePrompt: text('autopilot_niche_prompt'),
  autopilotProvider: text('autopilot_provider').default('stock').notNull(),
  autopilotMode: text('autopilot_mode').default('review').notNull(),
  autopilotScheduleHourUtc: integer('autopilot_schedule_hour_utc').default(9).notNull(),
  autopilotTargetAudience: text('autopilot_target_audience'),
  autopilotFormat: text('autopilot_format'),
  autopilotScheduleId: text('autopilot_schedule_id'),
  autopilotLastRunAt: timestamp('autopilot_last_run_at', { withTimezone: true }),
  autopilotConsecutiveFailures: integer('autopilot_consecutive_failures').default(0).notNull(),
  // Status
  status: channelStatusEnum('status').default('active').notNull(),
  isPrimary: boolean('is_primary').default(false).notNull(),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  unique('youtube_channels_org_channel_unique').on(t.organizationId, t.ytChannelId),
])

export const youtubeChannelsRelations = relations(youtubeChannels, ({ one }) => ({
  organization: one(organizations, {
    fields: [youtubeChannels.organizationId],
    references: [organizations.id],
  }),
  connectedByUser: one(users, {
    fields: [youtubeChannels.connectedBy],
    references: [users.id],
  }),
}))
