import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  pgEnum,
  date,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { users } from './users'
import { youtubeChannels } from './channels'

export const researchStatusEnum = pgEnum('research_status', [
  'pending',
  'running',
  'completed',
  'failed',
])

export const researchSourceEnum = pgEnum('research_source', ['ai', 'youtube_api', 'serpapi'])

// --- Niche Research ---
export const nicheResearch = pgTable('niche_research', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => youtubeChannels.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  query: text('query').notNull(),
  niches: jsonb('niches').default([]).notNull(),
  // [{ name, description, competition_score, monetization_score,
  //    trend_direction, estimated_cpm, recommended_formats, sample_channels }]
  modelUsed: text('model_used').notNull(),
  tokensUsed: integer('tokens_used'),
  status: researchStatusEnum('status').default('completed').notNull(),
  errorMessage: text('error_message'),
  triggerJobId: text('trigger_job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- Keyword Research ---
export const keywordResearch = pgTable('keyword_research', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => youtubeChannels.id),
  seedKeyword: text('seed_keyword').notNull(),
  results: jsonb('results').default([]).notNull(),
  // [{ keyword, search_volume, competition, cpc, trend_score, yt_search_count, difficulty }]
  source: researchSourceEnum('source').default('ai').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- Trends ---
export const trends = pgTable('trends', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id').references(() => youtubeChannels.id),
  topic: text('topic').notNull(),
  trendData: jsonb('trend_data').default({}).notNull(),
  // { score, velocity, peak_date, related_queries, geographic_data,
  //   youtube_trending_videos, predicted_longevity }
  source: researchSourceEnum('source').default('ai').notNull(),
  discoveredAt: timestamp('discovered_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
})

export const nicheResearchRelations = relations(nicheResearch, ({ one }) => ({
  organization: one(organizations, {
    fields: [nicheResearch.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [nicheResearch.channelId],
    references: [youtubeChannels.id],
  }),
  creator: one(users, {
    fields: [nicheResearch.createdBy],
    references: [users.id],
  }),
}))

export const keywordResearchRelations = relations(keywordResearch, ({ one }) => ({
  organization: one(organizations, {
    fields: [keywordResearch.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [keywordResearch.channelId],
    references: [youtubeChannels.id],
  }),
}))

export const trendsRelations = relations(trends, ({ one }) => ({
  organization: one(organizations, {
    fields: [trends.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [trends.channelId],
    references: [youtubeChannels.id],
  }),
}))
