import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/client'

export default function StartPin({ jobId, onPriceChanged }) {
  const [price, setPrice] = useState(null)
  const [issued, setIssued] = useState(null)
  const [pinRetry, setPinRetry] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const operationLock = useRef(false)
  const priceSignature = useRef(null)
  const loadSequence = useRef(0)

  const load = useCallback(async (signal) => {
    const sequence = ++loadSequence.current
    const data = await apiRequest(`/jobs/${jobId}/price-revisions?page_size=100`, {
      signal,
      cache: 'no-store',
    })
    if (signal?.aborted || sequence !== loadSequence.current) return null

    const signature = JSON.stringify([
      data.agreed_amount,
      data.has_pending_revision,
      data.job_status,
      data.revisions?.[0]?.id,
      data.revisions?.[0]?.version,
    ])
    if (
      data.has_pending_revision
      || data.job_status !== 'ARRIVED'
      || (priceSignature.current !== null && priceSignature.current !== signature)
    ) {
      setIssued(null)
    }
    priceSignature.current = signature
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
          setIssued(null)
          setPrice(null)
          setError(err.message || 'Unable to check the agreed price.')
          setLoading(false)
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
    if (operationLock.current) return
    operationLock.current = true
    setLoading(true)
    setIssued(null)
    setError('')
    try {
      await load()
    } catch (err) {
      setPrice(null)
      setError(err.message || 'Unable to refresh the price.')
      setLoading(false)
    } finally {
      operationLock.current = false
    }
  }

  async function requestFreshStartPin() {
    const data = await apiRequest(`/jobs/${jobId}/start-pin`, {
      method: 'POST',
    })
    if (!/^[0-9]{4}$/.test(data.start_pin || '')) {
      throw new Error('The Start PIN could not be displayed.')
    }
    setIssued({ pin: data.start_pin, expiresAt: data.expires_at })
    setPinRetry(false)
  }

  async function decide(revision, decision) {
    if (operationLock.current) return
    const approved = decision === 'APPROVED'
    const message = approved
      ? `Approve the revised TOTAL price of INR ${revision.proposed_amount} and generate your Start PIN?`
      : 'Decline this price revision and keep the previous agreed estimate?'
    if (!window.confirm(message)) return

    operationLock.current = true
    loadSequence.current += 1
    setBusy(true)
    setIssued(null)
    setPinRetry(false)
    setError('')
    setNotice('')

    try {
      let data
      try {
        data = await apiRequest(
          `/jobs/${jobId}/price-revisions/${revision.id}/decision`,
          {
            method: 'PUT',
            body: JSON.stringify({
              decision,
              expected_version: revision.version,
            }),
          },
        )
      } catch (err) {
        setPrice(null)
        setError(
          (err.message || 'Unable to confirm the price decision.')
          + ' Refresh Price Status before retrying.',
        )
        return
      }

      setNotice(approved
        ? 'Revised quotation approved. Generating your Start PIN...'
        : data.message)
      setPrice(null)

      try {
        await load()
      } catch {
        if (approved) setPinRetry(true)
        setNotice(approved
          ? 'Revised quotation approved.'
          : 'Your decision was saved.')
        setError(
          'Refresh Price Status to confirm the current price.'
          + (approved ? ' Then select Retry Generate PIN.' : ''),
        )
        return
      }

      if (approved) {
        try {
          await requestFreshStartPin()
          setNotice('Revised quotation approved. Your Start PIN is ready below.')
        } catch (err) {
          setPinRetry(true)
          setNotice('Revised quotation approved.')
          setError(
            (err.message || 'Unable to generate your Start PIN.')
            + ' Approval is saved. Retry Generate PIN when permitted.'
            + ' If the response was interrupted, wait at least 60 seconds before retrying.',
          )
        }
      }

      try {
        await onPriceChanged?.()
      } catch {
        setError((previous) => previous
          || 'Your decision was saved. Refresh the request page to update its price display.')
      }
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function generate() {
    if (operationLock.current || !price?.can_generate_start_pin) return
    if (issued && !window.confirm(
      'Generate a new Start PIN? Your previous PIN will stop working.',
    )) return

    operationLock.current = true
    setBusy(true)
    setError('')
    setIssued(null)
    try {
      const current = await load()
      if (!current?.can_generate_start_pin) {
        setError('Resolve the pending price revision before generating a Start PIN.')
        return
      }

      await requestFreshStartPin()
    } catch (err) {
      setError(
        (err.message || 'Unable to generate the Start PIN.')
        + ' Refresh Price Status. If the response was interrupted, '
        + 'wait at least 60 seconds before generating a replacement.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  const pending = price?.revisions?.find((revision) => revision.status === 'PENDING')

  return (
    <section className="dashboard-section" aria-label="Customer Start PIN and price review">
      <div className="section-heading">
        <div>
          <h2>Agreed Price and Start Work PIN</h2>
          <p>Review the total price before sharing your PIN to start work.</p>
        </div>
      </div>

      <button type="button" onClick={refresh} disabled={busy || loading}>
        {loading ? 'Loading price...' : 'Refresh Price Status'}
      </button>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {price && (
        <p><strong>Agreed estimate:</strong> {price.agreed_amount === null
          ? 'Not recorded' : `INR ${price.agreed_amount}`}</p>
      )}

      {pending && (
        <div style={{ padding: 16, border: '1px solid #dce5ee', borderRadius: 12 }}>
          <h3>Price Revision Awaiting Your Decision</h3>
          <p>Previous estimate: {pending.previous_amount === null
            ? 'Not recorded' : `INR ${pending.previous_amount}`}</p>
          <p><strong>Proposed TOTAL price: INR {pending.proposed_amount}</strong></p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{pending.reason}</p>
          <p>This is the total price, not an additional charge. Work cannot start while it is pending.</p>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => decide(pending, 'APPROVED')}
          >
            Approve Quotation and Generate PIN
          </button>
          <button
            type="button"
            disabled={busy || loading}
            onClick={() => decide(pending, 'DECLINED')}
            style={{ marginLeft: 8 }}
          >
            Decline Revision
          </button>
        </div>
      )}

      {price?.has_pending_revision && !pending && (
        <p>A price revision is pending. Refresh the request page to review it.</p>
      )}

      {issued && (
        <div aria-live="polite">
          <p><strong style={{ fontSize: 32, letterSpacing: 6 }}>{issued.pin}</strong></p>
          <p>Expires: {new Date(issued.expiresAt).toLocaleString()}</p>
          <p>Share only when you accept the agreed price and are ready for work to start.</p>
        </div>
      )}

      <button
        type="button"
        onClick={generate}
        disabled={busy || loading || !price?.can_generate_start_pin}
        style={{ marginTop: 16 }}
      >
        {busy ? 'Saving...' : issued
          ? 'Generate Replacement PIN'
          : pinRetry ? 'Retry Generate PIN' : 'Generate Start PIN'}
      </button>
      <p>PINs expire after 15 minutes. Wait at least 60 seconds between generations.</p>

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
