import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'

function getClient() {
  if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not set')
  return new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
}

export const GEMINI_MODEL = 'gemini-2.0-flash'

// Gemini 2.0 Flash pricing: $0.075/1M input, $0.30/1M output (free tier: 1M tokens/day)
export function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 0.075 + (outputTokens / 1_000_000) * 0.30
}

interface GeminiResult {
  content: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export async function generateText(
  userPrompt: string,
  systemPrompt: string,
  options: { temperature?: number; maxOutputTokens?: number } = {}
): Promise<GeminiResult> {
  const client = getClient()
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
  })

  const config: GenerationConfig = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
  }

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: config,
  })

  const inputTokens = result.response.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0

  return {
    content: result.response.text(),
    inputTokens,
    outputTokens,
    costUsd: calcCost(inputTokens, outputTokens),
  }
}

export async function generateJSON<T>(
  userPrompt: string,
  systemPrompt: string,
  options: { temperature?: number; maxOutputTokens?: number } = {}
): Promise<GeminiResult & { data: T }> {
  const client = getClient()
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt + '\n\nRespond with valid JSON only.',
  })

  const config: GenerationConfig = {
    temperature: options.temperature ?? 0.3,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
    responseMimeType: 'application/json',
  }

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    generationConfig: config,
  })

  const text = result.response.text()
  const inputTokens = result.response.usageMetadata?.promptTokenCount ?? 0
  const outputTokens = result.response.usageMetadata?.candidatesTokenCount ?? 0

  // Strip markdown fences if model wraps output
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  return {
    content: text,
    data: JSON.parse(cleaned) as T,
    inputTokens,
    outputTokens,
    costUsd: calcCost(inputTokens, outputTokens),
  }
}
