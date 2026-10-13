import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

const emptyForm = {
  name: '',
  description: '',
  icon_name: '',
  sort_order: 0,
}

function ServiceCategories() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const [showForm, setShowForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)

  const loadCategories = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const result = await apiRequest(
        '/admin/service-categories',
        {},
        getToken(),
      )

      setData(result)
    } catch (err) {
      setError(err.message || 'Unable to load service categories')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
  let cancelled = false

  async function initialLoad() {
    try {
      const result = await apiRequest(
        '/admin/service-categories',
        {},
        getToken(),
      )

      if (!cancelled) {
        setData(result)
      }
    } catch (err) {
      if (!cancelled) {
        setError(err.message || 'Unable to load service categories')
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
}, [])

  const filteredCategories = useMemo(() => {
    const categories = data?.categories || []
    const term = search.trim().toLowerCase()

    return categories.filter((category) => {
      const matchesSearch =
        !term ||
        category.name?.toLowerCase().includes(term) ||
        category.description?.toLowerCase().includes(term) ||
        category.icon_name?.toLowerCase().includes(term)

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' && category.is_active) ||
        (statusFilter === 'INACTIVE' && !category.is_active)

      return matchesSearch && matchesStatus
    })
  }, [data, search, statusFilter])

  function openAddForm() {
    setEditingCategory(null)
    setForm(emptyForm)
    setError('')
    setSuccess('')
    setShowForm(true)
  }

  function openEditForm(category) {
    setEditingCategory(category)

    setForm({
      name: category.name || '',
      description: category.description || '',
      icon_name: category.icon_name || '',
      sort_order: category.sort_order ?? 0,
    })

    setError('')
    setSuccess('')
    setShowForm(true)
  }

  function closeForm() {
    if (saving) return

    setShowForm(false)
    setEditingCategory(null)
    setForm(emptyForm)
  }

  function updateForm(event) {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: name === 'sort_order' ? Number(value) : value,
    }))
  }

  async function handleSubmit(event) {
    event.preventDefault()

    const name = form.name.trim()

    if (name.length < 2) {
      setError('Category name must contain at least 2 characters.')
      return
    }

    if (form.sort_order < 0) {
      setError('Sort order cannot be negative.')
      return
    }

    try {
      setSaving(true)
      setError('')
      setSuccess('')

      const payload = {
        name,
        description: form.description.trim() || null,
        icon_name: form.icon_name.trim() || null,
        sort_order: Number(form.sort_order) || 0,
      }

      if (editingCategory) {
        await apiRequest(
          `/admin/service-categories/${editingCategory.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify(payload),
          },
          getToken(),
        )

        setSuccess('Service category updated successfully.')
      } else {
        await apiRequest(
          '/admin/service-categories',
          {
            method: 'POST',
            body: JSON.stringify(payload),
          },
          getToken(),
        )

        setSuccess('Service category created successfully.')
      }

      setShowForm(false)
      setEditingCategory(null)
      setForm(emptyForm)

      await loadCategories()
    } catch (err) {
      setError(err.message || 'Unable to save service category')
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(category) {
    const action = category.is_active ? 'disable' : 'enable'

    const confirmed = window.confirm(
      `Are you sure you want to ${action} "${category.name}"?`,
    )

    if (!confirmed) return

    try {
      setError('')
      setSuccess('')

      await apiRequest(
        `/admin/service-categories/${category.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            is_active: !category.is_active,
          }),
        },
        getToken(),
      )

      setSuccess(
        `Service category ${
          category.is_active ? 'disabled' : 'enabled'
        } successfully.`,
      )

      await loadCategories()
    } catch (err) {
      setError(err.message || 'Unable to change category status')
    }
  }

  const summary = data?.summary || {
    total: 0,
    active: 0,
    inactive: 0,
  }

  return (
    <section className="skills-page">
      <div className="skills-page-header">
        <div>
          <p className="skills-eyebrow">MASTER DATA</p>
          <h1>Service Categories</h1>
          <p className="skills-subtitle">
            Manage the service categories displayed across Vishwakarma Setu.
          </p>
        </div>

<div className="skills-heading-actions">
  <button
    type="button"
    className="skills-refresh-button"
    onClick={loadCategories}
    disabled={loading}
  >
    Refresh
  </button>

  <button
    type="button"
    className="skills-add-button"
    onClick={openAddForm}
  >
    + Add Category
  </button>
</div>      </div>

      {error && (
        <div className="skills-alert skills-alert-error">
          {error}
        </div>
      )}

      {success && (
        <div className="skills-alert skills-alert-success">
          {success}
        </div>
      )}

      <div className="skills-summary-grid">
        <article className="skills-summary-card">
          <span>Total Categories</span>
          <strong>{summary.total}</strong>
        </article>

        <article className="skills-summary-card">
          <span>Active</span>
          <strong>{summary.active}</strong>
        </article>

        <article className="skills-summary-card">
          <span>Inactive</span>
          <strong>{summary.inactive}</strong>
        </article>

        <article className="skills-summary-card">
          <span>Showing</span>
          <strong>{filteredCategories.length}</strong>
        </article>
      </div>

      <div className="skills-toolbar">
        <div className="skills-search">
          <label htmlFor="category-search">Search</label>

          <input
            id="category-search"
            type="search"
            placeholder="Search name, description or icon..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="skills-filter">
          <label htmlFor="category-status">Status</label>

          <select
            id="category-status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="ALL">All</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
        </div>
      </div>

      {showForm && (
        <div className="skills-form-card">
          <div className="skills-form-heading">
            <div>
              <p className="skills-eyebrow">
                {editingCategory ? 'EDIT MASTER DATA' : 'NEW MASTER DATA'}
              </p>

              <h2>
                {editingCategory
                  ? 'Edit Service Category'
                  : 'Add Service Category'}
              </h2>
            </div>

            <button
              type="button"
              className="skills-close-button"
              onClick={closeForm}
              disabled={saving}
            >
              Close
            </button>
          </div>

          <form className="skills-form" onSubmit={handleSubmit}>
            <div className="skills-form-grid">
              <label>
                Category Name
                <input
                  name="name"
                  value={form.name}
                  onChange={updateForm}
                  maxLength={150}
                  required
                />
              </label>

              <label>
                Icon Name
                <input
                  name="icon_name"
                  value={form.icon_name}
                  onChange={updateForm}
                  maxLength={100}
                  placeholder="Example: cctv"
                />
              </label>

              <label>
                Sort Order
                <input
                  name="sort_order"
                  type="number"
                  min="0"
                  value={form.sort_order}
                  onChange={updateForm}
                  required
                />
              </label>
            </div>

            <label className="skills-description-field">
              Description
              <textarea
                name="description"
                value={form.description}
                onChange={updateForm}
                maxLength={2000}
                rows={4}
              />
            </label>

<div className="skills-form-actions">
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
    disabled={saving}
  >
    {saving
      ? 'Saving...'
      : editingCategory
        ? 'Save Changes'
        : 'Create Category'}
  </button>
</div>          </form>
        </div>
      )}

      <div className="skills-table-card">
        <div className="skills-table-heading">
          <div>
            <p className="skills-eyebrow">CATEGORY DIRECTORY</p>
            <h2>
              {filteredCategories.length} of {summary.total} Categories
            </h2>
          </div>
        </div>

        {loading ? (
          <div className="skills-empty-state">
            Loading service categories...
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="skills-empty-state">
            No service categories match the current filters.
          </div>
        ) : (
          <div className="skills-table-wrap">
            <table className="skills-table">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Category</th>
                  <th>Icon</th>
                  <th>Status</th>
                  <th>Services</th>
                  <th>Active Services</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredCategories.map((category) => (
                  <tr key={category.id}>
                    <td>
                      <strong>{category.sort_order}</strong>
                    </td>

                    <td>
                      <div className="skills-name-cell">
                        <strong>{category.name}</strong>

                        <span>
                          {category.description || 'No description'}
                        </span>
                      </div>
                    </td>

                    <td>{category.icon_name || '—'}</td>

                    <td>
                      <span
                        className={
                          category.is_active
                            ? 'skills-status skills-status-active'
                            : 'skills-status skills-status-inactive'
                        }
                      >
                        {category.is_active ? 'ACTIVE' : 'INACTIVE'}
                      </span>
                    </td>

                    <td>{category.services?.total ?? 0}</td>

                    <td>{category.services?.active ?? 0}</td>

                    <td>
<div className="skill-row-actions">
  <button
    type="button"
    onClick={() => openEditForm(category)}
  >
    Edit
  </button>

  <button
    type="button"
    className={
      category.is_active
        ? 'disable'
        : 'enable'
    }
    onClick={() => handleStatusChange(category)}
  >
    {category.is_active ? 'Disable' : 'Enable'}
  </button>
</div>                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default ServiceCategories