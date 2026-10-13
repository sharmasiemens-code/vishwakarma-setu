import { Capacitor } from '@capacitor/core'
import { App as NativeApp } from '@capacitor/app'
import { useEffect, useState } from 'react'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Earnings from './pages/Earnings'
import OnboardingGate from './components/OnboardingGate'
import {
  getCurrentUser,
  isAuthenticated,
  logout,
} from './auth/auth'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [page, setPage] = useState('dashboard')
  const [checkingAuth, setCheckingAuth] =
    useState(true)

  useEffect(() => {
    let cancelled = false

    async function verifySession() {
      if (!isAuthenticated()) {
        if (!cancelled) {
          setCheckingAuth(false)
        }

        return
      }

      const currentUser = await getCurrentUser()

      if (!cancelled) {
        setUser(currentUser)
        setCheckingAuth(false)
      }
    }

    verifySession()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    let disposed = false
    const listeners = []
    async function listen() {
      const back = await NativeApp.addListener('backButton', () => {
        const dialog = document.querySelector('[role="dialog"]')
        if (dialog) {
          dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
          return
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        if (page !== 'dashboard') setPage('dashboard')
        else if (window.confirm('Exit Vishwakarma Setu Technician?')) NativeApp.exitApp()
      })
      if (disposed) await back.remove()
      else listeners.push(back)
      const state = await NativeApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) window.dispatchEvent(new Event('technician-app-resumed'))
      })
      if (disposed) await state.remove()
      else listeners.push(state)
    }
    listen().catch(() => { /* Native registration can be retried on remount. */ })
    return () => { disposed = true; listeners.forEach((listener) => listener.remove()) }
  }, [page])

  function handleLogin(loggedInUser) {
    setUser(loggedInUser)
    setPage('dashboard')
  }

  function handleLogout() {
    logout()
    setUser(null)
    setPage('dashboard')
  }

  if (checkingAuth) {
    return (
      <div className="dashboard-message">
        Checking your session...
      </div>
    )
  }

  if (!user) {
    if (page === 'signup') {
      return (
        <Signup
          onBack={() => setPage('dashboard')}
          onRegistered={handleLogin}
        />
      )
    }
    return (
      <Login
        onLogin={handleLogin}
        onSignup={() => setPage('signup')}
      />
    )
  }

  if (page === 'change-password') {
    return <ChangePassword onBack={() => setPage('dashboard')} onChanged={handleLogout} />
  }

  if (page === 'earnings') {
    return (
      <OnboardingGate onLogout={handleLogout} onChangePassword={() => setPage('change-password')}>
        <Earnings onBack={() => setPage('dashboard')} />
      </OnboardingGate>
    )
  }

  return (
    <OnboardingGate onLogout={handleLogout} onChangePassword={() => setPage('change-password')}>
      <Dashboard
        user={user}
        onChangePassword={() => setPage('change-password')}
        onLogout={handleLogout}
        onViewEarnings={() => setPage('earnings')}
      />
    </OnboardingGate>
  )
}

export default App