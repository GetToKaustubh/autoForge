import { logger } from '@/lib/utils/logger'

const RUNWAY_API_BASE = 'https://api.runwayml.com/v1'

function getApiKey(): string {
  const key = process.env.RUNWAY_API_KEY
  if (!key) throw new Error('RUNWAY_API_KEY is not set')
  return key
}

export interface RunwayGenerationOptions {
  promptText: string
  promptImage?: string
  model?: 'gen3a_turbo' | 'gen4_turbo'
  duration?: 5 | 10
  ratio?: '1280:768' | '768:1280' | '1104:624' | '624:1104' | '960:960'
  watermark?: boolean
}

export interface RunwayGeneration {
  id: string
  status: 'PENDING' | 'THROTTLED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED'
  output?: string[]
  failure?: string
  createdAt: string
  progress?: number
}

export async function createGeneration(options: RunwayGenerationOptions): Promise<RunwayGeneration> {
  const model = options.model ?? 'gen3a_turbo'

  const body: Record<string, unknown> = {
    model,
    promptText: options.promptText,
    duration: options.duration ?? 5,
    ratio: options.ratio ?? '1280:768',
    watermark: options.watermark ?? false,
  }

  if (options.promptImage) {
    body.promptImage = options.promptImage
  }

  const res = await fetch(`${RUNWAY_API_BASE}/image_to_video`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'Content-Type': 'application/json',
      'X-Runway-Version': '2024-11-06',
    },
    body: JSON.stringify(body),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Runway createGeneration failed: ${res.status} — ${err}`)
  }

  const data = await res.json()
  logger.info({ generationId: data.id, model }, 'Runway generation created')
  return data as RunwayGeneration
}

export async function pollGeneration(generationId: string): Promise<RunwayGeneration> {
  const res = await fetch(`${RUNWAY_API_BASE}/tasks/${generationId}`, {
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      'X-Runway-Version': '2024-11-06',
    },
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Runway pollGeneration failed: ${res.status} — ${err}`)
  }

  return res.json() as Promise<RunwayGeneration>
}

export async function waitForGeneration(
  generationId: string,
  maxWaitMs = 600_000,
  pollIntervalMs = 10_000
): Promise<string> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    const gen = await pollGeneration(generationId)
    logger.info({ generationId, status: gen.status, progress: gen.progress }, 'Runway poll')

    if (gen.status === 'SUCCEEDED') {
      const videoUrl = gen.output?.[0]
      if (!videoUrl) throw new Error('Runway succeeded but no output URL')
      return videoUrl
    }

    if (gen.status === 'FAILED') {
      throw new Error(`Runway generation failed: ${gen.failure ?? 'unknown error'}`)
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  throw new Error(`Runway generation timed out after ${maxWaitMs / 1000}s`)
}

// ~$0.05/second of video; 5s clip = $0.25, 10s clip = $0.50
export function estimateCost(durationSeconds: number): number {
  return durationSeconds * 0.05
}
