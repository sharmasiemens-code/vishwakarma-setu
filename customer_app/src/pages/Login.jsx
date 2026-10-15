import { useRef, useState } from 'react'
import { login } from '../auth/auth'
import { useLanguage } from '../../../shared/Experience'

export default function Login({ onLogin, onSignup }) {
  const { t, language } = useLanguage()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function submit(event) {
    event.preventDefault()
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { const result = await login(identifier.trim(), password); onLogin(result.user) }
    catch (err) { setError(err.message || 'Unable to sign in. Please retry.') }
    finally { lock.current = false; setBusy(false) }
  }
  return <div className="login-page"><section className="login-card" style={{ margin: '0 auto' }}>
    <p className="setu-portal">Customer Portal</p>
    <h1>{t('Sign In')}</h1>
    <p>{language === 'hi' ? 'अपने मोबाइल नंबर या ईमेल और पासवर्ड से साइन इन करें।' : 'Use your mobile number or email and your password.'}</p>
    <form className="setu-form" onSubmit={submit}>
      <label>{language === 'hi' ? 'मोबाइल नंबर या ईमेल' : 'Mobile number or email'}<input type="text" autoComplete="username" required maxLength={255} value={identifier} onChange={(event) => setIdentifier(event.target.value)} disabled={busy} autoCapitalize="none" spellCheck={false} /></label>
      <label>{language === 'hi' ? 'पासवर्ड' : 'Password'}<input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>
      <button type="button" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{t(showPassword ? 'Hide passwords' : 'Show passwords')}</button>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>{t(busy ? 'Saving...' : 'Sign In')}</button>
    </form>
    <div className="setu-actions"><button type="button" onClick={onSignup} disabled={busy}>{language === 'hi' ? 'नया खाता बनाएँ' : 'Create Customer Account'}</button></div>
    <p><small>{language === 'hi' ? 'पासवर्ड भूल गए? सहायता के लिए अपने प्लेटफ़ॉर्म प्रतिनिधि से संपर्क करें।' : 'Forgot your password? Contact your platform representative for account recovery.'}</small></p>
  </section></div>
}
