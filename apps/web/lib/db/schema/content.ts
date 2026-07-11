import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  pgEnum,
  date,
  time,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { users } from './users'
import { youtubeChannels } from './channels'
import { nicheResearch, trends } from './research'

export const videoFormatEnum = pgEnum('video_format', [
  'tutorial',
  'review',
  'listicle',
  'vlog',
  'documentary',
  'shorts',
  'live',
  'comparison',
])

export const ideaStatusEnum = pgEnum('idea_status', [
  'idea',
  'approved',
  'in_production',
  'published',
  'rejected',
  'archived',
])

export const scriptStatusEnum = pgEnum('script_status', [
  'draft',
  'review',
  'approved',
  'in_production',
  'archived',
])

export const calendarTypeEnum = pgEnum('calendar_type', [
  'video',
  'short',
  'live',
  'community_post',
])

export const calendarStatusEnum = pgEnum('calendar_status', [
  'planned',
  'in_production',
  'ready',
  'published',
  'skipped',
])

// --- Video Ideas ---
export const videoIdeas = pgTable('video_ideas', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => youtubeChannels.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  hook: text('hook'),
  description: text('description'),
  format: videoFormatEnum('format'),
  targetKeywords: text('target_keywords').array(),
  estimatedViewsMin: integer('estimated_views_min'),
  estimatedViewsMax: integer('estimated_views_max'),
  priority: integer('priority').default(5).notNull(),
  status: ideaStatusEnum('status').default('idea').notNull(),
  nicheResearchId: uuid('niche_research_id').references(() => nicheResearch.id),
  trendId: uuid('trend_id').references(() => trends.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- Scripts ---
export const scripts = pgTable('scripts', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => youtubeChannels.id),
  ideaId: uuid('idea_id').references(() => videoIdeas.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  // Ordered array of script sections
  sections: jsonb('sections').default([]).notNull(),
  // [{ type: 'intro'|'hook'|'main'|'cta'|'outro', content, duration_sec, notes }]
  fullText: text('full_text'),
  wordCount: integer('word_count'),
  estimatedDurationSec: integer('estimated_duration_sec'),
  version: integer('version').default(1).notNull(),
  modelUsed: text('model_used'),
  tokensUsed: integer('tokens_used'),
  status: scriptStatusEnum('status').default('draft').notNull(),
  approvedBy: uuid('approved_by').references(() => users.id),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  triggerJobId: text('trigger_job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- Content Calendar ---
export const contentCalendar = pgTable('content_calendar', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => youtubeChannels.id),
  videoId: uuid('video_id'),    // references videos.id — set in videos.ts to avoid cycle
  ideaId: uuid('idea_id').references(() => videoIdeas.id),
  title: text('title').notNull(),
  plannedDate: date('planned_date').notNull(),
  plannedTime: time('planned_time'),
  timezone: text('timezone').default('UTC').notNull(),
  type: calendarTypeEnum('type').default('video').notNull(),
  status: calendarStatusEnum('status').default('planned').notNull(),
  notes: text('notes'),
  color: text('color'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export const videoIdeasRelations = relations(videoIdeas, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [videoIdeas.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [videoIdeas.channelId],
    references: [youtubeChannels.id],
  }),
  creator: one(users, {
    fields: [videoIdeas.createdBy],
    references: [users.id],
  }),
  nicheResearch: one(nicheResearch, {
    fields: [videoIdeas.nicheResearchId],
    references: [nicheResearch.id],
  }),
  trend: one(trends, {
    fields: [videoIdeas.trendId],
    references: [trends.id],
  }),
  scripts: many(scripts),
  calendarEntries: many(contentCalendar),
}))

export const scriptsRelations = relations(scripts, ({ one }) => ({
  organization: one(organizations, {
    fields: [scripts.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [scripts.channelId],
    references: [youtubeChannels.id],
  }),
  idea: one(videoIdeas, {
    fields: [scripts.ideaId],
    references: [videoIdeas.id],
  }),
  creator: one(users, {
    fields: [scripts.createdBy],
    references: [users.id],
  }),
  approver: one(users, {
    fields: [scripts.approvedBy],
    references: [users.id],
  }),
}))

export const contentCalendarRelations = relations(contentCalendar, ({ one }) => ({
  organization: one(organizations, {
    fields: [contentCalendar.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [contentCalendar.channelId],
    references: [youtubeChannels.id],
  }),
  idea: one(videoIdeas, {
    fields: [contentCalendar.ideaId],
    references: [videoIdeas.id],
  }),
  creator: one(users, {
    fields: [contentCalendar.createdBy],
    references: [users.id],
  }),
}))
