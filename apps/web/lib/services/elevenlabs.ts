import { logger } from '@/lib/utils/logger'

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1'

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY
  if (!key) throw new Error('ELEVENLABS_API_KEY is not set')
  return key
}

export interface ElevenLabsVoice {
  voice_id: string
  name: string
  category: string
  labels: Record<string, string>
  preview_url: string
}

export async function listVoices(): Promise<ElevenLabsVoice[]> {
  const res = await fetch(`${ELEVENLABS_API_BASE}/voices`, {
    headers: { 'xi-api-key': getApiKey() },
  })
  if (!res.ok) throw new Error(`ElevenLabs listVoices failed: ${res.status}`)
  const data = await res.json()
  return data.voices ?? []
}

export async function generateSpeech(
  text: string,
  voiceId: string,
  options: {
    modelId?: string
    stability?: number
    similarityBoost?: number
    style?: number
    speakerBoost?: boolean
  } = {}
): Promise<{ audioBuffer: Buffer; characterCount: number; costUsd: number }> {
  const modelId = options.modelId ?? 'eleven_turbo_v2'

  const res = await fetch(`${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`, {
    method: 'POST',
    headers: {
      'xi-api-key': getApiKey(),
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: options.stability ?? 0.5,
        similarity_boost: options.similarityBoost ?? 0.75,
        style: options.style ?? 0.0,
        use_speaker_boost: options.speakerBoost ?? true,
      },
    }),
  })

  if (!res.ok) {
    const errorBody = await res.text()
    throw new Error(`ElevenLabs TTS failed: ${res.status} — ${errorBody}`)
  }

  const arrayBuffer = await res.arrayBuffer()
  const audioBuffer = Buffer.from(arrayBuffer)
  const characterCount = text.length

  // ElevenLabs Creator plan: ~$0.12 per 1K chars
  const costUsd = (characterCount / 1000) * 0.12

  logger.info({ voiceId, modelId, characterCount, costUsd }, 'ElevenLabs TTS generated')
  return { audioBuffer, characterCount, costUsd }
}

export async function getUserSubscription() {
  const res = await fetch(`${ELEVENLABS_API_BASE}/user/subscription`, {
    headers: { 'xi-api-key': getApiKey() },
  })
  if (!res.ok) throw new Error(`ElevenLabs subscription check failed: ${res.status}`)
  return res.json()
}
