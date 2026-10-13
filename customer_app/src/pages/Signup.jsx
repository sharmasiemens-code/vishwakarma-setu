import { useRef, useState } from 'react'
import { registerCustomer } from '../auth/auth'

export default function Signup({ onBack, onRegistered }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operationLock = useRef(false)

  async function submit(event) {
    event.preventDefault()
    if (operationLock.current) return
    setError('')

    if (name.trim().length < 2) {
      setError('Please enter your full name.')
      return
    }
    if (!/^[6-9][0-9]{9}$/.test(phone)) {
      setError('Enter a valid ten-digit Indian mobile number.')
      return
    }
    if (
      password.length < 8
      || new TextEncoder().encode(password).length > 72
      || password !== password.trim()
      || !/\p{L}/u.test(password)
      || !/\p{N}/u.test(password)
      || Array.from(password).some(
        (character) => character.codePointAt(0) < 32
          || character.codePointAt(0) === 127,
      )
    ) {
      setError(
        'Use at least eight characters with a letter and a number. '
        + 'Do not begin or end your password with spaces.',
      )
      return
    }
    if (password !== confirmation) {
      setError('Your passwords do not match.')
      return
    }

    operationLock.current = true
    setBusy(true)

    try {
      const result = await registerCustomer({
        full_name: name.trim(),
        phone,
        password,
      })
      setPassword('')
      setConfirmation('')
      onRegistered(result.user)
    } catch (err) {
      setError(
        (err.message || 'Unable to create your account.')
        + ' If the connection was interrupted, try signing in before registering again.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>Vishwakarma Setu</h1>
        <p className="login-subtitle">Create your customer account</p>
        <p>Find skilled technicians near you. Register with your mobile number.</p>

        <form onSubmit={submit}>
          <label htmlFor="signup-name">Full name</label>
          <input
            id="signup-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={150}
            disabled={busy}
            required
          />

          <label htmlFor="signup-phone">Mobile number</label>
          <input
            id="signup-phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder="10-digit mobile number"
            value={phone}
            onChange={(event) => setPhone(
              event.target.value.replace(/[^0-9]/g, ''),
            )}
            maxLength={10}
            pattern="[6-9][0-9]{9}"
            disabled={busy}
            required
          />
          <p style={{ fontSize: 13 }}>
            Use your own mobile number. You will use it to sign in.
          </p>

          <label htmlFor="signup-password">Create password</label>
          <input
            id="signup-password"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            maxLength={72}
            disabled={busy}
            aria-describedby="signup-password-help"
            required
          />
          <p id="signup-password-help" style={{ fontSize: 13 }}>
            At least eight characters, including a letter and a number.
          </p>

          <label htmlFor="signup-confirmation">Confirm password</label>
          <input
            id="signup-confirmation"
            type={showPassword ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            maxLength={72}
            disabled={busy}
            required
          />

          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            aria-pressed={showPassword}
            disabled={busy}
            style={{ marginBottom: 16 }}
          >
            {showPassword ? 'Hide passwords' : 'Show passwords'}
          </button>

          {error && <p className="login-error" role="alert">{error}</p>}

          <button
            type="submit"
            className="primary-action"
            disabled={busy}
            style={{ width: '100%' }}
          >
            {busy ? 'Creating your account...' : 'Create Account and Continue'}
          </button>
        </form>

        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          style={{ width: '100%', marginTop: 16 }}
        >
          Already registered? Sign In
        </button>
      </div>
    </div>
  )
}
