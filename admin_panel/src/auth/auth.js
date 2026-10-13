import { apiRequest } from '../api/api'

const TOKEN_KEY = 'vishwakarma_setu_admin_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function isAuthenticated() {
  return Boolean(getToken())
}

export function logout() {
  localStorage.removeItem(TOKEN_KEY)
}

export function hasPermission(user, permissionCode) {
  return Array.isArray(user?.permissions)
    && user.permissions.includes(permissionCode)
}

async function loadAdminAccess(token) {
  const data = await apiRequest('/admin/access', {}, token)
  const admin = data?.admin

  if (
    admin?.role !== 'ADMIN'
    || !admin.admin_role
    || !Array.isArray(admin.permissions)
  ) {
    throw new Error('Unable to verify administrator permissions')
  }

  return admin
}

export async function login(email, password) {
  const data = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
    }),
  })

  if (data?.user?.role !== 'ADMIN' || !data.access_token) {
    throw new Error('Administrator access required')
  }

  try {
    const access = await loadAdminAccess(data.access_token)

    localStorage.setItem(TOKEN_KEY, data.access_token)

    return {
      ...data.user,
      ...access,
    }
  } catch (error) {
    logout()
    throw error
  }
}

export async function getCurrentAdmin() {
  const token = getToken()

  if (!token) {
    return null
  }

  try {
    const data = await apiRequest('/auth/me', {}, token)

    if (data?.token_data?.role !== 'ADMIN') {
      logout()
      return null
    }

    const access = await loadAdminAccess(token)

    return {
      ...data.token_data,
      ...access,
    }
  } catch {
    logout()
    return null
  }
}