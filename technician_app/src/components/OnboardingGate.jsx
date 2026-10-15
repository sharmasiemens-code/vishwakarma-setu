import { useEffect, useState } from 'react'
import { apiRequest } from '../api/client'
import CompleteOnboarding from '../pages/CompleteOnboarding'

export default function OnboardingGate({ children, onLogout, onChangePassword }) {
  const [application, setApplication] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const data = await apiRequest('/auth/technician/application', {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (controller.signal.aborted) return
        setApplication(data.application)
        setError('')
        setLoading(false)
      } catch (err) {
        if (controller.signal.aborted) return
        setApplication(null)
        setError(err.message || 'Unable to check your application status.')
        setLoading(false)
      } finally {
        checking = false
      }
    }

    check()
    const interval = window.setInterval(check, 30000)
    return () => {
      controller.abort()
      window.clearInterval(interval)
    }
  }, [reload])

  if (!loading && application?.can_work) return children
  if (!loading && application?.onboarding_required && !application.application_id) return <CompleteOnboarding
    onLogout={onLogout} onSubmitted={() => { setLoading(true); setReload((value) => value + 1) }}
  />

  return (
    <div className="login-page">
      <section className="login-card" style={{ width: '100%', maxWidth: 560 }}>
        <h1>Vishwakarma Setu</h1>
        <h2>Technician Application</h2>

        {loading && <p role="status">Checking your application...</p>}
        {error && <p role="alert" className="dashboard-error">{error}</p>}

        {application && (
          <>
            <p>Hello, <strong>{application.full_name}</strong>.</p>
            <p>
              <strong>Status:</strong>{' '}
              {(application.application_status || 'KYC REVIEW').replaceAll('_', ' ')}
            </p>
            <p>Your account can receive work once the following checks are complete.</p>
            <ul style={{ textAlign: 'left' }}>
              <li>
                Phone verification: {application.phone_verified ? 'Complete' : 'Awaiting representative call'}
              </li>
              <li>
                KYC: {(application.kyc_status || 'PENDING').replaceAll('_', ' ')}
              </li>
              <li>
                Address verification: {application.address_verified ? 'Complete' : 'Pending'}
              </li>
              <li>
                Application approval: {application.application_status === 'APPROVED' ? 'Complete' : 'Pending review'}
              </li>
            </ul>
            {application.review_reason && (
              <div style={{ textAlign: 'left', whiteSpace: 'pre-wrap' }}>
                <strong>Review update:</strong>
                <p>{application.review_reason}</p>
              </div>
            )}
            <p>Our representative will contact you regarding verification and KYC.</p>
          </>
        )}

        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setError('')
            setReload((current) => current + 1)
          }}
          style={{ width: '100%', marginTop: 12 }}
        >
          Refresh Application Status
        </button>
        <button type="button" onClick={onChangePassword}>Change Password</button>
        <button
          type="button"
          onClick={onLogout}
          style={{ width: '100%', marginTop: 12 }}
        >
          Sign Out
        </button>
      </section>
    </div>
  )
}
