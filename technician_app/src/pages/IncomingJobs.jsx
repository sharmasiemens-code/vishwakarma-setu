import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import JobPhotos from '../components/JobPhotos'

function IncomingJobs({ onJobResponded }) {
  const operationLock = useRef(false)
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [respondingJobId, setRespondingJobId] =
    useState(null)
  const [error, setError] = useState('')

  async function loadIncomingJobs() {
    setRefreshing(true)

    try {
      const data = await apiRequest(
        '/jobs/technician/me/incoming',
      )

      setJobs(data.jobs || [])
      setError('')
    } catch (err) {
      setError(
        err.message ||
          'Unable to load incoming jobs.',
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function fetchIncomingJobs() {
      try {
        const data = await apiRequest(
          '/jobs/technician/me/incoming',
        )

        if (!cancelled) {
          setJobs(data.jobs || [])
          setError('')
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              'Unable to load incoming jobs.',
          )
          setLoading(false)
        }
      }
    }

    fetchIncomingJobs()

    const intervalId = window.setInterval(
      fetchIncomingJobs,
      15000,
    )

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  async function respondToJob(jobId, action) {
    if (!jobId) {
      setError(
        'Job ID is missing. Please refresh the Incoming Jobs list.',
      )
      return
    }

    if (operationLock.current) return
    operationLock.current = true
    setRespondingJobId(jobId)
    setError('')

    try {
      await apiRequest(
        `/jobs/${jobId}/respond`,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            remarks:
              action === 'ACCEPT'
                ? 'Accepted by technician'
                : 'Rejected by technician',
          }),
        },
      )

      await loadIncomingJobs()

      if (onJobResponded) {
        await onJobResponded()
      }
    } catch (err) {
      setError(
        err.message ||
          `Unable to ${action.toLowerCase()} job.`,
      )
    } finally {
      operationLock.current = false
      setRespondingJobId(null)
    }
  }

  async function handleAccept(job) {
    const jobId = job.job_id || job.id

    await respondToJob(jobId, 'ACCEPT')
  }

  async function handleReject(job) {
    const confirmed = window.confirm(
      'Are you sure you want to reject this job?',
    )

    if (!confirmed) {
      return
    }

    const jobId = job.job_id || job.id

    await respondToJob(jobId, 'REJECT')
  }

  function formatAddress(job) {
    return [
      job.address_line1,
      job.address_line2,
      job.city,
      job.state,
      job.pincode,
    ]
      .filter(Boolean)
      .join(', ')
  }

  if (loading) {
    return (
      <section className="welcome-card">
        <h2>Incoming Jobs</h2>
        <p>Checking for new jobs...</p>
      </section>
    )
  }

  return (
    <section className="welcome-card">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2>Incoming Jobs</h2>

          <p>
            {jobs.length === 0
              ? 'No new job requests.'
              : `${jobs.length} job request${
                  jobs.length === 1 ? '' : 's'
                } waiting for your response.`}
          </p>
        </div>

        <button
          type="button"
          onClick={loadIncomingJobs}
          disabled={refreshing}
        >
          {refreshing
            ? 'Refreshing...'
            : 'Refresh'}
        </button>
      </div>

      {error && (
        <div
          className="dashboard-error"
          role="alert"
          style={{
            whiteSpace: 'pre-line',
            marginTop: '16px',
          }}
        >
          {error}
        </div>
      )}

      {jobs.length === 0 ? (
        <p style={{ marginTop: '18px' }}>
          New assigned jobs will appear here.
        </p>
      ) : (
        <div style={{ marginTop: '18px' }}>
          {jobs.map((job) => {
            const jobId = job.job_id || job.id
            const responding =
              respondingJobId === jobId

            return (
              <div
                key={jobId}
                style={{
                  border: '1px solid #e5e7eb',
                  borderRadius: '8px',
                  padding: '18px',
                  marginBottom: '16px',
                }}
              >
                <h3>
                  {job.service_request_title ||
                    job.service_name ||
                    'Service Job'}
                </h3>

                <p>
                  <strong>Service:</strong>{' '}
                  {job.service_name || 'N/A'}
                </p>

                <p>
                  <strong>Description:</strong>{' '}
                  {job.service_request_description ||
                    'N/A'}
                </p>

                <p>
                  <strong>Customer:</strong>{' '}
                  {job.customer_name || 'N/A'}
                </p>

                <p>
                  <strong>Phone:</strong>{' '}
                  {job.customer_phone || 'N/A'}
                </p>

                <p>
                  <strong>Address:</strong>{' '}
                  {formatAddress(job) || 'N/A'}
                </p>

                <p>
                  <strong>Estimated Amount:</strong>{' '}
                  {job.estimated_amount ?? 'N/A'}
                </p>

                <p>
                  <strong>Status:</strong>{' '}
                  {job.status || 'ASSIGNED'}
                </p>

                {job.service_request_id && (
                  <JobPhotos
                    key={job.service_request_id}
                    requestId={job.service_request_id}
                    disabled={responding}
                  />
                )}

                <div
                  style={{
                    display: 'flex',
                    gap: '10px',
                    flexWrap: 'wrap',
                    marginTop: '18px',
                  }}
                >
                  <button
                    type="button"
                    className="primary-action"
                    onClick={() =>
                      handleAccept(job)
                    }
                    disabled={responding}
                  >
                    {responding
                      ? 'Processing...'
                      : 'Accept Job'}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      handleReject(job)
                    }
                    disabled={responding}
                  >
                    Reject Job
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default IncomingJobs