import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return '—'

  if (seconds < 60) return `${seconds}s`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`

  const days = Math.floor(hours / 24)
  return `${days}d`
}

function formatDate(value) {
  if (!value) return '—'

  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatType(value) {
  if (!value) return '—'

  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function AdminExceptions() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [severityFilter, setSeverityFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')

  const loadExceptions = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const token = getToken()

      const result = await apiRequest(
        '/admin/exceptions',
        {},
        token,
      )

      setData(result)
    } catch (err) {
      setError(
        err.message || 'Unable to load operational exceptions.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadExceptions()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadExceptions])

  const exceptions = useMemo(() => {
    const rows = data?.exceptions || []
    const query = search.trim().toLowerCase()

    return rows.filter((item) => {
      const matchesSearch =
        !query ||
        item.title?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.customer_name?.toLowerCase().includes(query) ||
        item.technician_name?.toLowerCase().includes(query) ||
        item.service_name?.toLowerCase().includes(query) ||
        item.reference_id?.toLowerCase().includes(query)

      const matchesSeverity =
        severityFilter === 'ALL' ||
        item.severity === severityFilter

      const matchesType =
        typeFilter === 'ALL' ||
        item.type === typeFilter

      return (
        matchesSearch &&
        matchesSeverity &&
        matchesType
      )
    })
  }, [
    data,
    search,
    severityFilter,
    typeFilter,
  ])

  const summary = data?.summary || {
    total: 0,
    critical: 0,
    errors: 0,
    warnings: 0,
    unmatched_requests: 0,
    open_with_job: 0,
    stuck_jobs: 0,
    technician_mismatches: 0,
  }

  return (
    <div className="admin-exceptions-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Exceptions / Stuck Jobs</h1>
          <p className="page-subtitle">
            Monitor requests, jobs and technician states that
            require operational attention.
          </p>
        </div>

        <div className="skills-heading-actions">
          <button
            type="button"
            className="skills-refresh-button"
            onClick={loadExceptions}
            disabled={loading}
          >
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="admin-error-message">
          {error}
        </div>
      )}

      <div className="exception-summary-grid">
        <div className="exception-summary-card">
          <span>Total Exceptions</span>
          <strong>{summary.total}</strong>
        </div>

        <div className="exception-summary-card critical">
          <span>Critical</span>
          <strong>{summary.critical}</strong>
        </div>

        <div className="exception-summary-card error">
          <span>Errors</span>
          <strong>{summary.errors}</strong>
        </div>

        <div className="exception-summary-card warning">
          <span>Warnings</span>
          <strong>{summary.warnings}</strong>
        </div>

        <div className="exception-summary-card unmatched">
          <span>Unmatched Requests</span>
          <strong>{summary.unmatched_requests}</strong>
        </div>

        <div className="exception-summary-card stuck">
          <span>Stuck Jobs</span>
          <strong>{summary.stuck_jobs}</strong>
        </div>
      </div>

      <div className="exception-secondary-summary">
        <span>
          Open with Job:
          <strong> {summary.open_with_job}</strong>
        </span>

        <span>
          Technician Mismatches:
          <strong> {summary.technician_mismatches}</strong>
        </span>

        <span>
          Unmatched threshold:
          <strong>
            {' '}
            {data?.thresholds?.unmatched_request_minutes || 30} min
          </strong>
        </span>

        <span>
          Stuck-job threshold:
          <strong>
            {' '}
            {data?.thresholds?.stuck_active_job_hours || 2} hr
          </strong>
        </span>
      </div>

      <div className="exception-toolbar">
        <input
          type="search"
          placeholder="Search title, customer, technician or reference..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={severityFilter}
          onChange={(event) =>
            setSeverityFilter(event.target.value)
          }
        >
          <option value="ALL">All Severity</option>
          <option value="CRITICAL">Critical</option>
          <option value="ERROR">Error</option>
          <option value="WARNING">Warning</option>
        </select>

        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value)
          }
        >
          <option value="ALL">All Exception Types</option>
          <option value="UNMATCHED_REQUEST">
            Unmatched Request
          </option>
          <option value="OPEN_WITH_JOB">
            Open With Job
          </option>
          <option value="STUCK_ACTIVE_JOB">
            Stuck Active Job
          </option>
          <option value="TECHNICIAN_STATE_MISMATCH">
            Technician State Mismatch
          </option>
        </select>
      </div>

      <div className="notification-results-bar">
        Showing <strong>{exceptions.length}</strong> of{' '}
        <strong>{summary.total}</strong> exceptions
      </div>

      <div className="skills-table-card">
        <div className="exception-table-wrap">
          <table className="skills-table exception-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Type</th>
                <th>Issue</th>
                <th>Customer</th>
                <th>Technician</th>
                <th>Job Status</th>
                <th>Availability</th>
                <th>Age</th>
                <th>Updated</th>
                <th>Reference</th>
              </tr>
            </thead>

            <tbody>
              {!loading && exceptions.length === 0 && (
                <tr>
                  <td
                    colSpan="10"
                    className="empty-table-message"
                  >
                    No operational exceptions match the
                    selected filters.
                  </td>
                </tr>
              )}

              {exceptions.map((item, index) => (
                <tr
                  key={`${item.type}-${item.reference_id}-${index}`}
                >
                  <td>
                    <span
                      className={`exception-severity ${
                        item.severity?.toLowerCase()
                      }`}
                    >
                      {item.severity}
                    </span>
                  </td>

                  <td>
                    <span className="exception-type">
                      {formatType(item.type)}
                    </span>
                  </td>

                  <td>
                    <div className="exception-issue">
                      <strong>{item.title || '—'}</strong>
                      <span>{item.description}</span>

                      {item.service_name && (
                        <small>
                          Service: {item.service_name}
                        </small>
                      )}
                    </div>
                  </td>

                  <td>{item.customer_name || '—'}</td>

                  <td>{item.technician_name || '—'}</td>

                  <td>{item.job_status || '—'}</td>

                  <td>
                    {item.availability_status || '—'}
                  </td>

                  <td>
                    <strong>
                      {formatAge(item.age_seconds)}
                    </strong>
                  </td>

                  <td>{formatDate(item.updated_at)}</td>

                  <td>
                    <span className="notification-reference">
                      {item.reference_id || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="location-help-text">
        This screen is monitoring-only. It identifies operational
        conditions requiring review and does not automatically
        change requests, jobs or technician status.
      </p>
    </div>
  )
}