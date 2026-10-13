import { API_BASE_URL, apiRequest } from './client'
import { getToken } from '../auth/auth'

export const MAX_REQUEST_PHOTOS = 5
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
])

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function photoPath(requestId, photoId) {
  if (!UUID_PATTERN.test(String(requestId))) {
    throw new Error('Invalid service request ID')
  }

  const base = `/service-requests/${requestId}/photos`
  if (photoId === undefined) {
    return base
  }

  if (!UUID_PATTERN.test(String(photoId))) {
    throw new Error('Invalid photo ID')
  }

  return `${base}/${photoId}`
}

export function validatePhotoFile(file) {
  if (!(file instanceof File)) {
    throw new Error('Please select an image file.')
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Choose a JPEG, PNG or WebP image.')
  }
  if (file.size < 1) {
    throw new Error('The selected image is empty.')
  }
  if (file.size > MAX_PHOTO_BYTES) {
    throw new Error('Each image must be no larger than 5 MiB.')
  }
  return file
}

export function listRequestPhotos(requestId, signal) {
  return apiRequest(photoPath(requestId), {
    signal,
    cache: 'no-store',
  })
}

export function uploadRequestPhoto(requestId, file, signal) {
  validatePhotoFile(file)
  return apiRequest(photoPath(requestId), {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
    signal,
    cache: 'no-store',
  })
}

export function deleteRequestPhoto(requestId, photoId, signal) {
  return apiRequest(photoPath(requestId, photoId), {
    method: 'DELETE',
    signal,
    cache: 'no-store',
  })
}

export async function fetchRequestPhoto(
  requestId,
  photoId,
  variant = 'thumbnail',
  signal,
) {
  if (!['image', 'thumbnail'].includes(variant)) {
    throw new Error('Invalid photo variant')
  }

  const token = getToken()
  if (!token) {
    throw new Error('Please sign in to view request photos.')
  }

  const path = `${photoPath(requestId, photoId)}/content?variant=${variant}`
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = 'Unable to load this photo.'
    try {
      const data = await response.json()
      if (typeof data?.detail === 'string') {
        message = data.detail
      }
    } catch {
      // Keep the readable fallback when the response is not JSON.
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }

  const blob = await response.blob()
  if (!ALLOWED_TYPES.has(blob.type)) {
    throw new Error('Unexpected photo response.')
  }
  return blob
}
