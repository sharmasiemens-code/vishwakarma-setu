import { createContext, useContext, useEffect, useState } from 'react'
import Brand from './Brand'
import { hindi } from './messages'
import './experience.css'

const LanguageContext = createContext({ t: (key) => key, language: 'en' })
export function useLanguage() { return useContext(LanguageContext) }

export default function Experience({ children, role }) {
  const [language, setLanguage] = useState(() => {
    try { return localStorage.getItem('setu-language') === 'hi' ? 'hi' : 'en' } catch { return 'en' }
  })
  const [online, setOnline] = useState(navigator.onLine)
  const [expired, setExpired] = useState(false)
  const t = (key) => language === 'hi' ? hindi[key] || key : key
  useEffect(() => {
    document.documentElement.lang = language
    try { localStorage.setItem('setu-language', language) } catch { /* Language still works in memory. */ }
  }, [language])
  useEffect(() => {
    const connected = () => setOnline(true)
    const disconnected = () => setOnline(false)
    const sessionExpired = () => setExpired(true)
    window.addEventListener('online', connected)
    window.addEventListener('offline', disconnected)
    window.addEventListener('setu-session-expired', sessionExpired)
    return () => {
      window.removeEventListener('online', connected)
      window.removeEventListener('offline', disconnected)
      window.removeEventListener('setu-session-expired', sessionExpired)
    }
  }, [])
  return <LanguageContext.Provider value={{ language, t }}>
    <a href="#setu-content" className="setu-skip">Skip to content / मुख्य भाग पर जाएँ</a>
    <header className="setu-topbar"><Brand /><div className="setu-topbar-actions">
      <span className="setu-role">{role}</span>
      <button type="button" onClick={() => setLanguage(language === 'en' ? 'hi' : 'en')} aria-label="Change language / भाषा बदलें">
        {language === 'en' ? 'हिन्दी' : 'English'}
      </button>
    </div></header>
    {!online && <div className="setu-banner" role="status">{t('No connection. You can read this screen; reconnect before saving or submitting.')}</div>}
    {expired ? <section className="setu-empty" role="alert"><h1>{t('Your session expired. Sign in again to continue.')}</h1><button onClick={() => window.location.reload()}>{t('Sign In')}</button></section>
      : <div id="setu-content" tabIndex={-1}>{children}</div>}
    <footer className="setu-footer">Vishwakarma Setu · {language === 'hi' ? 'स्थानीय हुनर, आपके पास' : 'Skilled local help, connected to you'}</footer>
  </LanguageContext.Provider>
}
