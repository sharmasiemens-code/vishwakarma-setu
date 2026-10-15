import { requestJson } from '../../../shared/http'
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
export async function apiRequest(path, options = {}, token = null) {
  return requestJson(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) },
  }, () => {
    if (token && localStorage.getItem('vishwakarma_setu_admin_token') === token) {
      localStorage.removeItem('vishwakarma_setu_admin_token')
      window.dispatchEvent(new Event('setu-session-expired'))
    }
  })
}
