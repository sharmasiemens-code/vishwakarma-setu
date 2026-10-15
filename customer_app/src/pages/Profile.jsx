import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import { useLanguage } from '../../../shared/Experience'

export default function Profile({ onBack }) {
  const { t } = useLanguage()
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const lock = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/customers/me/profile', { signal: controller.signal, cache: 'no-store' })
      .then(({ profile: value }) => setProfile({ ...value, email: value.email || '', date_of_birth: value.date_of_birth || '' }))
      .catch((err) => { if (!controller.signal.aborted) setError(err.message) })
    return () => controller.abort()
  }, [retry])
  async function save(event) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true
    setBusy(true); setNotice(''); setError('')
    try {
      await apiRequest('/customers/me/profile', { method: 'PUT', body: JSON.stringify({
        full_name: profile.full_name.trim(), email: profile.email.trim() || null,
        date_of_birth: profile.date_of_birth || null,
      }) })
      setNotice(t('Profile saved. Your mobile number and password are unchanged.'))
    } catch (err) { setError(err.message) }
    finally { lock.current = false; setBusy(false) }
  }
  const change = (event) => { setProfile({ ...profile, [event.target.name]: event.target.value }); setNotice('') }
  return <div className="login-page"><section className="login-card">
    <h1>{t('Profile')}</h1>
    <p>{t('Email is an optional contact and sign-in address. Date of birth is optional private profile information; it is not shown to technicians. You can add or remove both later.')}</p>
    {error && <p role="alert">{error}</p>}
    {!profile ? <><p role="status">{t('Getting your details...')}</p><button onClick={() => { setError(''); setRetry(retry + 1) }}>{t('Retry')}</button></> : <form className="setu-form" onSubmit={save}>
      <label>{t('Full name')}<input name="full_name" autoComplete="name" value={profile.full_name} onChange={change} required minLength={2} maxLength={150} disabled={busy} /></label>
      <label>{t('Mobile number')}<input type="tel" value={profile.phone} readOnly /><small>Use Change Password to change your sign-in password.</small></label>
      <label>{t('Email (optional)')}<input name="email" type="email" autoComplete="email" maxLength={254} value={profile.email} onChange={change} disabled={busy} /></label>
      <label>{t('Date of birth (optional)')}<input name="date_of_birth" type="date" autoComplete="bday" value={profile.date_of_birth} onChange={change} disabled={busy} /></label>
      <button type="submit" disabled={busy}>{t(busy ? 'Saving...' : 'Save Profile')}</button>
    </form>}
    {notice && <p role="status">{notice}</p>}
    <div className="setu-actions"><button onClick={onBack} disabled={busy}>{t('Back')}</button></div>
  </section></div>
}
