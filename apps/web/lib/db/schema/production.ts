import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  jsonb,
  boolean,
  real,
  numeric,
  timestamp,
  pgEnum,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { organizations } from './organizations'
import { users } from './users'
import { youtubeChannels } from './channels'
import { scripts, videoIdeas } from './content'

export const jobStatusEnum = pgEnum('job_status', [
  'pending',
  'processing',
  'completed',
  'failed',
])

export const pipelineStageEnum = pgEnum('pipeline_stage', [
  'draft',
  'script_ready',
  'voice_ready',
  'scenes_generating',
  'scenes_ready',
  'editing',
  'render_queue',
  'rendered',
  'seo_optimized',
  'scheduled',
  'uploaded',
  'published',
  'failed',
])

export const ytVisibilityEnum = pgEnum('yt_visibility', ['public', 'private', 'unlisted'])

export const uploadStatusEnum = pgEnum('upload_status', [
  'scheduled',
  'uploading',
  'uploaded',
  'failed',
  'cancelled',
])

// --- Voice Generations ---
export const voiceGenerations = pgTable('voice_generations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  scriptId: uuid('script_id')
    .notNull()
    .references(() => scripts.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  // ElevenLabs config
  voiceId: text('voice_id').notNull(),
  voiceName: text('voice_name'),
  voiceSettings: jsonb('voice_settings').default({}).notNull(),
  // Per-section audio files
  sections: jsonb('sections').default([]).notNull(),
  // [{ section_index, cloudinary_url, duration_sec, characters_used }]
  fullAudioUrl: text('full_audio_url'),
  totalChars: integer('total_chars'),
  totalDurationSec: real('total_duration_sec'),
  status: jobStatusEnum('status').default('pending').notNull(),
  triggerJobId: text('trigger_job_id'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
})

// --- Thumbnails ---
export const thumbnails = pgTable('thumbnails', {
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
  prompt: text('prompt').notNull(),
  style: text('style'),
  templateId: text('template_id'),
  variants: jsonb('variants').default([]).notNull(),
  // [{ cloudinary_url, cloudinary_public_id, selected: bool }]
  selectedUrl: text('selected_url'),
  generationModel: text('generation_model'),
  status: jobStatusEnum('status').default('pending').notNull(),
  triggerJobId: text('trigger_job_id'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- Videos (central pipeline entity) ---
export const videos = pgTable('videos', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  channelId: uuid('channel_id')
    .notNull()
    .references(() => youtubeChannels.id),
  scriptId: uuid('script_id').references(() => scripts.id),
  voiceGenId: uuid('voice_gen_id').references(() => voiceGenerations.id),
  thumbnailId: uuid('thumbnail_id').references(() => thumbnails.id),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  title: text('title').notNull(),
  description: text('description'),
  // Pipeline stage machine
  pipelineStage: pipelineStageEnum('pipeline_stage').default('draft').notNull(),
  // Scene-level video data
  scenes: jsonb('scenes').default([]).notNull(),
  // [{ scene_index, prompt, cloudinary_url, duration_sec, runway_job_id, pika_job_id, status }]
  rawVideoUrl: text('raw_video_url'),
  finalVideoUrl: text('final_video_url'),
  cloudinaryPublicId: text('cloudinary_public_id'),
  durationSec: real('duration_sec'),
  resolution: text('resolution').default('1920x1080'),
  fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
  // YouTube metadata (prepared for upload)
  ytTitle: text('yt_title'),
  ytDescription: text('yt_description'),
  ytTags: text('yt_tags').array(),
  ytCategoryId: text('yt_category_id'),
  ytLanguage: text('yt_language').default('en'),
  ytMadeForKids: boolean('yt_made_for_kids').default(false).notNull(),
  ytVisibility: ytVisibilityEnum('yt_visibility').default('private').notNull(),
  // Post-upload YouTube data
  ytVideoId: text('yt_video_id'),
  ytUrl: text('yt_url'),
  // Fast public counters from videos.list (near-real-time, unlike the
  // YouTube Analytics API which has a 24-72h processing delay before
  // any data appears in reports).
  ytViewCount: bigint('yt_view_count', { mode: 'number' }),
  ytLikeCount: integer('yt_like_count'),
  ytCommentCount: integer('yt_comment_count'),
  ytStatsSyncedAt: timestamp('yt_stats_synced_at', { withTimezone: true }),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- Scheduled Uploads ---
export const scheduledUploads = pgTable('scheduled_uploads', {
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
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  timezone: text('timezone').default('UTC').notNull(),
  status: uploadStatusEnum('status').default('scheduled').notNull(),
  triggerJobId: text('trigger_job_id'),
  attemptCount: integer('attempt_count').default(0).notNull(),
  lastError: text('last_error'),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// --- SEO Optimizations ---
export const seoOptimizations = pgTable('seo_optimizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  organizationId: uuid('organization_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  videoId: uuid('video_id')
    .notNull()
    .references(() => videos.id)
    .unique(),
  optimizedTitle: text('optimized_title'),
  optimizedDescription: text('optimized_description'),
  tags: text('tags').array(),
  hashtags: text('hashtags').array(),
  chapters: jsonb('chapters').default([]),
  // [{ timestamp_sec, title }]
  cards: jsonb('cards').default([]),
  endScreens: jsonb('end_screens').default([]),
  titleScore: real('title_score'),
  descriptionScore: real('description_score'),
  tagScore: real('tag_score'),
  overallScore: real('overall_score'),
  modelUsed: text('model_used'),
  triggerJobId: text('trigger_job_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

// Relations
export const voiceGenerationsRelations = relations(voiceGenerations, ({ one }) => ({
  organization: one(organizations, {
    fields: [voiceGenerations.organizationId],
    references: [organizations.id],
  }),
  script: one(scripts, {
    fields: [voiceGenerations.scriptId],
    references: [scripts.id],
  }),
  creator: one(users, {
    fields: [voiceGenerations.createdBy],
    references: [users.id],
  }),
}))

export const thumbnailsRelations = relations(thumbnails, ({ one }) => ({
  organization: one(organizations, {
    fields: [thumbnails.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [thumbnails.channelId],
    references: [youtubeChannels.id],
  }),
  idea: one(videoIdeas, {
    fields: [thumbnails.ideaId],
    references: [videoIdeas.id],
  }),
  creator: one(users, {
    fields: [thumbnails.createdBy],
    references: [users.id],
  }),
}))

export const videosRelations = relations(videos, ({ one }) => ({
  organization: one(organizations, {
    fields: [videos.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [videos.channelId],
    references: [youtubeChannels.id],
  }),
  script: one(scripts, {
    fields: [videos.scriptId],
    references: [scripts.id],
  }),
  voiceGen: one(voiceGenerations, {
    fields: [videos.voiceGenId],
    references: [voiceGenerations.id],
  }),
  thumbnail: one(thumbnails, {
    fields: [videos.thumbnailId],
    references: [thumbnails.id],
  }),
  creator: one(users, {
    fields: [videos.createdBy],
    references: [users.id],
  }),
}))

export const scheduledUploadsRelations = relations(scheduledUploads, ({ one }) => ({
  organization: one(organizations, {
    fields: [scheduledUploads.organizationId],
    references: [organizations.id],
  }),
  channel: one(youtubeChannels, {
    fields: [scheduledUploads.channelId],
    references: [youtubeChannels.id],
  }),
  video: one(videos, {
    fields: [scheduledUploads.videoId],
    references: [videos.id],
  }),
  creator: one(users, {
    fields: [scheduledUploads.createdBy],
    references: [users.id],
  }),
}))

export const seoOptimizationsRelations = relations(seoOptimizations, ({ one }) => ({
  organization: one(organizations, {
    fields: [seoOptimizations.organizationId],
    references: [organizations.id],
  }),
  video: one(videos, {
    fields: [seoOptimizations.videoId],
    references: [videos.id],
  }),
}))
