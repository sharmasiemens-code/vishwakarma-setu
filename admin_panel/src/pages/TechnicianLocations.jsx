import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return 'Never'

  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDate(value) {
  if (!value) return '—'

  const date = new Date(value)

  return date.toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function formatCoordinate(value) {
  if (value === null || value === undefined) return '—'
  return Number(value).toFixed(6)
}

export default function TechnicianLocations() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [gpsFilter, setGpsFilter] = useState('ALL')

  const loadLocations = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const token = getToken()
      const result = await apiRequest(
        '/admin/technician-locations',
        {},
        token,
      )

      setData(result)
    } catch (err) {
      setError(err.message || 'Unable to load technician locations.')
    } finally {
      setLoading(false)
    }
  }, [])

useEffect(() => {
  const timer = setTimeout(() => {
    loadLocations()
  }, 0)

  return () => clearTimeout(timer)
}, [loadLocations])
  const locations = useMemo(() => {
    const rows = data?.locations || []
    const query = search.trim().toLowerCase()

    return rows.filter((item) => {
      const matchesGps =
        gpsFilter === 'ALL' || item.gps_status === gpsFilter

      const matchesSearch =
        !query ||
        item.full_name?.toLowerCase().includes(query) ||
        item.phone?.toLowerCase().includes(query) ||
        item.email?.toLowerCase().includes(query)

      return matchesGps && matchesSearch
    })
  }, [data, search, gpsFilter])

  const summary = data?.summary || {
    technicians: 0,
    live: 0,
    stale: 0,
    missing: 0,
  }

  return (
    <div className="technician-locations-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Technician Locations</h1>
          <p className="page-subtitle">
            Monitor technician GPS freshness, accuracy and device status.
          </p>
        </div>

        <div className="skills-heading-actions">
          <button
            type="button"
            className="skills-refresh-button"
            onClick={loadLocations}
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

      <div className="location-summary-grid">
        <div className="location-summary-card">
          <span>Total Technicians</span>
          <strong>{summary.technicians}</strong>
        </div>

        <div className="location-summary-card live">
          <span>Live GPS</span>
          <strong>{summary.live}</strong>
        </div>

        <div className="location-summary-card stale">
          <span>Stale GPS</span>
          <strong>{summary.stale}</strong>
        </div>

        <div className="location-summary-card missing">
          <span>Missing GPS</span>
          <strong>{summary.missing}</strong>
        </div>
      </div>

      <div className="skills-toolbar">
        <input
          type="search"
          placeholder="Search technician, phone or email..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={gpsFilter}
          onChange={(event) => setGpsFilter(event.target.value)}
        >
          <option value="ALL">All GPS Status</option>
          <option value="LIVE">Live</option>
          <option value="STALE">Stale</option>
          <option value="MISSING">Missing</option>
        </select>
      </div>

      <div className="skills-table-card">
        <div className="location-table-wrap">
          <table className="skills-table location-table">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Availability</th>
                <th>GPS</th>
                <th>Coordinates</th>
                <th>Accuracy</th>
                <th>Battery</th>
                <th>Last Seen</th>
                <th>Age</th>
              </tr>
            </thead>

            <tbody>
              {!loading && locations.length === 0 && (
                <tr>
                  <td colSpan="8" className="empty-table-message">
                    No technician locations found.
                  </td>
                </tr>
              )}

              {locations.map((item) => (
                <tr key={item.technician_id}>
                  <td>
                    <div className="location-technician">
                      <strong>{item.full_name}</strong>
                      <span>{item.phone || item.email || '—'}</span>
                    </div>
                  </td>

                  <td>
                    <span
                      className={`availability-badge ${
                        item.availability?.toLowerCase() || 'offline'
                      }`}
                    >
                      {item.availability || 'UNKNOWN'}
                    </span>
                  </td>

                  <td>
                    <span
                      className={`gps-badge ${
                        item.gps_status?.toLowerCase() || 'missing'
                      }`}
                    >
                      {item.gps_status}
                    </span>
                  </td>

                  <td>
                    {item.latitude === null ||
                    item.longitude === null ? (
                      '—'
                    ) : (
                      <div className="coordinate-value">
                        <span>
                          {formatCoordinate(item.latitude)}
                        </span>
                        <span>
                          {formatCoordinate(item.longitude)}
                        </span>
                      </div>
                    )}
                  </td>

                  <td>
                    {item.accuracy_meters === null
                      ? '—'
                      : `±${Math.round(item.accuracy_meters)} m`}
                  </td>

                  <td>
                    {item.battery_percent === null
                      ? '—'
                      : `${item.battery_percent}%`}
                  </td>

                  <td>{formatDate(item.last_seen_at)}</td>

                  <td>
                    <strong>
                      {formatAge(item.age_seconds)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="location-help-text">
        LIVE means the technician GPS was updated within the last
        10 minutes. STALE locations are retained for operational
        visibility but should not be treated as current.
      </p>
    </div>
  )
}