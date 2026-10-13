import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function formatDate(value) {
  if (!value) return '—'

  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function issueLabel(issue) {
  const labels = {
    ACTIVE_JOB_NOT_BUSY: 'Active job but status is not BUSY',
    BUSY_WITHOUT_ACTIVE_JOB: 'BUSY without active job',
    ONLINE_WITHOUT_LIVE_GPS: 'ONLINE without live GPS',
    ONLINE_ACCOUNT_DISABLED: 'ONLINE account is disabled',
    ONLINE_KYC_NOT_APPROVED: 'ONLINE without approved KYC',
  }

  return labels[issue] || issue
}

export default function TechnicianAvailability() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [issueFilter, setIssueFilter] = useState('ALL')

  const loadAvailability = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const token = getToken()
      const result = await apiRequest(
        '/admin/availability',
        {},
        token,
      )
      setData(result)
    } catch (err) {
      setError(
        err.message || 'Unable to load technician availability.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadAvailability()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadAvailability])

  const technicians = useMemo(() => {
    const rows = data?.technicians || []
    const query = search.trim().toLowerCase()

    return rows.filter((item) => {
      const matchesSearch =
        !query ||
        item.full_name?.toLowerCase().includes(query) ||
        item.phone?.toLowerCase().includes(query) ||
        item.email?.toLowerCase().includes(query)

      const matchesStatus =
        statusFilter === 'ALL' ||
        item.availability_status === statusFilter

      const matchesIssue =
        issueFilter === 'ALL' ||
        (issueFilter === 'ISSUES' && item.has_issue) ||
        (issueFilter === 'OK' && !item.has_issue)

      return matchesSearch && matchesStatus && matchesIssue
    })
  }, [data, search, statusFilter, issueFilter])

  const summary = data?.summary || {
    technicians: 0,
    online: 0,
    offline: 0,
    declared_busy: 0,
    actual_busy: 0,
    issues: 0,
  }

  return (
    <div className="technician-availability-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Availability / Busy Status</h1>
          <p className="page-subtitle">
            Compare technician availability with active jobs and
            GPS status.
          </p>
        </div>

        <div className="skills-heading-actions">
          <button
            type="button"
            className="skills-refresh-button"
            onClick={loadAvailability}
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

      <div className="availability-summary-grid">
        <div className="availability-summary-card">
          <span>Total Technicians</span>
          <strong>{summary.technicians}</strong>
        </div>

        <div className="availability-summary-card online">
          <span>Online</span>
          <strong>{summary.online}</strong>
        </div>

        <div className="availability-summary-card offline">
          <span>Offline</span>
          <strong>{summary.offline}</strong>
        </div>

        <div className="availability-summary-card busy">
          <span>Declared Busy</span>
          <strong>{summary.declared_busy}</strong>
        </div>

        <div className="availability-summary-card actual-busy">
          <span>Actual Busy</span>
          <strong>{summary.actual_busy}</strong>
        </div>

        <div className="availability-summary-card issue">
          <span>Status Issues</span>
          <strong>{summary.issues}</strong>
        </div>
      </div>

      <div className="availability-toolbar">
        <input
          type="search"
          placeholder="Search technician, phone or email..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value)
          }
        >
          <option value="ALL">All Availability</option>
          <option value="ONLINE">Online</option>
          <option value="BUSY">Busy</option>
          <option value="OFFLINE">Offline</option>
        </select>

        <select
          value={issueFilter}
          onChange={(event) =>
            setIssueFilter(event.target.value)
          }
        >
          <option value="ALL">All Health</option>
          <option value="ISSUES">Issues Only</option>
          <option value="OK">Healthy Only</option>
        </select>
      </div>

      <div className="skills-table-card">
        <div className="availability-table-wrap">
          <table className="skills-table availability-table">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Declared</th>
                <th>Active Jobs</th>
                <th>Actual State</th>
                <th>GPS</th>
                <th>KYC</th>
                <th>Account</th>
                <th>Health</th>
                <th>Last GPS</th>
              </tr>
            </thead>

            <tbody>
              {!loading && technicians.length === 0 && (
                <tr>
                  <td
                    colSpan="9"
                    className="empty-table-message"
                  >
                    No technicians match the selected filters.
                  </td>
                </tr>
              )}

              {technicians.map((item) => (
                <tr key={item.technician_id}>
                  <td>
                    <div className="location-technician">
                      <strong>{item.full_name}</strong>
                      <span>
                        {item.phone || item.email || '—'}
                      </span>
                    </div>
                  </td>

                  <td>
                    <span
                      className={`availability-badge ${
                        item.availability_status?.toLowerCase() ||
                        'offline'
                      }`}
                    >
                      {item.availability_status}
                    </span>
                  </td>

                  <td>
                    <strong>{item.active_jobs}</strong>
                  </td>

                  <td>
                    <span
                      className={`actual-state-badge ${
                        item.is_busy ? 'busy' : 'free'
                      }`}
                    >
                      {item.is_busy ? 'BUSY' : 'FREE'}
                    </span>
                  </td>

                  <td>
                    <span
                      className={`gps-badge ${
                        item.gps_status?.toLowerCase() ||
                        'missing'
                      }`}
                    >
                      {item.gps_status}
                    </span>
                  </td>

                  <td>{item.kyc_status}</td>

                  <td>
                    <span
                      className={`account-state ${
                        item.account_active
                          ? 'active'
                          : 'disabled'
                      }`}
                    >
                      {item.account_active
                        ? 'ACTIVE'
                        : 'DISABLED'}
                    </span>
                  </td>

                  <td>
                    {item.has_issue ? (
                      <div className="availability-issues">
                        {item.issues.map((issue) => (
                          <span key={issue}>
                            {issueLabel(issue)}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="health-ok">
                        HEALTHY
                      </span>
                    )}
                  </td>

                  <td>{formatDate(item.last_seen_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="location-help-text">
        Declared status comes from the technician profile. Actual
        Busy is calculated from active jobs. This screen does not
        change technician availability automatically.
      </p>
    </div>
  )
}