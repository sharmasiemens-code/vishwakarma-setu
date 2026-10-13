import { useEffect, useState } from 'react'
import Login from './pages/Login'
import Signup from './pages/Signup'
import Dashboard from './pages/Dashboard'
import CreateServiceRequest from './pages/CreateServiceRequest'
import MyServiceRequests from './pages/MyServiceRequests'
import ServiceRequestDetail from './pages/ServiceRequestDetail'
import {
  getCurrentUser,
  isAuthenticated,
} from './auth/auth'
import './App.css'

function App() {
  const [user, setUser] = useState(null)
  const [checkingAuth, setCheckingAuth] =
    useState(true)

  const [currentPage, setCurrentPage] =
    useState('dashboard')

  const [selectedRequestId, setSelectedRequestId] =
    useState(null)

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

  function handleLogin(loggedInUser) {
    setUser(loggedInUser)
    setCurrentPage('dashboard')
    setSelectedRequestId(null)
  }

  function handleLogout() {
    setUser(null)
    setCurrentPage('dashboard')
    setSelectedRequestId(null)
  }

  function handleCreateRequest() {
    setCurrentPage('create-request')
  }

  function handleViewRequests() {
    setCurrentPage('my-requests')
  }

  /*
   * Dashboard "Find a Technician" now opens
   * My Service Requests where the customer can
   * select an existing request and find a technician.
   */
  function handleFindTechnician() {
    setCurrentPage('my-requests')
  }

  /*
   * Open a specific service request.
   */
  function handleSelectRequest(requestId) {
    setSelectedRequestId(requestId)
    setCurrentPage('request-detail')
  }

  function handleRequestCreated(data) {
    const requestId = data?.service_request?.id
      || data?.request?.id
      || data?.request_id
      || data?.id

    if (!requestId) {
      throw new Error(
        'The request was created but its ID was not returned. '
        + 'Open My Requests to find it; do not create another request.',
      )
    }

    setSelectedRequestId(requestId)
    setCurrentPage('request-matches')
  }

  function handleBackToDashboard() {
    setCurrentPage('dashboard')
    setSelectedRequestId(null)
  }

  function handleBackToRequests() {
    setCurrentPage('my-requests')
    setSelectedRequestId(null)
  }

  if (checkingAuth) {
    return (
      <div className="dashboard-message">
        Checking your session...
      </div>
    )
  }

  if (!user) {
    if (currentPage === 'signup') {
      return (
        <Signup
          onBack={() => setCurrentPage('dashboard')}
          onRegistered={(registeredUser) => {
            setUser(registeredUser)
            setSelectedRequestId(null)
            setCurrentPage('create-request')
          }}
        />
      )
    }

    return (
      <Login
        onLogin={handleLogin}
        onSignup={() => setCurrentPage('signup')}
      />
    )
  }

  if (currentPage === 'create-request') {
    return (
      <CreateServiceRequest
        onBack={handleBackToDashboard}
        onCreated={handleRequestCreated}
      />
    )
  }

  if (currentPage === 'my-requests') {
    return (
      <MyServiceRequests
        onBack={handleBackToDashboard}
        onSelectRequest={handleSelectRequest}
      />
    )
  }

  if (
    ['request-detail', 'request-matches'].includes(currentPage) &&
    selectedRequestId
  ) {
    return (
      <ServiceRequestDetail
        key={selectedRequestId}
        requestId={selectedRequestId}
        focusMatches={currentPage === 'request-matches'}
        onBack={handleBackToRequests}
      />
    )
  }

  return (
    <Dashboard
      user={user}
      onLogout={handleLogout}
      onCreateRequest={handleCreateRequest}
      onViewRequests={handleViewRequests}
      onFindTechnician={handleFindTechnician}
      onSelectRequest={handleSelectRequest}
    />
  )
}

export default App