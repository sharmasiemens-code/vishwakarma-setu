import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function ServiceSkills() {
  const token = getToken()

  const [services, setServices] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState('')

  const [serviceInfo, setServiceInfo] = useState(null)
  const [skills, setSkills] = useState([])
  const [originalSkills, setOriginalSkills] = useState([])

  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [mappingLoading, setMappingLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

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

  const categoryServices = useMemo(() => {
    if (!selectedCategory) return []

    return services.filter(
      (service) => service.category_id === selectedCategory,
    )
  }, [services, selectedCategory])

  const visibleSkills = useMemo(() => {
    const term = search.trim().toLowerCase()

    if (!term) return skills

    return skills.filter(
      (skill) =>
        skill.name?.toLowerCase().includes(term) ||
        skill.description?.toLowerCase().includes(term),
    )
  }, [skills, search])

  const mappedCount = skills.filter(
    (skill) => skill.is_mapped,
  ).length

  const requiredCount = skills.filter(
    (skill) => skill.is_mapped && skill.is_required,
  ).length

  const optionalCount = mappedCount - requiredCount

  const hasChanges = useMemo(() => {
    if (skills.length !== originalSkills.length) return true

    return skills.some((skill) => {
      const original = originalSkills.find(
        (item) => item.id === skill.id,
      )

      if (!original) return true

      return (
        original.is_mapped !== skill.is_mapped ||
        original.is_required !== skill.is_required
      )
    })
  }, [skills, originalSkills])

  async function loadMapping(serviceId) {
    if (!serviceId) {
      setServiceInfo(null)
      setSkills([])
      setOriginalSkills([])
      return
    }

    setMappingLoading(true)
    setError('')
    setSuccess('')
    setSearch('')

    try {
      const data = await apiRequest(
        `/admin/service-skills/${serviceId}`,
        {},
        token,
      )

      const loadedSkills = data.skills || []

      setServiceInfo(data.service || null)
      setSkills(loadedSkills)
      setOriginalSkills(
        loadedSkills.map((skill) => ({ ...skill })),
      )
    } catch (err) {
      setError(err.message || 'Unable to load skill mappings')
      setServiceInfo(null)
      setSkills([])
      setOriginalSkills([])
    } finally {
      setMappingLoading(false)
    }
  }

  function handleCategoryChange(event) {
    const categoryId = event.target.value

    setSelectedCategory(categoryId)
    setSelectedServiceId('')
    setServiceInfo(null)
    setSkills([])
    setOriginalSkills([])
    setSearch('')
    setError('')
    setSuccess('')
  }

  function handleServiceChange(event) {
    const serviceId = event.target.value

    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved skill mapping changes. Discard them?',
      )

      if (!confirmed) return
    }

    setSelectedServiceId(serviceId)
    loadMapping(serviceId)
  }

  function toggleMapped(skillId) {
    setSkills((current) =>
      current.map((skill) => {
        if (skill.id !== skillId) return skill

        const nextMapped = !skill.is_mapped

        return {
          ...skill,
          is_mapped: nextMapped,
          is_required: nextMapped
            ? skill.is_required
            : false,
        }
      }),
    )

    setSuccess('')
  }

  function toggleRequired(skillId) {
    setSkills((current) =>
      current.map((skill) => {
        if (skill.id !== skillId) return skill
        if (!skill.is_mapped) return skill

        return {
          ...skill,
          is_required: !skill.is_required,
        }
      }),
    )

    setSuccess('')
  }

  function resetChanges() {
    setSkills(
      originalSkills.map((skill) => ({ ...skill })),
    )
    setSuccess('')
    setError('')
  }

  async function saveMappings() {
    if (!selectedServiceId) return

    const mappedSkills = skills
      .filter((skill) => skill.is_mapped)
      .map((skill) => ({
        skill_id: skill.id,
        is_required: Boolean(skill.is_required),
      }))

    const confirmed = window.confirm(
      `Save ${mappedSkills.length} skill mapping(s) for "${serviceInfo?.name}"?`,
    )

    if (!confirmed) return

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await apiRequest(
        `/admin/service-skills/${selectedServiceId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            skills: mappedSkills,
          }),
        },
        token,
      )

      await loadMapping(selectedServiceId)
      setSuccess('Service skill mappings saved successfully.')
    } catch (err) {
      setError(err.message || 'Unable to save skill mappings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="skills-page">
      <div className="skills-heading">
        <div>
          <h1>Service → Skills Mapping</h1>
          <p>
            Define which skills are required or optional for each
            service. These mappings support technician matching.
          </p>
        </div>
      </div>

      {error && <div className="admin-error">{error}</div>}
      {success && <div className="admin-success">{success}</div>}

      <div className="skill-editor-card">
        <div className="skill-editor-heading">
          <div>
            <h2>Select Service</h2>
            <p>
              Choose a category first, then select the service
              whose skill requirements you want to manage.
            </p>
          </div>
        </div>

        <div className="skill-editor-fields">
          <label>
            Service Category
            <select
              value={selectedCategory}
              onChange={handleCategoryChange}
              disabled={loading}
            >
              <option value="">Select Category</option>

              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                  {!category.is_active ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </label>

          <label>
            Service
            <select
              value={selectedServiceId}
              onChange={handleServiceChange}
              disabled={!selectedCategory || loading}
            >
              <option value="">Select Service</option>

              {categoryServices.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.name}
                  {!service.is_active ? ' (Inactive)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {mappingLoading && (
        <div className="skills-empty-state">
          Loading skill mappings...
        </div>
      )}

      {!mappingLoading && serviceInfo && (
        <>
          <div className="skills-summary-grid">
            <div className="skills-summary-card">
              <span>Available Skills</span>
              <strong>{skills.length}</strong>
            </div>

            <div className="skills-summary-card">
              <span>Mapped</span>
              <strong>{mappedCount}</strong>
            </div>

            <div className="skills-summary-card">
              <span>Required</span>
              <strong>{requiredCount}</strong>
            </div>

            <div className="skills-summary-card">
              <span>Optional</span>
              <strong>{optionalCount}</strong>
            </div>
          </div>

          <div className="skills-toolbar">
            <input
              type="search"
              placeholder="Search skills..."
              value={search}
              onChange={(event) =>
                setSearch(event.target.value)
              }
            />

            <div className="service-mapping-actions">
              <button
                type="button"
                className="skills-refresh-button"
                onClick={resetChanges}
                disabled={!hasChanges || saving}
              >
                Reset
              </button>

              <button
                type="button"
                className="skills-add-button"
                onClick={saveMappings}
                disabled={!hasChanges || saving}
              >
                {saving ? 'Saving...' : 'Save Mappings'}
              </button>
            </div>
          </div>

          <div className="skills-table-card">
            <div className="skills-table-wrap">
              <table className="skills-table">
                <thead>
                  <tr>
                    <th>Use</th>
                    <th>Skill</th>
                    <th>Status</th>
                    <th>Requirement</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleSkills.map((skill) => (
                    <tr key={skill.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(skill.is_mapped)}
                          onChange={() =>
                            toggleMapped(skill.id)
                          }
                          disabled={!skill.is_active}
                        />
                      </td>

                      <td className="skills-name-cell">
                        <strong>{skill.name}</strong>

                        {skill.description && (
                          <span>{skill.description}</span>
                        )}
                      </td>

                      <td>
                        <span
                          className={
                            skill.is_active
                              ? 'status-pill active'
                              : 'status-pill inactive'
                          }
                        >
                          {skill.is_active
                            ? 'Active'
                            : 'Inactive'}
                        </span>
                      </td>

                      <td>
                        {skill.is_mapped ? (
                          <button
                            type="button"
                            className={
                              skill.is_required
                                ? 'mapping-required'
                                : 'mapping-optional'
                            }
                            onClick={() =>
                              toggleRequired(skill.id)
                            }
                          >
                            {skill.is_required
                              ? 'Required'
                              : 'Optional'}
                          </button>
                        ) : (
                          <span className="skills-muted-text">
                            Not mapped
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {!loading &&
        !mappingLoading &&
        !serviceInfo && (
          <div className="skills-empty-state">
            Select a category and service to manage its skill
            mappings.
          </div>
        )}
    </div>
  )
}

export default ServiceSkills