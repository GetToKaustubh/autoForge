import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  real,
  numeric,
  timestamp,
  date,
  unique,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { youtubeChannels } from './channels'
import { videos } from './production'

// --- Video-level daily analytics snapshots ---
export const videoAnalytics = pgTable(
  'video_analytics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => youtubeChannels.id),
    videoId: uuid('video_id')
      .notNull()
      .references(() => videos.id),
    ytVideoId: text('yt_video_id').notNull(),
    snapshotDate: date('snapshot_date').notNull(),
    views: bigint('views', { mode: 'number' }).default(0),
    watchTimeMin: bigint('watch_time_min', { mode: 'number' }).default(0),
    likes: integer('likes').default(0),
    comments: integer('comments').default(0),
    shares: integer('shares').default(0),
    subscribersGained: integer('subscribers_gained').default(0),
    subscribersLost: integer('subscribers_lost').default(0),
    impressions: bigint('impressions', { mode: 'number' }).default(0),
    ctr: real('ctr'),
    avgViewDurationSec: real('avg_view_duration_sec'),
    avgViewPercentage: real('avg_view_percentage'),
    // Revenue data (requires yt-analytics-monetary.readonly)
    estimatedRevenueUsd: numeric('estimated_revenue_usd', { precision: 10, scale: 4 }).default('0'),
    rpm: numeric('rpm', { precision: 8, scale: 4 }),
    cpm: numeric('cpm', { precision: 8, scale: 4 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.videoId, t.snapshotDate)]
)

// --- Channel-level daily analytics snapshots ---
export const channelAnalytics = pgTable(
  'channel_analytics',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => youtubeChannels.id),
    snapshotDate: date('snapshot_date').notNull(),
    totalViews: bigint('total_views', { mode: 'number' }).default(0),
    totalWatchTimeMin: bigint('total_watch_time_min', { mode: 'number' }).default(0),
    subscribers: bigint('subscribers', { mode: 'number' }).default(0),
    subscriberChange: integer('subscriber_change').default(0),
    totalRevenueUsd: numeric('total_revenue_usd', { precision: 12, scale: 4 }).default('0'),
    totalVideos: integer('total_videos').default(0),
    avgCtr: real('avg_ctr'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [unique().on(t.channelId, t.snapshotDate)]
)

export const videoAnalyticsRelations = relations(videoAnalytics, ({ one }) => ({
  organization: one(organizations, {
    fields: [videoAnalytics.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [videoAnalytics.channelId],
    references: [youtubeChannels.id],
  }),
  video: one(videos, {
    fields: [videoAnalytics.videoId],
    references: [videos.id],
  }),
}))

export const channelAnalyticsRelations = relations(channelAnalytics, ({ one }) => ({
  organization: one(organizations, {
    fields: [channelAnalytics.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [channelAnalytics.channelId],
    references: [youtubeChannels.id],
  }),
}))
