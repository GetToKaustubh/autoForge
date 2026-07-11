import OpenAI from 'openai'

let _client: OpenAI | null = null

export function getOpenAIClient(): OpenAI {
  if (!_client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set')
    }
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
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
    responseFormat?: 'text' | 'json'
  } = {}
): Promise<{ content: string; inputTokens: number; outputTokens: number; costUsd: number }> {
  const client = getOpenAIClient()
  const model = options.model ?? 'gpt-4o'

  const res = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ],
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    response_format:
      options.responseFormat === 'json' ? { type: 'json_object' } : { type: 'text' },
  })

  const inputTokens = res.usage?.prompt_tokens ?? 0
  const outputTokens = res.usage?.completion_tokens ?? 0

  // GPT-4o pricing: $2.50/1M input, $10.00/1M output
  const costUsd = (inputTokens / 1_000_000) * 2.5 + (outputTokens / 1_000_000) * 10.0

  return {
    content: res.choices[0]?.message?.content ?? '',
    inputTokens,
    outputTokens,
    costUsd,
  }
}

export async function generateImage(
  prompt: string,
  options: {
    size?: '1024x1024' | '1792x1024' | '1024x1792'
    quality?: 'standard' | 'hd'
    style?: 'vivid' | 'natural'
  } = {}
): Promise<{ url: string; costUsd: number }> {
  const client = getOpenAIClient()

  const res = await client.images.generate({
    model: 'dall-e-3',
    prompt,
    size: options.size ?? '1792x1024',
    quality: options.quality ?? 'hd',
    style: options.style ?? 'vivid',
    n: 1,
  })

  // DALL-E 3 HD 1792x1024 = $0.080 per image
  const costUsd = options.quality === 'hd' ? 0.08 : 0.04

  return {
    url: (res.data as Array<{ url?: string }>)[0]?.url ?? '',
    costUsd,
  }
}

export async function generateEmbedding(text: string): Promise<number[]> {
  const client = getOpenAIClient()
  const res = await client.embeddings.create({
    model: 'text-embedding-3-small',
    input: text,
  })
  return res.data[0]?.embedding ?? []
}
