import { useEffect, useState } from 'react'
import Login from './pages/Login'
import ChangePassword from './pages/ChangePassword'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import Earnings from './pages/Earnings'
import Ratings from './pages/Ratings'
import OnboardingGate from './components/OnboardingGate'
import {
  getCurrentUser,
  isAuthenticated,
  logout,
} from './auth/auth'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [sessionError, setSessionError] = useState('')
  const [ratingJob, setRatingJob] = useState(null)
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

      let currentUser
      try { currentUser = await getCurrentUser() }
      catch (error) { if (!cancelled) { setSessionError(error.message); setCheckingAuth(false) }; return }

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

  function handleLogin(loggedInUser) {
    setUser(loggedInUser)
    setPage('dashboard')
  }

  function handleLogout() {
    logout()
    setUser(null)
    setPage('dashboard')
  }

  if (sessionError) return <section className="setu-empty" role="alert"><p>{sessionError}</p><p>Your session is saved. Reconnect and retry.</p><button onClick={() => window.location.reload()}>Retry</button></section>

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

  if (page === 'ratings') return <OnboardingGate onLogout={handleLogout} onChangePassword={() => setPage('change-password')}><Ratings jobId={ratingJob} onBack={() => setPage('dashboard')} /></OnboardingGate>

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
        onViewRatings={(jobId) => { setRatingJob(jobId || null); setPage('ratings') }}
      />
    </OnboardingGate>
  )
}

export default App