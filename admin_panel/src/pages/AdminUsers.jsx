
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken, hasPermission } from '../auth/auth'
import AdminRoleControl from './AdminRoleControl'

function formatDate(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export default function AdminUsers({ user }) {
  const canAssignRoles = hasPermission(user, 'roles.assign')
  const currentUserId = user?.user_id || user?.sub
  const [roles, setRoles] = useState([])
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const loadAdmins = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const [result, roleResult] = await Promise.all([
        apiRequest('/admin/admin-users', {}, getToken()),
        canAssignRoles
          ? apiRequest('/admin/roles', {}, getToken())
          : Promise.resolve(null),
      ])
      setData(result)
      setRoles(roleResult?.roles || [])
    } catch (err) {
      setError(err.message || 'Unable to load administrators.')
    } finally {
      setLoading(false)
    }
  }, [canAssignRoles])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadAdmins()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadAdmins])

  const admins = useMemo(() => {
    const query = search.trim().toLowerCase()

    return (data?.users || []).filter((item) => {
      const matchesSearch =
        !query ||
        item.full_name?.toLowerCase().includes(query) ||
        item.email?.toLowerCase().includes(query) ||
        item.phone?.includes(query)

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && item.is_active) ||
        (statusFilter === 'INACTIVE' && !item.is_active)

      return matchesSearch && matchesStatus
    })
  }, [data, search, statusFilter])

  const summary = data?.summary || {
    total: 0,
    active: 0,
    inactive: 0,
  }

  return (
    <div className="admin-users-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">PLATFORM</p>
          <h1>Admin Users</h1>
          <p className="page-subtitle">
            View administrator accounts and access status.
          </p>
        </div>

        <button
          type="button"
          className="skills-refresh-button"
          onClick={loadAdmins}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="admin-error-message">{error}</div>
      )}

      <div className="admin-users-summary">
        <div className="admin-user-stat">
          <span>Total Administrators</span>
          <strong>{summary.total}</strong>
        </div>
        <div className="admin-user-stat active">
          <span>Active</span>
          <strong>{summary.active}</strong>
        </div>
        <div className="admin-user-stat inactive">
          <span>Inactive</span>
          <strong>{summary.inactive}</strong>
        </div>
      </div>

      <div className="admin-users-toolbar">
        <input
          type="search"
          placeholder="Search name, email or phone..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="ALL">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      <div className="notification-results-bar">
        Showing {admins.length} of {summary.total} administrators
      </div>

      <div className="skills-table-card">
        <div className="admin-users-table-wrap">
          <table className="skills-table">
            <thead>
              <tr>
                <th>Administrator</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Admin Role</th>
                <th>Status</th>
                <th>Verified</th>
                <th>Created</th>
                {canAssignRoles && <th>Role Assignment</th>}
              </tr>
            </thead>

            <tbody>
              {!loading && admins.length === 0 && (
                <tr>
                  <td colSpan={canAssignRoles ? 8 : 7} className="empty-table-message">
                    No administrators found.
                  </td>
                </tr>
              )}

              {admins.map((item) => (
                <tr key={item.id}>
                  <td><strong>{item.full_name}</strong></td>
                  <td>{item.email || '—'}</td>
                  <td>{item.phone || '—'}</td>
                  <td>{item.admin_role_name || 'Unassigned'}</td>
                  <td>
                    <span className={
                      `admin-user-status ${
                        item.is_active ? 'active' : 'inactive'
                      }`
                    }>
                      {item.is_active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td>{item.is_verified ? 'YES' : 'NO'}</td>
                  <td>{formatDate(item.created_at)}</td>
                  {canAssignRoles && (
                    <td>
                      <AdminRoleControl
                        key={`${item.id}-${item.admin_role || 'unassigned'}`}
                        admin={item}
                        roles={roles}
                        currentUserId={currentUserId}
                        onChanged={loadAdmins}
                      />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="location-help-text">
        Administrator creation and account controls will be enabled
        after Super Admin authorization and audit logging are in place.
      </p>
    </div>
  )
}
