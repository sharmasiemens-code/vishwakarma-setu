import { useEffect, useState } from 'react'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import {
  getCurrentAdmin,
  isAuthenticated,
  logout,
} from './auth/auth'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
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

      const currentAdmin =
        await getCurrentAdmin()

      if (!cancelled) {
        setUser(currentAdmin)
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
  }

  function handleLogout() {
    logout()
    setUser(null)
  }

  if (checkingAuth) {
    return (
      <div className="app-loading">
        Checking administrator session...
      </div>
    )
  }

  if (!user) {
    return <Login onLogin={handleLogin} />
  }

  return (
    <Dashboard
      user={user}
      onLogout={handleLogout}
    />
  )
}

export default App