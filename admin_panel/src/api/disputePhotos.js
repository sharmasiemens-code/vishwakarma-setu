import { apiRequest } from './api'
const API_BASE_URL = 'http://127.0.0.1:8000'
import { getToken } from '../auth/auth'

const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i

function photoPath(disputeId, photoId) {
  if (!UUID_PATTERN.test(String(disputeId))) {
    throw new Error('Invalid dispute ID')
  }
  const base = `/disputes/${disputeId}/photos`
  if (photoId === undefined) return base
  if (!UUID_PATTERN.test(String(photoId))) {
    throw new Error('Invalid photo ID')
  }
  return `${base}/${photoId}`
}

export function listDisputePhotos(disputeId, signal) {
  return apiRequest(photoPath(disputeId), {
    signal,
    cache: 'no-store',
  }, getToken())
}

export async function fetchDisputePhoto(
  disputeId,
  photoId,
  variant = 'thumbnail',
  signal,
) {
  if (!['image', 'thumbnail'].includes(variant)) {
    throw new Error('Invalid photo variant')
  }
  const token = getToken()
  if (!token) throw new Error('Please sign in to view issue photos.')

  const path = `${photoPath(disputeId, photoId)}/content?variant=${variant}`
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal,
    cache: 'no-store',
  })

  if (!response.ok) {
    let message = 'Unable to load this issue photo.'
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
