import { apiRequest } from '../api/client'

const TOKEN_KEY = 'technician_access_token'
const USER_KEY = 'technician_user'

async function login(email, password) {
  const response = await apiRequest('/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
    }),
  })

  localStorage.setItem(TOKEN_KEY, response.access_token)

  const meResponse = await apiRequest('/auth/me')
  const tokenData = meResponse.token_data

  if (!tokenData || tokenData.role !== 'TECHNICIAN') {
    logout()
    throw new Error(
      'This account is not a technician account',
    )
  }

  const user = {
    id: tokenData.sub,
    role: tokenData.role,
    technician_id: tokenData.technician_id,
  }

  localStorage.setItem(USER_KEY, JSON.stringify(user))

  return {
    ...response,
    user,
  }
}

async function getCurrentUser() {
  const token = getToken()

  if (!token) {
    return null
  }

  try {
    const response = await apiRequest('/auth/me')
    const tokenData = response.token_data

    if (!tokenData || tokenData.role !== 'TECHNICIAN') {
      logout()
      return null
    }

    const user = {
      id: tokenData.sub,
      role: tokenData.role,
      technician_id: tokenData.technician_id,
    }

    localStorage.setItem(USER_KEY, JSON.stringify(user))

    return user
  } catch {
    logout()
    return null
  }
}

function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

function getUser() {
  const user = localStorage.getItem(USER_KEY)

  if (!user) {
    return null
  }

  try {
    return JSON.parse(user)
  } catch {
    return null
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}

function isAuthenticated() {
  return Boolean(getToken())
}

export {
  login,
  getCurrentUser,
  getToken,
  getUser,
  logout,
  isAuthenticated,
}

export async function registerTechnician(details) {
  const response = await apiRequest('/auth/register/technician', {
    method: 'POST',
    body: JSON.stringify(details),
  })
  if (
    typeof response?.access_token !== 'string'
    || !response.access_token
    || response?.user?.role !== 'TECHNICIAN'
    || !response.user.user_id
    || !response.user.technician_id
  ) {
    throw new Error(
      'Registration could not be confirmed. Try signing in with your mobile number and password.',
    )
  }

  const user = {
    id: response.user.user_id,
    role: response.user.role,
    technician_id: response.user.technician_id,
  }
  try {
    localStorage.setItem(TOKEN_KEY, response.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    logout()
    throw new Error(
      'Your application was saved, but your session could not be stored. Allow browser storage and sign in.',
    )
  }
  return { ...response, user }
}
