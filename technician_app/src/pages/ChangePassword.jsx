import { useState } from 'react'
import { apiRequest } from '../api/client'
import { logout } from '../auth/auth'

export default function ChangePassword({ onBack, onChanged }) {
  const [values, setValues] = useState({ current_password: '', new_password: '', confirm_password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (busy) return
    if (values.new_password !== values.confirm_password) {
      setError('New passwords do not match.'); return
    }
    setBusy(true); setError('')
    try {
      await apiRequest('/auth/change-password', { method: 'POST', body: JSON.stringify(values) })
      setValues({ current_password: '', new_password: '', confirm_password: '' })
      logout(); setDone(true)
    } catch (err) {
      setError(err.message || 'Unable to change password.')
      setValues((previous) => ({ ...previous, current_password: '' }))
    } finally { setBusy(false) }
  }

  return (
    <div className="login-page">
      <section className="login-card" style={{ maxWidth: 520, width: '100%' }}>
        <h1>Change Password</h1>
        {done ? <>
          <p role="status">Password changed. Please sign in with your new password.</p>
          <button type="button" onClick={onChanged}>Go to Login</button>
        </> : <>
          <p>Enter your current password. Forgotten it? Contact the administrator for a manual reset.</p>
          <p>Use 8–72 characters with a letter and a number (maximum 72 UTF-8 bytes).</p>
          <form onSubmit={submit}>
            {[
              ['current_password', 'Current password', 'current-password'],
              ['new_password', 'New password', 'new-password'],
              ['confirm_password', 'Confirm new password', 'new-password'],
            ].map(([key, label, autocomplete]) => (
              <label key={key} style={{ display: 'block', marginBottom: 16 }}>
                {label}
                <input type="password" autoComplete={autocomplete} required
                  minLength={key === 'current_password' ? 1 : 8}
                  maxLength={key === 'current_password' ? 128 : 72}
                  value={values[key]} disabled={busy}
                  onChange={(event) => setValues({ ...values, [key]: event.target.value })}
                  style={{ display: 'block', width: '100%', padding: 10 }} />
              </label>
            ))}
            {error && <p role="alert">{error}</p>}
            <button type="submit" disabled={busy}>{busy ? 'Changing…' : 'Change Password'}</button>
            <button type="button" disabled={busy} onClick={onBack}>Back</button>
          </form>
        </>}
      </section>
    </div>
  )
}
