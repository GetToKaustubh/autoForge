import { schedules, tasks, logger } from '@trigger.dev/sdk'

// Thin dispatcher so schedules.create()'s fixed ScheduledTaskPayload shape
// (timestamp/externalId/scheduleId/...) never leaks into channel-autopilot's
// own payload contract — it just forwards externalId (the channelId set when
// the schedule was created) as the same { channelId } shape the manual
// "Run once now" route triggers directly, so both invocation paths converge
// on one real implementation.
//
// autopilotEnabled is checked HERE, not in channel-autopilot itself — that
// keeps the manual "Run once now" route able to exercise the real task even
// before autopilot is ever enabled (see the plan's verification steps), while
// still guarding the scheduled path against firing just after a user disables
// autopilot (schedules.deactivate() is async and isn't instant).
export const autopilotScheduleTask = schedules.task({
  id: 'autopilot-schedule',
  run: async (payload) => {
    if (!payload.externalId) {
      throw new Error('autopilot-schedule fired with no externalId (expected a channelId)')
    }
    const channelId = payload.externalId

    const { db } = await import('../../lib/db')
    const { youtubeChannels } = await import('../../lib/db/schema')
    const { eq } = await import('drizzle-orm')

    const [channel] = await db
      .select({ autopilotEnabled: youtubeChannels.autopilotEnabled })
      .from(youtubeChannels)
      .where(eq(youtubeChannels.id, channelId))
      .limit(1)

    if (!channel?.autopilotEnabled) {
      logger.info(`Autopilot schedule fired for channel ${channelId} but autopilot is disabled, skipping`)
      return
    }

    logger.info(`Autopilot schedule fired for channel ${channelId}`)
    await tasks.trigger('channel-autopilot', { channelId })
  },
})
