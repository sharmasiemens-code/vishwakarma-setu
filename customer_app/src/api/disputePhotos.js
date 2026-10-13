import { API_BASE_URL, apiRequest } from './client'
import { getToken } from '../auth/auth'
import { validatePhotoFile } from './photos'

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
  })
}

export function uploadDisputePhoto(disputeId, file, signal) {
  validatePhotoFile(file)
  return apiRequest(photoPath(disputeId), {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
    signal,
    cache: 'no-store',
  })
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

  const response = await fetch(
    `${API_BASE_URL}${photoPath(disputeId, photoId)}/content?variant=${variant}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal,
      cache: 'no-store',
    },
  )
  if (!response.ok) {
    let message = 'Unable to load this issue photo.'
    try {
      const data = await response.json()
      if (typeof data?.detail === 'string') message = data.detail
    } catch {
      // Keep the fallback for non-JSON responses.
    }
    const error = new Error(message)
    error.status = response.status
    throw error
  }
  const blob = await response.blob()
  if (blob.type !== 'image/jpeg') {
    throw new Error('Unexpected issue photo response.')
  }
  return blob
}
