import { defineConfig } from '@trigger.dev/sdk/v3'

export default defineConfig({
  project: process.env.TRIGGER_PROJECT_ID ?? 'tubeforge',
  runtime: 'node',
  dirs: ['./tasks'],
  maxDuration: 3600, // global default; individual tasks override as needed
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 2000,
      maxTimeoutInMs: 30000,
      factor: 2,
      randomize: true,
    },
  },
  machine: 'medium-1x', // 1 vCPU, 2GB RAM
})
