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

function formatType(value) {
  if (!value) return 'GENERAL'

  return value
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

export default function AdminNotifications() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('ALL')
  const [readFilter, setReadFilter] = useState('ALL')
  const [typeFilter, setTypeFilter] = useState('ALL')

  const loadNotifications = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const token = getToken()
      const result = await apiRequest(
        '/admin/notifications',
        {},
        token,
      )
      setData(result)
    } catch (err) {
      setError(
        err.message || 'Unable to load notifications.',
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadNotifications()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadNotifications])

  const notifications = useMemo(() => {
    const rows = data?.notifications || []
    const query = search.trim().toLowerCase()

    return rows.filter((item) => {
      const matchesSearch =
        !query ||
        item.recipient_name?.toLowerCase().includes(query) ||
        item.recipient_phone?.toLowerCase().includes(query) ||
        item.recipient_email?.toLowerCase().includes(query) ||
        item.title?.toLowerCase().includes(query) ||
        item.message?.toLowerCase().includes(query) ||
        item.notification_type?.toLowerCase().includes(query) ||
        item.reference_id?.toLowerCase().includes(query)

      const matchesRole =
        roleFilter === 'ALL' ||
        item.recipient_role === roleFilter

      const matchesRead =
        readFilter === 'ALL' ||
        (readFilter === 'UNREAD' && !item.is_read) ||
        (readFilter === 'READ' && item.is_read)

      const matchesType =
        typeFilter === 'ALL' ||
        item.notification_type === typeFilter

      return (
        matchesSearch &&
        matchesRole &&
        matchesRead &&
        matchesType
      )
    })
  }, [
    data,
    search,
    roleFilter,
    readFilter,
    typeFilter,
  ])

  const summary = data?.summary || {
    total: 0,
    unread: 0,
    read: 0,
    customer_notifications: 0,
    technician_notifications: 0,
  }

  const types = data?.types || []

  return (
    <div className="admin-notifications-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">OPERATIONS</p>
          <h1>Notifications</h1>
          <p className="page-subtitle">
            Monitor marketplace notifications sent to customers
            and technicians.
          </p>
        </div>

        <div className="skills-heading-actions">
          <button
            type="button"
            className="skills-refresh-button"
            onClick={loadNotifications}
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

      <div className="notification-summary-grid">
        <div className="notification-summary-card">
          <span>Total</span>
          <strong>{summary.total}</strong>
        </div>

        <div className="notification-summary-card unread">
          <span>Unread</span>
          <strong>{summary.unread}</strong>
        </div>

        <div className="notification-summary-card read">
          <span>Read</span>
          <strong>{summary.read}</strong>
        </div>

        <div className="notification-summary-card customer">
          <span>Customer</span>
          <strong>
            {summary.customer_notifications}
          </strong>
        </div>

        <div className="notification-summary-card technician">
          <span>Technician</span>
          <strong>
            {summary.technician_notifications}
          </strong>
        </div>
      </div>

      <div className="notification-toolbar">
        <input
          type="search"
          placeholder="Search recipient, title, message or reference..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={roleFilter}
          onChange={(event) =>
            setRoleFilter(event.target.value)
          }
        >
          <option value="ALL">All Recipients</option>
          <option value="CUSTOMER">Customers</option>
          <option value="TECHNICIAN">Technicians</option>
        </select>

        <select
          value={readFilter}
          onChange={(event) =>
            setReadFilter(event.target.value)
          }
        >
          <option value="ALL">Read + Unread</option>
          <option value="UNREAD">Unread Only</option>
          <option value="READ">Read Only</option>
        </select>

        <select
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value)
          }
        >
          <option value="ALL">All Types</option>

          {types.map((item) => (
            <option
              key={item.notification_type}
              value={item.notification_type}
            >
              {formatType(item.notification_type)}
              {' '}({item.total})
            </option>
          ))}
        </select>
      </div>

      <div className="notification-results-bar">
        Showing <strong>{notifications.length}</strong> of{' '}
        <strong>{summary.total}</strong> notifications
      </div>

      <div className="skills-table-card">
        <div className="notification-table-wrap">
          <table className="skills-table notification-table">
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Role</th>
                <th>Notification</th>
                <th>Type</th>
                <th>Status</th>
                <th>Reference</th>
                <th>Created</th>
              </tr>
            </thead>

            <tbody>
              {!loading && notifications.length === 0 && (
                <tr>
                  <td
                    colSpan="7"
                    className="empty-table-message"
                  >
                    No notifications match the selected
                    filters.
                  </td>
                </tr>
              )}

              {notifications.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="notification-recipient">
                      <strong>
                        {item.recipient_name}
                      </strong>
                      <span>
                        {item.recipient_phone ||
                          item.recipient_email ||
                          '—'}
                      </span>
                    </div>
                  </td>

                  <td>
                    <span
                      className={`notification-role ${
                        item.recipient_role?.toLowerCase()
                      }`}
                    >
                      {item.recipient_role}
                    </span>
                  </td>

                  <td>
                    <div className="notification-content">
                      <strong>{item.title}</strong>
                      <span>{item.message}</span>
                    </div>
                  </td>

                  <td>
                    <span className="notification-type">
                      {formatType(
                        item.notification_type,
                      )}
                    </span>
                  </td>

                  <td>
                    <span
                      className={`notification-read-state ${
                        item.is_read
                          ? 'read'
                          : 'unread'
                      }`}
                    >
                      {item.is_read
                        ? 'READ'
                        : 'UNREAD'}
                    </span>
                  </td>

                  <td>
                    <span className="notification-reference">
                      {item.reference_id || '—'}
                    </span>
                  </td>

                  <td>{formatDate(item.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="location-help-text">
        Read status indicates whether the recipient has opened
        the notification. It does not represent SMS, email or
        push-delivery status.
      </p>
    </div>
  )
}