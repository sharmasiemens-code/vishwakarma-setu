import { useState } from 'react'
import { login } from '../auth/auth'

function Login({ onLogin, onSignup }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')

    if (!email.trim()) {
      setError('Please enter your mobile number or email')
      return
    }

    if (!password) {
      setError('Please enter your password')
      return
    }

    setSubmitting(true)

    try {
      const result = await login(email.trim(), password)

      if (onLogin) {
        onLogin(result.user)
      }
    } catch (err) {
      setError(
        err.message ||
          'Unable to login. Please check your credentials.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="login-page"
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        background:
          'linear-gradient(135deg, #f8fafc 0%, #eef2ff 50%, #f8fafc 100%)',
        boxSizing: 'border-box',
      }}
    >
      <div
        className="login-card"
        style={{
          width: '100%',
          maxWidth: '430px',
          padding: '36px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: '20px',
          boxShadow: '0 20px 50px rgba(15, 23, 42, 0.12)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: '28px' }}>
          <div
            style={{
              width: '64px',
              height: '64px',
              margin: '0 auto 16px',
              borderRadius: '18px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#eef2ff',
              fontSize: '32px',
            }}
            aria-hidden="true"
          >
            🔱
          </div>

          <h1
            style={{
              margin: 0,
              fontSize: '36px',
              lineHeight: 1.1,
              fontWeight: '800',
              letterSpacing: '-1px',
            }}
          >
            Vishwakarma Setu
          </h1>

          <p
            className="login-subtitle"
            style={{
              margin: '10px 0 0',
              color: '#64748b',
              fontSize: '16px',
              fontWeight: '600',
            }}
          >
            Customer Portal
          </p>

          <p
            style={{
              margin: '6px 0 0',
              color: '#94a3b8',
              fontSize: '13px',
            }}
          >
            Connect • Serve • Grow
          </p>
        </div>

        {error && (
          <div
            className="dashboard-error"
            role="alert"
            style={{
              marginBottom: '18px',
              padding: '12px 14px',
              borderRadius: '10px',
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <label
            style={{
              display: 'block',
              marginBottom: '16px',
              color: '#334155',
              fontWeight: '600',
            }}
          >
            Mobile number or email
            <input
              type="text"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter mobile number or email"
              disabled={submitting}
              autoComplete="username"
              required
              style={{
                width: '100%',
                marginTop: '7px',
                padding: '12px 13px',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                boxSizing: 'border-box',
                fontSize: '15px',
                background: '#fff',
              }}
            />
          </label>

          <label
            style={{
              display: 'block',
              marginBottom: '20px',
              color: '#334155',
              fontWeight: '600',
            }}
          >
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              disabled={submitting}
              autoComplete="current-password"
              required
              style={{
                width: '100%',
                marginTop: '7px',
                padding: '12px 13px',
                border: '1px solid #cbd5e1',
                borderRadius: '10px',
                boxSizing: 'border-box',
                fontSize: '15px',
                background: '#fff',
              }}
            />
          </label>

          <button
            type="submit"
            className="primary-action"
            disabled={submitting}
            style={{
              width: '100%',
              padding: '13px 16px',
              borderRadius: '10px',
              fontSize: '15px',
              fontWeight: '700',
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            {submitting
              ? 'Signing in...'
              : 'Sign in to Customer Portal'}
          </button>

        <p>Forgot your password? Contact the administrator for a manual reset.</p>
          </form>

        <div style={{ marginTop: 20, textAlign: 'center' }}>
          <p style={{ color: '#64748b', fontSize: 14 }}>
            New to Vishwakarma Setu?
          </p>
          <button
            type="button"
            onClick={onSignup}
            disabled={submitting}
            style={{
              width: '100%',
              padding: '12px 16px',
              border: '1px solid #cbd5e1',
              borderRadius: 10,
              background: '#ffffff',
              color: '#176b78',
              fontSize: 15,
              fontWeight: 700,
              cursor: submitting ? 'not-allowed' : 'pointer',
            }}
          >
            Create Customer Account
          </button>
        </div>

        <div
          style={{
            marginTop: '24px',
            paddingTop: '18px',
            borderTop: '1px solid #e2e8f0',
            textAlign: 'center',
            color: '#94a3b8',
            fontSize: '12px',
          }}
        >
          Vishwakarma Setu • Tech Expert Marketplace
        </div>
      </div>
    </div>
  )
}

export default Login
