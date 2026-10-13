import { useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

export default function AdminRoleControl({
  admin,
  roles,
  currentUserId,
  onChanged,
}) {
  const [selectedRole, setSelectedRole] = useState(admin.admin_role || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isOwnAccount = admin.id === currentUserId
  const unchanged = selectedRole === (admin.admin_role || '')

  async function saveRole(event) {
    event.preventDefault()

    if (isOwnAccount || !selectedRole || unchanged || saving) {
      return
    }

    setSaving(true)
    setError('')

    try {
      await apiRequest(
        `/admin/admin-users/${admin.id}/role`,
        {
          method: 'PUT',
          body: JSON.stringify({ role_code: selectedRole }),
        },
        getToken(),
      )

      await onChanged()
    } catch (err) {
      setError(err.message || 'Unable to assign administrator role.')
    } finally {
      setSaving(false)
    }
  }

  if (isOwnAccount) {
    return <span>Your own role cannot be changed here.</span>
  }

  return (
    <form onSubmit={saveRole}>
      <select
        aria-label={`Administrative role for ${admin.full_name}`}
        value={selectedRole}
        onChange={(event) => {
          setSelectedRole(event.target.value)
          setError('')
        }}
        disabled={saving || roles.length === 0}
      >
        <option value="" disabled>Select a role</option>

        {roles.map((role) => (
          <option key={role.code} value={role.code}>
            {role.name}
          </option>
        ))}
      </select>

      <button
        type="submit"
        className="skills-refresh-button"
        disabled={saving || !selectedRole || unchanged || roles.length === 0}
      >
        {saving ? 'Saving...' : 'Save Role'}
      </button>

      {error && (
        <div className="admin-error-message" role="alert">
          {error}
        </div>
      )}
    </form>
  )
}