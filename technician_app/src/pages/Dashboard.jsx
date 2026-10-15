import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import { useLanguage } from '../../../shared/Experience'
import IncomingJobs from './IncomingJobs'
import ManualLocation from '../components/ManualLocation'
import JobPhotos from '../components/JobPhotos'
import StartWorkPin from '../components/StartWorkPin'
import CompleteWork from '../components/CompleteWork'

const LOCATION_INTERVAL_MS = 5 * 60 * 1000
const NOTIFICATION_INTERVAL_MS = 15 * 1000

function Dashboard({ user, onLogout, onViewEarnings, onChangePassword, onViewRatings }) {
  const { t } = useLanguage()
  const [dashboard, setDashboard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationMessage, setLocationMessage] = useState('')
  const [jobStatusLoading, setJobStatusLoading] = useState(false)

  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationLoading, setNotificationLoading] = useState(false)

  const notificationBellRef = useRef(null)
  const actionLock = useRef(false)
  const manualLocation = useRef(false)
  const locationLock = useRef(false)
  const ratingNotification = useRef(null)

  function closeNotifications() {
    setNotificationsOpen(false)
    notificationBellRef.current?.focus()
  }

  useEffect(() => {
    if (!notificationsOpen) return

    function handleEscape(event) {
      if (event.key === 'Escape') {
        setNotificationsOpen(false)
        notificationBellRef.current?.focus()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [notificationsOpen])

  const loadDashboard = useCallback(async () => {
    try {
      const [data, ratings] = await Promise.all([apiRequest('/technicians/me/dashboard'), apiRequest('/ratings/me?limit=1')])
      if (data.dashboard?.profile) { data.dashboard.profile.rating_average = ratings.rating_average; data.dashboard.profile.review_count = ratings.total_reviews }
      setDashboard(data.dashboard || null)
      setError('')
    } catch (err) {
      setError(err.message || 'Unable to load technician dashboard.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadNotifications = useCallback(async (silent = false) => {
    if (!silent) {
      setNotificationLoading(true)
    }

    try {
      const [notificationData, unreadData] = await Promise.all([
        apiRequest('/notifications'),
        apiRequest('/notifications/unread-count'),
      ])

      const latestRating = notificationData.notifications?.find((item) => item.notification_type === 'RATING_RECEIVED')
      if (latestRating && ratingNotification.current !== latestRating.id) {
        ratingNotification.current = latestRating.id
        loadDashboard()
      }
      setNotifications(notificationData.notifications || [])
      setUnreadCount(
        unreadData.unread_count ??
          unreadData.count ??
          notificationData.unread_count ??
          0,
      )
    } catch (err) {
      if (!silent && err.status !== 401) {
        setError(err.message || 'Unable to load notifications.')
      }
    } finally {
      if (!silent) {
        setNotificationLoading(false)
      }
    }
  }, [loadDashboard])

  async function markNotificationRead(notificationId) {
    if (!notificationId) return

    try {
      await apiRequest(`/notifications/${notificationId}/read`, {
        method: 'POST',
      })
      await loadNotifications(true)
    } catch (err) {
      setError(err.message || 'Unable to mark notification as read.')
    }
  }

  async function markAllNotificationsRead() {
    try {
      await apiRequest('/notifications/read-all', {
        method: 'POST',
      })
      await loadNotifications(true)
    } catch (err) {
      setError(err.message || 'Unable to mark notifications as read.')
    }
  }

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      loadDashboard()
      loadNotifications(true)
    }, 0)

    const notificationIntervalId = window.setInterval(() => {
      loadNotifications(true)
    }, NOTIFICATION_INTERVAL_MS)

    return () => {
      window.clearTimeout(timerId)
      window.clearInterval(notificationIntervalId)
    }
  }, [loadDashboard, loadNotifications])

  async function updateLocation() {
    if (locationLock.current) return false
    if (!navigator.geolocation) {
      setLocationMessage('Geolocation is not supported by this browser.')
      return false
    }

    locationLock.current = true
    setLocationLoading(true)
    setLocationMessage('Getting your current location...')
    setError('')

    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          {
            enableHighAccuracy: true,
            timeout: 15000,
            maximumAge: 0,
          },
        )
      })

      let batteryPercent = null

      if ('getBattery' in navigator) {
        try {
          const battery = await navigator.getBattery()
          batteryPercent = Math.round(battery.level * 100)
        } catch {
          batteryPercent = null
        }
      }

      const data = await apiRequest('/technicians/me/location', {
        method: 'POST',
        body: JSON.stringify({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy_meters: position.coords.accuracy,
          battery_percent: batteryPercent,
        }),
      })

      setLocationMessage(
        data.message || 'Location updated successfully.',
      )

      return true
    } catch (err) {
      if (err?.code === 1) {
        setLocationMessage(
          'Location permission was denied. Use Manual location below, or enable location in your browser settings.',
        )
      } else if (err?.code === 2) {
        setLocationMessage('Unable to determine your current location.')
      } else if (err?.code === 3) {
        setLocationMessage('Location request timed out. Please try again.')
      } else {
        setLocationMessage(
          err.message || 'Unable to update your location.',
        )
      }

      return false
    } finally {
      locationLock.current = false
      setLocationLoading(false)
    }
  }

  useEffect(() => {


    const locationIntervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        navigator.permissions?.query({ name: 'geolocation' }).then((permission) => {
          if (permission.state === 'granted') updateLocation()
        }).catch(() => {})
      }
    }, LOCATION_INTERVAL_MS)

    return () => {
      window.clearInterval(locationIntervalId)
    }
  }, [])

  async function changeAvailability(newStatus) {
    if (actionLock.current) return
    actionLock.current = true
    setAvailabilityLoading(true)
    setError('')
    setLocationMessage('')

    try {
      const data = await apiRequest('/technicians/me/availability', {
        method: 'POST',
        body: JSON.stringify({
          availability_status: newStatus,
        }),
      })

      setLocationMessage(
        data.message || `Availability updated to ${newStatus}.`,
      )

      await loadDashboard()
    } catch (err) {
      setError(
        err.message || `Unable to change availability to ${newStatus}.`,
      )
    } finally {
      actionLock.current = false
      setAvailabilityLoading(false)
    }
  }

  async function handleGoOnline() {
    setError('')
    setLocationMessage('First updating your location...')

    const locationUpdated = manualLocation.current || await updateLocation()

    if (!locationUpdated) {
      return
    }

    await changeAvailability('ONLINE')
  }

  async function handleGoOffline() {
    await changeAvailability('OFFLINE')
  }

  async function updateJobStatus(jobId, newStatus) {
    if (!jobId) {
      setError('Job ID is missing. Please refresh the dashboard.')
      return
    }

    if (actionLock.current) return
    actionLock.current = true
    setJobStatusLoading(true)
    setError('')
    setLocationMessage('')

    try {
      await apiRequest(`/jobs/${jobId}/status`, {
        method: 'POST',
        body: JSON.stringify({
          new_status: newStatus,
          remarks:
            newStatus === 'ON_THE_WAY'
              ? 'Technician is on the way to customer location'
              : `Technician changed job status to ${newStatus}`,
        }),
      })

      await loadDashboard()
      await loadNotifications(true)
    } catch (err) {
      setError(
        err.message || `Unable to change job status to ${newStatus}.`,
      )
    } finally {
      actionLock.current = false
      setJobStatusLoading(false)
    }
  }

  async function handleStartTravel() {
    if (!activeJob?.job_id) {
      setError('Active job ID is missing. Please refresh the dashboard.')
      return
    }

    await updateJobStatus(activeJob.job_id, 'ON_THE_WAY')
  }

  async function handleMarkArrived() {
    if (!activeJob?.job_id) {
      setError('Active job ID is missing. Please refresh the dashboard.')
      return
    }

    await updateJobStatus(activeJob.job_id, 'ARRIVED')
  }



  if (loading) {
    return (
      <div className="dashboard-message">
        Loading Vishwakarma Setu technician dashboard...
      </div>
    )
  }

  if (error && !dashboard) {
    return (
      <div className="dashboard">
        <main className="dashboard-content">
          <div className="dashboard-error" role="alert">
            {error}
          </div>
          <button
            type="button"
            onClick={loadDashboard}
            className="primary-action"
          >
            Retry
          </button>
        </main>
      </div>
    )
  }

  const profile = dashboard?.profile || {}
  const summary = dashboard?.job_summary || {}
  const activeJob = dashboard?.active_job
  const recentJobs = dashboard?.recent_jobs || []
  const isOnline = profile.availability_status === 'ONLINE'

  return (
    <div
      className="dashboard technician-workspace"
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
      }}
    >
