import { useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import { useLanguage } from '../../../shared/Experience'
import { uploadRequestPhoto } from '../api/photos'
import RequestPhotoPicker from '../components/RequestPhotoPicker'

const INITIAL_FORM = {
  service_id: '',
  title: '',
  description: '',
  address_line1: '',
  address_line2: '',
  city: 'Jabalpur',
  state: 'Madhya Pradesh',
  pincode: '',
  latitude: '',
  longitude: '',
  preferred_date: '',
  preferred_time_start: '',
  preferred_time_end: '',
}

const STEPS = [
  {
    number: 1,
    title: 'Service',
    subtitle: 'Choose what you need',
  },
  {
    number: 2,
    title: 'Requirements',
    subtitle: 'See expert requirements',
  },
  {
    number: 3,
    title: 'Work Details',
    subtitle: 'Tell us about the job',
  },
  {
    number: 4,
    title: 'Review',
    subtitle: 'Confirm your request',
  },
]

function CreateServiceRequest({ onBack, onCreated }) {
  const { t } = useLanguage()
  const [categories, setCategories] = useState([])
  const [services, setServices] = useState([])

  const [selectedCategoryId, setSelectedCategoryId] = useState('')
  const [selectedService, setSelectedService] = useState(null)

  const [requiredSkills, setRequiredSkills] = useState([])
  const [requiredTools, setRequiredTools] = useState([])

  const [loadingServices, setLoadingServices] = useState(true)
  const [loadingRequirements, setLoadingRequirements] =
    useState(false)

  const [currentStep, setCurrentStep] = useState(1)

  const [submitting, setSubmitting] = useState(false)
  const [locating, setLocating] = useState(false)

  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showSuccess, setShowSuccess] = useState(false)

  const [locationCaptured, setLocationCaptured] =
    useState(false)
  const [showAdvancedLocation, setShowAdvancedLocation] =
    useState(false)

  const [form, setForm] = useState(INITIAL_FORM)
  const [photoFiles, setPhotoFiles] = useState([])
  const [createdResponse, setCreatedResponse] = useState(null)
  const submissionLock = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function loadInitialData() {
      setLoadingServices(true)
      setError('')

      try {
        const [categoryData, serviceData] =
          await Promise.all([
            apiRequest('/services/categories'),
            apiRequest('/services'),
          ])

        if (cancelled) {
          return
        }

        const loadedCategories =
          categoryData.categories ||
          categoryData.data ||
          []

        const loadedServices =
          serviceData.services ||
          serviceData.data ||
          serviceData ||
          []

        setCategories(
          Array.isArray(loadedCategories)
            ? loadedCategories
            : [],
        )

        setServices(
          Array.isArray(loadedServices)
            ? loadedServices
            : [],
        )
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              'Unable to load available services.',
          )
        }
      } finally {
        if (!cancelled) {
          setLoadingServices(false)
        }
      }
    }

    loadInitialData()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredServices = useMemo(() => {
    if (!selectedCategoryId) {
      return services
    }

    return services.filter(
      (service) =>
        String(service.category_id) ===
        String(selectedCategoryId),
    )
  }, [selectedCategoryId, services])

  function clearMessages() {
    setError('')
    setSuccess('')
  }

  function handleCategoryChange(event) {
    const categoryId = event.target.value

    clearMessages()

    setSelectedCategoryId(categoryId)

    setForm((current) => ({
      ...current,
      service_id: '',
    }))

    setSelectedService(null)
    setRequiredSkills([])
    setRequiredTools([])
  }

  async function handleServiceChange(event) {
    const serviceId = event.target.value

    clearMessages()

    setForm((current) => ({
      ...current,
      service_id: serviceId,
    }))

    setSelectedService(
      services.find(
        (service) =>
          String(service.id) === String(serviceId),
      ) || null,
    )

    setRequiredSkills([])
    setRequiredTools([])

    if (!serviceId) {
      return
    }

    setLoadingRequirements(true)

    try {
      const data = await apiRequest(
        `/services/${serviceId}`,
      )

      const service =
        data.service ||
        data.data?.service ||
        null

      const skills =
        data.required_skills ||
        data.data?.required_skills ||
        []

      const tools =
        data.required_tools ||
        data.data?.required_tools ||
        []

      if (service) {
        setSelectedService(service)
      }

      setRequiredSkills(
        Array.isArray(skills) ? skills : [],
      )

      setRequiredTools(
        Array.isArray(tools) ? tools : [],
      )
    } catch (err) {
      setError(
        err.message ||
          'Unable to load technical requirements for this service.',
      )
    } finally {
      setLoadingRequirements(false)
    }
  }

  function handleChange(event) {
    const { name, value } = event.target

    setForm((current) => ({
      ...current,
      [name]: value,
    }))

    if (error) {
      setError('')
    }
  }

  function captureCurrentLocation() {
    clearMessages()

    if (!navigator.geolocation) {
      setError(
        'Location services are not available in this browser. Please use Advanced Location.',
      )
      setShowAdvancedLocation(true)
      return
    }

    setLocating(true)

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude =
          position.coords.latitude

        const longitude =
          position.coords.longitude

        setForm((current) => ({
          ...current,
          latitude: String(latitude),
          longitude: String(longitude),
        }))

        setLocationCaptured(true)
        setLocating(false)
      },
      (locationError) => {
        setLocating(false)

        let message =
          'Unable to capture your current location.'

        if (locationError.code === 1) {
          message =
            'Location permission was denied. Please allow location access or use Advanced Location.'
        }

        if (locationError.code === 2) {
          message =
            'Your current location could not be determined. Please try again or use Advanced Location.'
        }

        if (locationError.code === 3) {
          message =
            'Location request timed out. Please try again or use Advanced Location.'
        }

        setError(message)
        setShowAdvancedLocation(true)
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 300000,
      },
    )
  }

  function validateStep(step) {
    clearMessages()

    if (step === 1) {
      if (!form.service_id) {
        setError('Please select a service.')
        return false
      }

      return true
    }

    if (step === 2) {
      if (!form.service_id) {
        setError(
          'Please select a service before continuing.',
        )
        setCurrentStep(1)
        return false
      }

      return true
    }

    if (step === 3) {
      if (!form.title.trim()) {
        setError(
          'Please enter a title for your service request.',
        )
        return false
      }

      if (form.title.trim().length < 3) {
        setError(
          'Request title must be at least 3 characters.',
        )
        return false
      }

      if (!form.address_line1.trim()) {
        setError(
          'Please enter the service address.',
        )
        return false
      }

      if (!form.city.trim()) {
        setError('Please enter your city.')
        return false
      }

      if (!form.state.trim()) {
        setError('Please enter your state.')
        return false
      }

      const latitude = Number(form.latitude)
      const longitude = Number(form.longitude)

      if (
        !form.latitude.trim() || !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90
      ) {
        setError(
          'Please capture your location or enter a valid latitude.',
        )
        return false
      }

      if (
        !form.longitude.trim() || !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180
      ) {
        setError(
          'Please capture your location or enter a valid longitude.',
        )
        return false
      }

      if (
        form.preferred_time_start &&
        form.preferred_time_end &&
        form.preferred_time_end <=
          form.preferred_time_start
      ) {
        setError(
          'Preferred end time must be later than the start time.',
        )
        return false
      }

      return true
    }

    return true
  }

  function goToNextStep() {
    if (!validateStep(currentStep)) {
      return
    }

    setCurrentStep((current) =>
      Math.min(current + 1, 4),
    )
  }

  function goToPreviousStep() {
    clearMessages()

    setCurrentStep((current) =>
      Math.max(current - 1, 1),
    )
  }

  function handleSubmit(event) {
    event.preventDefault()

    if (!validateStep(3)) {
      setCurrentStep(3)
      return
    }

    setCurrentStep(4)
  }

  async function submitRequest() {
    if (submissionLock.current || createdResponse) {
      return
    }
    clearMessages()

    if (!validateStep(1)) {
      setCurrentStep(1)
      return
    }

    if (!validateStep(3)) {
      setCurrentStep(3)
      return
    }

    const latitude = Number(form.latitude)
    const longitude = Number(form.longitude)

    const payload = {
      service_id: form.service_id,
      title: form.title.trim(),
      description:
        form.description.trim() || null,
      address_line1:
        form.address_line1.trim(),
      address_line2:
        form.address_line2.trim() || null,
      city: form.city.trim(),
      state: form.state.trim(),
      pincode:
        form.pincode.trim() || null,
      latitude,
      longitude,
      preferred_date:
        form.preferred_date || null,
      preferred_time_start:
        form.preferred_time_start || null,
      preferred_time_end:
        form.preferred_time_end || null,
    }

    submissionLock.current = true
    setSubmitting(true)

    try {
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest(
        'SHA-256', new TextEncoder().encode(JSON.stringify(payload)),
      )), (byte) => byte.toString(16).padStart(2, '0')).join('')
      const storageKey = `setu-request-${fingerprint}`
      const requestKey = sessionStorage.getItem(storageKey) || crypto.randomUUID()
      sessionStorage.setItem(storageKey, requestKey)
      const data = await apiRequest(
        '/service-requests',
        {
          method: 'POST',
          headers: { 'Idempotency-Key': requestKey },
          body: JSON.stringify(payload),
        },
      )

      sessionStorage.removeItem(storageKey)
      setCreatedResponse(data)

      const requestId = data?.service_request?.id
      let uploaded = 0

      if (photoFiles.length > 0) {
        try {
          if (!requestId) {
            throw new Error('The created request ID was not returned.')
          }

          for (const file of photoFiles) {
            await uploadRequestPhoto(requestId, file)
            uploaded += 1
          }
        } catch (photoError) {
          setSuccess('Your service request has been created.')
          setError(
            `${uploaded} of ${photoFiles.length} photo uploads confirmed. `
            + 'Open your created request to review the saved photos. '
            + (photoError.message || 'Photo upload could not be confirmed.'),
          )
          return
        }
      }

      setSuccess(
        photoFiles.length
          ? 'Your service request and work photos have been saved successfully.'
          : 'Your service request has been created successfully.',
      )

      setShowSuccess(true)

      if (onCreated) {
        onCreated(data)
      }
    } catch (err) {
      setError(
        err.message ||
          'Unable to create service request.',
      )
    } finally {
      submissionLock.current = false
      setSubmitting(false)
    }
  }

  function getCategoryName() {
    if (!selectedService?.category_id) {
      return ''
    }

    const category = categories.find(
      (item) =>
        String(item.id) ===
        String(selectedService.category_id),
    )

    return (
      selectedService.category_name ||
      category?.name ||
      ''
    )
  }

  function getRequiredCount(items) {
    return items.filter(
      (item) => item.is_required !== false,
    ).length
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background:
          'linear-gradient(180deg, #f4f8ff 0%, #f7f9fc 48%, #ffffff 100%)',
        color: '#172033',
      }}
    >
      <header
        style={{
          background:
            'linear-gradient(135deg, #102a43 0%, #176b87 55%, #2a9d8f 100%)',
          color: '#ffffff',
          padding: '18px 24px',
          boxShadow:
            '0 8px 24px rgba(16, 42, 67, 0.18)',
        }}
      >
        <div
          style={{
            maxWidth: '1180px',
            margin: '0 auto',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '20px',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                letterSpacing: '1.4px',
                textTransform: 'uppercase',
                opacity: 0.86,
              }}
            >
              🔱 Vishwakarma Setu
            </div>

            <h1
              style={{
                margin: '4px 0 2px',
                fontSize: '28px',
                lineHeight: 1.2,
              }}
            >
              Technical Services Marketplace
            </h1>

            <p
              style={{
                margin: 0,
                fontSize: '14px',
                opacity: 0.9,
              }}
            >
              Trusted technical experts, matched to your
              actual service requirements.
            </p>
          </div>

          <button
            type="button"
            onClick={onBack}
            disabled={submitting || Boolean(createdResponse)}
            style={{
              border: '1px solid rgba(255,255,255,0.35)',
              background: 'rgba(255,255,255,0.12)',
              color: '#ffffff',
              padding: '11px 16px',
              borderRadius: '10px',
              cursor: submitting
                ? 'not-allowed'
                : 'pointer',
              fontWeight: 700,
            }}
          >
            ← Dashboard
          </button>
        </div>
      </header>

      <main
        style={{
          maxWidth: '1180px',
          margin: '0 auto',
          padding: '28px 20px 50px',
        }}
      >
        <section
          style={{
            background: '#ffffff',
            borderRadius: '18px',
            padding: '24px',
            boxShadow:
              '0 10px 35px rgba(16, 42, 67, 0.08)',
            border: '1px solid #e4eaf2',
            marginBottom: '22px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: '18px',
              alignItems: 'flex-start',
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div
                style={{
                  fontSize: '13px',
                  color: '#2a9d8f',
                  fontWeight: 800,
                  textTransform: 'uppercase',
                  letterSpacing: '0.8px',
                }}
              >
                New Service Request
              </div>

              <h2
                style={{
                  margin: '5px 0 6px',
                  fontSize: '26px',
                }}
              >
                Find the right technical expert
              </h2>

              <p
                style={{
                  margin: 0,
                  color: '#617083',
                  lineHeight: 1.6,
                }}
              >
                Select your service and tell us what you
                need. Vishwakarma Setu will use the service
                requirements to identify suitable technicians.
              </p>
            </div>

            <div
              style={{
                background: '#eef8f6',
                color: '#176b63',
                borderRadius: '12px',
                padding: '12px 14px',
                minWidth: '190px',
              }}
            >
              <div
                style={{
                  fontSize: '12px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Matching Model
              </div>

              <strong
                style={{
                  display: 'block',
                  marginTop: '4px',
                  fontSize: '15px',
                }}
              >
                Skills + Tools + Availability
              </strong>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns:
                'repeat(4, minmax(0, 1fr))',
              gap: '10px',
              marginTop: '26px',
            }}
          >
            {STEPS.map((step) => {
              const active =
                currentStep === step.number

              const completed =
                currentStep > step.number

              return (
                <div
                  key={step.number}
                  style={{
                    position: 'relative',
                    padding: '12px 10px',
                    borderRadius: '12px',
                    background: active
                      ? '#eaf5ff'
                      : completed
                        ? '#eef8f6'
                        : '#f6f8fb',
                    border:
                      active || completed
                        ? '1px solid #c8dff0'
                        : '1px solid #e7ebf1',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '9px',
                    }}
                  >
                    <span
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: active
                          ? '#176b87'
                          : completed
                            ? '#2a9d8f'
                            : '#dbe2ea',
                        color:
                          active || completed
                            ? '#ffffff'
                            : '#536273',
                        fontWeight: 800,
                        fontSize: '13px',
                      }}
                    >
                      {completed
                        ? '✓'
                        : step.number}
                    </span>

                    <div>
                      <strong
                        style={{
                          display: 'block',
                          fontSize: '13px',
                        }}
                      >
                        {t(step.title)}
                      </strong>

                      <span
                        style={{
                          display: 'block',
                          color: '#718096',
                          fontSize: '11px',
                          marginTop: '2px',
                        }}
                      >
                        {step.subtitle}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {error && (
          <div
            role="alert"
            style={{
              background: '#fff2f2',
              border: '1px solid #f2c7c7',
              color: '#a12a2a',
              borderRadius: '12px',
              padding: '13px 15px',
              marginBottom: '18px',
              fontWeight: 600,
            }}
          >
            {error}
          </div>
        )}

        {success && !showSuccess && (
          <div
            role="status"
            style={{
              background: '#eef9f2',
              border: '1px solid #c6e8d0',
              color: '#176b3b',
              borderRadius: '12px',
              padding: '13px 15px',
              marginBottom: '18px',
              fontWeight: 600,
            }}
          >
            {success}
          </div>
        )}

        {createdResponse && !showSuccess && (
          <section
            aria-label="Created request"
            style={{
              padding: 20,
              marginBottom: 20,
              border: '1px solid #dce5ee',
              borderRadius: 12,
              background: '#ffffff',
            }}
          >
            <h3>Your request has been created</h3>
            <p>
              Review the photos on this request before assigning a technician.
              You do not need to submit another request.
            </p>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onCreated?.(createdResponse)}
            >
              Open Created Request
            </button>
          </section>
        )}

        <form onSubmit={handleSubmit}>
          {currentStep === 1 && (
            <section
              style={{
                background: '#ffffff',
                borderRadius: '18px',
                padding: '28px',
                border: '1px solid #e4eaf2',
                boxShadow:
                  '0 8px 28px rgba(16, 42, 67, 0.06)',
              }}
            >
              <div style={{ marginBottom: '24px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    background: '#eaf5ff',
                    color: '#176b87',
                    padding: '6px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  STEP 1
                </span>

                <h2
                  style={{
                    margin: '10px 0 6px',
                    fontSize: '23px',
                  }}
                >
                  What technical service do you need?
                </h2>

                <p
                  style={{
                    margin: 0,
                    color: '#687789',
                  }}
                >
                  Start with a service. We will automatically
                  determine the technical requirements.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns:
                    'repeat(2, minmax(0, 1fr))',
                  gap: '20px',
                }}
              >
                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '7px',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '14px',
                    }}
                  >
                    Service Category
                  </span>

                  <select
                    value={selectedCategoryId}
                    onChange={handleCategoryChange}
                    disabled={
                      loadingServices || submitting
                    }
                    style={inputStyle}
                  >
                    <option value="">
                      All service categories
                    </option>

                    {categories.map((category) => (
                      <option
                        key={category.id}
                        value={category.id}
                      >
                        {category.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '7px',
                  }}
                >
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: '14px',
                    }}
                  >
                    Technical Service
                  </span>

                  <select
                    value={form.service_id}
                    onChange={handleServiceChange}
                    disabled={
                      loadingServices || submitting
                    }
                    required
                    style={inputStyle}
                  >
                    <option value="">
                      {loadingServices
                        ? 'Loading services...'
                        : 'Select a technical service'}
                    </option>

                    {filteredServices.map((service) => (
                      <option
                        key={service.id}
                        value={service.id}
                      >
                        {service.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {selectedService && (
                <div
                  style={{
                    marginTop: '24px',
                    background:
                      'linear-gradient(135deg, #f4f9ff, #eefaf7)',
                    border: '1px solid #d8e8e8',
                    borderRadius: '14px',
                    padding: '18px',
                  }}
                >
                  <div
                    style={{
                      color: '#687789',
                      fontSize: '12px',
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      letterSpacing: '0.7px',
                    }}
                  >
                    Selected Service
                  </div>

                  <h3
                    style={{
                      margin: '5px 0',
                      fontSize: '20px',
                    }}
                  >
                    {selectedService.name}
                  </h3>

                  {getCategoryName() && (
                    <div
                      style={{
                        color: '#176b87',
                        fontSize: '13px',
                        fontWeight: 700,
                      }}
                    >
                      {getCategoryName()}
                    </div>
                  )}

                  {selectedService.description && (
                    <p
                      style={{
                        margin: '10px 0 0',
                        color: '#617083',
                        lineHeight: 1.6,
                      }}
                    >
                      {selectedService.description}
                    </p>
                  )}
                </div>
              )}

              <div
                style={{
                  marginTop: '24px',
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  onClick={goToNextStep}
                  disabled={
                    submitting ||
                    loadingRequirements
                  }
                  style={primaryButtonStyle}
                >
                  {t('Continue')} →
                </button>
              </div>
            </section>
          )}

          {currentStep === 2 && (
            <section
              style={{
                background: '#ffffff',
                borderRadius: '18px',
                padding: '28px',
                border: '1px solid #e4eaf2',
                boxShadow:
                  '0 8px 28px rgba(16, 42, 67, 0.06)',
              }}
            >
              <div style={{ marginBottom: '22px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    background: '#eef8f6',
                    color: '#176b63',
                    padding: '6px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  STEP 2
                </span>

                <h2
                  style={{
                    margin: '10px 0 6px',
                    fontSize: '23px',
                  }}
                >
                  Technical requirements
                </h2>

                <p
                  style={{
                    margin: 0,
                    color: '#687789',
                    lineHeight: 1.6,
                  }}
                >
                  You do not need to select these items.
                  They are automatically defined by the
                  selected service and are used by our matching
                  mechanism.
                </p>
              </div>

              {selectedService && (
                <div
                  style={{
                    background: '#f7f9fc',
                    border: '1px solid #e5eaf1',
                    borderRadius: '12px',
                    padding: '14px 16px',
                    marginBottom: '20px',
                  }}
                >
                  <div
                    style={{
                      color: '#718096',
                      fontSize: '12px',
                      fontWeight: 700,
                    }}
                  >
                    SERVICE
                  </div>

                  <strong
                    style={{
                      display: 'block',
                      marginTop: '3px',
                    }}
                  >
                    {selectedService.name}
                  </strong>
                </div>
              )}

              {loadingRequirements ? (
                <div
                  style={{
                    padding: '35px 20px',
                    textAlign: 'center',
                    color: '#64748b',
                  }}
                >
                  Loading technical requirements...
                </div>
              ) : (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(2, minmax(0, 1fr))',
                      gap: '20px',
                    }}
                  >
                    <RequirementPanel
                      title="Required Skills"
                      icon="🛠️"
                      items={requiredSkills}
                      emptyText="No specific skills have been configured for this service."
                    />

                    <RequirementPanel
                      title="Required Tools"
                      icon="🔧"
                      items={requiredTools}
                      emptyText="No specific tools have been configured for this service."
                    />
                  </div>

                  <div
                    style={{
                      marginTop: '22px',
                      background: '#f0f8ff',
                      border: '1px solid #cfe5f5',
                      borderRadius: '14px',
                      padding: '17px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'flex-start',
                      }}
                    >
                      <span
                        style={{
                          fontSize: '22px',
                        }}
                      >
                        🎯
                      </span>

                      <div>
                        <strong
                          style={{
                            display: 'block',
                            color: '#155b7a',
                          }}
                        >
                          How Vishwakarma Setu matches experts
                        </strong>

                        <p
                          style={{
                            margin: '5px 0 0',
                            color: '#557084',
                            lineHeight: 1.6,
                            fontSize: '14px',
                          }}
                        >
                          The selected service determines the
                          required technical skills and tools.
                          The system then looks for suitable
                          technicians based on these
                          requirements, KYC/verification,
                          availability and location.
                        </p>
                      </div>
                    </div>
                  </div>
                </>
              )}

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginTop: '25px',
                }}
              >
                <button
                  type="button"
                  onClick={goToPreviousStep}
                  disabled={submitting || Boolean(createdResponse)}
                  style={secondaryButtonStyle}
                >
                  ← {t('Back')}
                </button>

                <button
                  type="button"
                  onClick={goToNextStep}
                  disabled={
                    submitting ||
                    loadingRequirements
                  }
                  style={primaryButtonStyle}
                >
                  {t('Continue')} →
                </button>
              </div>
            </section>
          )}

          {currentStep === 3 && (
            <section
              style={{
                background: '#ffffff',
                borderRadius: '18px',
                padding: '28px',
                border: '1px solid #e4eaf2',
                boxShadow:
                  '0 8px 28px rgba(16, 42, 67, 0.06)',
              }}
            >
              <div style={{ marginBottom: '22px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    background: '#eaf5ff',
                    color: '#176b87',
                    padding: '6px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  STEP 3
                </span>

                <h2
                  style={{
                    margin: '10px 0 6px',
                    fontSize: '23px',
                  }}
                >
                  Tell us about the work
                </h2>

                <p
                  style={{
                    margin: 0,
                    color: '#687789',
                  }}
                >
                  Give the expert enough information to
                  understand the requirement before arriving.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: '20px',
                }}
              >
                <Field
                  label="Request Title"
                  required
                >
                  <input
                    type="text"
                    name="title"
                    value={form.title}
                    onChange={handleChange}
                    placeholder="Example: Install 8 IP CCTV cameras"
                    disabled={submitting || Boolean(createdResponse)}
                    style={inputStyle}
                  />
                </Field>

                <Field label="Work Description">
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    placeholder="Describe the work, existing equipment, site condition, urgency or any other useful information."
                    rows={5}
                    disabled={submitting || Boolean(createdResponse)}
                    style={{
                      ...inputStyle,
                      resize: 'vertical',
                    }}
                  />
                </Field>

                <RequestPhotoPicker
                  files={photoFiles}
                  onChange={setPhotoFiles}
                  disabled={submitting || Boolean(createdResponse)}
                />

                <div
                  style={{
                    borderTop:
                      '1px solid #e8edf3',
                    paddingTop: '22px',
                  }}
                >
                  <h3
                    style={{
                      margin: '0 0 15px',
                      fontSize: '17px',
                    }}
                  >
                    📍 Service Location
                  </h3>

                  <div
                    style={{
                      background: '#f5f9fc',
                      border:
                        '1px solid #dce8f0',
                      borderRadius: '14px',
                      padding: '16px',
                      marginBottom: '18px',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent:
                          'space-between',
                        alignItems: 'center',
                        gap: '14px',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <strong
                          style={{
                            display: 'block',
                          }}
                        >
                          Use your current location
                        </strong>

                        <span
                          style={{
                            display: 'block',
                            marginTop: '4px',
                            color: '#687789',
                            fontSize: '13px',
                          }}
                        >
                          Your location helps us find
                          technicians within the service
                          radius.
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={captureCurrentLocation}
                        disabled={
                          locating || submitting
                        }
                        style={{
                          ...primaryButtonStyle,
                          minWidth: '180px',
                        }}
                      >
                        {locating
                          ? 'Getting Location...'
                          : locationCaptured
                            ? '✓ Location Updated'
                            : `📍 ${t('Use My Location')}`}
                      </button>
                    </div>

                    {locationCaptured && (
                      <div
                        style={{
                          marginTop: '12px',
                          color: '#176b63',
                          fontSize: '13px',
                          fontWeight: 700,
                        }}
                      >
                        ✓ Current location captured
                        successfully.
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(2, minmax(0, 1fr))',
                      gap: '18px',
                    }}
                  >
                    <Field
                      label="Address / Building"
                      required
                    >
                      <input
                        type="text"
                        name="address_line1"
                        value={form.address_line1}
                        onChange={handleChange}
                        placeholder="House, office, building or site address"
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="Area / Landmark">
                      <input
                        type="text"
                        name="address_line2"
                        value={form.address_line2}
                        onChange={handleChange}
                        placeholder="Area, landmark or nearby location"
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="City" required>
                      <input
                        type="text"
                        name="city"
                        value={form.city}
                        onChange={handleChange}
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="State" required>
                      <input
                        type="text"
                        name="state"
                        value={form.state}
                        onChange={handleChange}
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="Pincode">
                      <input
                        type="text"
                        name="pincode"
                        value={form.pincode}
                        onChange={handleChange}
                        placeholder="Pincode"
                        maxLength={10}
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>
                  </div>

                  <div
                    style={{
                      marginTop: '15px',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setShowAdvancedLocation(
                          (current) => !current,
                        )
                      }
                      style={{
                        border: 'none',
                        background: 'transparent',
                        color: '#176b87',
                        fontWeight: 700,
                        padding: 0,
                        cursor: 'pointer',
                      }}
                    >
                      {showAdvancedLocation
                        ? `− ${t('Manual location')}`
                        : `+ ${t('Manual location')}`}
                    </button>
                  </div>

                  {showAdvancedLocation && (
                    <div
                      style={{
                        marginTop: '15px',
                        background: '#fafbfd',
                        border:
                          '1px solid #e2e8f0',
                        borderRadius: '12px',
                        padding: '15px',
                      }}
                    >
                      <p
                        style={{
                          margin:
                            '0 0 14px',
                          color: '#687789',
                          fontSize: '13px',
                        }}
                      >
                        Use these fields only when browser
                        location is unavailable.
                      </p>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns:
                            'repeat(2, minmax(0, 1fr))',
                          gap: '15px',
                        }}
                      >
                        <Field label="Latitude" required>
                          <input
                            type="number"
                            step="any"
                            name="latitude"
                            value={form.latitude}
                            onChange={(event) => {
                              setLocationCaptured(false)
                              handleChange(event)
                            }}
                            placeholder="e.g. 23.1815"
                            disabled={submitting || Boolean(createdResponse)}
                            style={inputStyle}
                          />
                        </Field>

                        <Field label="Longitude" required>
                          <input
                            type="number"
                            step="any"
                            name="longitude"
                            value={form.longitude}
                            onChange={(event) => {
                              setLocationCaptured(false)
                              handleChange(event)
                            }}
                            placeholder="e.g. 79.9864"
                            disabled={submitting || Boolean(createdResponse)}
                            style={inputStyle}
                          />
                        </Field>
                      </div>
                    </div>
                  )}
                </div>

                <div
                  style={{
                    borderTop:
                      '1px solid #e8edf3',
                    paddingTop: '22px',
                  }}
                >
                  <h3
                    style={{
                      margin: '0 0 15px',
                      fontSize: '17px',
                    }}
                  >
                    🗓️ Preferred Schedule
                  </h3>

                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns:
                        'repeat(3, minmax(0, 1fr))',
                      gap: '18px',
                    }}
                  >
                    <Field label="Preferred Date">
                      <input
                        type="date"
                        name="preferred_date"
                        value={form.preferred_date}
                        onChange={handleChange}
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="Available From">
                      <input
                        type="time"
                        name="preferred_time_start"
                        value={
                          form.preferred_time_start
                        }
                        onChange={handleChange}
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>

                    <Field label="Available Until">
                      <input
                        type="time"
                        name="preferred_time_end"
                        value={
                          form.preferred_time_end
                        }
                        onChange={handleChange}
                        disabled={submitting || Boolean(createdResponse)}
                        style={inputStyle}
                      />
                    </Field>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginTop: '28px',
                }}
              >
                <button
                  type="button"
                  onClick={goToPreviousStep}
                  disabled={submitting || Boolean(createdResponse)}
                  style={secondaryButtonStyle}
                >
                  ← {t('Back')}
                </button>

                <button
                  type="submit"
                  disabled={submitting || Boolean(createdResponse)}
                  style={primaryButtonStyle}
                >
                  {t('Review Request')} →
                </button>
              </div>
            </section>
          )}

          {currentStep === 4 && (
            <section
              style={{
                background: '#ffffff',
                borderRadius: '18px',
                padding: '28px',
                border: '1px solid #e4eaf2',
                boxShadow:
                  '0 8px 28px rgba(16, 42, 67, 0.06)',
              }}
            >
              <div style={{ marginBottom: '22px' }}>
                <span
                  style={{
                    display: 'inline-block',
                    background: '#eef8f6',
                    color: '#176b63',
                    padding: '6px 10px',
                    borderRadius: '20px',
                    fontSize: '12px',
                    fontWeight: 800,
                  }}
                >
                  STEP 4
                </span>

                <h2
                  style={{
                    margin: '10px 0 6px',
                    fontSize: '23px',
                  }}
                >
                  Review your request
                </h2>

                <p
                  style={{
                    margin: 0,
                    color: '#687789',
                  }}
                >
                  Please check the details before sending the
                  request to Vishwakarma Setu.
                </p>
              </div>

              <div
                style={{
                  display: 'grid',
                  gap: '16px',
                }}
              >
                <ReviewCard
                  title="Selected Service"
                  icon="🛠️"
                >
                  <strong>
                    {selectedService?.name ||
                      'Service'}
                  </strong>

                  {getCategoryName() && (
                    <span
                      style={{
                        display: 'block',
                        color: '#176b87',
                        fontSize: '13px',
                        marginTop: '4px',
                      }}
                    >
                      {getCategoryName()}
                    </span>
                  )}
                </ReviewCard>

                <ReviewCard
                  title="Technical Matching Requirements"
                  icon="🎯"
                >
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '8px',
                    }}
                  >
                    <span style={summaryBadgeStyle}>
                      {getRequiredCount(
                        requiredSkills,
                      )}{' '}
                      required skills
                    </span>

                    <span style={summaryBadgeStyle}>
                      {getRequiredCount(
                        requiredTools,
                      )}{' '}
                      required tools
                    </span>

                    <span
                      style={{
                        ...summaryBadgeStyle,
                        background: '#eef8f6',
                        color: '#176b63',
                      }}
                    >
                      Automatic technician matching
                    </span>
                  </div>
                </ReviewCard>

                <ReviewCard
                  title="Work Details"
                  icon="📋"
                >
                  <strong>
                    {form.title}
                  </strong>

                  {form.description && (
                    <p
                      style={{
                        margin:
                          '7px 0 0',
                        color: '#687789',
                        lineHeight: 1.6,
                      }}
                    >
                      {form.description}
                    </p>
                  )}
                </ReviewCard>

                <ReviewCard
                  title="Service Location"
                  icon="📍"
                >
                  <div>
                    {form.address_line1}

                    {form.address_line2 && (
                      <>
                        <br />
                        {form.address_line2}
                      </>
                    )}

                    <br />
                    {form.city}, {form.state}

                    {form.pincode && (
                      <> - {form.pincode}</>
                    )}
                  </div>

                  <div
                    style={{
                      marginTop: '8px',
                      color: '#176b63',
                      fontSize: '13px',
                      fontWeight: 700,
                    }}
                  >
                    ✓ Location coordinates available for
                    technician matching
                  </div>
                </ReviewCard>

                <ReviewCard
                  title="Preferred Schedule"
                  icon="🗓️"
                >
                  <div>
                    {form.preferred_date ||
                    form.preferred_time_start ||
                    form.preferred_time_end ? (
                      <>
                        {form.preferred_date && (
                          <div>
                            Date:{' '}
                            {form.preferred_date}
                          </div>
                        )}

                        {(form.preferred_time_start ||
                          form.preferred_time_end) && (
                          <div>
                            Time:{' '}
                            {form.preferred_time_start ||
                              '--:--'}{' '}
                            to{' '}
                            {form.preferred_time_end ||
                              '--:--'}
                          </div>
                        )}
                      </>
                    ) : (
                      <span
                        style={{
                          color: '#687789',
                        }}
                      >
                        Flexible / no preferred schedule
                        specified.
                      </span>
                    )}
                  </div>
                </ReviewCard>
              </div>

              <div
                style={{
                  marginTop: '22px',
                  background:
                    'linear-gradient(135deg, #eef8f6, #f0f8ff)',
                  border:
                    '1px solid #d4e9e5',
                  borderRadius: '14px',
                  padding: '18px',
                }}
              >
                <strong
                  style={{
                    display: 'block',
                    color: '#176b63',
                  }}
                >
                  🔱 What happens after submission?
                </strong>

                <p
                  style={{
                    margin: '7px 0 0',
                    color: '#557084',
                    lineHeight: 1.6,
                    fontSize: '14px',
                  }}
                >
                  Your request is created and the matching
                  system can identify technicians whose
                  skills, tools, verification, availability
                  and location satisfy the service
                  requirements.
                </p>
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '12px',
                  marginTop: '28px',
                }}
              >
                <button
                  type="button"
                  onClick={goToPreviousStep}
                  disabled={submitting || Boolean(createdResponse)}
                  style={secondaryButtonStyle}
                >
                  ← Edit Request
                </button>

                <button
                  type="button"
                  onClick={submitRequest}
                  disabled={submitting || Boolean(createdResponse)}
                  style={{
                    ...primaryButtonStyle,
                    minWidth: '220px',
                  }}
                >
                  {submitting
                    ? 'Saving request and photos...'
                    : createdResponse
                      ? 'Request Already Created'
                      : 'Submit Service Request'}
                </button>
              </div>
            </section>
          )}
        </form>
      </main>

      {showSuccess && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background:
              'rgba(15, 23, 42, 0.62)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
            zIndex: 1000,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: '480px',
              background: '#ffffff',
              borderRadius: '20px',
              padding: '32px',
              textAlign: 'center',
              boxShadow:
                '0 25px 70px rgba(0, 0, 0, 0.25)',
            }}
          >
            <div
              style={{
                width: '70px',
                height: '70px',
                margin: '0 auto 18px',
                borderRadius: '50%',
                background: '#e8f7ef',
                color: '#198754',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '36px',
                fontWeight: 800,
              }}
            >
              ✓
            </div>

            <div
              style={{
                color: '#176b63',
                fontSize: '13px',
                fontWeight: 800,
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}
            >
              Vishwakarma Setu
            </div>

            <h2
              style={{
                margin:
                  '7px 0 10px',
                fontSize: '25px',
              }}
            >
              Request Created Successfully
            </h2>

            <p
              style={{
                margin: 0,
                color: '#687789',
                lineHeight: 1.6,
              }}
            >
              {success}
            </p>

            <div
              style={{
                marginTop: '20px',
                padding: '13px',
                borderRadius: '11px',
                background: '#f4f8fb',
                color: '#526274',
                fontSize: '13px',
              }}
            >
              Redirecting you to your dashboard...
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, required, children }) {
  const { t } = useLanguage()
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '7px',
      }}
    >
      <span
        style={{
          fontWeight: 700,
          fontSize: '14px',
        }}
      >
        {t(label)}

        {required && (
          <span
            style={{
              color: '#d64545',
              marginLeft: '4px',
            }}
          >
            *
          </span>
        )}
      </span>

      {children}
    </label>
  )
}

