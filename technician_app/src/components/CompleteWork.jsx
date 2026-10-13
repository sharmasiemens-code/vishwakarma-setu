import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import DisputePhotos from './DisputePhotos'

export default function CompleteWork({ jobId, disabled, onCompleted }) {
  const [review, setReview] = useState(null)
  const [code, setCode] = useState('')
  const [workSummary, setWorkSummary] = useState('')
  const [summarySheet, setSummarySheet] = useState(null)
  const [summaryNotice, setSummaryNotice] = useState('')
  const summaryDirty = useRef(false)
  const [disputes, setDisputes] = useState([])
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const operationLock = useRef(false)

  const load = useCallback(async (signal) => {
    const [data, history, sheetData] = await Promise.all([
      apiRequest(`/jobs/${jobId}/completion`, {
        signal,
        cache: 'no-store',
      }),
      apiRequest(`/jobs/${jobId}/disputes?page_size=100`, {
        signal,
        cache: 'no-store',
      }),
      apiRequest(`/jobs/${jobId}/completion-price-sheet`, {
        signal,
        cache: 'no-store',
      }),
    ])
    if (signal?.aborted) return
    setReview(data)
    setSummarySheet(sheetData.price_sheet)
    if (!summaryDirty.current) {
      setWorkSummary(sheetData.price_sheet?.work_summary || '')
    }
    setDisputes(history.disputes || [])
    setHistoryHasMore(Boolean(history.pagination?.has_more))
    if (data.completion_request?.status !== 'APPROVED') setCode('')
    setLoading(false)
  }, [jobId])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      load(controller.signal).catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message || 'Unable to load completion status.')
          setLoading(false)
        }
      })
    }, 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [load])

  async function refresh() {
    if (operationLock.current || disabled) return
    operationLock.current = true
    setLoading(true)
    setError('')
    try {
      await load()
    } catch (err) {
      setError(err.message || 'Unable to refresh completion status.')
      setLoading(false)
    } finally {
      operationLock.current = false
    }
  }

  async function persistSummary() {
    if (!summarySheet || workSummary.trim().length < 10) {
      throw new Error('Describe the completed work in at least ten characters.')
    }
    const data = await apiRequest(`/jobs/${jobId}/completion-summary`, {
      method: 'PUT',
      body: JSON.stringify({
        summary: workSummary.trim(),
        expected_version: summarySheet.summary_version,
      }),
    })
    summaryDirty.current = false
    setSummarySheet((previous) => ({
      ...previous,
      work_summary: data.work_summary,
      summary_version: data.summary_version,
    }))
    setWorkSummary(data.work_summary)
  }

  async function saveSummary() {
    if (operationLock.current || disabled || loading) return
    operationLock.current = true
    setBusy(true)
    setError('')
    setSummaryNotice('')
    try {
      await persistSummary()
      setSummaryNotice('Completed-work summary saved.')
    } catch (err) {
      setError(
        (err.message || 'Unable to save the work summary.')
        + ' Refresh Review Status before retrying.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function requestCompletion() {
    if (operationLock.current || disabled) return
    operationLock.current = true
    setBusy(true)
    setError('')
    try {
      await persistSummary()
      const data = await apiRequest(`/jobs/${jobId}/completion-request`, {
        method: 'POST',
      })
      setReview({
        job_status: 'IN_PROGRESS',
        completion_request: data.completion_request,
      })
    } catch (err) {
      setError(
        (err.message || 'Unable to request completion.')
        + ' Refresh the review status before retrying if the connection was interrupted.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function finish(event) {
    event.preventDefault()
    if (operationLock.current || disabled) return
    if (!/^[0-9]{4}$/.test(code)) {
      setError('Enter the four-digit Happy Code provided by the customer.')
      return
    }

    operationLock.current = true
    setBusy(true)
    setError('')
    try {
      await apiRequest(`/jobs/${jobId}/status`, {
        method: 'POST',
        body: JSON.stringify({
          new_status: 'COMPLETED',
          happy_code: code,
        }),
      })
      setReview((previous) => ({
        ...previous,
        job_status: 'COMPLETED',
        completion_request: {
          ...previous?.completion_request,
          status: 'COMPLETED',
        },
      }))
      await onCompleted?.()
    } catch (err) {
      setError(
        (err.message || 'Unable to confirm completion.')
        + ' Refresh the dashboard to check the current job status before retrying.',
      )
    } finally {
      setCode('')
      operationLock.current = false
      setBusy(false)
    }
  }

  const status = review?.completion_request?.status
  const inProgress = review?.job_status === 'IN_PROGRESS'

  return (
    <section className="technician-completion" aria-label="Customer completion confirmation" style={{ marginTop: 16 }}>
      <h3>Confirm Work Completion</h3>
      <p>The job stays in progress until the customer approves and you verify their Happy Code.</p>

      <button
        type="button"
        onClick={refresh}
        disabled={busy || loading || disabled}
      >
        {loading ? 'Loading review...' : 'Refresh Review Status'}
      </button>

      {error && <p role="alert">{error}</p>}
      {summaryNotice && <p role="status">{summaryNotice}</p>}

      {!loading && inProgress && (
        !status || ['REQUESTED', 'WORK_RESUMED'].includes(status)
      ) && (
        <div style={{ marginTop: 16 }}>
          <label style={{ display: 'block' }}>
            Brief description of work completed
            <textarea
              value={workSummary}
              onChange={(event) => {
                summaryDirty.current = true
                setWorkSummary(event.target.value)
                setSummaryNotice('')
              }}
              minLength={10}
              maxLength={2000}
              rows={4}
              disabled={busy || disabled || loading}
              placeholder="Describe the work performed and checks completed."
              style={{
                display: 'block', width: '100%', boxSizing: 'border-box',
                marginTop: 8, padding: 12,
              }}
            />
          </label>
          <p>The customer will see this summary and the agreed total before approving.</p>
          {status === 'REQUESTED' && (
            <button
              type="button"
              onClick={saveSummary}
              disabled={busy || disabled || !summarySheet || workSummary.trim().length < 10}
            >
              {busy ? 'Saving...' : 'Save Work Summary'}
            </button>
          )}
        </div>
      )}

      {!loading && inProgress && (!status || status === 'WORK_RESUMED') && (
        <button
          type="button"
          className="primary-action"
          onClick={requestCompletion}
          disabled={busy || disabled || !summarySheet || workSummary.trim().length < 10}
          style={{ marginTop: 12 }}
        >
          {busy
            ? 'Requesting...'
            : status === 'WORK_RESUMED'
              ? 'Request Fresh Review After Corrections'
              : 'Request Customer Completion Review'}
        </button>
      )}

      {status === 'REQUESTED' && (
        <p>Waiting for customer review. Refresh this status after they approve.</p>
      )}
      {status === 'ISSUE_REPORTED' && (
        <p>The customer reported an issue. Completion is blocked until it is resolved.</p>
      )}
      {status === 'WORK_RESUMED' && (
        <p>
          The administrator returned the job for corrective work.
          Make the corrections, then request a fresh customer review.
          The previous Happy Code cannot complete this job.
        </p>
      )}
      {review?.job_status === 'COMPLETED' && (
        <p>Completion confirmed. Refresh the dashboard if the active job is still displayed.</p>
      )}

      {inProgress && status === 'APPROVED' && (
        <form onSubmit={finish} style={{ marginTop: 16 }}>
          <label>
            Customer Happy Code
            <input
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{4}"
              maxLength={4}
              value={code}
              onChange={(event) => {
                setCode(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))
                setError('')
              }}
              disabled={busy || disabled || loading}
              required
              style={{
                display: 'block',
                marginTop: 8,
                padding: 10,
                width: 160,
                letterSpacing: 6,
              }}
            />
          </label>
          <button
            type="submit"
            className="primary-action"
            disabled={busy || disabled || loading || code.length !== 4}
            style={{ marginTop: 12 }}
          >
            {busy ? 'Verifying...' : 'Verify Happy Code and Complete Job'}
          </button>
          <p>Five incorrect attempts temporarily lock verification.</p>
        </form>
      )}
      {disputes.length > 0 && (
        <section aria-label="Work issue history" style={{ marginTop: 24 }}>
          <h3>Work Issue History</h3>
          {disputes.map((dispute) => (
            <article
              key={dispute.id}
              style={{
                border: '1px solid #dce5ee',
                borderRadius: 10,
                padding: 16,
                marginTop: 12,
              }}
            >
              <strong>{dispute.status.replaceAll('_', ' ')}</strong>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {dispute.description}
              </p>
              <p>Reported: {new Date(dispute.created_at).toLocaleString()}</p>
              {dispute.resolution_reason && (
                <>
                  <strong>Resolution: Return to Work</strong>
                  <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {dispute.resolution_reason}
                  </p>
                  <p>Resolved: {new Date(dispute.resolved_at).toLocaleString()}</p>
                </>
              )}
              <DisputePhotos
                disputeId={dispute.id}
                disabled={busy || loading || disabled}
              />
            </article>
          ))}
          {historyHasMore && <p>Showing the latest 100 issues.</p>}
        </section>
      )}

    </section>
  )
}
