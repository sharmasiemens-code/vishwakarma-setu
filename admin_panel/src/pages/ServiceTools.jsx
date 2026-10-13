import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function ServiceTools() {
  const token = getToken()

  const [services, setServices] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedCategory, setSelectedCategory] = useState('')
  const [selectedServiceId, setSelectedServiceId] = useState('')

  const [serviceInfo, setServiceInfo] = useState(null)
  const [tools, setTools] = useState([])
  const [originalTools, setOriginalTools] = useState([])

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

  const visibleTools = useMemo(() => {
    const term = search.trim().toLowerCase()

    if (!term) return tools

    return tools.filter(
      (tool) =>
        tool.name?.toLowerCase().includes(term) ||
        tool.description?.toLowerCase().includes(term),
    )
  }, [tools, search])

  const mappedCount = tools.filter(
    (tool) => tool.is_mapped,
  ).length

  const requiredCount = tools.filter(
    (tool) => tool.is_mapped && tool.is_required,
  ).length

  const optionalCount = mappedCount - requiredCount

  const hasChanges = useMemo(() => {
    if (tools.length !== originalTools.length) return true

    return tools.some((tool) => {
      const original = originalTools.find(
        (item) => item.id === tool.id,
      )

      if (!original) return true

      return (
        original.is_mapped !== tool.is_mapped ||
        original.is_required !== tool.is_required
      )
    })
  }, [tools, originalTools])

  async function loadMapping(serviceId) {
    if (!serviceId) {
      setServiceInfo(null)
      setTools([])
      setOriginalTools([])
      return
    }

    setMappingLoading(true)
    setError('')
    setSuccess('')
    setSearch('')

    try {
      const data = await apiRequest(
        `/admin/service-tools/${serviceId}`,
        {},
        token,
      )

      const loadedTools = data.tools || []

      setServiceInfo(data.service || null)
      setTools(loadedTools)
      setOriginalTools(
        loadedTools.map((tool) => ({ ...tool })),
      )
    } catch (err) {
      setError(err.message || 'Unable to load tool mappings')
      setServiceInfo(null)
      setTools([])
      setOriginalTools([])
    } finally {
      setMappingLoading(false)
    }
  }

  function handleCategoryChange(event) {
    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved tool mapping changes. Discard them?',
      )

      if (!confirmed) return
    }

    const categoryId = event.target.value

    setSelectedCategory(categoryId)
    setSelectedServiceId('')
    setServiceInfo(null)
    setTools([])
    setOriginalTools([])
    setSearch('')
    setError('')
    setSuccess('')
  }

  function handleServiceChange(event) {
    const serviceId = event.target.value

    if (hasChanges) {
      const confirmed = window.confirm(
        'You have unsaved tool mapping changes. Discard them?',
      )

      if (!confirmed) return
    }

    setSelectedServiceId(serviceId)
    loadMapping(serviceId)
  }

  function toggleMapped(toolId) {
    setTools((current) =>
      current.map((tool) => {
        if (tool.id !== toolId) return tool

        const nextMapped = !tool.is_mapped

        return {
          ...tool,
          is_mapped: nextMapped,
          is_required: nextMapped
            ? tool.is_required
            : false,
        }
      }),
    )

    setSuccess('')
  }

  function toggleRequired(toolId) {
    setTools((current) =>
      current.map((tool) => {
        if (tool.id !== toolId) return tool
        if (!tool.is_mapped) return tool

        return {
          ...tool,
          is_required: !tool.is_required,
        }
      }),
    )

    setSuccess('')
  }

  function resetChanges() {
    setTools(
      originalTools.map((tool) => ({ ...tool })),
    )
    setSuccess('')
    setError('')
  }

  async function saveMappings() {
    if (!selectedServiceId) return

    const mappedTools = tools
      .filter((tool) => tool.is_mapped)
      .map((tool) => ({
        tool_id: tool.id,
        is_required: Boolean(tool.is_required),
      }))

    const confirmed = window.confirm(
      `Save ${mappedTools.length} tool mapping(s) for "${serviceInfo?.name}"?`,
    )

    if (!confirmed) return

    setSaving(true)
    setError('')
    setSuccess('')

    try {
      await apiRequest(
        `/admin/service-tools/${selectedServiceId}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            tools: mappedTools,
          }),
        },
        token,
      )

      await loadMapping(selectedServiceId)
      setSuccess('Service tool mappings saved successfully.')
    } catch (err) {
      setError(err.message || 'Unable to save tool mappings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="skills-page">
      <div className="skills-heading">
        <div>
          <h1>Service → Tools Mapping</h1>
          <p>
            Define which tools are required or optional for each
            service.
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
              whose tool requirements you want to manage.
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
          Loading tool mappings...
        </div>
      )}

      {!mappingLoading && serviceInfo && (
        <>
          <div className="skills-summary-grid">
            <div className="skills-summary-card">
              <span>Available Tools</span>
              <strong>{tools.length}</strong>
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
              placeholder="Search tools..."
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
                    <th>Tool</th>
                    <th>Status</th>
                    <th>Requirement</th>
                  </tr>
                </thead>

                <tbody>
                  {visibleTools.map((tool) => (
                    <tr key={tool.id}>
                      <td>
                        <input
                          type="checkbox"
                          checked={Boolean(tool.is_mapped)}
                          onChange={() =>
                            toggleMapped(tool.id)
                          }
                          disabled={!tool.is_active}
                        />
                      </td>

                      <td className="skills-name-cell">
                        <strong>{tool.name}</strong>

                        {tool.description && (
                          <span>{tool.description}</span>
                        )}
                      </td>

                      <td>
                        <span
                          className={
                            tool.is_active
                              ? 'status-pill active'
                              : 'status-pill inactive'
                          }
                        >
                          {tool.is_active
                            ? 'Active'
                            : 'Inactive'}
                        </span>
                      </td>

                      <td>
                        {tool.is_mapped ? (
                          <button
                            type="button"
                            className={
                              tool.is_required
                                ? 'mapping-required'
                                : 'mapping-optional'
                            }
                            onClick={() =>
                              toggleRequired(tool.id)
                            }
                          >
                            {tool.is_required
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
            Select a category and service to manage its tool
            mappings.
          </div>
        )}
    </div>
  )
}

export default ServiceTools