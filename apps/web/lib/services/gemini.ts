import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai'

let _client: GoogleGenerativeAI | null = null

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not set')
    _client = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY)
  }
  return _client
}

export const GEMINI_MODEL = 'gemini-2.5-flash'

function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * 0.30 + (outputTokens / 1_000_000) * 2.50
}

interface GeminiResult {
  content: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export async function generateText(
  prompt: string,
  systemPrompt: string,
  options: {
    temperature?: number
    maxOutputTokens?: number
    responseFormat?: 'text' | 'json'
  } = {}
): Promise<GeminiResult> {
  const client = getClient()
  const model = client.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: systemPrompt,
  })

  const config: GenerationConfig = {
    temperature: options.temperature ?? 0.7,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
    ...(options.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
  }

  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
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
