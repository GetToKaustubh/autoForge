import { generateText as geminiGenerateText } from './gemini'

// Retained for backward compatibility — all calls now routed to Gemini 2.0 Flash (free tier)

export async function generateText(
  prompt: string,
  systemPrompt: string,
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
  } = {}
): Promise<{ content: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  return geminiGenerateText(prompt, systemPrompt, {
    maxOutputTokens: options.maxTokens,
    temperature: options.temperature,
  })
}

export async function generateJSON<T>(
  prompt: string,
  systemPrompt: string,
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
  } = {}
): Promise<{ data: T; inputTokens: number; outputTokens: number; costUsd: number }> {
  const result = await geminiGenerateText(
    prompt,
    systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no explanation.',
    { maxOutputTokens: options.maxTokens, temperature: options.temperature ?? 0.3, responseFormat: 'json' }
  )

  const jsonMatch = result.content.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  const jsonStr = jsonMatch?.[0] ?? result.content

  return {
    data: JSON.parse(jsonStr) as T,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    costUsd: result.costUsd,
  }
}
