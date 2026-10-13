import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { apiRequest } from '../api/client'

const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'OPEN', label: 'Open' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'CANCELLED', label: 'Cancelled' },
]

const ACTIVE_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ARRIVED',
  'IN_PROGRESS',
]

function MyServiceRequests({
  onBack,
  onSelectRequest,
}) {
  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState('ALL')

  const loadRequests = useCallback(
    async (showLoading = true) => {
      if (showLoading) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      setError('')

      try {
        const data = await apiRequest('/service-requests/my')

        const requestData =
          data.service_requests ||
          data.requests ||
          data.data ||
          []

        setRequests(
          Array.isArray(requestData)
            ? requestData
            : [],
        )
      } catch (err) {
        setError(
          err.message ||
            'Unable to load your service requests.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [],
  )

  useEffect(() => {
    let cancelled = false

    const initialTimer = setTimeout(() => {
      if (!cancelled) {
        void loadRequests(true)
      }
    }, 0)

    const intervalId = setInterval(() => {
      if (!cancelled) {
        void loadRequests(false)
      }
    }, 15000)

    return () => {
      cancelled = true
      clearTimeout(initialTimer)
      clearInterval(intervalId)
    }
  }, [loadRequests])

  const counts = useMemo(() => {
    const result = {
      ALL: requests.length,
      OPEN: 0,
      ACTIVE: 0,
      COMPLETED: 0,
      CANCELLED: 0,
    }

    requests.forEach((request) => {
      const status = String(
        request.status || '',
      ).toUpperCase()

      if (status === 'OPEN') {
        result.OPEN += 1
      }

      if (ACTIVE_STATUSES.includes(status)) {
        result.ACTIVE += 1
      }

      if (status === 'COMPLETED') {
        result.COMPLETED += 1
      }

      if (status === 'CANCELLED') {
        result.CANCELLED += 1
      }
    })

    return result
  }, [requests])

  const filteredRequests = useMemo(() => {
    if (filter === 'ALL') {
      return requests
    }

    if (filter === 'ACTIVE') {
      return requests.filter((request) =>
        ACTIVE_STATUSES.includes(
          String(
            request.status || '',
          ).toUpperCase(),
        ),
      )
    }

    return requests.filter(
      (request) =>
        String(
          request.status || '',
        ).toUpperCase() === filter,
    )
  }, [filter, requests])

  function getStatusLabel(status) {
    if (!status) {
      return 'UNKNOWN'
    }

    return String(status)
      .replaceAll('_', ' ')
      .toUpperCase()
  }

  function getStatusStyle(status) {
    const normalized = String(
      status || '',
    ).toUpperCase()

    if (normalized === 'COMPLETED') {
      return {
        background: '#dcfce7',
        color: '#166534',
        border: '1px solid #bbf7d0',
      }
    }

    if (normalized === 'CANCELLED') {
      return {
        background: '#fee2e2',
        color: '#991b1b',
        border: '1px solid #fecaca',
      }
    }

    if (normalized === 'OPEN') {
      return {
        background: '#fef3c7',
        color: '#92400e',
        border: '1px solid #fde68a',
      }
    }

    if (ACTIVE_STATUSES.includes(normalized)) {
      return {
        background: '#dbeafe',
        color: '#1d4ed8',
        border: '1px solid #bfdbfe',
      }
    }

    return {
      background: '#f1f5f9',
      color: '#475569',
      border: '1px solid #e2e8f0',
    }
  }

  function getJobCount(request) {
    if (
      request.job_count !== undefined &&
      request.job_count !== null
    ) {
      return request.job_count
    }

    if (Array.isArray(request.jobs)) {
      return request.jobs.length
    }

    return 0
  }

  function formatDate(value) {
    if (!value) {
      return '-'
    }

    try {
      return new Date(value).toLocaleDateString(
        'en-IN',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        },
      )
    } catch {
      return value
    }
  }

  function formatDateTime(value) {
    if (!value) {
      return '-'
    }

    try {
      return new Date(value).toLocaleString(
        'en-IN',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        },
      )
    } catch {
      return value
    }
  }

  function formatTime(value) {
    if (!value) {
      return ''
    }

    return String(value).slice(0, 5)
  }

  if (loading) {
    return (
      <div style={styles.page}>
        <header style={styles.header}>
          <div style={styles.brandArea}>
            <div style={styles.logo}>🔱</div>

            <div>
              <div style={styles.brand}>
                Vishwakarma Setu
              </div>

              <div style={styles.subtitle}>
                Technical Services Marketplace
              </div>
            </div>
          </div>
        </header>

        <main style={styles.container}>
          <div style={styles.loadingCard}>
            <div style={styles.loadingIcon}>
              🔄
            </div>

            <h2 style={styles.loadingTitle}>
              Loading your service requests
            </h2>

            <p style={styles.loadingText}>
              Please wait while we retrieve your
              service history.
            </p>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.brandArea}>
            <div style={styles.logo}>🔱</div>

            <div>
              <div style={styles.brand}>
                Vishwakarma Setu
              </div>

              <div style={styles.subtitle}>
                Technical Services Marketplace
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onBack}
            style={styles.backButton}
          >
            ← Dashboard
          </button>
        </div>
      </header>

      <main style={styles.container}>
        <section style={styles.heroCard}>
          <div>
            <div style={styles.eyebrow}>
              CUSTOMER PORTAL
            </div>

            <h1 style={styles.pageTitle}>
              My Service Requests
            </h1>

            <p style={styles.pageDescription}>
              View, track and manage all your technical
              service requests from one place.
            </p>
          </div>

          <button
            type="button"
            onClick={() => loadRequests(false)}
            disabled={refreshing}
            style={{
              ...styles.refreshButton,
              opacity: refreshing ? 0.65 : 1,
            }}
          >
            {refreshing
              ? 'Refreshing...'
              : '↻ Refresh'}
          </button>
        </section>

        <section style={styles.summaryGrid}>
          <SummaryCard
            icon="📋"
            label="Total"
            value={counts.ALL}
            active={filter === 'ALL'}
            onClick={() => setFilter('ALL')}
          />

          <SummaryCard
            icon="🟡"
            label="Open"
            value={counts.OPEN}
            active={filter === 'OPEN'}
            onClick={() => setFilter('OPEN')}
          />

          <SummaryCard
            icon="🔵"
            label="Active"
            value={counts.ACTIVE}
            active={filter === 'ACTIVE'}
            onClick={() => setFilter('ACTIVE')}
          />

          <SummaryCard
            icon="🟢"
            label="Completed"
            value={counts.COMPLETED}
            active={filter === 'COMPLETED'}
            onClick={() => setFilter('COMPLETED')}
          />

          <SummaryCard
            icon="🔴"
            label="Cancelled"
            value={counts.CANCELLED}
            active={filter === 'CANCELLED'}
            onClick={() => setFilter('CANCELLED')}
          />
        </section>

        <section style={styles.contentCard}>
          <div style={styles.sectionHeader}>
            <div>
              <h2 style={styles.sectionTitle}>
                Service Request History
              </h2>

              <p style={styles.sectionDescription}>
                Select a request to view details,
                technician matching and job progress.
              </p>
            </div>

            <div style={styles.liveIndicator}>
              <span style={styles.liveDot} />
              Auto refresh: 15 sec
            </div>
          </div>

          <div style={styles.filters}>
            {FILTERS.map((item) => {
              const active =
                filter === item.key

              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() =>
                    setFilter(item.key)
                  }
                  style={{
                    ...styles.filterButton,
                    ...(active
                      ? styles.filterButtonActive
                      : {}),
                  }}
                >
                  {item.label}

                  <span
                    style={{
                      ...styles.filterCount,
                      ...(active
                        ? styles.filterCountActive
                        : {}),
                    }}
                  >
                    {counts[item.key]}
                  </span>
                </button>
              )
            })}
          </div>

          {error && (
            <div
              style={styles.error}
              role="alert"
            >
              <strong>
                Unable to load requests
              </strong>

              <div>{error}</div>

              <button
                type="button"
                onClick={() =>
                  loadRequests(true)
                }
                style={styles.retryButton}
              >
                Try Again
              </button>
            </div>
          )}

          {!error &&
            filteredRequests.length === 0 && (
              <div style={styles.emptyState}>
                <div style={styles.emptyIcon}>
                  {filter === 'ALL'
                    ? '📋'
                    : '🔎'}
                </div>

                <h3 style={styles.emptyTitle}>
                  {filter === 'ALL'
                    ? 'No service requests yet'
                    : `No ${filter.toLowerCase()} requests`}
                </h3>

                <p style={styles.emptyText}>
                  {filter === 'ALL'
                    ? 'Create your first technical service request to get started.'
                    : 'There are no requests in this status right now.'}
                </p>
              </div>
            )}

          {!error &&
            filteredRequests.length > 0 && (
              <div style={styles.requestList}>
                {filteredRequests.map(
                  (request) => {
                    const status =
                      String(
                        request.status || '',
                      ).toUpperCase()

                    const jobCount =
                      getJobCount(request)

                    const addressParts = [
                      request.city,
                      request.state,
                    ].filter(Boolean)

                    return (
                      <article
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
                            event.key ===
                              'Enter' ||
                            event.key === ' '
                          ) {
                            event.preventDefault()

                            onSelectRequest(
                              request.id,
                            )
                          }
                        }}
                        style={styles.requestCard}
                        onMouseEnter={(event) => {
                          event.currentTarget.style.transform =
                            'translateY(-2px)'
                          event.currentTarget.style.boxShadow =
                            '0 12px 28px rgba(15, 23, 42, 0.10)'
                        }}
                        onMouseLeave={(event) => {
                          event.currentTarget.style.transform =
                            'translateY(0)'
                          event.currentTarget.style.boxShadow =
                            '0 4px 16px rgba(15, 23, 42, 0.06)'
                        }}
                      >
                        <div style={styles.requestTop}>
                          <div style={styles.serviceIcon}>
                            🔧
                          </div>

                          <div
                            style={
                              styles.requestTitleArea
                            }
                          >
                            <div
                              style={
                                styles.requestTitleRow
                              }
                            >
                              <h3
                                style={
                                  styles.requestTitle
                                }
                              >
                                {request.title ||
                                  'Service Request'}
                              </h3>

                              <span
                                style={{
                                  ...styles.statusBadge,
                                  ...getStatusStyle(
                                    status,
                                  ),
                                }}
                              >
                                {getStatusLabel(
                                  status,
                                )}
                              </span>
                            </div>

                            <div
                              style={
                                styles.serviceName
                              }
                            >
                              {request.service_name ||
                                'Technical Service'}
                            </div>
                          </div>
                        </div>

                        <div
                          style={styles.infoGrid}
                        >
                          <InfoItem
                            icon="📍"
                            label="Location"
                            value={
                              addressParts.length
                                ? addressParts.join(
                                    ', ',
                                  )
                                : '-'
                            }
                          />

                          <InfoItem
                            icon="📅"
                            label="Preferred Date"
                            value={
                              request.preferred_date
                                ? formatDate(
                                    request.preferred_date,
                                  )
                                : 'Not specified'
                            }
                          />

                          <InfoItem
                            icon="⏰"
                            label="Preferred Time"
                            value={
                              request.preferred_time_start
                                ? `${formatTime(
                                    request.preferred_time_start,
                                  )}${
                                    request.preferred_time_end
                                      ? ` - ${formatTime(
                                          request.preferred_time_end,
                                        )}`
                                      : ''
                                  }`
                                : 'Not specified'
                            }
                          />

                          <InfoItem
                            icon="🛠️"
                            label="Jobs"
                            value={`${jobCount} ${
                              jobCount === 1
                                ? 'job'
                                : 'jobs'
                            }`}
                          />
                        </div>

                        <div
                          style={
                            styles.requestFooter
                          }
                        >
                          <div
                            style={
                              styles.createdText
                            }
                          >
                            Created:{' '}
                            {formatDateTime(
                              request.created_at,
                            )}
                          </div>

                          <div
                            style={
                              styles.viewDetails
                            }
                          >
                            View Details →
                          </div>
                        </div>
                      </article>
                    )
                  },
                )}
              </div>
            )}
        </section>

        <div style={styles.footerMessage}>
          🔄 Your request history refreshes
          automatically every 15 seconds.
        </div>
      </main>
    </div>
  )
}

