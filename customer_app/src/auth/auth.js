import { apiRequest } from '../api/client'

const TOKEN_KEY = 'customer_access_token'
const USER_KEY = 'customer_user'

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

  if (!tokenData || tokenData.role !== 'CUSTOMER') {
    logout()
    throw new Error('This account is not a customer account')
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

    if (!tokenData || tokenData.role !== 'CUSTOMER') {
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

export async function registerCustomer({ full_name, phone, password }) {
  const response = await apiRequest('/auth/register/customer', {
    method: 'POST',
    body: JSON.stringify({ full_name, phone, password }),
  })

  if (
    typeof response?.access_token !== 'string'
    || !response.access_token
    || response?.user?.role !== 'CUSTOMER'
    || !response.user.user_id
  ) {
    throw new Error(
      'Your registration response could not be confirmed. '
      + 'Try signing in with your mobile number and password.',
    )
  }

  const user = {
    id: response.user.user_id,
    role: response.user.role,
    technician_id: null,
  }

  try {
    localStorage.setItem(TOKEN_KEY, response.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(user))
  } catch {
    logout()
    throw new Error(
      'Your account was created, but this browser could not save your session. '
      + 'Allow browser storage and sign in.',
    )
  }

  return { ...response, user }
}
