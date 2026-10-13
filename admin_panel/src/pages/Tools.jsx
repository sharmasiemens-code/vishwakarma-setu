import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

const emptyForm = {
  name: '',
  description: '',
}

function Tools() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const [showForm, setShowForm] = useState(false)
  const [editingTool, setEditingTool] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  async function refreshTools() {
    setError('')

    try {
      const response = await apiRequest(
        '/admin/tools',
        {},
        getToken(),
      )

      setData(response)
    } catch (err) {
      setError(
        err.message || 'Unable to load Tools',
      )
    }
  }

  useEffect(() => {
    let cancelled = false

    async function fetchTools() {
      try {
        const response = await apiRequest(
          '/admin/tools',
          {},
          getToken(),
        )

        if (!cancelled) {
          setData(response)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message || 'Unable to load Tools',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchTools()

    return () => {
      cancelled = true
    }
  }, [])

const filteredTools = useMemo(() => {
  const tools = data?.tools || []
  const term = search.trim().toLowerCase()

  return tools.filter((tool) => {
    const matchesSearch =
      !term ||
      tool.name?.toLowerCase().includes(term) ||
      tool.description?.toLowerCase().includes(term)

    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && tool.is_active) ||
      (statusFilter === 'INACTIVE' && !tool.is_active)

    return matchesSearch && matchesStatus
  })
}, [data, search, statusFilter])

const summary = data?.summary || {
  total: 0,
  active: 0,
  inactive: 0,
  mapped: 0,
}
  function openCreateForm() {
    setEditingTool(null)
    setForm(emptyForm)
    setFormError('')
    setSuccessMessage('')
    setShowForm(true)
  }

  function openEditForm(Tool) {
    setEditingTool(Tool)
    setForm({
      name: Tool.name || '',
      description: Tool.description || '',
    })
    setFormError('')
    setSuccessMessage('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) {
      return
    }

    setShowForm(false)
    setEditingTool(null)
    setForm(emptyForm)
    setFormError('')
  }

  function handleFormChange(event) {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const name = form.name.trim()
    const description = form.description.trim()

    if (name.length < 2) {
      setFormError(
        'Tool name must contain at least 2 characters.',
      )
      return
    }

    setSaving(true)
    setFormError('')
    setSuccessMessage('')

    try {
      if (editingTool) {
        await apiRequest(
          `/admin/tools/${editingTool.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              name,
              description,
            }),
          },
          getToken(),
        )

        setSuccessMessage(
          'Tool updated successfully.',
        )
      } else {
        await apiRequest(
          '/admin/tools',
          {
            method: 'POST',
            body: JSON.stringify({
              name,
              description,
            }),
          },
          getToken(),
        )

        setSuccessMessage(
          'Tool created successfully.',
        )
      }

      setShowForm(false)
      setEditingTool(null)
      setForm(emptyForm)

      await refreshTools()
    } catch (err) {
      setFormError(
        err.message || 'Unable to save Tool',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(tool) {
    const nextStatus = !tool.is_active

    const confirmed = window.confirm(
      `${nextStatus ? 'Enable' : 'Disable'} Tool "${tool.name}"?`,
    )

    if (!confirmed) {
      return
    }

    setSuccessMessage('')
    setError('')

    try {
      await apiRequest(
        `/admin/tools/${tool.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            is_active: nextStatus,
          }),
        },
        getToken(),
      )

      setSuccessMessage(
        `${tool.name} ${
          nextStatus ? 'enabled' : 'disabled'
        } successfully.`,
      )

      await refreshTools()
    } catch (err) {
      setError(
        err.message ||
          'Unable to change Tool status',
      )
    }
  }

  return (
    <section className="skills-page">
      <div className="skills-heading">
        <div>
          <span className="section-label">
            TECHNICIAN MANAGEMENT
          </span>

          <h2>Tools Management</h2>

          <p>
            Manage the Tools used for technician
            profiles and service matching.
          </p>
        </div>

        <div className="skills-heading-actions">
          <button
            type="button"
            className="skills-refresh-button"
            onClick={refreshTools}
          >
            Refresh
          </button>

          <button
            type="button"
            className="skills-add-button"
            onClick={openCreateForm}
          >
            + Add Tool
          </button>
        </div>
      </div>

      {successMessage && (
        <div className="skills-success-panel">
          {successMessage}
        </div>
      )}

      <div className="skills-summary-grid">
        <div className="skills-summary-card">
          <span>Total Tools</span>
          <strong>{summary.total}</strong>
        </div>

        <div className="skills-summary-card">
          <span>Active</span>
          <strong>{summary.active}</strong>
        </div>

        <div className="skills-summary-card">
          <span>Inactive</span>
          <strong>{summary.inactive}</strong>
        </div>

        <div className="skills-summary-card">
          <span>Mapped</span>
          <strong>{summary.mapped}</strong>
        </div>
      </div>

      <div className="skills-toolbar">
        <div className="skills-search">
          <label htmlFor="Tools-search">
            Search Tools
          </label>

          <input
            id="Tools-search"
            type="search"
            placeholder="Search by Tool name or description..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <div className="skills-filter">
          <label htmlFor="Tools-status">
            Status
          </label>

          <select
            id="Tools-status"
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">
              Inactive
            </option>
          </select>
        </div>
      </div>

      {showForm && (
        <form
          className="skill-editor-card"
          onSubmit={handleSubmit}
        >
          <div className="skill-editor-heading">
            <div>
              <span className="section-label">
                {editingTool
                  ? 'EDIT Tool'
                  : 'NEW Tool'}
              </span>

              <h3>
                {editingTool
                  ? editingTool.name
                  : 'Add Tool'}
              </h3>
            </div>

            <button
              type="button"
              className="skill-editor-close"
              onClick={closeForm}
              disabled={saving}
            >
              Close
            </button>
          </div>

          {formError && (
            <div className="error-panel">
              {formError}
            </div>
          )}

          <div className="skill-editor-fields">
            <div>
              <label htmlFor="Tool-name">
                Tool Name
              </label>

              <input
                id="Tool-name"
                name="name"
                type="text"
                maxLength="150"
                value={form.name}
                onChange={handleFormChange}
                disabled={saving}
                required
              />
            </div>

            <div>
              <label htmlFor="Tool-description">
                Description
              </label>

              <textarea
                id="Tool-description"
                name="description"
                maxLength="2000"
                rows="3"
                value={form.description}
                onChange={handleFormChange}
                disabled={saving}
              />
            </div>
          </div>

          <div className="skill-editor-footer">
            <span>
              {editingTool
                ? 'Changes affect the master Tool record.'
                : 'New Tools are active by default.'}
            </span>

            <div>
              <button
                type="button"
                className="skill-cancel-button"
                onClick={closeForm}
                disabled={saving}
              >
                Cancel
              </button>

              <button
                type="submit"
                className="skill-save-button"
                disabled={
                  saving ||
                  form.name.trim().length < 2
                }
              >
                {saving
                  ? 'Saving...'
                  : editingTool
                    ? 'Save Changes'
                    : 'Create Tool'}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading && (
        <div className="status-panel">
          Loading Tools...
        </div>
      )}

      {error && (
        <div className="error-panel">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="skills-table-card">
          <div className="skills-table-header">
            <div>
              <strong>Tool Directory</strong>

              <span>
                {filteredTools.length} of{' '}
                {summary.total} Tools
              </span>
            </div>
          </div>

          <div className="skills-table-wrapper">
            <table className="skills-table">
              <thead>
                <tr>
                  <th>Tool</th>
                  <th>Status</th>
                  <th>Technicians</th>
                  <th>Services</th>
                  <th>Required</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredTools.map((Tool) => (
                  <tr key={Tool.id}>
                    <td>
                      <div className="skill-name-cell">
                        <strong>
                          {Tool.name}
                        </strong>

                        <span>
                          {Tool.description ||
                            'No description'}
                        </span>
                      </div>
                    </td>

                    <td>
                      <span
                        className={`Tool-status-badge ${
                          Tool.is_active
                            ? 'active'
                            : 'inactive'
                        }`}
                      >
                        {Tool.is_active
                          ? 'ACTIVE'
                          : 'INACTIVE'}
                      </span>
                    </td>

                    <td>
                      {Tool.usage?.technicians ?? 0}
                    </td>

                    <td>
                      {Tool.usage?.services ?? 0}
                    </td>

                    <td>
                      {Tool.usage
                        ?.required_services ?? 0}
                    </td>

                    <td>
                      <div className="skill-row-actions">
                        <button
                          type="button"
                          onClick={() =>
                            openEditForm(Tool)
                          }
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          className={
                            Tool.is_active
                              ? 'disable'
                              : 'enable'
                          }
                          onClick={() =>
                            handleStatusChange(Tool)
                          }
                        >
                          {Tool.is_active
                            ? 'Disable'
                            : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredTools.length === 0 && (
                  <tr>
                    <td
                      colSpan="6"
                      className="skills-empty"
                    >
                      No Tools match the current
                      search/filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default Tools





