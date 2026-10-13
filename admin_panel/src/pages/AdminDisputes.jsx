import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken, hasPermission } from '../auth/auth'
import DisputePhotos from '../components/DisputePhotos'

export default function AdminDisputes({ user }) {
  const [filter, setFilter] = useState('OPEN')
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const operationLock = useRef(false)
  const canResolve = hasPermission(user, 'disputes.resolve')

  const load = useCallback(async (signal) => {
    const query = new URLSearchParams({
      page: String(page),
      page_size: '25',
    })
    if (filter) query.set('dispute_status', filter)
    const data = await apiRequest(
      `/admin/disputes?${query}`,
      { signal, cache: 'no-store' },
      getToken(),
    )
    if (signal?.aborted) return
    setRows(data.disputes || [])
    setHasMore(Boolean(data.pagination?.has_more))
    setLoading(false)
  }, [filter, page])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      load(controller.signal).catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message || 'Unable to load disputes.')
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
    setSelected(null)
    setError('')
    try {
      await load()
    } catch (err) {
      setError(err.message || 'Unable to refresh disputes.')
      setLoading(false)
    } finally {
      operationLock.current = false
    }
  }

  async function openDetails(id) {
    if (operationLock.current) return
    operationLock.current = true
    setBusy(true)
    setSelected(null)
    setReason('')
    setError('')
    setNotice('')
    try {
      const data = await apiRequest(
        `/admin/disputes/${id}`,
        { cache: 'no-store' },
        getToken(),
      )
      setSelected(data.dispute)
    } catch (err) {
      setError(err.message || 'Unable to load dispute details.')
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  async function update(status) {
    if (operationLock.current || !selected || !canResolve) return
    const trimmed = reason.trim()
    if (trimmed.length < 3) {
      setError('Provide a reason of at least three characters.')
      return
    }
    if (!window.confirm(
      status === 'RESOLVED'
        ? 'Resolve this issue and return the job for corrective work? A fresh technician request and customer approval will be required.'
        : 'Start reviewing this work issue?',
    )) return

    operationLock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const data = await apiRequest(
        `/admin/disputes/${selected.id}/status`,
        {
          method: 'PUT',
          body: JSON.stringify({
            status,
            expected_version: selected.version,
            reason: trimmed,
          }),
        },
        getToken(),
      )
      setSelected((previous) => ({
        ...previous,
        ...data.dispute,
        completion_review_status: status === 'RESOLVED'
          ? 'WORK_RESUMED'
          : previous.completion_review_status,
      }))
      setReason('')
      setNotice(status === 'RESOLVED'
        ? 'Issue resolved. The job remains in progress for corrective work.'
        : 'Issue is now under review.')
      try {
        await load()
      } catch {
        setError('Change saved. Refresh the list when your connection returns.')
      }
    } catch (err) {
      setSelected(null)
      setError(
        (err.message || 'Unable to confirm the change.')
        + ' Refresh and reopen the dispute before retrying.',
      )
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  function changePage(nextPage) {
    setLoading(true)
    setError('')
    setSelected(null)
    setPage(nextPage)
  }

  const canAct = canResolve
    && selected
    && ['OPEN', 'UNDER_REVIEW'].includes(selected.status)

  return (
    <>
      <section className="page-heading">
        <div>
          <h2>Work Disputes</h2>
          <p>Review reported work issues and return jobs for corrective work.</p>
        </div>
      </section>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <label>
          Status{' '}
          <select
            value={filter}
            disabled={busy || loading}
            onChange={(event) => {
              setFilter(event.target.value)
              setPage(1)
              setSelected(null)
              setError('')
              setNotice('')
              setLoading(true)
            }}
          >
            <option value="">All statuses</option>
            <option value="OPEN">Open</option>
            <option value="UNDER_REVIEW">Under review</option>
            <option value="RESOLVED">Resolved</option>
          </select>
        </label>
        <button type="button" onClick={refresh} disabled={busy || loading}>
          Refresh Disputes
        </button>
      </div>

      {error && <div className="error-panel" role="alert">{error}</div>}
      {notice && <div className="status-panel" role="status">{notice}</div>}
      {loading && <div className="status-panel">Loading disputes...</div>}

      {!loading && (
        <div className="skills-table-card">
          <div className="skills-table-wrapper">
            <table className="skills-table">
              <thead>
                <tr>
                  <th>Reported</th><th>Work issue</th><th>Status</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.created_at).toLocaleString()}</td>
                    <td style={{ overflowWrap: 'anywhere' }}>
                      {row.description.slice(0, 160)}
                      {row.description.length > 160 ? '...' : ''}
                    </td>
                    <td>{row.status.replaceAll('_', ' ')}</td>
                    <td>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openDetails(row.id)}
                      >
                        View Details
                      </button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={4}>No disputes match this status.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 16, alignItems: 'center' }}>
        <button
          type="button"
          disabled={busy || loading || page === 1}
          onClick={() => changePage(page - 1)}
        >Previous</button>
        <span>Page {page}</span>
        <button
          type="button"
          disabled={busy || loading || !hasMore || page >= 10000}
          onClick={() => changePage(page + 1)}
        >Next</button>
      </div>

      {selected && (
        <section className="operations-card" style={{ marginTop: 24 }}>
          <h3>Dispute Details</h3>
          <p>Status: {selected.status.replaceAll('_', ' ')}</p>
          <p>Job status: {selected.job_status}</p>
          <p style={{ overflowWrap: 'anywhere' }}>Job reference: {selected.job_id}</p>
          <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {selected.description}
          </p>
          {selected.resolution_reason && (
            <>
              <h4>Resolution: Return to Work</h4>
              <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                {selected.resolution_reason}
              </p>
              <p>Resolved: {new Date(selected.resolved_at).toLocaleString()}</p>
            </>
          )}

          <DisputePhotos
            key={selected.id}
            disputeId={selected.id}
            disabled={busy}
          />

          {canAct && (
            <>
              <label style={{ display: 'block' }}>
                Review or resolution reason
                <textarea
                  rows={4}
                  maxLength={1000}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy}
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box',
                    marginTop: 8, padding: 12,
                  }}
                />
              </label>
              <p>The reason is audited. Resolution reasons are visible to both parties.</p>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {selected.status === 'OPEN' && (
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => update('UNDER_REVIEW')}
                  >Start Review</button>
                )}
                <button
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() => update('RESOLVED')}
                >Resolve and Return to Work</button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  )
}
