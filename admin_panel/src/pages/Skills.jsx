import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

const emptyForm = {
  name: '',
  description: '',
}

function Skills() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  const [showForm, setShowForm] = useState(false)
  const [editingSkill, setEditingSkill] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  async function refreshSkills() {
    setError('')

    try {
      const response = await apiRequest(
        '/admin/skills',
        {},
        getToken(),
      )

      setData(response)
    } catch (err) {
      setError(
        err.message || 'Unable to load skills',
      )
    }
  }

  useEffect(() => {
    let cancelled = false

    async function fetchSkills() {
      try {
        const response = await apiRequest(
          '/admin/skills',
          {},
          getToken(),
        )

        if (!cancelled) {
          setData(response)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message || 'Unable to load skills',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchSkills()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredSkills = useMemo(() => {
    const skills = data?.skills || []
    const term = search.trim().toLowerCase()

    return skills.filter((skill) => {
      const matchesSearch =
        !term ||
        skill.name?.toLowerCase().includes(term) ||
        skill.description?.toLowerCase().includes(term)

      const matchesStatus =
        statusFilter === 'ALL' ||
        (statusFilter === 'ACTIVE' &&
          skill.is_active) ||
        (statusFilter === 'INACTIVE' &&
          !skill.is_active)

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
    setEditingSkill(null)
    setForm(emptyForm)
    setFormError('')
    setSuccessMessage('')
    setShowForm(true)
  }

  function openEditForm(skill) {
    setEditingSkill(skill)
    setForm({
      name: skill.name || '',
      description: skill.description || '',
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
    setEditingSkill(null)
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
        'Skill name must contain at least 2 characters.',
      )
      return
    }

    setSaving(true)
    setFormError('')
    setSuccessMessage('')

    try {
      if (editingSkill) {
        await apiRequest(
          `/admin/skills/${editingSkill.id}`,
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
          'Skill updated successfully.',
        )
      } else {
        await apiRequest(
          '/admin/skills',
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
          'Skill created successfully.',
        )
      }

      setShowForm(false)
      setEditingSkill(null)
      setForm(emptyForm)

      await refreshSkills()
    } catch (err) {
      setFormError(
        err.message || 'Unable to save skill',
      )
    } finally {
      setSaving(false)
    }
  }

  async function handleStatusChange(skill) {
    const nextStatus = !skill.is_active

    const confirmed = window.confirm(
      `${nextStatus ? 'Enable' : 'Disable'} skill "${skill.name}"?`,
    )

    if (!confirmed) {
      return
    }

    setSuccessMessage('')
    setError('')

    try {
      await apiRequest(
        `/admin/skills/${skill.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            is_active: nextStatus,
          }),
        },
        getToken(),
      )

      setSuccessMessage(
        `${skill.name} ${
          nextStatus ? 'enabled' : 'disabled'
        } successfully.`,
      )

      await refreshSkills()
    } catch (err) {
      setError(
        err.message ||
          'Unable to change skill status',
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

          <h2>Skills Management</h2>

          <p>
            Manage the skills used for technician
            profiles and service matching.
          </p>
        </div>

        <div className="skills-heading-actions">
          <button
            type="button"
            className="skills-refresh-button"
            onClick={refreshSkills}
          >
            Refresh
          </button>

          <button
            type="button"
            className="skills-add-button"
            onClick={openCreateForm}
          >
            + Add Skill
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
          <span>Total Skills</span>
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
          <label htmlFor="skills-search">
            Search Skills
          </label>

          <input
            id="skills-search"
            type="search"
            placeholder="Search by skill name or description..."
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
          />
        </div>

        <div className="skills-filter">
          <label htmlFor="skills-status">
            Status
          </label>

          <select
            id="skills-status"
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
                {editingSkill
                  ? 'EDIT SKILL'
                  : 'NEW SKILL'}
              </span>

              <h3>
                {editingSkill
                  ? editingSkill.name
                  : 'Add Skill'}
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
              <label htmlFor="skill-name">
                Skill Name
              </label>

              <input
                id="skill-name"
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
              <label htmlFor="skill-description">
                Description
              </label>

              <textarea
                id="skill-description"
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
              {editingSkill
                ? 'Changes affect the master skill record.'
                : 'New skills are active by default.'}
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
                  : editingSkill
                    ? 'Save Changes'
                    : 'Create Skill'}
              </button>
            </div>
          </div>
        </form>
      )}

      {loading && (
        <div className="status-panel">
          Loading skills...
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
              <strong>Skill Directory</strong>

              <span>
                {filteredSkills.length} of{' '}
                {summary.total} skills
              </span>
            </div>
          </div>

          <div className="skills-table-wrapper">
            <table className="skills-table">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Status</th>
                  <th>Technicians</th>
                  <th>Services</th>
                  <th>Required</th>
                  <th>Actions</th>
                </tr>
              </thead>

              <tbody>
                {filteredSkills.map((skill) => (
                  <tr key={skill.id}>
                    <td>
                      <div className="skill-name-cell">
                        <strong>
                          {skill.name}
                        </strong>

                        <span>
                          {skill.description ||
                            'No description'}
                        </span>
                      </div>
                    </td>

                    <td>
                      <span
                        className={`skill-status-badge ${
                          skill.is_active
                            ? 'active'
                            : 'inactive'
                        }`}
                      >
                        {skill.is_active
                          ? 'ACTIVE'
                          : 'INACTIVE'}
                      </span>
                    </td>

                    <td>
                      {skill.usage?.technicians ?? 0}
                    </td>

                    <td>
                      {skill.usage?.services ?? 0}
                    </td>

                    <td>
                      {skill.usage
                        ?.required_services ?? 0}
                    </td>

                    <td>
                      <div className="skill-row-actions">
                        <button
                          type="button"
                          onClick={() =>
                            openEditForm(skill)
                          }
                        >
                          Edit
                        </button>

                        <button
                          type="button"
                          className={
                            skill.is_active
                              ? 'disable'
                              : 'enable'
                          }
                          onClick={() =>
                            handleStatusChange(skill)
                          }
                        >
                          {skill.is_active
                            ? 'Disable'
                            : 'Enable'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {filteredSkills.length === 0 && (
                  <tr>
                    <td
                      colSpan="6"
                      className="skills-empty"
                    >
                      No skills match the current
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

export default Skills