function SummaryCard({
  icon,
  label,
  value,
  active,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        ...styles.summaryCard,
        ...(active
          ? styles.summaryCardActive
          : {}),
      }}
    >
      <div style={styles.summaryIcon}>
        {icon}
      </div>

      <div style={styles.summaryValue}>
        {value}
      </div>

      <div style={styles.summaryLabel}>
        {label}
      </div>
    </button>
  )
}

function InfoItem({
  icon,
  label,
  value,
}) {
  return (
    <div style={styles.infoItem}>
      <div style={styles.infoIcon}>
        {icon}
      </div>

      <div>
        <div style={styles.infoLabel}>
          {label}
        </div>

        <div style={styles.infoValue}>
          {value}
        </div>
      </div>
    </div>
  )
}

const styles = {
  page: {
    minHeight: '100vh',
    background:
      'linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%)',
    color: '#0f172a',
    fontFamily:
      'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  },

  header: {
    background:
      'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    color: '#ffffff',
    boxShadow:
      '0 4px 18px rgba(15, 23, 42, 0.16)',
  },

  headerInner: {
    maxWidth: '1180px',
    margin: '0 auto',
    padding: '16px 22px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '16px',
    flexWrap: 'wrap',
  },

  brandArea: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },

  logo: {
    width: '44px',
    height: '44px',
    borderRadius: '12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background:
      'rgba(255,255,255,0.12)',
    fontSize: '25px',
  },

  brand: {
    fontSize: '22px',
    fontWeight: '800',
    letterSpacing: '-0.3px',
  },

  subtitle: {
    marginTop: '2px',
    color: '#cbd5e1',
    fontSize: '12px',
  },

  backButton: {
    border: '1px solid rgba(255,255,255,0.22)',
    background:
      'rgba(255,255,255,0.10)',
    color: '#ffffff',
    borderRadius: '9px',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: '600',
    cursor: 'pointer',
  },

  container: {
    maxWidth: '1180px',
    margin: '0 auto',
    padding: '28px 22px 40px',
  },

  heroCard: {
    background: '#ffffff',
    borderRadius: '18px',
    padding: '26px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '20px',
    flexWrap: 'wrap',
    boxShadow:
      '0 6px 24px rgba(15, 23, 42, 0.06)',
    border: '1px solid #e2e8f0',
    marginBottom: '20px',
  },

  eyebrow: {
    color: '#2563eb',
    fontSize: '11px',
    fontWeight: '800',
    letterSpacing: '1.2px',
    marginBottom: '7px',
  },

  pageTitle: {
    margin: 0,
    fontSize: '30px',
    lineHeight: 1.2,
    fontWeight: '800',
    letterSpacing: '-0.7px',
  },

  pageDescription: {
    margin: '8px 0 0',
    color: '#64748b',
    fontSize: '15px',
    lineHeight: 1.5,
  },

  refreshButton: {
    border: '1px solid #cbd5e1',
    background: '#ffffff',
    color: '#0f172a',
    borderRadius: '10px',
    padding: '11px 18px',
    fontSize: '14px',
    fontWeight: '700',
    cursor: 'pointer',
  },

  summaryGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(145px, 1fr))',
    gap: '12px',
    marginBottom: '20px',
  },

  summaryCard: {
    border: '1px solid #e2e8f0',
    background: '#ffffff',
    borderRadius: '14px',
    padding: '17px 15px',
    textAlign: 'left',
    cursor: 'pointer',
    boxShadow:
      '0 3px 12px rgba(15, 23, 42, 0.04)',
    transition:
      'all 0.18s ease',
  },

  summaryCardActive: {
    border:
      '1px solid #2563eb',
    boxShadow:
      '0 5px 18px rgba(37, 99, 235, 0.15)',
  },

  summaryIcon: {
    fontSize: '19px',
    marginBottom: '7px',
  },

  summaryValue: {
    fontSize: '27px',
    fontWeight: '800',
    color: '#0f172a',
    lineHeight: 1,
  },

  summaryLabel: {
    marginTop: '6px',
    color: '#64748b',
    fontSize: '13px',
    fontWeight: '600',
  },

  contentCard: {
    background: '#ffffff',
    borderRadius: '18px',
    border: '1px solid #e2e8f0',
    boxShadow:
      '0 6px 24px rgba(15, 23, 42, 0.05)',
    padding: '22px',
  },

  sectionHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '15px',
    flexWrap: 'wrap',
    marginBottom: '18px',
  },

  sectionTitle: {
    margin: 0,
    fontSize: '21px',
    fontWeight: '800',
  },

  sectionDescription: {
    margin: '5px 0 0',
    color: '#64748b',
    fontSize: '13px',
  },

  liveIndicator: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    color: '#64748b',
    fontSize: '12px',
    fontWeight: '600',
  },

  liveDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: '#22c55e',
    boxShadow:
      '0 0 0 3px rgba(34,197,94,0.12)',
  },

  filters: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    paddingBottom: '18px',
    borderBottom:
      '1px solid #e2e8f0',
  },

  filterButton: {
    border: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#475569',
    borderRadius: '999px',
    padding: '8px 12px',
    fontSize: '13px',
    fontWeight: '700',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
  },

  filterButtonActive: {
    background: '#0f172a',
    color: '#ffffff',
    border:
      '1px solid #0f172a',
  },

  filterCount: {
    minWidth: '20px',
    height: '20px',
    padding: '0 5px',
    borderRadius: '999px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#e2e8f0',
    color: '#475569',
    fontSize: '11px',
  },

  filterCountActive: {
    background:
      'rgba(255,255,255,0.18)',
    color: '#ffffff',
  },

  requestList: {
    display: 'grid',
    gap: '13px',
    marginTop: '18px',
  },

  requestCard: {
    border: '1px solid #e2e8f0',
    borderRadius: '15px',
    padding: '18px',
    background: '#ffffff',
    cursor: 'pointer',
    boxShadow:
      '0 4px 16px rgba(15, 23, 42, 0.06)',
    transition:
      'transform 0.18s ease, box-shadow 0.18s ease',
    outline: 'none',
  },

  requestTop: {
    display: 'flex',
    gap: '13px',
    alignItems: 'flex-start',
  },

  serviceIcon: {
    width: '45px',
    height: '45px',
    flex: '0 0 45px',
    borderRadius: '12px',
    background: '#eff6ff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '21px',
  },

  requestTitleArea: {
    flex: 1,
    minWidth: 0,
  },

  requestTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '10px',
    flexWrap: 'wrap',
  },

  requestTitle: {
    margin: 0,
    fontSize: '17px',
    fontWeight: '800',
    color: '#0f172a',
  },

  serviceName: {
    marginTop: '4px',
    color: '#2563eb',
    fontSize: '13px',
    fontWeight: '700',
  },

  statusBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    borderRadius: '999px',
    padding: '5px 9px',
    fontSize: '10px',
    fontWeight: '800',
    letterSpacing: '0.4px',
    whiteSpace: 'nowrap',
  },

  infoGrid: {
    display: 'grid',
    gridTemplateColumns:
      'repeat(auto-fit, minmax(190px, 1fr))',
    gap: '12px',
    marginTop: '17px',
    paddingTop: '15px',
    borderTop:
      '1px solid #f1f5f9',
  },

  infoItem: {
    display: 'flex',
    gap: '9px',
    alignItems: 'flex-start',
  },

  infoIcon: {
    fontSize: '16px',
    width: '22px',
  },

  infoLabel: {
    color: '#94a3b8',
    fontSize: '10px',
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },

  infoValue: {
    marginTop: '2px',
    color: '#334155',
    fontSize: '13px',
    fontWeight: '600',
    lineHeight: 1.4,
  },

  requestFooter: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    marginTop: '17px',
    paddingTop: '13px',
    borderTop:
      '1px solid #f1f5f9',
  },

  createdText: {
    color: '#94a3b8',
    fontSize: '11px',
  },

  viewDetails: {
    color: '#2563eb',
    fontSize: '13px',
    fontWeight: '800',
  },

  error: {
    marginTop: '18px',
    padding: '15px',
    borderRadius: '12px',
    background: '#fef2f2',
    border: '1px solid #fecaca',
    color: '#991b1b',
    fontSize: '13px',
    lineHeight: 1.5,
  },

  retryButton: {
    marginTop: '10px',
    border: '1px solid #fecaca',
    background: '#ffffff',
    color: '#991b1b',
    borderRadius: '8px',
    padding: '7px 12px',
    fontWeight: '700',
    cursor: 'pointer',
  },

  emptyState: {
    marginTop: '18px',
    padding: '50px 20px',
    textAlign: 'center',
    borderRadius: '14px',
    background: '#f8fafc',
    border:
      '1px dashed #cbd5e1',
  },

  emptyIcon: {
    fontSize: '35px',
    marginBottom: '10px',
  },

  emptyTitle: {
    margin: 0,
    fontSize: '18px',
    fontWeight: '800',
  },

  emptyText: {
    margin: '7px auto 0',
    maxWidth: '480px',
    color: '#64748b',
    fontSize: '13px',
    lineHeight: 1.5,
  },

  footerMessage: {
    marginTop: '18px',
    padding: '13px 16px',
    textAlign: 'center',
    borderRadius: '12px',
    background: '#ffffff',
    border:
      '1px solid #e2e8f0',
    color: '#64748b',
    fontSize: '12px',
  },

  loadingCard: {
    background: '#ffffff',
    borderRadius: '18px',
    padding: '65px 25px',
    textAlign: 'center',
    border:
      '1px solid #e2e8f0',
    boxShadow:
      '0 6px 24px rgba(15, 23, 42, 0.06)',
  },

  loadingIcon: {
    fontSize: '35px',
  },

  loadingTitle: {
    margin: '12px 0 5px',
    fontSize: '20px',
  },

  loadingText: {
    margin: 0,
    color: '#64748b',
    fontSize: '13px',
  },
}

export default MyServiceRequests