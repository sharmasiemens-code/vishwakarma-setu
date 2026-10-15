import { requestJson } from '../../../shared/http'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

async function apiRequest(path, options = {}) {
  const token = localStorage.getItem('technician_access_token')
  const authenticating = path === '/auth/login' || path.startsWith('/auth/register/')
  return requestJson(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token && !authenticating ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  }, () => {
    if (token && !authenticating && localStorage.getItem('technician_access_token') === token) {
      localStorage.removeItem('technician_access_token')
      localStorage.removeItem('technician_user')
      window.dispatchEvent(new Event('setu-session-expired'))
    }
  })
}
export { API_BASE_URL, apiRequest }
