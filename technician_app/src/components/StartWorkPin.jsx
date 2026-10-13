import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'

export default function StartWorkPin({ jobId, disabled, onStarted }) {
  const [price, setPrice] = useState(null)
  const [quotationOpen, setQuotationOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [cancelReason, setCancelReason] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const operationLock = useRef(false)
  const signatureRef = useRef(null)
  const loadSequence = useRef(0)

  const load = useCallback(async (signal) => {
    const sequence = ++loadSequence.current
    const data = await apiRequest(`/jobs/${jobId}/price-revisions?page_size=100`, {
      signal,
      cache: 'no-store',
    })
    if (signal?.aborted || sequence !== loadSequence.current) return null
    const signature = JSON.stringify([
      data.agreed_amount, data.has_pending_revision, data.job_status,
      data.revisions?.[0]?.id, data.revisions?.[0]?.version,
    ])
    if (
      data.has_pending_revision
      || data.job_status !== 'ARRIVED'
      || (signatureRef.current !== null && signatureRef.current !== signature)
    ) setPin('')
    signatureRef.current = signature
    setPrice(data)
    setLoading(false)
    return data
  }, [jobId])

  useEffect(() => {
    const controller = new AbortController()
    const check = () => {
      if (operationLock.current) return
      load(controller.signal).catch((err) => {
        if (!controller.signal.aborted) {
          setPrice(null)
          setPin('')
          setLoading(false)
          setError(err.message || 'Unable to check the agreed price.')
        }
      })
    }
    const timer = window.setTimeout(check, 0)
    const interval = window.setInterval(check, 15000)
    return () => {
      window.clearTimeout(timer)
      window.clearInterval(interval)
      controller.abort()
      loadSequence.current += 1
    }
  }, [load])

  async function refresh() {
    if (operationLock.current || disabled) return
    operationLock.current = true
    setLoading(true)
    setPin('')
    setError('')
    try {
      await load()
    } catch (err) {
      setPrice(null)
      setLoading(false)
      setError(err.message || 'Unable to refresh the price.')
    } finally {
      operationLock.current = false
    }
  }

  async function propose(event) {
    event.preventDefault()
    if (operationLock.current || disabled || !price?.can_generate_start_pin) return
    if (!/^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setError('Enter a positive total price with at most two decimal places.')
      return
    }
    if (reason.trim().length < 10) {
      setError('Explain the additional work in at least ten characters.')
      return
    }
    if (!window.confirm(
      `Propose a TOTAL price of INR ${amount}? Any existing Start PIN will expire.`,
    )) return

    operationLock.current = true
    loadSequence.current += 1
    setBusy(true)
    setPin('')
    setError('')
    setNotice('')
    try {
      const data = await apiRequest(`/jobs/${jobId}/price-revisions`, {
        method: 'POST',
        body: JSON.stringify({ proposed_amount: amount, reason: reason.trim() }),
      })
      setNotice(data.message)
      setAmount('')
      setReason('')
      setQuotationOpen(false)
      setPrice(null)
      try {
        await load()
      } catch {
        setError('Proposal saved. Refresh Price Status to confirm it.')
      }
    } catch (err) {
      setPrice(null)
      setError(
        (err.message || 'Unable to propose a revised price.')
        + ' Refresh Price Status before retrying if the response was interrupted.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function withdraw(revision) {
    if (operationLock.current || disabled) return
    if (!window.confirm(
      'Withdraw this proposal and proceed at the unchanged agreed estimate?',
    )) return
    operationLock.current = true
    loadSequence.current += 1
    setBusy(true)
    setPin('')
    setError('')
    setNotice('')
    try {
      const data = await apiRequest(
        `/jobs/${jobId}/price-revisions/${revision.id}/withdraw`,
        {
          method: 'PUT',
          body: JSON.stringify({ expected_version: revision.version }),
        },
      )
      setNotice(data.message)
      setPrice(null)
      try {
        await load()
      } catch {
        setError('Withdrawal saved. Refresh Price Status to confirm it.')
      }
    } catch (err) {
      setPrice(null)
      setError((err.message || 'Unable to withdraw the proposal.') + ' Refresh Price Status before retrying.')
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function cancelAfterDecline(event) {
    event.preventDefault()
    if (operationLock.current || disabled || loading) return

    const revision = price?.revisions?.[0]
    if (
      price?.job_status !== 'ARRIVED'
      || price.has_pending_revision
      || revision?.status !== 'DECLINED'
    ) {
      setError('Refresh Price Status before cancelling.')
      return
    }

    const explanation = cancelReason.trim()
    if (explanation.length < 10) {
      setError('Explain the cancellation in at least ten characters.')
      return
    }

    if (!window.confirm(
      'Cancel this job because the revised price was declined? '
      + 'The customer can choose another technician.',
    )) return

    operationLock.current = true
    loadSequence.current += 1
    setBusy(true)
    setPin('')
    setError('')
    setNotice('')
    let cancelled = false

    try {
      const data = await apiRequest(
        `/jobs/${jobId}/price-disagreement-cancellation`,
        {
          method: 'POST',
          body: JSON.stringify({
            revision_id: revision.id,
            expected_version: revision.version,
            reason: explanation,
          }),
        },
      )
      cancelled = true
      setCancelReason('')
      setNotice(data.message || 'Job cancelled successfully.')
      setPrice((previous) => ({
        ...previous,
        job_status: 'CANCELLED',
        can_generate_start_pin: false,
      }))
    } catch (err) {
      setPrice(null)
      setError(
        (err.message || 'Unable to cancel this job.')
        + ' Refresh the dashboard and Price Status before retrying.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }

    if (cancelled) {
      try {
        await onStarted?.()
      } catch {
        setError('Job cancelled successfully. Refresh the dashboard.')
      }
    }
  }

  async function submit(event) {
    event.preventDefault()
    if (operationLock.current || disabled || !price?.can_generate_start_pin) return
    if (!/^[0-9]{4}$/.test(pin)) {
      setError('Enter the four-digit Start PIN provided by the customer.')
      return
    }
    operationLock.current = true
    setBusy(true)
    setError('')
    let started = false
    try {
      await apiRequest(`/jobs/${jobId}/status`, {
        method: 'POST',
        body: JSON.stringify({ new_status: 'IN_PROGRESS', start_pin: pin }),
      })
      started = true
      setPrice((previous) => ({
        ...previous, job_status: 'IN_PROGRESS', can_generate_start_pin: false,
      }))
    } catch (err) {
      setError(
        (err.message || 'Unable to confirm work start.')
        + ' Refresh the dashboard to check the current job status before retrying.',
      )
    } finally {
      setPin('')
      operationLock.current = false
      setBusy(false)
    }
    if (started) {
      try {
        await onStarted?.()
      } catch {
        setError('Work started successfully. Refresh the dashboard to see its current status.')
      }
    }
  }

  const pending = price?.revisions?.find((revision) => revision.status === 'PENDING')
  const latestRevision = price?.revisions?.[0]
  const canCancelAfterDecline = price?.job_status === 'ARRIVED'
    && !price.has_pending_revision
    && latestRevision?.status === 'DECLINED'
  const blocked = busy || loading || disabled

  return (
    <section aria-label="Price revision and work start" style={{ marginTop: 16 }}>
      <h3>Agreed Price and Work Start</h3>
      <button type="button" onClick={refresh} disabled={blocked}>
        {loading ? 'Loading price...' : 'Refresh Price Status'}
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {price && <p><strong>Agreed estimate:</strong> {price.agreed_amount === null
        ? 'Not recorded' : `INR ${price.agreed_amount}`}</p>}

      {pending && (
        <div style={{ padding: 12, border: '1px solid #dce5ee', borderRadius: 10 }}>
          <p><strong>Pending proposed TOTAL: INR {pending.proposed_amount}</strong></p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{pending.reason}</p>
          <p>Waiting for customer approval. Work cannot start while this proposal is pending.</p>
          <button type="button" onClick={() => withdraw(pending)} disabled={blocked}>
            Withdraw Price Proposal
          </button>
        </div>
      )}

      {price?.can_generate_start_pin && (
        <div style={{ marginTop: 16 }}>
          <button
            type="button"
            disabled={blocked}
            aria-expanded={quotationOpen}
            aria-controls="revised-quotation-form"
            onClick={() => {
              setQuotationOpen((current) => !current)
              setError('')
            }}
          >
            {quotationOpen ? 'Close Revised Quotation' : 'Propose Revised Quotation'}
          </button>
          {!quotationOpen && (
            <p>Unable to do the work at the agreed estimate? Propose a revised quotation.</p>
          )}
        </div>
      )}

      {price?.can_generate_start_pin && quotationOpen && (
        <form id="revised-quotation-form" onSubmit={propose} style={{ marginTop: 16 }}>
          <h4>Propose a Revised Total Price</h4>
          <p>For additional work discovered on arrival. Customer approval is required.</p>
          <label>
            Revised TOTAL price (INR)
            <input
              type="text" inputMode="decimal" maxLength={13}
              value={amount} onChange={(event) => setAmount(event.target.value)}
              disabled={blocked} required
              style={{ display: 'block', padding: 10, marginTop: 8 }}
            />
          </label>
          <label style={{ display: 'block', marginTop: 12 }}>
            Reason for the increase
            <textarea
              value={reason} onChange={(event) => setReason(event.target.value)}
              minLength={10} maxLength={1000} required disabled={blocked}
              style={{ display: 'block', padding: 10, width: '100%', boxSizing: 'border-box' }}
            />
          </label>
          <button type="submit" disabled={blocked} style={{ marginTop: 12 }}>
            Send Quotation for Customer Approval
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              setQuotationOpen(false)
              setAmount('')
              setReason('')
              setError('')
            }}
            style={{ marginLeft: 8, marginTop: 12 }}
          >
            Cancel
          </button>
        </form>
      )}

      {canCancelAfterDecline && (
        <form onSubmit={cancelAfterDecline} style={{ marginTop: 16 }}>
          <h4>Price Proposal Declined</h4>
          <p>
            If you cannot proceed at the agreed estimate, cancel before
            starting work so the customer can choose another technician.
          </p>
          <label>
            Cancellation reason
            <textarea
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value)}
              minLength={10}
              maxLength={1000}
              required
              disabled={blocked}
              style={{
                display: 'block', padding: 10,
                width: '100%', boxSizing: 'border-box',
              }}
            />
          </label>
          <button
            type="submit"
            disabled={blocked || cancelReason.trim().length < 10}
            style={{ marginTop: 12 }}
          >
            {busy ? 'Saving...' : 'Cancel After Price Disagreement'}
          </button>
        </form>
      )}

      <form onSubmit={submit} style={{ marginTop: 16 }}>
        <p>
          Confirm the agreed price, then ask the customer for their Start PIN.
          After a price revision, ask for a newly generated PIN.
        </p>
        <label>
          Customer Start PIN
          <input
            type="password" inputMode="numeric" autoComplete="off"
            pattern="[0-9]{4}" maxLength={4} value={pin}
            onChange={(event) => {
              setPin(event.target.value.replace(/[^0-9]/g, '').slice(0, 4))
              setError('')
            }}
            disabled={blocked || !price?.can_generate_start_pin} required
            style={{ display: 'block', marginTop: 8, padding: 10, width: 160, letterSpacing: 6 }}
          />
        </label>
        <button
          type="submit" className="primary-action"
          disabled={blocked || !price?.can_generate_start_pin || pin.length !== 4}
          style={{ marginTop: 12 }}
        >
          {busy ? 'Saving...' : 'Verify PIN and Start Work'}
        </button>
        <p>Five incorrect attempts temporarily lock verification.</p>
      </form>

      {Boolean(price?.revisions?.length) && (
        <details style={{ marginTop: 16 }}>
          <summary>Price Revision History</summary>
          {price.revisions.map((revision) => (
            <article key={revision.id} style={{ padding: 12, borderBottom: '1px solid #dce5ee' }}>
              <p><strong>{revision.status}</strong> - Proposed total: INR {revision.proposed_amount}</p>
              <p style={{ whiteSpace: 'pre-wrap' }}>{revision.reason}</p>
              <p>{new Date(revision.created_at).toLocaleString()}</p>
            </article>
          ))}
          {price.pagination?.has_more && <p>Only the latest 100 revisions are displayed.</p>}
        </details>
      )}
    </section>
  )
}
