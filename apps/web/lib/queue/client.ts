import { tasks } from '@trigger.dev/sdk'

// Re-export the tasks client for use in API routes
// Each task is defined in packages/trigger/src/tasks/
export { tasks }

// Task ID constants — keeps IDs in sync between API routes and task definitions
export const TASK_IDS = {
  // Research
  NICHE_RESEARCH: 'niche-research',
  KEYWORD_RESEARCH: 'keyword-research',
  TREND_DISCOVERY: 'trend-discovery',

  // Content
  IDEA_GENERATION: 'idea-generation',
  SCRIPT_GENERATION: 'script-generation',

  // Production
  VOICE_GENERATION: 'voice-generation',
  THUMBNAIL_GENERATION: 'thumbnail-generation',
  VIDEO_GENERATION: 'video-generation',
  VIDEO_PIPELINE: 'video-pipeline',

  // Publishing
  SEO_OPTIMIZATION: 'seo-optimization',
  YOUTUBE_UPLOAD: 'youtube-upload',

  // Workflows
  WORKFLOW_EXECUTION: 'workflow-execution',

  // Autopilot
  CHANNEL_AUTOPILOT: 'channel-autopilot',
  AUTOPILOT_SCHEDULE: 'autopilot-schedule',

  // Analytics
  ANALYTICS_SYNC: 'analytics-sync',

  // Notifications
  SEND_NOTIFICATION: 'send-notification',

  // Maintenance
  TOKEN_REFRESH: 'token-refresh',
  QUOTA_RESET: 'quota-reset',
} as const

export type TaskId = (typeof TASK_IDS)[keyof typeof TASK_IDS]
