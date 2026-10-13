import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import { logout } from '../auth/auth'

function extractCustomerId(data) {
  return (
    data?.customer_id ||
    data?.customer?.id ||
    data?.customer?.customer_id ||
    data?.service_request?.customer_id ||
    data?.request?.customer_id ||
    data?.data?.customer_id ||
    data?.data?.customer?.id ||
    null
  )
}

function extractRequests(data) {
  if (Array.isArray(data?.service_requests)) {
    return data.service_requests
  }

  if (Array.isArray(data?.requests)) {
    return data.requests
  }

  if (Array.isArray(data?.data)) {
    return data.data
  }

  if (Array.isArray(data)) {
    return data
  }

  return []
}

function extractJobs(data) {
  if (Array.isArray(data?.jobs)) {
    return data.jobs
  }

  if (Array.isArray(data?.data?.jobs)) {
    return data.data.jobs
  }

  if (Array.isArray(data?.results)) {
    return data.results
  }

  if (Array.isArray(data?.data)) {
    return data.data
  }

  if (Array.isArray(data)) {
    return data
  }

  return []
}

async function resolveCustomerId(requestData) {
  const serviceRequests = extractRequests(requestData)

  const directCustomerId =
    extractCustomerId(requestData) ||
    serviceRequests.find(
      (item) => extractCustomerId(item),
    )?.customer_id

  if (directCustomerId) {
    return directCustomerId
  }

  /*
   * The list endpoint does not always expose customer_id.
   * Resolve it from recent service-request details.
   */
  const requestsToCheck = serviceRequests
    .filter((item) => item?.id)
    .slice(0, 5)

  for (const item of requestsToCheck) {
    try {
      const detailData = await apiRequest(
        `/service-requests/${item.id}`,
      )

      const detail =
        detailData?.request ||
        detailData?.service_request ||
        detailData?.data ||
        detailData

      const customerId =
        extractCustomerId(detail) ||
        extractCustomerId(detailData)

      if (customerId) {
        return customerId
      }
    } catch {
      // Try the next recent request.
    }
  }

  return null
}

