import { API_BASE_URL, apiRequest } from './client'
import { getToken } from '../auth/auth'

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function photoPath(requestId, photoId) {
  if (!UUID_PATTERN.test(String(requestId))) {
    throw new Error('Invalid service request ID')
  }
  const base = `/service-requests/${requestId}/photos`
  if (photoId === undefined) return base
  if (!UUID_PATTERN.test(String(photoId))) {
    throw new Error('Invalid photo ID')
  }
  return `${base}/${photoId}`
}

export function listRequestPhotos(requestId, signal) {
  return apiRequest(photoPath(requestId), {
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
  if (!token) throw new Error('Please sign in to view work photos.')

  const path = `${photoPath(requestId, photoId)}/content?variant=${variant}`
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = 'Unable to load this work photo.'
    try {
      const data = await response.json()
      if (typeof data?.detail === 'string') message = data.detail
    } catch {
      // Retain a readable fallback.
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }

  const blob = await response.blob()
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(blob.type)) {
    throw new Error('Unexpected photo response.')
  }
  return blob
}