<header
  className="dashboard-header marketplace-header"
  style={{
    position: 'sticky',
    top: 0,
    zIndex: 20,
    padding: '22px 28px',
  }}
>
  <div className="marketplace-brand">
    <div className="marketplace-brand-name">
      <span className="brand-symbol">♨</span>
      VISHWAKARMA SETU
    </div>

    <h1
      style={{
        margin: 0,
        fontSize: '29px',
        fontWeight: 800,
        letterSpacing: '-0.5px',
      }}
    >
      Technician Workspace
    </h1>

    <p style={{ margin: '5px 0 0' }}>
      Your jobs, your next step, all in one place.
    </p>


  </div>

        <div
          className="workspace-header-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
          }}
        >
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setNotificationsOpen((value) => !value)}
              ref={notificationBellRef}
              aria-expanded={notificationsOpen}
              aria-controls="technician-notification-panel"
              aria-label="Notifications"
              style={{
                width: '58px',
                height: '52px',
                border: '1px solid #dbe3ef',
                borderRadius: '12px',
                background: '#ffffff',
                fontSize: '25px',
                cursor: 'pointer',
              }}
            >
              Notifications
            </button>

            {unreadCount > 0 && (
              <span
                style={{
                  position: 'absolute',
                  top: '-7px',
                  right: '-5px',
                  minWidth: '22px',
                  height: '22px',
                  padding: '0 6px',
                  borderRadius: '999px',
                  background: '#dc2626',
                  color: '#ffffff',
                  fontSize: '12px',
                  fontWeight: 800,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}

            {notificationsOpen && (
              <div
                id="technician-notification-panel"
                className="technician-notification-panel"
                role="region"
                aria-label="Notifications"
                style={{
                  position: 'fixed',
                  right: '16px',
                  top: '82px',
                  width: '360px',
                  maxWidth: 'calc(100vw - 32px)',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: '14px',
                  boxShadow: '0 20px 45px rgba(15,23,42,0.16)',
                  overflow: 'hidden',
                  zIndex: 50,
                }}
              >
                <div
                  style={{
                    padding: '14px 16px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                  }}
                >
                  <strong>Notifications</strong>
                  <button
                    type="button"
                    className="notification-close"
                    onClick={closeNotifications}
                    aria-label="Close notifications"
                  >
                    Close
                  </button>
                  <button
                    type="button"
                    onClick={markAllNotificationsRead}
                    disabled={unreadCount === 0 || notificationLoading}
                    style={{
                      border: 0,
                      background: 'transparent',
                      color: '#2563eb',
                      cursor:
                        unreadCount === 0 ? 'default' : 'pointer',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    Mark all read
                  </button>
                </div>

                <div
                  className="technician-notification-list"
                  style={{ maxHeight: '430px', overflowY: 'auto' }}
                >
                  {notifications.length === 0 ? (
                    <p
                      style={{
                        padding: '24px',
                        margin: 0,
                        color: '#64748b',
                      }}
                    >
                      No notifications.
                    </p>
                  ) : (
                    notifications.map((notification) => (
                      <button
                        type="button"
                        key={notification.id}
                        onClick={() => { markNotificationRead(notification.id); if (notification.notification_type === 'RATING_RECEIVED') onViewRatings(notification.reference_id); else loadDashboard() }}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '14px 16px',
                          border: 0,
                          borderBottom: '1px solid #eef2f7',
                          background: notification.is_read
                            ? '#ffffff'
                            : '#eff6ff',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            fontWeight: notification.is_read ? 600 : 800,
                            color: '#0f172a',
                          }}
                        >
                          {notification.title || 'Notification'}
                        </div>
                        <div
                          style={{
                            marginTop: '5px',
                            color: '#475569',
                            fontSize: '13px',
                            lineHeight: 1.45,
                          }}
                        >
                          {notification.message || ''}
                        </div>
                        <div
                          style={{
                            marginTop: '7px',
                            color: notification.is_read
                              ? '#94a3b8'
                              : '#2563eb',
                            fontSize: '11px',
                            fontWeight: 700,
                          }}
                        >
                          {notification.is_read ? 'Read' : 'Unread'}
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={onChangePassword}>Change Password</button>

          <button
            type="button"
            onClick={onLogout}
            style={{
              padding: '11px 16px',
              borderRadius: '10px',
              cursor: 'pointer',
            }}
          >
            Logout
          </button>
        </div>
      </header>

      <main
        className="dashboard-content"
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '28px 22px 50px',
        }}
      >
        {error && (
          <div
            className="dashboard-error"
            role="alert"
            style={{
              whiteSpace: 'pre-line',
              marginBottom: '16px',
            }}
          >
            {error}
          </div>
        )}

        <section
          className="welcome-card technician-welcome"
          style={{
            textAlign: 'left',
            padding: '22px 24px',
          }}
        >
          <h2 style={{ marginBottom: '8px' }}>
            Welcome, {profile.full_name || 'Technician'}
          </h2>

          <p style={{ color: '#64748b', marginTop: 0 }}>
            {profile.business_name || 'Technician account'}
          </p>
          <nav className="technician-workspace-nav" aria-label="Workspace sections">
            {activeJob && <a href="#active-job">Active Job</a>}
            <a href="#incoming-jobs">Incoming Jobs</a>
            <button type="button" onClick={onViewEarnings}>
              Earnings &amp; Work Value
            </button>
            <button type="button" onClick={loadDashboard}>
              Refresh Dashboard
            </button>
          </nav>

          <div
            style={{
              marginTop: '18px',
              display: 'flex',
              gap: '10px',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {isOnline ? (
              <button
                type="button"
                onClick={handleGoOffline}
                disabled={availabilityLoading}
              >
                {availabilityLoading ? 'Updating...' : t('Go Offline')}
              </button>
            ) : (
              <button
                type="button"
                className="primary-action"
                onClick={handleGoOnline}
                disabled={availabilityLoading || locationLoading}
              >
                {availabilityLoading || locationLoading
                  ? 'Going Online...'
                  : t('Go Online')}
              </button>
            )}
          </div>

          <p
            style={{
              margin: '12px 0 0',
              color: '#64748b',
              fontSize: '13px',
            }}
          >
            Your position helps nearby customers find you. While this screen is open, GPS refreshes every 5 minutes if permission is granted.
          </p>

          <ManualLocation onSaved={() => {
            manualLocation.current = true
            setLocationMessage('Position saved. Select Go Online when ready. Confirm your location again after moving; stale locations cannot receive jobs.')
            loadDashboard()
          }} />
          {locationMessage && (
            <p
              style={{
                margin: '8px 0 0',
                color: '#475569',
                fontSize: '13px',
                whiteSpace: 'pre-line',
              }}
            >
              {locationMessage}
            </p>
          )}
        </section>

        {/* active-job-panel */}
        {activeJob && (
        <section className="welcome-card technician-active-job" id="active-job">
          <div className="technician-job-heading">
            <div>
              <span className="technician-eyebrow">YOUR CURRENT WORK</span>
              <h2>Active Job</h2>
            </div>
            {activeJob && (
              <span className="technician-status-pill">
                {String(activeJob.status || '').replaceAll('_', ' ')}
              </span>
            )}
          </div>
          {activeJob && (
            <p className="technician-next-step">
              {({
                ASSIGNED: 'Review the incoming request below to accept or decline.',
                ACCEPTED: 'Ready to leave? Select Start Travel.',
                ON_THE_WAY: 'At the work location? Select Mark Arrived.',
                ARRIVED: 'Agree on the price, then verify the customer Start PIN.',
                IN_PROGRESS: 'When the work is ready, request customer completion review.',
              })[activeJob.status] || 'Review the current job details below.'}
            </p>
          )}

          {!activeJob ? (
            <p>No active job currently assigned.</p>
          ) : (
            <div className="technician-job-body">
              <h3 className="technician-job-title">
                {activeJob.service_request_title ||
                  activeJob.service_name ||
                  'Service Job'}
              </h3>

              <dl className="technician-job-facts">
                <div>
                  <dt>Customer</dt>
                  <dd>{activeJob.customer_name || 'Not available'}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{activeJob.customer_phone || 'Not available'}</dd>
                </div>
                <div>
                  <dt>Estimated Amount</dt>
                  <dd>
                    {activeJob.estimated_amount != null &&
                    String(activeJob.estimated_amount).trim() !== '' &&
                    Number.isFinite(Number(activeJob.estimated_amount))
                      ? new Intl.NumberFormat('en-IN', {
                          style: 'currency',
                          currency: 'INR',
                          maximumFractionDigits: 2,
                        }).format(Number(activeJob.estimated_amount))
                      : 'Not available'}
                  </dd>
                </div>
                <div className="technician-job-address">
                  <dt>Work Address</dt>
                  <dd>
                    {[
                      activeJob.address_line1,
                      activeJob.address_line2,
                      activeJob.city,
                      activeJob.state,
                      activeJob.pincode,
                    ].filter(Boolean).join(', ') || 'Not available'}
                  </dd>
                </div>
              </dl>

              {activeJob.status === 'ACCEPTED' && (
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleStartTravel}
                  disabled={jobStatusLoading}
                  style={{ marginTop: '12px' }}
                >
                  {jobStatusLoading ? 'Updating...' : 'Start Travel'}
                </button>
              )}

              {activeJob.status === 'ON_THE_WAY' && (
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleMarkArrived}
                  disabled={jobStatusLoading}
                  style={{ marginTop: '12px' }}
                >
                  {jobStatusLoading ? 'Updating...' : 'Mark Arrived'}
                </button>
              )}

              {activeJob.status === 'ARRIVED' && (
                <StartWorkPin
                  key={activeJob.job_id}
                  jobId={activeJob.job_id}
                  disabled={jobStatusLoading}
                  onStarted={async () => {
                    await loadDashboard()
                    await loadNotifications(true)
                  }}
                />
              )}

              {activeJob.status === 'IN_PROGRESS' && (
                <CompleteWork
                  key={activeJob.job_id}
                  jobId={activeJob.job_id}
                  disabled={jobStatusLoading}
                  onCompleted={async () => {
                    await loadDashboard()
                    await loadNotifications(true)
                  }}
                />
              )}
              {activeJob.service_request_id && (
                <JobPhotos
                  key={activeJob.service_request_id}
                  requestId={activeJob.service_request_id}
                  disabled={jobStatusLoading}
                />
              )}

            </div>
          )}
        </section>
        )}

        <div id="incoming-jobs" className="technician-incoming">
          <IncomingJobs onJobResponded={loadDashboard} />
        </div>

        <section
          className="technician-overview-grid" aria-label="Technician overview"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: '16px',
            marginBottom: '22px',
          }}
        >
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            }}
          >
            <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Availability
            </div>
            <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '9px' }}>
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: isOnline ? '#16a34a' : '#94a3b8',
                  boxShadow: isOnline ? '0 0 0 4px #dcfce7' : '0 0 0 4px #f1f5f9',
                }}
              />
              <strong style={{ fontSize: '22px', color: isOnline ? '#15803d' : '#475569' }}>
                {profile.availability_status || 'OFFLINE'}
              </strong>
            </div>
          </div>

          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            }}
          >
            <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              KYC Status
            </div>
            <div style={{ marginTop: '10px' }}>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '7px 12px',
                  borderRadius: '999px',
                  background: '#ecfdf5',
                  color: '#047857',
                  fontSize: '13px',
                  fontWeight: 800,
                }}
              >
                ✓ {profile.kyc_status || 'UNKNOWN'}
              </span>
            </div>
          </div>

          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            }}
          >
            <button type="button" onClick={() => onViewRatings()}>{t('View Ratings')} · {profile.review_count ?? 0}</button>
            <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Rating
            </div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '22px' }}>⭐</span>
              <strong style={{ fontSize: '25px', color: '#0f172a' }}>
                {profile.rating_average == null ? '—' : Number(profile.rating_average).toFixed(2)}
              </strong>
              <span style={{ color: '#94a3b8', fontSize: '12px' }}>/ 5</span>
            </div>
          </div>

          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: '16px',
              padding: '20px',
              boxShadow: '0 8px 24px rgba(15, 23, 42, 0.06)',
            }}
          >
            <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.8px' }}>
              Total Jobs
            </div>
            <div style={{ marginTop: '8px', display: 'flex', alignItems: 'baseline', gap: '7px' }}>
              <strong style={{ fontSize: '28px', color: '#0f172a' }}>
                {profile.total_jobs ?? 0}
              </strong>
              <span style={{ color: '#64748b', fontSize: '12px' }}>jobs completed/handled</span>
            </div>
          </div>
        </section>

        <style>{`
          @media (max-width: 900px) {
            .technician-overview-grid {
              grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            }
          }

          @media (max-width: 560px) {
            .technician-overview-grid {
              grid-template-columns: 1fr !important;
            }
          }
        `}</style>
        <section className="welcome-card">
          <h2 style={{ marginBottom: '18px' }}>Job Summary</h2>

          <div
            className="job-summary-badges"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: '12px',
            }}
          >
            {[
              ['Assigned', summary.assigned_jobs ?? 0, '#eff6ff', '#1d4ed8'],
              ['Accepted', summary.accepted_jobs ?? 0, '#f5f3ff', '#6d28d9'],
              ['In Progress', summary.in_progress_jobs ?? 0, '#fff7ed', '#c2410c'],
              ['Completed', summary.completed_jobs ?? 0, '#ecfdf5', '#047857'],
            ].map(([label, value, background, textColor]) => (
              <div
                key={label}
                style={{
                  background,
                  borderRadius: '14px',
                  padding: '16px',
                  textAlign: 'center',
                }}
              >
                <div style={{ color: '#64748b', fontSize: '12px', fontWeight: 800 }}>
                  {label}
                </div>
                <strong style={{ display: 'block', marginTop: '5px', fontSize: '25px', color: textColor }}>
                  {value}
                </strong>
              </div>
            ))}
          </div>

          <style>{`
            @media (max-width: 900px) {
              .job-summary-badges {
                grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
              }
            }

            @media (max-width: 560px) {
              .job-summary-badges {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </section>




        <section className="welcome-card">
          <h2>Recent Jobs</h2>

          {recentJobs.length === 0 ? (
            <p>No jobs found.</p>
          ) : (
            <div>
              {recentJobs.map((job) => (
                <div
                  key={job.job_id}
                  style={{
                    padding: '14px 0',
                    borderBottom: '1px solid #e5e7eb',
                  }}
                >
                  <h3>
                    {job.service_request_title ||
                      job.service_name ||
                      'Service Job'}
                  </h3>

                  <p>
                    <strong>Status:</strong> {job.status}
                  </p>

                  <p>
                    <strong>Customer:</strong>{' '}
                    {job.customer_name || 'N/A'}
                  </p>

                  <p>
                    <strong>Location:</strong>{' '}
                    {[job.city, job.state]
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="welcome-card">
          <p>
            Technician ID:{' '}
            <strong>
              {profile.technician_id || user?.technician_id || 'N/A'}
            </strong>
          </p>

          <button
            type="button"
            onClick={loadDashboard}
            className="primary-action"
          >
            Refresh Dashboard
          </button>
        </section>
      </main>
    </div>
  )
}

export default Dashboard
