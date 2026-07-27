import type { v2 as CloudinaryV2 } from 'cloudinary'

// Standalone Imagen 4 ("predict" API) is dead for this account - confirmed
// live, every imagen-4.0-*-generate-001 model 404s with "no longer available
// to new users." Google's own error points at the replacement: image
// generation now lives inside Gemini itself via generateContent (these are
// the models Google calls "Nano Banana" in some docs), returning inline
// base64 image bytes as a response part instead of the old predict/bytes
// shape. Pricing confirmed live via ai.google.dev/gemini-api/docs/pricing.
export const IMAGE_MODELS = {
  'imagen-fast': { id: 'gemini-3.1-flash-lite-image', costPerImage: 0.0336 },
  'imagen-standard': { id: 'gemini-2.5-flash-image', costPerImage: 0.039 },
  'imagen-ultra': { id: 'gemini-3-pro-image', costPerImage: 0.134 },
} as const

// Gemini native image generation (Google GenAI SDK) — synchronous like
// Pollinations, no polling (unlike Veo's long-running video operations).
// Image comes back as an inline base64 part of a normal generateContent
// response, not a dedicated images array — uploaded to Cloudinary here to
// get a stable hosted URL, same as every other provider in this app.
//
// referenceImageUrl (optional): when set, fetches that image and sends it
// alongside the prompt as a second content part — Gemini's image models
// support this as image-conditioned generation/editing, letting a later
// scene say "same character, new scene: ..." and get a visually consistent
// result instead of an independently-generated one.
export async function generateWithGeminiImage(
  prompt: string,
  model: keyof typeof IMAGE_MODELS,
  cloudinary: typeof CloudinaryV2,
  folder: string,
  publicId: string,
  referenceImageUrl?: string
): Promise<string> {
  const { GoogleGenAI } = await import('@google/genai')
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! })

  let contents: string | Array<{ text?: string; inlineData?: { data: string; mimeType: string } }> = prompt
  if (referenceImageUrl) {
    const imgRes = await fetch(referenceImageUrl)
    if (imgRes.ok) {
      const buf = Buffer.from(await imgRes.arrayBuffer())
      contents = [
        { inlineData: { data: buf.toString('base64'), mimeType: imgRes.headers.get('content-type') ?? 'image/png' } },
        { text: `${prompt}. Keep the exact same character design and art style as the reference image — same face, same colors, same line style — just place them in this new scene.` },
      ]
    }
  }

  const result = await ai.models.generateContent({
    model: IMAGE_MODELS[model].id,
    contents,
  })

  const parts = result.candidates?.[0]?.content?.parts ?? []
  const imagePart = parts.find((p) => !!p.inlineData?.data)
  if (!imagePart?.inlineData?.data) {
    const textPart = parts.find((p) => p.text)?.text
    throw new Error(textPart ? `Model returned no image: ${textPart.slice(0, 200)}` : 'Model returned no image')
  }

  const dataUri = `data:${imagePart.inlineData.mimeType ?? 'image/png'};base64,${imagePart.inlineData.data}`
  const uploaded = await cloudinary.uploader.upload(dataUri, {
    resource_type: 'image',
    folder,
    public_id: publicId,
    format: 'png',
  })
  return uploaded.secure_url
}
