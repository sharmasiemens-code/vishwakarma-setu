const API_BASE_URL = 'http://127.0.0.1:8000'

export async function apiRequest(
  path,
  options = {},
  token = null,
) {
  const headers = {
    ...(options.body
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(options.headers || {}),
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  const response = await fetch(
    `${API_BASE_URL}${path}`,
    {
      ...options,
      headers,
    },
  )

  const data = await response
    .json()
    .catch(() => null)

  if (!response.ok) {
    const message =
      data?.detail ||
      data?.message ||
      `Request failed with status ${response.status}`

    const error = new Error(message)
    error.status = response.status
    throw error
  }

  return data
}