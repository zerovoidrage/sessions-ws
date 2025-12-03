import { getAvatarUploadSignature } from '../infra/cloudinary'

export async function getAvatarUploadSignatureEndpoint(userId: string) {
  return getAvatarUploadSignature(userId)
}

