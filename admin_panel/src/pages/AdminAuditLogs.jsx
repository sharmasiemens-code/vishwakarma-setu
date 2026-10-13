import { useEffect, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

const actions = {
  SYSTEM_SETTING_CHANGED: 'System setting changed',
  USER_PASSWORD_RESET: 'Customer/technician password reset',
  ADMIN_ROLE_ASSIGNED: 'Administrator role assigned',
  ADMIN_USER_CREATED: 'Administrator created',
  ADMIN_USER_STATUS_CHANGED: 'Administrator account status changed',
  TECHNICIAN_ACCOUNT_STATUS_CHANGED: 'Technician account status changed',
  TECHNICIAN_KYC_STATUS_CHANGED: 'Technician KYC status changed',
}

const uuidPattern =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'

export default function AdminAuditLogs() {
  const [request, setRequest] = useState({
    filters: {}, page: 1, revision: 0,
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterError, setFilterError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setLoading(true)
      setError('')
      setData(null)
      try {
        const params = new URLSearchParams({
          ...request.filters,
          page: String(request.page),
          page_size: '25',
        })
        const result = await apiRequest(
          `/admin/audit-logs?${params}`,
          { signal: controller.signal },
          getToken(),
        )
        if (!controller.signal.aborted) setData(result)
      } catch (err) {
        if (!controller.signal.aborted) {
          setError(
            err.status === 403
              ? 'You do not have permission to view audit logs.'
              : err.status === 401
                ? 'Your session has expired. Please log in again.'
                : 'Unable to load audit logs. Check the filters and try again.',
          )
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }, 0)

    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [request])

  function applyFilters(event) {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    const filters = {}
    for (const [key, value] of values.entries()) {
      const trimmed = String(value).trim()
      if (trimmed) filters[key] = trimmed
    }

    for (const key of ['created_from', 'created_to']) {
      if (filters[key]) {
        const date = new Date(filters[key])
        if (Number.isNaN(date.getTime())) {
          setFilterError('Enter valid dates.')
          return
        }
        filters[key] = date.toISOString()
      }
    }

    if (
      filters.created_from && filters.created_to &&
      filters.created_from > filters.created_to
    ) {
      setFilterError('From date must not be later than To date.')
      return
    }

    setFilterError('')
    setLoading(true)
    setRequest((previous) => ({
      filters, page: 1, revision: previous.revision + 1,
    }))
  }

  function resetFilters() {
    setFilterError('')
    setLoading(true)
    setRequest((previous) => ({
      filters: {}, page: 1, revision: previous.revision + 1,
    }))
  }

  function changePage(page) {
    setLoading(true)
    setRequest((previous) => ({ ...previous, page }))
  }

  const rows = data?.audit_logs || []

  return (
    <div className="admin-audit-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">PLATFORM</p>
          <h1>Audit Logs</h1>
          <p className="page-subtitle">
            Review administrator role, account and technician KYC changes.
          </p>
        </div>
        <button
          type="button"
          className="skills-refresh-button"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setRequest((previous) => ({
              ...previous, revision: previous.revision + 1,
            }))
          }}
        >
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      <form
        className="audit-filters"
        onSubmit={applyFilters}
        onReset={resetFilters}
      >
        <label>
          Action
          <select name="action" defaultValue="">
            <option value="">All actions</option>
            {Object.entries(actions).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
        </label>
        <label>
          Target type
          <select name="target_type" defaultValue="">
            <option value="">All targets</option>
            <option value="USER">User</option>
            <option value="TECHNICIAN">Technician</option>
            <option value="TECHNICIAN_KYC">Technician KYC</option>
            <option value="SYSTEM_SETTING">System setting</option>
          </select>
        </label>
        <label>
          Actor user ID
          <input name="actor_user_id" pattern={uuidPattern}
            placeholder="Full UUID" title="Enter a complete UUID" />
        </label>
        <label>
          Target ID
          <input name="target_id" pattern={uuidPattern}
            placeholder="Full UUID" title="Enter a complete UUID" />
        </label>
        <label>
          From (your local time)
          <input name="created_from" type="datetime-local" />
        </label>
        <label>
          To (your local time)
          <input name="created_to" type="datetime-local" />
        </label>
        <div className="audit-filter-actions">
          <button className="skills-refresh-button" disabled={loading}>
            Apply filters
          </button>
          <button type="reset" className="skills-refresh-button"
            disabled={loading}>
            Clear
          </button>
        </div>
      </form>

      {filterError && (
        <div className="admin-error-message" role="alert">{filterError}</div>
      )}
      {error && (
        <div className="admin-error-message" role="alert">{error}</div>
      )}
      {loading && (
        <div className="status-panel" role="status">Loading audit logs...</div>
      )}

      {!loading && !error && data && (
        <>
          <div className="notification-results-bar" aria-live="polite">
            Page {request.page} ? {rows.length} events
          </div>
          <div className="skills-table-card">
            <div className="skills-table-wrapper">
              <table className="skills-table audit-table">
                <thead>
                  <tr>
                    <th>Time</th><th>Action</th><th>Actor</th>
                    <th>Target</th><th>Details</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan="5" className="empty-table-message">
                        No audit events match these filters.
                      </td>
                    </tr>
                  )}
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <time dateTime={row.created_at}>
                          {new Date(row.created_at).toLocaleString('en-IN', {
                            dateStyle: 'medium', timeStyle: 'medium',
                          })}
                        </time>
                      </td>
                      <td>{actions[row.action] || row.action}</td>
                      <td>
                        <strong>{row.actor_role_code.replaceAll('_', ' ')}</strong>
                        <code className="audit-reference">{row.actor_user_id}</code>
                      </td>
                      <td>
                        {row.target_type.replaceAll('_', ' ')}
                        <code className="audit-reference">{row.target_id}</code>
                      </td>
                      <td>
                        <details>
                          <summary>View changes</summary>
                          <strong>Before</strong>
                          <pre>{JSON.stringify(row.before_values, null, 2)}</pre>
                          <strong>After</strong>
                          <pre>{JSON.stringify(row.after_values, null, 2)}</pre>
                          <strong>Reason</strong>
                          <p className="audit-reason">{row.reason || 'No reason recorded'}</p>
                          <code className="audit-reference">Event: {row.id}</code>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="audit-pagination">
            <button type="button" className="skills-refresh-button"
              disabled={request.page <= 1}
              onClick={() => changePage(request.page - 1)}>
              Previous
            </button>
            <span>Page {request.page}</span>
            <button type="button" className="skills-refresh-button"
              disabled={!data.pagination.has_more || request.page >= 10000}
              onClick={() => changePage(request.page + 1)}>
              Next
            </button>
          </div>
        </>
      )}
      <p className="location-help-text">
        Audit recording began with C31. Earlier changes are not included.
        Times are displayed in your local timezone.
      </p>
    </div>
  )
}
