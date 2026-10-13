import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

export default function RolesPermissions({ user }) {
  const [roles, setRoles] = useState([])
  const [selectedCode, setSelectedCode] = useState('SUPER_ADMIN')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const loadRoles = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const result = await apiRequest(
        '/admin/roles',
        {},
        getToken(),
      )

      if (!Array.isArray(result?.roles)) {
        throw new Error('Invalid role data received')
      }

      setRoles(result.roles)
    } catch (err) {
      setRoles([])
      setError(err.message || 'Unable to load administrative roles.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => {
      loadRoles()
    }, 0)

    return () => clearTimeout(timer)
  }, [loadRoles])

  const selectedRole = roles.find(
    (role) => role.code === selectedCode,
  ) || roles[0]

  const permissionCount = new Set(
    roles.flatMap(
      (role) => role.permissions.map((permission) => permission.code),
    ),
  ).size

  return (
    <div className="admin-users-page">
      <div className="skills-heading">
        <div>
          <p className="eyebrow">PLATFORM</p>
          <h1>Roles &amp; Permissions</h1>
          <p className="page-subtitle">
            Review administrator access enforced by the backend.
          </p>
        </div>

        <button
          type="button"
          className="skills-refresh-button"
          onClick={loadRoles}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="admin-error-message" role="alert">
          {error}
        </div>
      )}

      <div className="admin-users-summary">
        <div className="admin-user-stat">
          <span>Administrative Roles</span>
          <strong>{roles.length}</strong>
        </div>

        <div className="admin-user-stat">
          <span>Defined Permissions</span>
          <strong>{permissionCount}</strong>
        </div>

        <div className="admin-user-stat active">
          <span>Your Role</span>
          <strong>{user?.admin_role_name || 'Administrator'}</strong>
        </div>
      </div>

      {loading && (
        <div className="status-panel" role="status">
          Loading role definitions...
        </div>
      )}

      {!loading && roles.length > 0 && (
        <>
          <div className="skills-table-card">
            <div className="admin-users-table-wrap">
              <table className="skills-table">
                <caption>Administrative role overview</caption>
                <thead>
                  <tr>
                    <th scope="col">Role</th>
                    <th scope="col">Purpose</th>
                    <th scope="col">Permissions</th>
                  </tr>
                </thead>

                <tbody>
                  {roles.map((role) => (
                    <tr key={role.code}>
                      <td><strong>{role.name}</strong></td>
                      <td>{role.description}</td>
                      <td>{role.permissions.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="admin-users-toolbar">
            <label htmlFor="admin-role-permission-selection">
              View permissions for
            </label>

            <select
              id="admin-role-permission-selection"
              value={selectedRole?.code || ''}
              onChange={(event) => setSelectedCode(event.target.value)}
            >
              {roles.map((role) => (
                <option key={role.code} value={role.code}>
                  {role.name}
                </option>
              ))}
            </select>
          </div>

          <div className="notification-results-bar">
            {selectedRole?.name}: {selectedRole?.permissions.length || 0}
            {' '}permissions
          </div>

          <div className="skills-table-card">
            <div className="admin-users-table-wrap">
              <table className="skills-table">
                <caption>{selectedRole?.name} permissions</caption>
                <thead>
                  <tr>
                    <th scope="col">Permission</th>
                    <th scope="col">Allowed Action</th>
                  </tr>
                </thead>

                <tbody>
                  {selectedRole?.permissions.length === 0 && (
                    <tr>
                      <td colSpan="2" className="empty-table-message">
                        No permissions are enabled for this role yet.
                      </td>
                    </tr>
                  )}

                  {selectedRole?.permissions.map((permission) => (
                    <tr key={permission.code}>
                      <td><code>{permission.code}</code></td>
                      <td>{permission.description}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <p className="location-help-text">
        Selecting a role here only displays its permissions.
        It does not change your account or any administrator assignment.
      </p>
    </div>
  )
}