function Dashboard({
  user,
  onLogout,
  onChangePassword,
  onCreateRequest,
  onViewRequests,
  onSelectRequest,
}) {
  const [requests, setRequests] = useState([])
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [jobs, setJobs] = useState([])
  const [customerId, setCustomerId] = useState(null)

  const [loading, setLoading] = useState(true)
  const [refreshingNotifications, setRefreshingNotifications] =
    useState(false)

  const [error, setError] = useState('')
  const [notificationError, setNotificationError] =
    useState('')

  const [showNotifications, setShowNotifications] =
    useState(false)

  const [markingNotificationId, setMarkingNotificationId] =
    useState(null)

  const [markingAllRead, setMarkingAllRead] =
    useState(false)

  const notificationButtonRef = useRef(null)

  function closeNotifications() {
    setShowNotifications(false)
    notificationButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!showNotifications) return
    function handleEscape(event) {
      if (event.key === 'Escape') {
        setShowNotifications(false)
        notificationButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showNotifications])

  /*
   * Initial dashboard load.
   */
  useEffect(() => {
    let cancelled = false

    async function fetchDashboard() {
      setLoading(true)
      setError('')

      try {
        const [requestData, notificationData, unreadData] =
          await Promise.all([
            apiRequest('/service-requests/my'),
            apiRequest('/notifications'),
            apiRequest('/notifications/unread-count'),
          ])

        if (cancelled) {
          return
        }

        const serviceRequests =
          extractRequests(requestData)

        setRequests(serviceRequests)
        setNotifications(
          notificationData?.notifications || [],
        )
        setUnreadCount(
          unreadData?.unread_count || 0,
        )

        const resolvedCustomerId =
          await resolveCustomerId(requestData)

        if (cancelled) {
          return
        }

        setCustomerId(resolvedCustomerId)

        if (!resolvedCustomerId) {
          setJobs([])
          return
        }

        try {
          const jobData = await apiRequest(
            `/jobs/customer/${resolvedCustomerId}`,
          )

          if (!cancelled) {
            setJobs(extractJobs(jobData))
          }
        } catch {
          if (!cancelled) {
            setJobs([])
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              'Unable to load dashboard data',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchDashboard()

    return () => {
      cancelled = true
    }
  }, [user])

  /*
   * Refresh dashboard data every 15 seconds.
   * Customer ID is resolved again instead of relying on
   * a stale closure value from the previous render.
   */
  useEffect(() => {
    if (!user?.id) {
      return undefined
    }

    let cancelled = false

    async function refreshDashboardData() {
      try {
        setRefreshingNotifications(true)

        const [notificationData, unreadData, requestData] =
          await Promise.all([
            apiRequest('/notifications'),
            apiRequest('/notifications/unread-count'),
            apiRequest('/service-requests/my'),
          ])

        const refreshedRequests =
          extractRequests(requestData)

        const resolvedCustomerId =
          await resolveCustomerId(requestData)

        if (cancelled) {
          return
        }

        setNotifications(
          notificationData?.notifications || [],
        )
        setUnreadCount(
          unreadData?.unread_count || 0,
        )
        setRequests(refreshedRequests)
        setCustomerId(resolvedCustomerId)
        setNotificationError('')

        if (!resolvedCustomerId) {
          setJobs([])
          return
        }

        try {
          const jobData = await apiRequest(
            `/jobs/customer/${resolvedCustomerId}`,
          )

          if (!cancelled) {
            setJobs(extractJobs(jobData))
          }
        } catch {
          /* Keep the previous job list if a refresh fails. */
        }
      } catch (err) {
        if (!cancelled) {
          setNotificationError(
            err.message ||
              'Unable to refresh dashboard data',
          )
        }
      } finally {
        if (!cancelled) {
          setRefreshingNotifications(false)
        }
      }
    }

    const intervalId = setInterval(
      refreshDashboardData,
      15000,
    )

    return () => {
      cancelled = true
      clearInterval(intervalId)
    }
  }, [user])

  function handleLogout() {
    logout()
    onLogout()
  }

  async function handleMarkNotificationRead(
    notificationId,
  ) {
    setMarkingNotificationId(notificationId)
    setNotificationError('')

    try {
      await apiRequest(
        `/notifications/${notificationId}/read`,
        {
          method: 'POST',
        },
      )

      setNotifications((current) =>
        current.map((notification) =>
          notification.id === notificationId
            ? {
                ...notification,
                is_read: true,
              }
            : notification,
        ),
      )

      setUnreadCount((current) =>
        Math.max(0, current - 1),
      )
    } catch (err) {
      setNotificationError(
        err.message ||
          'Unable to mark notification as read',
      )
    } finally {
      setMarkingNotificationId(null)
    }
  }

  async function handleMarkAllRead() {
    if (unreadCount === 0) {
      return
    }

    setMarkingAllRead(true)
    setNotificationError('')

    try {
      await apiRequest('/notifications/read-all', {
        method: 'POST',
      })

      setNotifications((current) =>
        current.map((notification) => ({
          ...notification,
          is_read: true,
        })),
      )

      setUnreadCount(0)
    } catch (err) {
      setNotificationError(
        err.message ||
          'Unable to mark all notifications as read',
      )
    } finally {
      setMarkingAllRead(false)
    }
  }

  const totalRequests = requests.length

  const totalJobs = requests.reduce(
    (total, request) =>
      total + (request.job_count || 0),
    0,
  )

  const openRequests = requests.filter(
    (request) => request.status === 'OPEN',
  ).length

  const completedRequests = requests.filter(
    (request) => request.status === 'COMPLETED',
  ).length

  const recentRequests = requests.slice(0, 5)

  const activeJobs = jobs.filter(
    (job) =>
      !['COMPLETED', 'CANCELLED'].includes(
        job.status,
      ),
  )

  return (
    <div className="dashboard customer-workspace">
<header className="dashboard-header marketplace-header">
  <div className="marketplace-brand">
    <div className="marketplace-brand-name">
      <span className="brand-symbol">♨</span>
      VISHWAKARMA SETU
    </div>

    <h1>Your Service Dashboard</h1>

    <p>
      Find nearby technicians and manage your work in one place.
    </p>
  </div>

  <div className="dashboard-header-actions">          <button
            type="button"
            className="notification-button"
            ref={notificationButtonRef}
            aria-expanded={showNotifications}
            aria-controls="customer-notifications"
            onClick={() =>
              setShowNotifications(
                (current) => !current,
              )
            }
          >
            Notifications

            {unreadCount > 0 && (
              <span className="notification-badge">
                {unreadCount}
              </span>
            )}
          </button>

          <button type="button" onClick={onChangePassword}>Change Password</button>

          <button
            type="button"
            onClick={handleLogout}
          >
            Logout
          </button>
        </div>
      </header>

      <main className="dashboard-content">
        {showNotifications && (
          <section
            className="dashboard-section notification-panel"
            id="customer-notifications"
            aria-label="Notifications"
          >
            <div className="section-heading">
              <div>
                <h2>Notifications</h2>
                <p>
                  Updates about your service jobs
                </p>
              </div>

              <div className="dashboard-actions">
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={
                    unreadCount === 0 ||
                    markingAllRead
                  }
                >
                  {markingAllRead
                    ? 'Marking...'
                    : 'Mark All as Read'}
                </button>

                <button
                  type="button"
                  onClick={closeNotifications}
                  aria-label="Close notifications" 
                >
                  Close
                </button>
              </div>
            </div>

            {notificationError && (
              <div
                className="dashboard-error"
                role="alert"
              >
                {notificationError}
              </div>
            )}

            {notifications.length === 0 ? (
              <div className="empty-state">
                No notifications available.
              </div>
            ) : (
              <div className="notification-list">
                {notifications.map((notification) => (
                  <article
                    className="notification-card"
                    key={notification.id}
                  >
                    <div>
                      <h3>
                        {notification.title}
                      </h3>
                      <p>
                        {notification.message}
                      </p>
                      {notification.created_at && (
                        <small>
                          {notification.created_at}
                        </small>
                      )}
                    </div>

                    <div className="notification-card-actions">
                      <span
                        className={
                          notification.is_read
                            ? 'read-status'
                            : 'unread-status'
                        }
                      >
                        {notification.is_read
                          ? 'Read'
                          : 'New'}
                      </span>

                      {!notification.is_read && (
                        <button
                          type="button"
                          onClick={() =>
                            handleMarkNotificationRead(
                              notification.id,
                            )
                          }
                          disabled={
                            markingNotificationId ===
                            notification.id
                          }
                        >
                          {markingNotificationId ===
                          notification.id
                            ? 'Marking...'
                            : 'Mark Read'}
                        </button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        <section className="welcome-card customer-action-hero">
          <div>
            <span className="customer-hero-eyebrow">YOUR NEXT JOB, MADE SIMPLE</span>
            <h2>What can we help you fix today?</h2>
            <p>
              Describe the work, see nearby matching technicians,
              and choose who works for you.
            </p>
          </div>
          <div className="customer-hero-actions">
            <button
              type="button"
              className="primary-action"
              onClick={onCreateRequest}
            >
              + Create Service Request
            </button>
            <button type="button" onClick={onViewRequests}>
              My Requests
            </button>
            <p className="customer-action-help">
              Open My Requests to find technicians or track existing work.
            </p>
          </div>
        </section>

        {loading && (
          <div className="dashboard-message">
            Loading dashboard...
          </div>
        )}

        {error && (
          <div
            className="dashboard-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            <section className="dashboard-stats">
              <div className="stat-card">
                <span className="stat-icon">
                  Requests
                </span>
                <span className="stat-label">
                  Service Requests
                </span>
                <strong>{totalRequests}</strong>
              </div>

              <div className="stat-card">
                <span className="stat-icon">
                  Jobs
                </span>
                <span className="stat-label">
                  Jobs Created
                </span>
                <strong>{totalJobs}</strong>
              </div>

              <div className="stat-card">
                <span className="stat-icon">
                  Open
                </span>
                <span className="stat-label">
                  Open Requests
                </span>
                <strong>{openRequests}</strong>
              </div>

              <div className="stat-card">
                <span className="stat-icon">
                  Done
                </span>
                <span className="stat-label">
                  Completed Requests
                </span>
                <strong>
                  {completedRequests}
                </strong>
              </div>
            </section>

            <section className="dashboard-section">
              <div className="section-heading">
                <div>
                  <h2>Active Jobs</h2>
                  <p>
                    Track your currently active
                    technician jobs
                  </p>
                </div>
              </div>

              {activeJobs.length === 0 ? (
                <div className="empty-state">
                  No active jobs currently.
                </div>
              ) : (
                <div className="request-list">
                  {activeJobs.map((job) => (
                    <article
                      className="request-card"
                      key={
                        job.job_id || job.id
                      }
                    >
                      <div className="request-main">
                        <h3>
                          {job.service_request_title ||
                            job.title ||
                            'Service Job'}
                        </h3>

                        <p className="request-service">
                          {job.service_name ||
                            'Technical Service'}
                        </p>

                        <p className="request-location">
                          Technician:{' '}
                          {job.technician_name ||
                            'Assigned Technician'}
                        </p>

                        <p className="request-location">
                          Amount:{' '}
                          {job.estimated_amount !==
                            undefined &&
                          job.estimated_amount !==
                            null
                            ? `₹${job.estimated_amount}`
                            : '-'}
                        </p>
                      </div>

                      <div className="request-meta">
                        <span
                          className={`status status-${(
                            job.status || ''
                          ).toLowerCase()}`}
                        >
                          {job.status || '-'}
                        </span>

                        {job.service_request_id && (
                          <button
                            type="button"
                            onClick={() =>
                              onSelectRequest(
                                job.service_request_id,
                              )
                            }
                          >
                            Track Job
                          </button>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className="dashboard-section">
              <div className="section-heading">
                <div>
                  <h2>
                    Recent Service Requests
                  </h2>
                  <p>
                    Your latest service requests
                  </p>
                </div>

                <button
                  type="button"
                  onClick={onViewRequests}
                >
                  View All
                </button>
              </div>

              {recentRequests.length === 0 ? (
                <div className="empty-state">
                  No service requests found.
                </div>
              ) : (
                <div className="request-list">
                  {recentRequests.map(
                    (request) => (
                      <article
                        className="request-card"
                        key={request.id}
                        role="button"
                        tabIndex={0}
                        onClick={() =>
                          onSelectRequest(
                            request.id,
                          )
                        }
                        onKeyDown={(event) => {
                          if (
                            event.key === 'Enter' ||
                            event.key === ' '
                          ) {
                            event.preventDefault()
                            onSelectRequest(
                              request.id,
                            )
                          }
                        }}
                      >
                        <div className="request-main">
                          <h3>
                            {request.title}
                          </h3>

                          <p className="request-service">
                            {request.service_name}
                          </p>

                          <p className="request-location">
                            {request.city},{' '}
                            {request.state}
                          </p>
                        </div>

                        <div className="request-meta">
                          <span
                            className={`status status-${(
                              request.status || ''
                            ).toLowerCase()}`}
                          >
                            {request.status}
                          </span>

                          <span>
                            Jobs:{' '}
                            {request.job_count || 0}
                          </span>
                        </div>
                      </article>
                    ),
                  )}
                </div>
              )}
            </section>

            <section className="dashboard-section">
              <div className="section-heading">
                <div>
                  <h2>Recent Notifications</h2>
                  <p>
                    Latest updates about your
                    service jobs
                  </p>
                </div>

                <span className="notification-total">
                  {notifications.length}{' '}
                  notifications
                </span>
              </div>

              {notifications.length === 0 ? (
                <div className="empty-state">
                  No notifications available.
                </div>
              ) : (
                <div className="notification-list">
                  {notifications
                    .slice(0, 5)
                    .map((notification) => (
                      <article
                        className="notification-card"
                        key={notification.id}
                      >
                        <div>
                          <h3>
                            {notification.title}
                          </h3>

                          <p>
                            {notification.message}
                          </p>
                        </div>

                        <span
                          className={
                            notification.is_read
                              ? 'read-status'
                              : 'unread-status'
                          }
                        >
                          {notification.is_read
                            ? 'Read'
                            : 'New'}
                        </span>
                      </article>
                    ))}
                </div>
              )}
            </section>



            {refreshingNotifications && (
              <div className="dashboard-message">
                Updating your jobs and notifications...
              </div>
            )}

            {customerId && (
              <div
                style={{
                  display: 'none',
                }}
                aria-hidden="true"
              >
                {customerId}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

export default Dashboard
