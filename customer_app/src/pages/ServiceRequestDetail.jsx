import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import RequestPhotos from '../components/RequestPhotos'
import RequestLocationEditor from '../components/RequestLocationEditor'
import StartPin from '../components/StartPin'
import HappyCode from '../components/HappyCode'

const CANCELLABLE_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
]

const TIMELINE_STATUSES = [
  'ASSIGNED',
  'ACCEPTED',
  'ON_THE_WAY',
  'ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
]

function isRequestAssignable(request, job) {
  return String(request?.status || '').toUpperCase() === 'OPEN'
    && (!job || String(job.status || '').toUpperCase() === 'CANCELLED')
}

function formatStatus(status) {
  if (!status) {
    return '-'
  }

  return String(status).replaceAll('_', ' ')
}

function formatDateTime(value) {
  if (!value) {
    return '-'
  }

  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}

function getStatusClass(status) {
  return `status status-${String(status || '').toLowerCase()}`
}

function getArray(data, keys) {
  for (const key of keys) {
    if (Array.isArray(data?.[key])) {
      return data[key]
    }
  }

  return []
}

function ServiceRequestDetail({ requestId, onBack, focusMatches = false }) {
  const [request, setRequest] = useState(null)
  const [matches, setMatches] = useState([])
  const [job, setJob] = useState(null)
  const [history, setHistory] = useState([])
  const [rating, setRating] = useState(null)

  const [selectedTechnicianId, setSelectedTechnicianId] = useState('')
  const [estimatedAmount, setEstimatedAmount] = useState('1200')
  const [ratingValue, setRatingValue] = useState(5)
  const [review, setReview] = useState('')

  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [matching, setMatching] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [locationBusy, setLocationBusy] = useState(false)
  const locationOperation = useRef(false)
  const [cancelling, setCancelling] = useState(false)
  const [submittingRating, setSubmittingRating] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [showAssignmentSuccess, setShowAssignmentSuccess] = useState(false)
  const [assignedJobId, setAssignedJobId] = useState('')
  const successRef = useRef(null)
  const matchesHeadingRef = useRef(null)
  const matchesFocused = useRef(false)

  const loadData = useCallback(async (showLoading = false) => {
    if (showLoading) {
      setRefreshing(true)
    }

    setError('')

    try {
      const summaryData = await apiRequest(
        `/service-requests/${requestId}/summary`,
      )

      const requestData =
        summaryData.service_request ||
        summaryData.request ||
        summaryData.data ||
        null

      if (!requestData) {
        throw new Error('Service request details were not returned.')
      }

      setRequest(requestData)

      let latestJob = null

      if (requestData.customer_id) {
        const jobsData = await apiRequest(
          `/jobs/customer/${requestData.customer_id}`,
        )

        const jobs = getArray(jobsData, ['jobs', 'data'])

        const requestJobs = jobs
          .filter(
            (item) =>
              String(item.service_request_id) ===
              String(requestId),
          )
          .sort((a, b) => {
            const first = new Date(
              a.created_at || 0,
            ).getTime()
            const second = new Date(
              b.created_at || 0,
            ).getTime()

            return second - first
          })

        latestJob = requestJobs[0] || null
      }

      setJob(latestJob)

      if (latestJob?.id) {
        const jobData = await apiRequest(
          `/jobs/${latestJob.id}`,
        )

        if (jobData.job) {
          latestJob = jobData.job
          setJob(latestJob)
        }

        const historyData = await apiRequest(
          `/jobs/${latestJob.id}/history`,
        )

        setHistory(
          getArray(historyData, ['history', 'data']),
        )

        try {
          const ratingData = await apiRequest(
            `/ratings/job/${latestJob.id}`,
          )

          setRating(
            ratingData.rating ||
              ratingData.data ||
              ratingData ||
              null,
          )
        } catch (ratingError) {
          if (ratingError.status === 404) {
            setRating(null)
          } else {
            throw ratingError
          }
        }
      } else {
        setHistory([])
        setRating(null)
      }

     

      if (isRequestAssignable(requestData, latestJob)) {
        const matchesData = await apiRequest(
          `/service-requests/${requestId}/matches`,
        )

        const matchedTechnicians =
  matchesData.matches ||
  matchesData.matching?.technicians ||
  matchesData.matching?.matches ||
  matchesData.data?.matches ||
  matchesData.data?.technicians ||
  []

setMatches(
  Array.isArray(matchedTechnicians)
    ? matchedTechnicians
    : [],
)
      } else {
        setMatches([])
      }
    } catch (err) {
      setError(
        err.message ||
          'Unable to load service request details.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [requestId])

  useEffect(() => {
    let cancelled = false

    const initialTimer = setTimeout(() => {
      if (!cancelled) {
        void loadData(false)
      }
    }, 0)

    const intervalId = setInterval(() => {
      if (!cancelled) {
        void loadData(true)
      }
    }, 15000)

    return () => {
      cancelled = true
      clearTimeout(initialTimer)
      clearInterval(intervalId)
    }
  }, [loadData])

  const currentStatus = useMemo(() => {
    return String(
      job?.status ||
        request?.job_status ||
        request?.status ||
        '',
    ).toUpperCase()
  }, [job, request])

  const canAssign = isRequestAssignable(request, job)

  useEffect(() => {
    if (
      !focusMatches || loading || error || !canAssign
      || matchesFocused.current
    ) return
    const timer = window.setTimeout(() => {
      const heading = matchesHeadingRef.current
      if (!heading) return
      matchesFocused.current = true
      heading.scrollIntoView({ behavior: 'smooth', block: 'start' })
      heading.focus({ preventScroll: true })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [focusMatches, loading, error, canAssign])
  const canCancel =
    Boolean(job?.id) &&
    CANCELLABLE_STATUSES.includes(currentStatus)

  const technician = useMemo(() => {
    return matches.find(
      (item) =>
        String(item.technician_id) ===
        String(selectedTechnicianId),
    )
  }, [matches, selectedTechnicianId])

  async function handleFindTechnicians() {
    if (
      !canAssign || matching || assigning
      || locationBusy || locationOperation.current
    ) return
    setMatching(true)
    setError('')
    setSuccess('')

    try {
      const data = await apiRequest(
        `/service-requests/${requestId}/matches`,
      )

      const matchedTechnicians =
        data.matches ||
        data.matching?.technicians ||
        data.matching?.matches ||
        data.data?.matches ||
        data.data?.technicians ||
        []

      setMatches(
        Array.isArray(matchedTechnicians)
          ? matchedTechnicians
          : [],
      )

      setSelectedTechnicianId('')

      if (matchedTechnicians.length === 0) {
        setSuccess(
          'No eligible technicians are available right now.',
        )
      }
    } catch (err) {
      setError(
        err.message ||
          'Unable to find matching technicians.',
      )
    } finally {
      setMatching(false)
    }
  }

  function handleSelectTechnician(technicianId) {
    if (
      !canAssign || assigning || photoBusy || matching
      || locationOperation.current || locationBusy
    ) return
    setSelectedTechnicianId(technicianId)
    setError('')
    setSuccess('')
    setShowConfirmModal(true)
  }

  function closeConfirmModal() {
    if (!assigning) {
      setShowConfirmModal(false)
    }
  }

  async function handleAssign() {
    if (!canAssign || photoBusy || assigning || locationBusy || locationOperation.current) {
      return
    }
    if (!selectedTechnicianId) {
      setError('Please select a technician first.')
      return
    }

    setAssigning(true)
    setError('')
    setSuccess('')

    try {
      const amountText = String(
        estimatedAmount || '',
      ).trim()

      const amount =
        amountText === ''
          ? null
          : Number(amountText)

      if (
        amount !== null &&
        (!Number.isFinite(amount) || amount < 0)
      ) {
        throw new Error(
          'Estimated amount must be a valid number.',
        )
      }

      const data = await apiRequest('/jobs', {
        method: 'POST',
        body: JSON.stringify({
          service_request_id: requestId,
          technician_id: selectedTechnicianId,
          estimated_amount: amount,
        }),
      })

      const createdJobId =
        data.job?.id || data.id || data.job_id || ''

      setAssignedJobId(createdJobId)
      setSuccess('Job Assigned Successfully')
      setShowConfirmModal(false)
      setSelectedTechnicianId('')
      await loadData(false)
      setShowAssignmentSuccess(true)

      window.setTimeout(() => {
        successRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        })
      }, 50)
    } catch (err) {
      setError(
        err.message ||
          'Unable to assign the technician.',
      )
    } finally {
      setAssigning(false)
    }
  }

  async function handleCancelJob() {
    if (!job?.id) {
      return
    }

    const reason = window.prompt(
      'Enter cancellation reason (optional):',
      '',
    )

    if (reason === null) {
      return
    }

    setCancelling(true)
    setError('')
    setSuccess('')

    try {
      const data = await apiRequest(
        `/jobs/${job.id}/cancel`,
        {
          method: 'POST',
          body: JSON.stringify({
            reason: reason.trim() || null,
          }),
        },
      )

      setSuccess(
        data.message ||
          'Job cancelled successfully.',
      )

      await loadData(false)
    } catch (err) {
      setError(
        err.message ||
          'Unable to cancel the job.',
      )
    } finally {
      setCancelling(false)
    }
  }

  async function handleSubmitRating() {
    if (!job?.id) {
      return
    }

    setSubmittingRating(true)
    setError('')
    setSuccess('')

    try {
      const data = await apiRequest('/ratings', {
        method: 'POST',
        body: JSON.stringify({
          job_id: job.id,
          rating: Number(ratingValue),
          review: review.trim(),
        }),
      })

      setRating(
        data.rating ||
          data.data ||
          data,
      )

      setSuccess(
        data.message ||
          'Rating submitted successfully.',
      )

      setReview('')
      await loadData(false)
    } catch (err) {
      setError(
        err.message ||
          'Unable to submit rating.',
      )
    } finally {
      setSubmittingRating(false)
    }
  }

  if (loading) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <div>
            <h1>Tech Expert Marketplace</h1>
            <p>Service Request Details</p>
          </div>
        </header>

        <main className="dashboard-content">
          <div className="dashboard-message">
            Loading service request...
          </div>
        </main>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="dashboard">
        <header className="dashboard-header">
          <div>
            <h1>Tech Expert Marketplace</h1>
            <p>Service Request Details</p>
          </div>

          <button type="button" onClick={onBack}>
            Back
          </button>
        </header>

        <main className="dashboard-content">
          {error && (
            <div
              className="dashboard-error"
              role="alert"
            >
              {error}
            </div>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <div>
          <h1>Tech Expert Marketplace</h1>
          <p>Service Request Details</p>
        </div>

        <button type="button" onClick={onBack}>
          Back to Requests
        </button>
      </header>

      <main className="dashboard-content">
        {error && (
          <div
            className="dashboard-error"
            role="alert"
          >
            {error}
          </div>
        )}

        {success && (
          <div
            className="dashboard-message"
            role="status"
          >
            {success}
          </div>
        )}

        <section className="welcome-card">
          <div className="section-heading">
            <div>
              <h2>
                {request.title ||
                  'Service Request'}
              </h2>

              <p>
                {request.service_name ||
                  'Technical Service'}
              </p>
            </div>

            <span
              className={getStatusClass(
                currentStatus,
              )}
            >
              {formatStatus(currentStatus)}
            </span>
          </div>

          <div className="request-details">
            <p>
              <strong>Category:</strong>{' '}
              {request.category_name || '-'}
            </p>

            <p>
              <strong>Description:</strong>{' '}
              {request.description || '-'}
            </p>

            <p>
              <strong>Address:</strong>{' '}
              {request.address_line1 || '-'}
              {request.address_line2
                ? `, ${request.address_line2}`
                : ''}
            </p>

            <p>
              <strong>Location:</strong>{' '}
              {request.city || '-'}
              {request.state
                ? `, ${request.state}`
                : ''}
              {request.pincode
                ? ` - ${request.pincode}`
                : ''}
            </p>

            <p>
              <strong>Preferred Date:</strong>{' '}
              {request.preferred_date || '-'}
            </p>

            <p>
              <strong>Preferred Time:</strong>{' '}
              {request.preferred_time_start ||
                '-'}
              {request.preferred_time_end
                ? ` to ${request.preferred_time_end}`
                : ''}
            </p>

            <p>
              <strong>Created:</strong>{' '}
              {formatDateTime(
                request.created_at,
              )}
            </p>
          </div>
        </section>

        {!job && !request.job_id && String(request.status).toUpperCase() === 'OPEN' && (
          <details className="dashboard-section" aria-label="Correct work location">
            <summary style={{ cursor: 'pointer', fontWeight: 700 }}>
              Correct Work Location
            </summary>
            <p>Use this only if the location saved with your request is incorrect.</p>
          <RequestLocationEditor
            key={`location-${requestId}`}
            requestId={requestId}
            disabled={assigning || photoBusy || matching || refreshing}
            onBusyChange={(value) => {
              locationOperation.current = value
              setLocationBusy(value)
              if (value) {
                setSelectedTechnicianId('')
                setShowConfirmModal(false)
                setMatches([])
              }
            }}
            onSaved={async () => {
              setSelectedTechnicianId('')
              setShowConfirmModal(false)
              setMatches([])
              await loadData(false)
            }}
          />
          </details>
        )}

        <RequestPhotos
          key={`photos-${requestId}`}
          requestId={requestId}
          editable={
            !job
            && !request.job_id
            && String(request.status).toUpperCase() === 'OPEN'
          }
          disabled={assigning || locationBusy}
          onBusyChange={setPhotoBusy}
        />

        {job && String(job.status).toUpperCase() === 'ARRIVED' && (
          <StartPin key={job.id} jobId={job.id} onPriceChanged={() => loadData(false)} />
        )}

        {job && String(job.status).toUpperCase() === 'IN_PROGRESS' && (
          <HappyCode key={job.id} jobId={job.id} />
        )}

        {job && (
          <section className="dashboard-section">
            <div className="section-heading">
              <div>
                <h2>Job Tracking</h2>
                <p>
                  Follow the assigned technician job.
                </p>
              </div>

              <span
                className={getStatusClass(
                  job.status,
                )}
              >
                {formatStatus(job.status)}
              </span>
            </div>

            <div className="request-details">
              <p>
                <strong>Job ID:</strong>{' '}
                {job.id}
              </p>

              <p>
                <strong>Technician:</strong>{' '}
                {job.technician_name || '-'}
              </p>

              <p>
                <strong>Business:</strong>{' '}
                {job.technician_business_name ||
                  '-'}
              </p>

              <p>
                <strong>Estimated Amount:</strong>{' '}
                {job.estimated_amount !==
                  undefined &&
                job.estimated_amount !== null
                  ? `₹${job.estimated_amount}`
                  : '-'}
              </p>

              {job.final_amount !==
                undefined &&
                job.final_amount !== null && (
                  <p>
                    <strong>Final Amount:</strong>{' '}
                    ₹{job.final_amount}
                  </p>
                )}
            </div>

            {canCancel && (
              <div className="dashboard-actions">
                <button
                  type="button"
                  onClick={handleCancelJob}
                  disabled={cancelling}
                >
                  {cancelling
                    ? 'Cancelling...'
                    : 'Cancel Job'}
                </button>
              </div>
            )}

            <div className="dashboard-section">
              <h3>Job Timeline</h3>

              <div className="request-list">
                {TIMELINE_STATUSES.map(
                  (status) => {
                    const historyItem =
                      history.find(
                        (item) =>
                          String(
                            item.new_status ||
                              '',
                          ).toUpperCase() ===
                          status,
                      )

                    return (
                      <article
                        className="request-card"
                        key={status}
                      >
                        <div className="request-main">
                          <h3>
                            {formatStatus(status)}
                          </h3>

                          <p className="request-location">
                            {historyItem
                              ? formatDateTime(
                                  historyItem.created_at,
                                )
                              : 'Pending'}
                          </p>

                          {historyItem?.remarks && (
                            <p className="request-location">
                              {historyItem.remarks}
                            </p>
                          )}
                        </div>

                        <div className="request-meta">
                          <span
                            className={getStatusClass(
                              historyItem
                                ? status
                                : '',
                            )}
                          >
                            {historyItem
                              ? 'Done'
                              : 'Pending'}
                          </span>
                        </div>
                      </article>
                    )
                  },
                )}

                {currentStatus ===
                  'CANCELLED' && (
                  <article className="request-card">
                    <div className="request-main">
                      <h3>Cancelled</h3>
                      <p className="request-location">
                        {formatDateTime(
                          job.cancelled_at,
                        )}
                      </p>

                      {job.cancellation_reason && (
                        <p className="request-location">
                          Reason:{' '}
                          {
                            job.cancellation_reason
                          }
                        </p>
                      )}
                    </div>
                  </article>
                )}
              </div>
            </div>
          </section>
        )}

        {canAssign && job?.status?.toUpperCase() === 'CANCELLED' && (
          <div className="dashboard-message" role="status">
            The previous job was cancelled. Your service request remains
            open. Select a technician below to arrange a new job.
          </div>
        )}

        {canAssign && (
          <section className="dashboard-section">
            <div className="section-heading">
              <div>
                <h2
                  ref={matchesHeadingRef}
                  tabIndex={-1}
                  style={{ scrollMarginTop: 24 }}
                >
                  Matching Technicians
                </h2>
                <p>
                  Select an eligible technician for
                  this service request.
                </p>
              </div>

              <button
                type="button"
                onClick={handleFindTechnicians}
                disabled={matching || assigning || photoBusy || locationBusy}
              >
                {matching
                  ? 'Finding...'
                  : 'Find Technician'}
              </button>
            </div>

            {matches.length === 0 ? (
              <div className="empty-state">
                No eligible technicians are available nearby right now.
                You can refresh the matches or return to this request later.
              </div>
            ) : (
              <div className="request-list">
                {matches.map((item) => {
                  const isSelected =
                    String(
                      selectedTechnicianId,
                    ) ===
                    String(item.technician_id)

                  return (
                    <article
                      className="request-card"
                      key={item.technician_id}
                      role="button"
                      tabIndex={0}
                      onClick={() =>
                        handleSelectTechnician(
                          item.technician_id,
                        )
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === 'Enter' ||
                          event.key === ' '
                        ) {
                          event.preventDefault()
                          handleSelectTechnician(
                            item.technician_id,
                          )
                        }
                      }}
                      style={{
                        cursor: 'pointer',
                        outline: isSelected
                          ? '2px solid currentColor'
                          : undefined,
                      }}
                    >
                      <div className="request-main">
                        <h3>
                          {item.full_name ||
                            'Technician'}
                        </h3>

                        <p className="request-service">
                          {item.business_name ||
                            'Independent Technician'}
                        </p>

                        <p className="request-location">
                          Experience:{' '}
                          {item.experience_years ??
                            0}{' '}
                          years
                        </p>

                        <p className="request-location">
                          Rating:{' '}
                          {item.rating_average ??
                            0}{' '}
                          / 5
                        </p>

                        <p className="request-location">
                          Jobs:{' '}
                          {item.total_jobs ?? 0}
                        </p>

                        <p className="request-location">
                          Distance:{' '}
                          {item.distance_km ??
                            '-'}{' '}
                          km
                        </p>
                      </div>

                      <div className="request-meta">
                        <span
                          className={getStatusClass(
                            item.availability_status,
                          )}
                        >
                          {item.availability_status ||
                            'ONLINE'}
                        </span>

                        <span>
                          {isSelected
                            ? 'Selected'
                            : 'Select'}
                        </span>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}

            {selectedTechnicianId && !showConfirmModal && (
              <div className="welcome-card">
                <h3>Technician Selected</h3>
                <p>
                  {technician?.full_name || selectedTechnicianId}
                </p>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => setShowConfirmModal(true)}
                >
                  Review & Confirm
                </button>
              </div>
            )}
          </section>
        )}

        {job &&
          String(job.status).toUpperCase() ===
            'COMPLETED' && (
            <section className="dashboard-section">
              <div className="section-heading">
                <div>
                  <h2>Service Rating</h2>
                  <p>
                    Rate the completed service.
                  </p>
                </div>
              </div>

              {rating ? (
                <div className="welcome-card">
                  <h3>Rating Submitted</h3>
                  <p>
                    <strong>
                      {rating.rating || 0}
                      /5
                    </strong>
                  </p>

                  {rating.review && (
                    <p>
                      {rating.review}
                    </p>
                  )}
                </div>
              ) : (
                <div className="welcome-card">
                  <label htmlFor="rating-value">
                    Rating
                  </label>

                  <select
                    id="rating-value"
                    value={ratingValue}
                    onChange={(event) =>
                      setRatingValue(
                        Number(
                          event.target.value,
                        ),
                      )
                    }
                  >
                    <option value="5">
                      5 - Excellent
                    </option>
                    <option value="4">
                      4 - Very Good
                    </option>
                    <option value="3">
                      3 - Good
                    </option>
                    <option value="2">
                      2 - Fair
                    </option>
                    <option value="1">
                      1 - Poor
                    </option>
                  </select>

                  <label htmlFor="review">
                    Review
                  </label>

                  <textarea
                    id="review"
                    maxLength={1000}
                    rows={4}
                    value={review}
                    onChange={(event) =>
                      setReview(
                        event.target.value,
                      )
                    }
                    placeholder="Write your review..."
                  />

                  <div className="dashboard-actions">
                    <button
                      type="button"
                      className="primary-action"
                      onClick={
                        handleSubmitRating
                      }
                      disabled={
                        submittingRating
                      }
                    >
                      {submittingRating
                        ? 'Submitting...'
                        : 'Submit Rating'}
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

        {canAssign && showConfirmModal && technician && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-technician-title"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              background: 'rgba(0, 0, 0, 0.55)',
            }}
          >
            <div
              className="welcome-card"
              style={{
                width: 'min(520px, 100%)',
                maxHeight: '90vh',
                overflowY: 'auto',
                margin: 0,
              }}
            >
              <h2 id="confirm-technician-title">
                Confirm Technician
              </h2>
              <p>Review the technician and estimated amount before assigning the job.</p>

              <div className="request-card">
                <div className="request-main">
                  <h3>{technician.full_name || 'Technician'}</h3>
                  <p className="request-service">
                    {technician.business_name || 'Independent Technician'}
                  </p>
                  <p className="request-location">
                    Experience: {technician.experience_years ?? 0} years
                  </p>
                  <p className="request-location">
                    Rating: {technician.rating_average ?? 0} / 5
                  </p>
                  <p className="request-location">
                    Distance: {technician.distance_km ?? '-'} km
                  </p>
                </div>
              </div>

              <label htmlFor="estimated-amount-modal">
                Estimated Amount
              </label>
              <input
                id="estimated-amount-modal"
                type="number"
                min="0"
                step="0.01"
                value={estimatedAmount}
                onChange={(event) => setEstimatedAmount(event.target.value)}
              />

              {error && (
                <div className="dashboard-error" role="alert">
                  {error}
                </div>
              )}

              <div
                className="dashboard-actions"
                style={{ marginTop: '20px' }}
              >
                <button
                  type="button"
                  onClick={closeConfirmModal}
                  disabled={assigning || photoBusy}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary-action"
                  onClick={handleAssign}
                  disabled={assigning || photoBusy}
                >
                  {assigning ? 'Assigning...' : 'Confirm & Assign Job'}
                </button>
              </div>
            </div>
          </div>
        )}

        {showAssignmentSuccess && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="assignment-success-title"
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1100,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '20px',
              background: 'rgba(0, 0, 0, 0.55)',
            }}
          >
            <div
              className="welcome-card"
              style={{
                width: 'min(480px, 100%)',
                margin: 0,
                textAlign: 'center',
              }}
            >
              <h2 id="assignment-success-title">
                Job Assigned Successfully
              </h2>
              <p>
                The technician has been assigned to your service request.
              </p>
              {assignedJobId && (
                <p className="request-location">
                  Job ID: {assignedJobId}
                </p>
              )}
              <div className="dashboard-actions" style={{ justifyContent: 'center', marginTop: '20px' }}>
                <button
                  type="button"
                  className="primary-action"
                  onClick={() => {
                    setShowAssignmentSuccess(false)
                    window.setTimeout(() => {
                      successRef.current?.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start',
                      })
                    }, 50)
                  }}
                >
                  Continue to Job
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={successRef} className="dashboard-message">
          {refreshing
            ? 'Refreshing job information...'
            : 'This page refreshes automatically every 15 seconds.'}
        </div>
      </main>
    </div>
  )
}

export default ServiceRequestDetail
