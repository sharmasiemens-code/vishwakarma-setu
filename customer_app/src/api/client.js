const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('customer_access_token')

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  })

  let data

  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`

    if (Array.isArray(data?.detail)) {
      message = data.detail
        .map((item) => {
          if (typeof item === 'string') {
            return item
          }

          const location = Array.isArray(item.loc)
            ? item.loc.join(' → ')
            : ''

          return location
            ? `${location}: ${item.msg}`
            : item.msg || JSON.stringify(item)
        })
        .join('\n')
    } else if (typeof data?.detail === 'string') {
      message = data.detail
    } else if (data?.detail) {
      message = JSON.stringify(data.detail)
    }

    const error = new Error(message)
    error.status = response.status
    error.data = data

    throw error
  }

  return data
}

export { API_BASE_URL, apiRequest }