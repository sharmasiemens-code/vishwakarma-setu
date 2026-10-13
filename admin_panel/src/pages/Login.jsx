import { useState } from 'react'
import { login } from '../auth/auth'

function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()

    setError('')
    setLoading(true)

    try {
      const user = await login(email.trim(), password)
      onLogin(user)
    } catch (err) {
      setError(err.message || 'Unable to sign in')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-login-page">
      <div className="admin-login-brand">
        <div className="brand-name">
          <span>♨</span> VISHWAKARMA SETU
        </div>

        <h1>Admin Control Center</h1>

        <p>
          Manage technicians, customers, service requests,
          jobs and marketplace operations.
        </p>
      </div>

      <div className="admin-login-card">
        <div className="login-heading">
          <span className="login-badge">SECURE ADMIN ACCESS</span>
          <h2>Administrator Login</h2>
          <p>
            Sign in with an authorized administrator account.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <label htmlFor="admin-email">
            Email Address
          </label>

          <input
            id="admin-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="admin@example.com"
            autoComplete="username"
            required
          />

          <label htmlFor="admin-password">
            Password
          </label>

          <input
            id="admin-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Enter your password"
            autoComplete="current-password"
            required
          />

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <button
            type="submit"
            className="primary-button login-button"
            disabled={loading}
          >
            {loading ? 'Signing in...' : 'Sign In to Admin'}
          </button>
        </form>

        <div className="security-note">
          Protected administrator area
        </div>
      </div>
    </div>
  )
}

export default Login