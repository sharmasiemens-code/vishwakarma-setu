import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function Services() {
  const token = getToken()

  const [services, setServices] = useState([])
  const [categories, setCategories] = useState([])
  const [summary, setSummary] = useState({
    total: 0,
    active: 0,
    inactive: 0,
    with_skills: 0,
    with_tools: 0,
  })

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [categoryFilter, setCategoryFilter] = useState('ALL')

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [showEditor, setShowEditor] = useState(false)
  const [editingService, setEditingService] = useState(null)

  const [form, setForm] = useState({
    category_id: '',
    name: '',
    description: '',
  })

  async function loadData() {
    setLoading(true)
    setError('')

    try {
      const [serviceData, categoryData] = await Promise.all([
        apiRequest('/admin/services', {}, token),
        apiRequest('/admin/service-categories', {}, token),
      ])

      setServices(serviceData.services || [])
      setSummary(
        serviceData.summary || {
          total: 0,
          active: 0,
          inactive: 0,
          with_skills: 0,
          with_tools: 0,
        },
      )

      setCategories(categoryData.categories || [])
    } catch (err) {
      setError(err.message || 'Unable to load services')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
  let cancelled = false

  async function initialLoad() {
    setLoading(true)
    setError('')

    try {
      const [serviceData, categoryData] = await Promise.all([
        apiRequest('/admin/services', {}, token),
        apiRequest('/admin/service-categories', {}, token),
      ])

      if (cancelled) return

      setServices(serviceData.services || [])
      setSummary(
        serviceData.summary || {
          total: 0,
          active: 0,
          inactive: 0,
          with_skills: 0,
          with_tools: 0,
        },
      )
      setCategories(categoryData.categories || [])
    } catch (err) {
      if (!cancelled) {
        setError(err.message || 'Unable to load services')
      }
    } finally {
      if (!cancelled) {
        setLoading(false)
      }
    }
  }

  initialLoad()

  return () => {
    cancelled = true
  }
}, [token])

  const filteredServices = useMemo(() => {
    const term = search.trim().toLowerCase()

    return services.filter((service) => {
      const matchesSearch =
        !term ||
        service.name?.toLowerCase().includes(term) ||
        service.description?.toLowerCase().includes(term) ||
        service.category_name?.toLowerCase().includes(term)

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && service.is_active) ||
        (statusFilter === 'INACTIVE' && !service.is_active)

      const matchesCategory =
        categoryFilter === 'ALL' ||
        service.category_id === categoryFilter

      return matchesSearch && matchesStatus && matchesCategory
    })
  }, [services, search, statusFilter, categoryFilter])

  function openCreate() {
    setEditingService(null)
    setForm({
      category_id: '',
      name: '',
      description: '',
    })
    setError('')
    setSuccess('')
    setShowEditor(true)
  }

  function openEdit(service) {
    setEditingService(service)
    setForm({
      category_id: service.category_id,
      name: service.name || '',
      description: service.description || '',
    })
    setError('')
    setSuccess('')
    setShowEditor(true)
  }

  function closeEditor() {
    if (saving) return

    setShowEditor(false)
    setEditingService(null)
    setForm({
      category_id: '',
      name: '',
      description: '',
    })
  }

  async function handleSave(event) {
    event.preventDefault()

    const name = form.name.trim()

    if (!form.category_id) {
      setError('Please select a service category.')
      return
    }

    if (name.length < 2) {
      setError('Service name must contain at least 2 characters.')
      return
    }

    setSaving(true)
    setError('')
    setSuccess('')

    const payload = {
      category_id: form.category_id,
      name,
      description: form.description.trim() || null,
    }

    try {
      if (editingService) {
        await apiRequest(
          `/admin/services/${editingService.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
          token,
        )

        setSuccess('Service updated successfully.')
      } else {
        await apiRequest(
          '/admin/services',
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
          token,
        )

        setSuccess('Service created successfully.')
      }

      setShowEditor(false)
      setEditingService(null)

      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to save service')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatus(service) {
    const nextStatus = !service.is_active

    const confirmed = window.confirm(
      nextStatus
        ? `Enable "${service.name}"?`
        : `Disable "${service.name}"?`,
    )

    if (!confirmed) return

    setError('')
    setSuccess('')

    try {
      await apiRequest(
        `/admin/services/${service.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            is_active: nextStatus,
          }),
        },
        token,
      )

      setSuccess(
        nextStatus
          ? 'Service enabled successfully.'
          : 'Service disabled successfully.',
      )

      await loadData()
    } catch (err) {
      setError(err.message || 'Unable to change service status')
    }
  }

  return (
    <div className="skills-page">
      <div className="skills-heading">
        <div>
          <h1>Services</h1>
          <p>
            Manage customer-facing services and their service categories.
            Skills and Tools mappings are managed separately.
          </p>
        </div>

        <div className="skills-heading-actions">
          <button
            type="button"
            className="skills-refresh-button"
            onClick={loadData}
            disabled={loading}
          >
            Refresh
          </button>

          <button
            type="button"
            className="skills-add-button"
            onClick={openCreate}
          >
            + Add Service
          </button>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {success && <div className="admin-success">{success}</div>}

      <div className="skills-summary-grid">
        <div className="skills-summary-card">
          <span>Total Services</span>
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
          <span>Showing</span>
          <strong>{filteredServices.length}</strong>
        </div>
      </div>

      <div className="skills-toolbar">
        <input
          type="search"
          placeholder="Search service, category or description..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />

        <select
          value={categoryFilter}
          onChange={(event) => setCategoryFilter(event.target.value)}
        >
          <option value="ALL">All Categories</option>

          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
        >
          <option value="ALL">All Status</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
        </select>
      </div>

      {showEditor && (
        <form className="skill-editor-card" onSubmit={handleSave}>
          <div className="skill-editor-heading">
            <div>
              <h2>{editingService ? 'Edit Service' : 'Add Service'}</h2>
              <p>
                {editingService
                  ? 'Update the selected service.'
                  : 'Create a new service under an active category.'}
              </p>
            </div>

            <button
              type="button"
              className="skill-editor-close"
              onClick={closeEditor}
              disabled={saving}
            >
              ×
            </button>
          </div>

          <div className="skill-editor-fields">
            <label>
              Category
              <select
                value={form.category_id}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    category_id: event.target.value,
                  }))
                }
                required
              >
                <option value="">Select Category</option>

                {categories
                  .filter(
                    (category) =>
                      category.is_active ||
                      category.id === editingService?.category_id,
                  )
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                      {!category.is_active ? ' (Inactive)' : ''}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Service Name
              <input
                type="text"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                maxLength={150}
                required
              />
            </label>

            <label className="skill-editor-description">
              Description
              <textarea
                value={form.description}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                rows={3}
                maxLength={2000}
              />
            </label>
          </div>

          <div className="skill-editor-footer">
            <button
              type="button"
              className="skill-cancel-button"
              onClick={closeEditor}
              disabled={saving}
            >
              Cancel
            </button>

            <button
              type="submit"
              className="skill-save-button"
              disabled={saving}
            >
              {saving
                ? 'Saving...'
                : editingService
                  ? 'Save Changes'
                  : 'Create Service'}
            </button>
          </div>
        </form>
      )}

      <div className="skills-table-card">
        {loading ? (
          <div className="skills-empty-state">Loading services...</div>
        ) : filteredServices.length === 0 ? (
          <div className="skills-empty-state">No services found.</div>
        ) : (
          <div className="skills-table-wrap">
            <table className="skills-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Skills</th>
                  <th>Tools</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredServices.map((service) => (
                  <tr key={service.id}>
                    <td className="skills-name-cell">
                      <strong>{service.name}</strong>

                      {service.description && (
                        <span>{service.description}</span>
                      )}
                    </td>

                    <td>
                      <strong>{service.category_name}</strong>

                      {!service.category_is_active && (
                        <span className="skills-muted-text">
                          Category inactive
                        </span>
                      )}
                    </td>

                    <td>
                      <span
                        className={
                          service.is_active
                            ? 'status-pill active'
                            : 'status-pill inactive'
                        }
                      >
                        {service.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>

                    <td>{service.skills_count}</td>
                    <td>{service.tools_count}</td>

                    <td>
                      <div className="skill-row-actions">
                        <button
                          type="button"
                          onClick={() => openEdit(service)}
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          className={
                            service.is_active ? 'disable' : 'enable'
                          }
                          onClick={() => handleStatus(service)}
                        >
                          {service.is_active ? 'Disable' : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default Services