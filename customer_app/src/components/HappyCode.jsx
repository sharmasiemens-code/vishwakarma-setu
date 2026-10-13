import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import DisputePhotos from './DisputePhotos'

export default function HappyCode({ jobId }) {
  const [review, setReview] = useState(null)
  const [issued, setIssued] = useState(null)
  const [accepted, setAccepted] = useState(false)
  const [completionSheet, setCompletionSheet] = useState(null)
  const sheetSignature = useRef(null)
  const [disputes, setDisputes] = useState([])
  const [historyHasMore, setHistoryHasMore] = useState(false)
  const [description, setDescription] = useState('')
  const [showIssueForm, setShowIssueForm] = useState(false)
  const [notice, setNotice] = useState('')
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
    const sheet = sheetData.price_sheet
    const signature = JSON.stringify([
      sheet?.summary_version, sheet?.total_payable,
    ])
    if (sheetSignature.current !== signature) {
      setAccepted(false)
      setIssued(null)
    }
    sheetSignature.current = signature
    setCompletionSheet(sheet)
    setDisputes(history.disputes || [])
    setHistoryHasMore(Boolean(history.pagination?.has_more))
    setLoading(false)
    const currentStatus = data.completion_request?.status
    if (data.job_status !== 'IN_PROGRESS' || currentStatus !== 'APPROVED') {
      setIssued(null)
    }
    if (!['REQUESTED', 'APPROVED'].includes(currentStatus)) {
      setAccepted(false)
      setShowIssueForm(false)
    }
  }, [jobId])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      load(controller.signal).catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message || 'Unable to load completion review.')
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
    if (operationLock.current) return
    operationLock.current = true
    setLoading(true)
    setError('')
    try {
      await load()
    } catch (err) {
      setError(err.message || 'Unable to refresh completion review.')
      setLoading(false)
    } finally {
      operationLock.current = false
    }
  }

  async function approve() {
    if (
      operationLock.current || !accepted || loading
      || !completionSheet?.ready
      || review?.job_status !== 'IN_PROGRESS'
      || !['REQUESTED', 'APPROVED'].includes(review?.completion_request?.status)
    ) return

    operationLock.current = true
    setBusy(true)
    setError('')
    setIssued(null)

    try {
      const data = await apiRequest(`/jobs/${jobId}/completion-approval`, {
        method: 'POST',
        body: JSON.stringify({
          accept_work: true,
          expected_summary_version: completionSheet.summary_version,
          expected_total: completionSheet.total_payable,
        }),
      })
      if (!/^[0-9]{4}$/.test(data.happy_code || '')) {
        throw new Error('The Happy Code could not be displayed.')
      }
      setIssued({ code: data.happy_code, expiresAt: data.expires_at })

      try {
        await load()
      } catch {
        setError('Approval succeeded. Refresh the review status when your connection returns.')
      }
    } catch (err) {
      setError(
        (err.message || 'Unable to confirm approval.')
        + ' If the response was interrupted, refresh the review status '
        + 'and wait at least 60 seconds before generating a replacement.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function reportIssue(event) {
    event.preventDefault()
    if (operationLock.current) return
    const trimmed = description.trim()
    if (trimmed.length < 10 || trimmed.length > 2000) {
      setError('Describe the issue in 10 to 2000 characters.')
      return
    }
    if (!window.confirm(
      'Report this work issue? Completion will be blocked and any issued Happy Code will stop working.',
    )) return

    operationLock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setIssued(null)
    setAccepted(false)

    try {
      const data = await apiRequest(`/jobs/${jobId}/disputes`, {
        method: 'POST',
        body: JSON.stringify({ description: trimmed }),
      })
      setReview((previous) => ({
        ...previous,
        completion_request: {
          ...previous?.completion_request,
          status: 'ISSUE_REPORTED',
        },
      }))
      setDisputes((previous) => [
        data.dispute,
        ...previous.filter((item) => item.id !== data.dispute.id),
      ])
      setDescription('')
      setShowIssueForm(false)
      setNotice(data.message || 'Issue reported. Completion is blocked.')
      try {
        await load()
      } catch {
        setError('Issue saved. Refresh the review status when your connection returns.')
      }
    } catch (err) {
      setError(
        (err.message || 'Unable to confirm issue reporting.')
        + ' Refresh the review status before retrying if the connection was interrupted.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  const status = review?.completion_request?.status
  const canApprove = review?.job_status === 'IN_PROGRESS'
    && ['REQUESTED', 'APPROVED'].includes(status)

  return (
    <section className="dashboard-section" aria-label="Completion review">
      <div className="section-heading">
        <div>
          <h2>Review Completed Work</h2>
          <p>Approve only after checking the work and accepting its completion.</p>
        </div>
      </div>

      <button
        type="button"
        onClick={refresh}
        disabled={busy || loading}
      >
        {loading ? 'Loading review...' : 'Refresh Review Status'}
      </button>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {!loading && !status && (
        <p>Your technician has not requested completion yet.</p>
      )}
      {status === 'REQUESTED' && (
        <p>Your technician has requested completion. Please review the work.</p>
      )}
      {status === 'APPROVED' && (
        <p>
          You approved the work. The job remains in progress until your
          technician verifies your Happy Code.
        </p>
      )}
      {status === 'ISSUE_REPORTED' && (
        <p>A reported issue must be resolved before completion.</p>
      )}
      {status === 'WORK_RESUMED' && (
        <p>
          The issue was resolved by returning the job for corrective work.
          Your technician must request a fresh review after making corrections.
        </p>
      )}
      {review?.job_status === 'COMPLETED' && (
        <p>Completion has been confirmed. Refresh the request page to see its updated status.</p>
      )}

      {canApprove && (
        <>
          <label style={{ display: 'block', marginTop: 16 }}>
            <input
              type="checkbox"
              checked={accepted}
              onChange={(event) => setAccepted(event.target.checked)}
              disabled={busy || loading || !completionSheet?.ready}
            />
            {' '}I have reviewed the work and accept its completion.
          </label>

          {!completionSheet?.ready && (
            <p>
              The completion price sheet is not ready.
              Ask the technician to save the completed-work summary,
              then refresh the review status.
            </p>
          )}

          {accepted && completionSheet?.ready && (
            <section
              aria-label="Completion price sheet"
              style={{
                marginTop: 16, padding: 20,
                border: '1px solid #dce5ee', borderRadius: 12,
                background: '#f8fafc',
              }}
            >
              <h3>Completion Price Sheet</h3>
              <p><strong>Service:</strong> {completionSheet.service_name}</p>
              <p><strong>Request:</strong> {completionSheet.request_title}</p>
              <h4>Work completed</h4>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {completionSheet.work_summary}
              </p>
              <p><strong>Agreed work amount:</strong> INR {completionSheet.agreed_amount}</p>
              <p style={{ fontSize: 22 }}>
                <strong>Total payable: INR {completionSheet.total_payable}</strong>
              </p>
              <p>
                Confirm this summary and total before generating your Happy Code.
                This confirmation does not record a payment.
              </p>
              {status === 'APPROVED' && (
                <p>A replacement Happy Code will invalidate the previous code.</p>
              )}
              <button
                type="button"
                className="primary-action"
                onClick={approve}
                disabled={busy || loading}
              >
                {busy ? 'Confirming...'
                  : status === 'APPROVED'
                    ? 'Confirm and Generate Replacement Code'
                    : 'Confirm and Generate Happy Code'}
              </button>
              <button
                type="button"
                onClick={() => setAccepted(false)}
                disabled={busy || loading}
                style={{ marginLeft: 8, marginTop: 12 }}
              >
                Back to Work Review
              </button>
            </section>
          )}
        </>
      )}

      {canApprove && (
        <div style={{ marginTop: 20 }}>
          <button
            type="button"
            onClick={() => {
              setShowIssueForm((previous) => !previous)
              setError('')
            }}
            disabled={busy || loading}
          >
            {showIssueForm ? 'Close Issue Form' : 'Work Not Satisfactory? Report an Issue'}
          </button>

          {showIssueForm && (
            <form onSubmit={reportIssue} style={{ marginTop: 12 }}>
              <label style={{ display: 'block' }}>
                Describe the work issue
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  minLength={10}
                  maxLength={2000}
                  rows={5}
                  required
                  disabled={busy || loading}
                  style={{
                    display: 'block',
                    width: '100%',
                    boxSizing: 'border-box',
                    marginTop: 8,
                    padding: 12,
                  }}
                />
              </label>
              <p>10 to 2000 characters. Reporting blocks completion pending resolution.</p>
              <button
                type="submit"
                disabled={busy || loading || description.trim().length < 10}
              >
                {busy ? 'Saving...' : 'Submit Work Issue'}
              </button>
            </form>
          )}
        </div>
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
                editable={
                  review?.job_status === 'IN_PROGRESS'
                  && ['OPEN', 'UNDER_REVIEW'].includes(dispute.status)
                }
                disabled={busy || loading}
                onBusyChange={setBusy}
              />
            </article>
          ))}
          {historyHasMore && <p>Showing the latest 100 issues.</p>}
        </section>
      )}

      {issued && (
        <div aria-live="polite">
          <p>
            <strong style={{ fontSize: 32, letterSpacing: 6 }}>
              {issued.code}
            </strong>
          </p>
          <p>Expires: {new Date(issued.expiresAt).toLocaleString()}</p>
          <p>
            Share this code only after accepting the work.
            Refreshing or leaving this page clears its display.
          </p>
        </div>
      )}
    </section>
  )
}
