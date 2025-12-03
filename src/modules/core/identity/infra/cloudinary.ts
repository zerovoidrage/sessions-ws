import crypto from 'crypto'

export interface AvatarUploadSignature {
  timestamp: number
  signature: string
  apiKey: string
  cloudName: string
  folder: string
}

export function getAvatarUploadSignature(userId: string): AvatarUploadSignature {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey = process.env.CLOUDINARY_API_KEY
  const apiSecret = process.env.CLOUDINARY_API_SECRET

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary env not configured')
  }

  const timestamp = Math.round(Date.now() / 1000)
  const folder = `rooms/avatars/${userId}`

  // Генерируем signature для upload
  const params: Record<string, string | number> = {
    timestamp,
    folder,
  }

  const paramsString = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&')

  const signature = crypto
    .createHash('sha1')
    .update(paramsString + apiSecret)
    .digest('hex')

  return {
    timestamp,
    signature,
    apiKey,
    cloudName,
    folder,
  }
}

