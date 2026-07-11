// AI prompt templates used across research and content modules.
// Trigger.dev tasks embed their own copies; these are the canonical source for reference
// and for any inline AI calls made directly from API routes.

export const NICHE_RESEARCH_SYSTEM = `You are an expert YouTube niche analyst with deep knowledge of content monetization, audience growth, and market saturation. Analyze niches scientifically and provide data-driven insights.`

export const NICHE_RESEARCH_PROMPT = (query: string) => `Research YouTube niches related to: "${query}"

Return a JSON object with this exact structure:
{
  "niches": [
    {
      "name": "string",
      "description": "string",
      "estimatedMonthlySearchVolume": number,
      "competitionLevel": "low" | "medium" | "high",
      "monetizationPotential": "low" | "medium" | "high",
      "averageCpm": number,
      "contentFormats": ["string"],
      "keyTopics": ["string"],
      "targetAudience": "string",
      "growthTrend": "declining" | "stable" | "growing" | "exploding",
      "entryBarrier": "low" | "medium" | "high",
      "score": number
    }
  ],
  "summary": "string",
  "recommendedNiche": "string",
  "reasoning": "string"
}

Return 5-8 niches. Score is 0-100.`

export const KEYWORD_RESEARCH_PROMPT = (seedKeyword: string, niche?: string) =>
  `Research YouTube keywords for: "${seedKeyword}"${niche ? ` in the "${niche}" niche` : ''}.

Return a JSON object:
{
  "keywords": [
    {
      "keyword": "string",
      "searchVolume": "low" | "medium" | "high" | "very_high",
      "competition": "low" | "medium" | "high",
      "cpc": number,
      "intent": "informational" | "commercial" | "navigational" | "transactional",
      "type": "short_tail" | "long_tail" | "question" | "comparison",
      "difficulty": number,
      "opportunity": number,
      "relatedKeywords": ["string"],
      "videoAngle": "string"
    }
  ],
  "clusters": [{ "theme": "string", "keywords": ["string"], "contentStrategy": "string" }],
  "topOpportunity": "string",
  "contentGaps": ["string"]
}

Return 15-20 keywords. difficulty and opportunity are 0-100.`

export const TREND_DISCOVERY_PROMPT = (topic: string, niche?: string) =>
  `Discover current YouTube trends for topic: "${topic}"${niche ? ` in the "${niche}" niche` : ''}.

Return JSON:
{
  "trends": [
    {
      "title": "string", "description": "string",
      "momentum": "rising" | "peaked" | "evergreen",
      "velocity": number, "estimatedWeeksUntilPeak": number | null,
      "contentAngles": ["string"], "hashtags": ["string"],
      "targetDemographic": "string", "urgencyScore": number,
      "opportunityWindow": "days" | "weeks" | "months" | "evergreen"
    }
  ],
  "insights": "string", "immediateActions": ["string"],
  "expiresAt": "ISO8601 date string"
}`

export const SCRIPT_GENERATION_SYSTEM = `You are an expert YouTube script writer. Write engaging, educational scripts optimized for viewer retention.
Your scripts must:
- Open with a powerful hook in the first 15 seconds
- Follow a clear structure: Hook → Problem → Solution → Value → CTA
- Use conversational language appropriate for YouTube
- Include natural transitions between sections
- End with a strong call-to-action

Output JSON with this exact structure:
{
  "sections": [
    { "type": "hook", "content": "...", "duration_sec": 15, "notes": "..." },
    { "type": "intro", "content": "...", "duration_sec": 30, "notes": "..." },
    { "type": "main", "content": "...", "duration_sec": 480, "notes": "..." },
    { "type": "cta", "content": "...", "duration_sec": 45, "notes": "..." },
    { "type": "outro", "content": "...", "duration_sec": 30, "notes": "..." }
  ]
}`

export const SEO_OPTIMIZATION_PROMPT = (title: string, description: string, tags: string[]) =>
  `Optimize the following YouTube video metadata for maximum discoverability:

Title: ${title}
Description: ${description}
Tags: ${tags.join(', ')}

Return JSON:
{
  "optimizedTitle": "string (max 100 chars)",
  "optimizedDescription": "string (first 150 chars shown before 'more')",
  "optimizedTags": ["string"],
  "chapters": [{ "timecode": "0:00", "title": "string" }],
  "thumbnailTextSuggestion": "string",
  "cardSuggestions": ["string"],
  "overallScore": number,
  "improvements": ["string"]
}

overallScore is 0-100.`
