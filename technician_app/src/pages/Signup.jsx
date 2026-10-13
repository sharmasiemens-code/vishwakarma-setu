import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import { registerTechnician } from '../auth/auth'

function Entry({
  label, name, values, onChange, type = 'text',
  required = true, maxLength, autoComplete, ...extra
}) {
  return (
    <label style={{ display: 'block', textAlign: 'left', marginBottom: 16 }}>
      {label}
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

export default function Signup({ onBack, onRegistered }) {
  const [step, setStep] = useState(0)
  const [values, setValues] = useState({
    full_name: '', phone: '', email: '', date_of_birth: '', gender: '',
    address_line1: '', address_line2: '', city: '', state: '',
    pincode: '', work_area: '', experience_years: '0', service_radius_km: '10',
    service_ids: [], skill_ids: [], tool_ids: [],
    password: '', confirmation: '',
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
    apiRequest('/auth/technician/registration-options', {
      signal: controller.signal,
      cache: 'no-store',
    }).then((data) => {
      if (controller.signal.aborted) return
      setOptions(data)
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
        {items.map((item) => (
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

  async function submit(event) {
    event.preventDefault()
    if (operationLock.current || optionsLoading || !options) return
    setError('')

    if (step === 0) {
      if (!/^[6-9][0-9]{9}$/.test(values.phone)) {
        setError('Enter a valid ten-digit Indian mobile number.')
        return
      }
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
      setStep(1)
      return
    }

    if (step === 1) {
      const workError = validateWork()
      if (workError) {
        setError(workError)
        return
      }
      setStep(2)
      return
    }

    if (values.password !== values.confirmation) {
      setError('Your passwords do not match.')
      return
    }
    if (
      values.password.length < 8
      || new TextEncoder().encode(values.password).length > 72
      || values.password !== values.password.trim()
      || !/\p{L}/u.test(values.password)
      || !/\p{N}/u.test(values.password)
      || Array.from(values.password).some(
        (character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127,
      )
    ) {
      setError('Use at least eight characters with a letter and a number, without leading or trailing spaces.')
      return
    }

    operationLock.current = true
    setBusy(true)
    try {
      const details = { ...values }
      delete details.confirmation
      const result = await registerTechnician(details)
      setValues((previous) => ({ ...previous, password: '', confirmation: '' }))
      onRegistered(result.user)
    } catch (err) {
      setError(
        (err.status === 422
          ? 'Please check your personal details, work selections and password.'
          : err.message || 'Unable to submit your application.')
        + ' If the connection was interrupted, try signing in before registering again.',
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
        <h2>Register as a Technician</h2>
        <p>Step {step + 1} of 3: {['Personal Details', 'Work Details', 'Secure Your Account'][step]}</p>
        <p>Our representative will contact you for phone verification and KYC before work access is enabled.</p>

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
                <Entry label="Full name" name="full_name" values={values} onChange={change} minLength={2} maxLength={150} autoComplete="name" />
                <Entry label="Mobile number" name="phone" values={values} onChange={change} type="tel" inputMode="numeric" maxLength={10} pattern="[6-9][0-9]{9}" autoComplete="tel-national" />
                <Entry label="Email address" name="email" values={values} onChange={change} type="email" maxLength={254} autoComplete="email" />
                <Entry label="Date of birth" name="date_of_birth" values={values} onChange={change} type="date" autoComplete="bday" />
                <label style={{ display: 'block', textAlign: 'left', marginBottom: 16 }}>
                  Gender
                  <select name="gender" value={values.gender} onChange={change} required style={{ width: '100%', padding: 12, marginTop: 6 }}>
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
                  <select value={category} required onChange={(event) => {
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

            {step === 2 && (
              <>
                <p>You will sign in with your mobile number or email and this password.</p>
                <Entry label="Create password" name="password" values={values} onChange={change} type="password" minLength={8} maxLength={72} autoComplete="new-password" />
                <Entry label="Confirm password" name="confirmation" values={values} onChange={change} type="password" minLength={8} maxLength={72} autoComplete="new-password" />
                <p>Use at least eight characters, including a letter and a number.</p>
              </>
            )}

            <button type="submit" className="primary-action" style={{ width: '100%', marginTop: 20 }}>
              {busy ? 'Submitting application...' : step < 2 ? 'Continue' : 'Submit Technician Application'}
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

        <button type="button" onClick={onBack} disabled={busy} style={{ width: '100%', marginTop: 16 }}>
          Already registered? Sign In
        </button>
      </section>
    </div>
  )
}
