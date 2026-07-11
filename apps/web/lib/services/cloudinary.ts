import { v2 as cloudinary } from 'cloudinary'

function ensureConfigured() {
  if (!process.env.CLOUDINARY_CLOUD_NAME) throw new Error('CLOUDINARY_CLOUD_NAME is not set')
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  })
}

export type CloudinaryResourceType = 'video' | 'image' | 'raw' | 'auto'

export async function uploadBuffer(
  buffer: Buffer,
  options: {
    folder: string
    publicId?: string
    resourceType?: CloudinaryResourceType
    tags?: string[]
    transformation?: object[]
  }
): Promise<{ url: string; publicId: string; bytes: number; duration?: number }> {
  ensureConfigured()

  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder: options.folder,
        public_id: options.publicId,
        resource_type: options.resourceType ?? 'auto',
        tags: options.tags,
        transformation: options.transformation,
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Cloudinary upload failed'))
        resolve({
          url: result.secure_url,
          publicId: result.public_id,
          bytes: result.bytes,
          duration: result.duration,
        })
      }
    )
    uploadStream.end(buffer)
  })
}

export async function uploadFromUrl(
  url: string,
  options: {
    folder: string
    publicId?: string
    resourceType?: CloudinaryResourceType
    tags?: string[]
  }
): Promise<{ url: string; publicId: string; bytes: number; duration?: number }> {
  ensureConfigured()

  const result = await cloudinary.uploader.upload(url, {
    folder: options.folder,
    public_id: options.publicId,
    resource_type: options.resourceType ?? 'auto',
    tags: options.tags,
  })
  return {
    url: result.secure_url,
    publicId: result.public_id,
    bytes: result.bytes,
    duration: result.duration,
  }
}

export async function deleteResource(
  publicId: string,
  resourceType: CloudinaryResourceType = 'image'
): Promise<void> {
  ensureConfigured()
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType })
}

export async function concatVideos(
  publicIds: string[],
  outputFolder: string,
  outputPublicId: string
): Promise<{ url: string; publicId: string }> {
  ensureConfigured()
  if (publicIds.length === 0) throw new Error('No video public IDs provided')

  // Build transformation to concatenate multiple video segments
  const transformation = publicIds.slice(1).map((pid) => ({
    overlay: { resource_type: 'video', public_id: pid },
    flags: 'splice',
  }))

  const result = await cloudinary.uploader.explicit(publicIds[0]!, {
    type: 'upload',
    resource_type: 'video',
    eager: [{ transformation }],
    eager_async: false,
  })

  const finalUrl = result.eager?.[0]?.secure_url ?? result.secure_url
  return { url: finalUrl, publicId: result.public_id }
}

export async function overlayAudioOnVideo(
  videoPublicId: string,
  audioPublicId: string,
  outputFolder: string
): Promise<{ url: string }> {
  ensureConfigured()

  const url = cloudinary.url(videoPublicId, {
    resource_type: 'video',
    transformation: [
      {
        overlay: `${audioPublicId.replace(/\//g, ':')}`,
        resource_type: 'video',
        flags: 'layer_apply',
      },
    ],
    format: 'mp4',
  })

  return { url }
}

export function getSignedUploadParams(
  folder: string,
  resourceType: CloudinaryResourceType = 'auto'
): { signature: string; timestamp: number; apiKey: string; cloudName: string; folder: string } {
  ensureConfigured()
  const timestamp = Math.round(Date.now() / 1000)
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, folder },
    process.env.CLOUDINARY_API_SECRET!
  )
  return {
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY!,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME!,
    folder,
  }
}
