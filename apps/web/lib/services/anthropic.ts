import Anthropic from '@anthropic-ai/sdk'

let _client: Anthropic | null = null

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not set')
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return _client
}

export async function generateText(
  prompt: string,
  systemPrompt: string,
  options: {
    model?: string
    maxTokens?: number
    temperature?: number
  } = {}
): Promise<{ content: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const client = getAnthropicClient()
  const model = options.model ?? 'claude-sonnet-4-6'

  const res = await client.messages.create({
    model,
    system: systemPrompt,
    messages: [{ role: 'user', content: prompt }],
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
  })

  const inputTokens = res.usage?.input_tokens ?? 0
  const outputTokens = res.usage?.output_tokens ?? 0

  // Claude Sonnet 4.6: $3.00/1M input, $15.00/1M output
  const costUsd = (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0

  const content =
    res.content
      .filter((block) => block.type === 'text')
      .map((block) => (block as { type: 'text'; text: string }).text)
      .join('') ?? ''

  return { content, inputTokens, outputTokens, costUsd }
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
  const result = await generateText(
    prompt,
    systemPrompt + '\n\nYou MUST respond with valid JSON only. No markdown, no explanation.',
    { ...options, temperature: options.temperature ?? 0.3 }
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
