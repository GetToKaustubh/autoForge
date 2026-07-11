import { generateText as geminiGenerateText } from './gemini'

// Retained for backward compatibility — all calls now routed to Gemini 2.0 Flash (free tier)

export async function generateText(
  prompt: string,
  systemPrompt: string,
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
    responseFormat?: 'text' | 'json'
  } = {}
): Promise<{ content: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  return geminiGenerateText(prompt, systemPrompt, {
    maxOutputTokens: options.maxTokens,
    temperature: options.temperature,
    responseFormat: options.responseFormat === 'json' ? 'json' : 'text',
  })
}

// Pollinations.ai — free URL-based image generation, no API key required
export async function generateImage(
  prompt: string,
  options: {
    size?: '1024x1024' | '1792x1024' | '1024x1792'
    quality?: 'standard' | 'hd'
    style?: 'vivid' | 'natural'
  } = {}
): Promise<{ url: string; costUsd: number }> {
  const width = options.size === '1024x1792' ? 1024 : 1280
  const height = options.size === '1024x1792' ? 1792 : 720
  const seed = Math.floor(Math.random() * 1_000_000)
  const encoded = encodeURIComponent(prompt)
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=${width}&height=${height}&seed=${seed}&nologo=true&enhance=true`
  return { url, costUsd: 0 }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  // Gemini text-embedding-004: free tier, 768-dim embeddings
  const { GoogleGenerativeAI } = await import('@google/generative-ai')
  const apiKey = process.env.GOOGLE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_AI_API_KEY is not set')
  const genai = new GoogleGenerativeAI(apiKey)
  const model = genai.getGenerativeModel({ model: 'text-embedding-004' })
  const result = await model.embedContent(text)
  return result.embedding.values
}
