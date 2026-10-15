import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import { useLanguage } from '../../../shared/Experience'

function Entry({
  label, name, values, onChange, type = 'text',
  required = true, maxLength, autoComplete, ...extra
}) {
  const { t } = useLanguage()
  return (
    <label style={{ display: 'block', textAlign: 'left', marginBottom: 16 }}>
      {t(label)}
      <input
        name={name}
        type={type}
        value={values[name]}
        onChange={onChange}
        required={required}
        maxLength={maxLength}
        autoComplete={autoComplete}
        style={{ width: '100%', boxSizing: 'border-box', marginTop: 6 }}
        {...extra}
      />
    </label>
  )
}

export default function CompleteOnboarding({ onSubmitted, onLogout }) {
  const { t } = useLanguage()
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState('')
  const [search, setSearch] = useState('')
  const [step, setStep] = useState(0)
  const [values, setValues] = useState({
    email: '', date_of_birth: '', gender: '',
    address_line1: '', address_line2: '', city: '', state: '',
    pincode: '', work_area: '', experience_years: '0', service_radius_km: '10',
    service_ids: [], skill_ids: [], tool_ids: [],
  })
  const [category, setCategory] = useState('')
  const [options, setOptions] = useState(null)
  const [optionsLoading, setOptionsLoading] = useState(true)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const operationLock = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    Promise.all([
      apiRequest('/auth/technician/registration-options', { signal: controller.signal, cache: 'no-store' }),
      apiRequest('/auth/technician/onboarding', { signal: controller.signal, cache: 'no-store' }),
    ]).then(([data, saved]) => {
      if (controller.signal.aborted) return
      setOptions(data)
      setValues((previous) => ({ ...previous, ...saved.draft.details }))
      setVersion(saved.draft.version)
      const service = data.services.find((item) => saved.draft.details.service_ids?.includes(item.id))
      if (service) setCategory(service.category_id)
      setOptionsLoading(false)
      setError('')
    }).catch((err) => {
      if (controller.signal.aborted) return
      setOptionsLoading(false)
      setError(err.message || 'Unable to load registration choices.')
    })
    return () => controller.abort()
  }, [reload])

  function change(event) {
    const { name, value } = event.target
    setValues((previous) => ({
      ...previous,
      [name]: name === 'phone' || name === 'pincode'
        ? value.replace(/[^0-9]/g, '') : value,
    }))
    setError('')
  }

  function toggle(field, id) {
    setValues((previous) => ({
      ...previous,
      [field]: previous[field].includes(id)
        ? previous[field].filter((item) => item !== id)
        : [...previous[field], id],
    }))
    setError('')
  }

  function choiceList(field, items) {
    return (
      <div style={{
        maxHeight: 220, overflowY: 'auto', padding: 12,
        border: '1px solid #dce5ee', borderRadius: 10, textAlign: 'left',
      }}>
        {items.filter((item) => item.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map((item) => (
          <label key={item.id} style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={values[field].includes(item.id)}
              onChange={() => toggle(field, item.id)}
              style={{ width: 'auto', margin: 0 }}
            />
            <span>{item.name}</span>
          </label>
        ))}
        {!items.length && <p>No choices available in this category.</p>}
      </div>
    )
  }

  function validateWork() {
    if (
      !values.service_ids.length || values.service_ids.length > 20
      || !values.skill_ids.length || values.skill_ids.length > 50
      || !values.tool_ids.length || values.tool_ids.length > 50
    ) {
      return 'Choose 1 to 20 services, and 1 to 50 skills and tools.'
    }
    for (const id of values.service_ids) {
      const requiredSkills = options.required_skills.filter((item) => item.service_id === id)
      const requiredTools = options.required_tools.filter((item) => item.service_id === id)
      const service = options.services.find((item) => item.id === id)
      if (!requiredSkills.some((item) => values.skill_ids.includes(item.skill_id))) {
        return `Select a required skill for ${service.name}.`
      }
      if (requiredTools.some((item) => !values.tool_ids.includes(item.tool_id))) {
        return `Select all tools required for ${service.name}, or remove that service.`
      }
    }
    return ''
  }

  async function saveProgress() {
    if (operationLock.current) return false
    operationLock.current = true
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await apiRequest('/auth/technician/onboarding', { method: 'PUT', body: JSON.stringify({ details: values, expected_version: version }) })
      setVersion(result.version)
      setNotice(t('Progress saved'))
      return true
    } catch (err) { setError(err.message); return false }
    finally { operationLock.current = false; setBusy(false) }
  }

  async function submit(event) {
    event.preventDefault()
    if (operationLock.current || optionsLoading || !options) return
    setError('')

    if (step === 0) {
      const birth = new Date(`${values.date_of_birth}T12:00:00`)
      const today = new Date()
      const age = today.getFullYear() - birth.getFullYear() - (
        today.getMonth() < birth.getMonth()
        || (today.getMonth() === birth.getMonth() && today.getDate() < birth.getDate())
        ? 1 : 0
      )
      if (!Number.isFinite(age) || age < 18 || birth.getFullYear() < 1900) {
        setError('Technician registration requires age 18 or above.')
        return
      }
      if (await saveProgress()) setStep(1)
      return
    }

    if (step === 1) {
      const workError = validateWork()
      if (workError) {
        setError(workError)
        return
      }
      if (await saveProgress()) setStep(2)
      return
    }

    operationLock.current = true
    setBusy(true)
    try {
      await apiRequest('/auth/technician/onboarding/submit', { method: 'POST', body: JSON.stringify(values) })
      onSubmitted()
    } catch (err) {
      setError(
        (err.status === 422
          ? 'Please check your personal details and work selections.'
          : err.message || 'Unable to submit your application.')
        + ' Refresh application status if the response was interrupted.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  const categoryServices = options?.services.filter(
    (item) => item.category_id === category,
  ) || []

  return (
    <div className="login-page" style={{ padding: 20 }}>
      <section className="login-card" style={{ width: '100%', maxWidth: 720 }}>
        <h1>Vishwakarma Setu</h1>
        <h2>{t('Skills and Service Area')}</h2>
        <ol className="setu-stepper"><li className="done">{t('Account')} ✓</li><li aria-current={step < 2 ? 'step' : undefined}>{t('Skills and Service Area')}</li><li aria-current={step === 2 ? 'step' : undefined}>{t('Verification')}</li></ol><p>{t('Your account is saved. Complete these steps whenever you are ready.')}</p>
        <p>Our representative will contact you for phone verification and KYC before work access is enabled.</p>

        {notice && <p role="status">{notice}</p>}
        {optionsLoading && <p role="status">Loading registration choices...</p>}
        {error && <p role="alert" className="dashboard-error">{error}</p>}
        {!optionsLoading && !options && (
          <button type="button" onClick={() => {
            setOptionsLoading(true)
            setError('')
            setReload((current) => current + 1)
          }}>
            Retry Loading Choices
          </button>
        )}

        <form onSubmit={submit}>
          <fieldset disabled={busy || optionsLoading || !options} style={{ border: 0, padding: 0, margin: 0 }}>
            {step === 0 && (
              <>
                <Entry label="Email address" name="email" values={values} onChange={change} type="email" maxLength={254} autoComplete="email" />
                <Entry label="Date of birth" name="date_of_birth" values={values} onChange={change} type="date" autoComplete="bday" />
                <label style={{ display: 'block', textAlign: 'left', marginBottom: 16 }}>
                  Gender
                  <select aria-label={t('Gender')} name="gender" value={values.gender} onChange={change} required style={{ width: '100%', padding: 12, marginTop: 6 }}>
                    <option value="">Select</option>
                    <option value="MALE">Male</option>
                    <option value="FEMALE">Female</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
              </>
            )}

            {step === 1 && (
              <>
                <label>{t('Search services, skills or tools')}<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
                <Entry label="Address" name="address_line1" values={values} onChange={change} minLength={3} maxLength={300} autoComplete="address-line1" />
                <Entry label="Address line 2 (optional)" name="address_line2" values={values} onChange={change} required={false} maxLength={300} autoComplete="address-line2" />
                <Entry label="City" name="city" values={values} onChange={change} minLength={2} maxLength={100} autoComplete="address-level2" />
                <Entry label="State" name="state" values={values} onChange={change} minLength={2} maxLength={100} autoComplete="address-level1" />
                <Entry label="Pincode" name="pincode" values={values} onChange={change} inputMode="numeric" maxLength={6} pattern="[1-9][0-9]{5}" autoComplete="postal-code" />
                <Entry label="Areas where you work" name="work_area" values={values} onChange={change} minLength={3} maxLength={300} />
                <Entry label="Experience in years" name="experience_years" values={values} onChange={change} type="number" min="0" max="80" step="0.1" />
                <Entry label="Service radius in kilometres" name="service_radius_km" values={values} onChange={change} type="number" min="1" max="100" step="0.01" />
                <label style={{ display: 'block', textAlign: 'left', marginBottom: 16 }}>
                  Work category
                  <select aria-label={t('Work category')} value={category} required onChange={(event) => {
                    setCategory(event.target.value)
                    setValues((previous) => ({ ...previous, service_ids: [] }))
                    setError('')
                  }} style={{ width: '100%', padding: 12, marginTop: 6 }}>
                    <option value="">Select your work category</option>
                    {options?.categories.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </label>
                <h3>Services you perform</h3>
                {choiceList('service_ids', categoryServices)}

                {values.service_ids.map((id) => {
                  const service = options.services.find((item) => item.id === id)
                  const skills = options.required_skills
                    .filter((item) => item.service_id === id)
                    .map((item) => options.skills.find((skill) => skill.id === item.skill_id)?.name)
                  const tools = options.required_tools
                    .filter((item) => item.service_id === id)
                    .map((item) => options.tools.find((tool) => tool.id === item.tool_id)?.name)
                  return (
                    <p key={id} style={{ textAlign: 'left', fontSize: 13 }}>
                      <strong>{service.name}:</strong> matching skill: {skills.join(', ')}.
                      {' '}Required tools: {tools.length ? tools.join(', ') : 'None specified'}.
                    </p>
                  )
                })}

                <h3>Your skills</h3>
                {choiceList('skill_ids', options?.skills || [])}
                <h3>Tools you have</h3>
                <p>Select only tools that you own or have available for work.</p>
                {choiceList('tool_ids', options?.tools || [])}
              </>
            )}

            {step === 2 && <section>
              <h3>{t('Verification')}</h3>
              <p>Check your email, address and work selections before submitting. Our representative will contact you for manual phone verification, identity and address checks. You cannot receive jobs until approved.</p>
              <p><strong>{values.email}</strong><br />{values.address_line1}, {values.city}, {values.state} {values.pincode}</p>
              <p>{values.service_ids.length} services · {values.skill_ids.length} skills · {values.tool_ids.length} tools</p>
              <p>Never send your password, Start PIN or Happy Code to a representative.</p>
            </section>}

            <button type="submit" className="primary-action" style={{ width: '100%', marginTop: 20 }}>
              {busy ? t('Saving...') : t(step < 2 ? 'Save and Continue' : 'Submit for Verification')}
            </button>
            {step > 0 && (
              <button type="button" onClick={() => {
                setStep((current) => current - 1)
                setError('')
              }} style={{ width: '100%', marginTop: 12 }}>
                Previous Step
              </button>
            )}
          </fieldset>
        </form>

        <div className="setu-actions">
          <button type="button" onClick={saveProgress} disabled={busy || optionsLoading}>{t('Save Progress')}</button>
          <button type="button" onClick={onLogout} disabled={busy}>{t('Sign Out')}</button>
        </div>
      </section>
    </div>
  )
}
