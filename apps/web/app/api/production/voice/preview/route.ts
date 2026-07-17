import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts'
import { applyRateLimit, rateLimiters } from '@/lib/rate-limit'

// Whitelisted against the exact voice ids offered in the picker (production/
// voice/page.tsx's POPULAR_VOICES) - msedge-tts will happily accept any
// string, so validating against a known-good set here prevents this becoming
// an open TTS proxy for arbitrary voice ids.
const PREVIEWABLE_VOICE_IDS = new Set([
  'en-US-GuyNeural',
  'en-US-EricNeural',
  'en-US-AriaNeural',
  'en-US-JennyNeural',
  'en-US-MichelleNeural',
  'en-GB-RyanNeural',
  'en-GB-SoniaNeural',
  'en-AU-WilliamMultilingualNeural',
])

const PREVIEW_TEXT = "Hi there! This is a quick preview of my voice for your video."

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await applyRateLimit(rateLimiters.api, `${userId}:voice-preview`)
  if (rateLimitRes) return rateLimitRes

  const voiceId = req.nextUrl.searchParams.get('voiceId')
  if (!voiceId || !PREVIEWABLE_VOICE_IDS.has(voiceId)) {
    return NextResponse.json({ error: 'Unknown voice' }, { status: 400 })
  }

  try {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voiceId, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3)
    const { audioStream } = tts.toStream(PREVIEW_TEXT)
    const chunks: Buffer[] = []
    for await (const chunk of audioStream) {
      chunks.push(chunk as Buffer)
    }
    tts.close()
    const audioBuffer = Buffer.concat(chunks)

    return new NextResponse(new Uint8Array(audioBuffer), {
      headers: {
        'Content-Type': 'audio/mpeg',
        // Same fixed sample text every time for a given voice - safe to let
        // the browser cache it instead of re-synthesising on every click.
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate preview' },
      { status: 502 }
    )
  }
}