function RequirementPanel({
  title,
  icon,
  items,
  emptyText,
}) {
  const requiredItems = items.filter(
    (item) => item.is_required !== false,
  )

  const optionalItems = items.filter(
    (item) => item.is_required === false,
  )

  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '15px',
        padding: '18px',
        background: '#fbfcfe',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          marginBottom: '14px',
        }}
      >
        <span
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#eaf5ff',
            fontSize: '19px',
          }}
        >
          {icon}
        </span>

        <div>
          <strong
            style={{
              display: 'block',
              fontSize: '16px',
            }}
          >
            {title}
          </strong>

          <span
            style={{
              display: 'block',
              marginTop: '2px',
              color: '#718096',
              fontSize: '12px',
            }}
          >
            {requiredItems.length} required
            {optionalItems.length > 0
              ? ` • ${optionalItems.length} optional`
              : ''}
          </span>
        </div>
      </div>

      {items.length === 0 ? (
        <div
          style={{
            color: '#7b8794',
            fontSize: '13px',
            lineHeight: 1.5,
            padding: '10px 0',
          }}
        >
          {emptyText}
        </div>
      ) : (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          {items.map((item) => (
            <span
              key={item.id}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                background:
                  item.is_required === false
                    ? '#f4f5f7'
                    : '#edf7f5',
                color:
                  item.is_required === false
                    ? '#657180'
                    : '#176b63',
                border:
                  item.is_required === false
                    ? '1px solid #e1e5ea'
                    : '1px solid #cfe7e1',
                borderRadius: '20px',
                padding: '7px 10px',
                fontSize: '12px',
                fontWeight: 700,
              }}
            >
              {item.is_required !== false
                ? '✓'
                : '○'}{' '}
              {item.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewCard({ title, icon, children }) {
  return (
    <div
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: '14px',
        padding: '17px',
        background: '#fbfcfe',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '9px',
          marginBottom: '10px',
        }}
      >
        <span>{icon}</span>

        <strong
          style={{
            fontSize: '14px',
          }}
        >
          {title}
        </strong>
      </div>

      <div
        style={{
          color: '#27364a',
          fontSize: '14px',
          lineHeight: 1.6,
        }}
      >
        {children}
      </div>
    </div>
  )
}

const inputStyle = {
  width: '100%',
  minHeight: '46px',
  padding: '11px 13px',
  border: '1px solid #cfd8e3',
  borderRadius: '10px',
  background: '#ffffff',
  color: '#172033',
  fontSize: '14px',
  outline: 'none',
  boxSizing: 'border-box',
}

const primaryButtonStyle = {
  border: 'none',
  background:
    'linear-gradient(135deg, #176b87, #2a9d8f)',
  color: '#ffffff',
  padding: '12px 20px',
  borderRadius: '10px',
  cursor: 'pointer',
  fontWeight: 800,
  fontSize: '14px',
  boxShadow:
    '0 6px 15px rgba(23, 107, 135, 0.18)',
}

const secondaryButtonStyle = {
  border: '1px solid #cfd8e3',
  background: '#ffffff',
  color: '#334155',
  padding: '12px 18px',
  borderRadius: '10px',
  cursor: 'pointer',
  fontWeight: 700,
  fontSize: '14px',
}

const summaryBadgeStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  background: '#eaf5ff',
  color: '#176b87',
  borderRadius: '20px',
  padding: '7px 10px',
  fontSize: '12px',
  fontWeight: 700,
}

export default CreateServiceRequest