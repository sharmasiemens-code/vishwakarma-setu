import { useEffect, useRef, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken, hasPermission } from '../auth/auth'

const labels = {
  VERIFY_PHONE: 'Mark Phone Verified',
  VERIFY_ADDRESS: 'Mark Address Verified',
  START_REVIEW: 'Start Review',
  APPROVE: 'Approve Onboarding',
  REJECT: 'Reject Application',
  REQUEST_CORRECTIONS: 'Request Corrections',
}

function statusLabel(value) {
  return (value || 'PENDING').replaceAll('_', ' ')
}

function Information({ label, children }) {
  return (
    <div style={{ padding: '8px 0', overflowWrap: 'anywhere' }}>
      <span style={{ color: '#64748b', display: 'block', fontSize: 13 }}>{label}</span>
      <strong>{children || 'Not provided'}</strong>
    </div>
  )
}

export default function TechnicianApplications({ user, onReviewKyc }) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [list, setList] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailReload, setDetailReload] = useState(0)
  const [error, setError] = useState('')
  const [action, setAction] = useState('')
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const operationLock = useRef(false)

  const canReview = user?.admin_role === 'SUPER_ADMIN'
    && hasPermission(user, 'technician_applications.review')
  const canVerifyAddress = canReview && hasPermission(user, 'kyc.write')
  const canViewKyc = hasPermission(user, 'kyc.read')

  useEffect(() => {
    if (selected) return
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      page: String(page), page_size: '25', search: query,
    })
    if (filter) parameters.set('application_status', filter)

    apiRequest(
      `/admin/technician-applications?${parameters}`,
      { signal: controller.signal, cache: 'no-store' },
      getToken(),
    ).then((data) => {
      if (controller.signal.aborted) return
      setList(data)
      setLoading(false)
      setError('')
    }).catch((err) => {
      if (controller.signal.aborted) return
      setList(null)
      setLoading(false)
      setError(err.message || 'Unable to load applications.')
    })
    return () => controller.abort()
  }, [page, query, filter, reload, selected])

  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    apiRequest(
      `/admin/technician-applications/${selected}`,
      { signal: controller.signal, cache: 'no-store' },
      getToken(),
    ).then((data) => {
      if (controller.signal.aborted) return
      setDetail(data)
      setDetailLoading(false)
      setError('')
    }).catch((err) => {
      if (controller.signal.aborted) return
      setDetail(null)
      setDetailLoading(false)
      setError(err.message || 'Unable to load application details.')
    })
    return () => controller.abort()
  }, [selected, detailReload])

  function refreshDetail() {
    setDetailLoading(true)
    setError('')
    setDetailReload((current) => current + 1)
  }

  function openApplication(id) {
    setSelected(id)
    setDetail(null)
    setDetailLoading(true)
    setError('')
    setAction('')
    setReason('')
    setConfirmed(false)
    setActionError('')
    setNotice('')
  }

  async function submitReview(event) {
    event.preventDefault()
    if (operationLock.current || detailLoading || !detail || !canReview) return
    const checkRequired = ['VERIFY_PHONE', 'VERIFY_ADDRESS'].includes(action)
    if (!action || reason.trim().length < 3 || (checkRequired && !confirmed)) {
      setActionError('Choose an action, enter remarks and confirm any verification check.')
      return
    }
    if (!window.confirm(
      `${labels[action]} for ${detail.application.full_name}?`,
    )) return

    operationLock.current = true
    setBusy(true)
    setActionError('')
    setNotice('')
    try {
      const result = await apiRequest(
        `/admin/technician-applications/${selected}/review`,
        {
          method: 'PUT',
          body: JSON.stringify({
            action,
            expected_version: detail.application.version,
            reason: reason.trim(),
            confirm_check: checkRequired && confirmed,
          }),
        },
        getToken(),
      )
      setNotice(result.message || 'Application updated.')
      setAction('')
      setReason('')
      setConfirmed(false)
      refreshDetail()
    } catch (err) {
      setActionError(
        (err.message || 'Unable to confirm the review action.')
        + ' Check the refreshed application before retrying.',
      )
      refreshDetail()
    } finally {
      operationLock.current = false
      setBusy(false)
    }
  }

  if (selected) {
    const application = detail?.application
    const pending = application && [
      'SUBMITTED', 'UNDER_REVIEW', 'RESUBMISSION_REQUIRED',
    ].includes(application.status)
    const approvalReady = application?.is_active
      && application.phone_verified
      && application.address_verified
      && application.kyc_status === 'APPROVED'
      && application.detailed_kyc_status === 'APPROVED'
      && application.status === 'UNDER_REVIEW'
    const actions = []
    if (pending) {
      if (!application.phone_verified) actions.push('VERIFY_PHONE')
      if (!application.address_verified && canVerifyAddress) actions.push('VERIFY_ADDRESS')
      if (application.status !== 'UNDER_REVIEW') actions.push('START_REVIEW')
      if (application.status === 'UNDER_REVIEW') actions.push('APPROVE')
      actions.push('REJECT')
      if (application.status !== 'RESUBMISSION_REQUIRED') actions.push('REQUEST_CORRECTIONS')
    }
    const checkRequired = ['VERIFY_PHONE', 'VERIFY_ADDRESS'].includes(action)

    return (
      <section>
        <button type="button" disabled={busy} onClick={() => {
          setSelected(null)
          setLoading(true)
          setError('')
          setReload((current) => current + 1)
        }}>
          Back to Technician Applications
        </button>
        <div className="page-heading">
          <div>
            <h2>{application?.full_name || 'Technician Application'}</h2>
            <p>{application ? statusLabel(application.status) : 'Loading details...'}</p>
          </div>
          <button type="button" onClick={refreshDetail} disabled={busy || detailLoading}>
            Refresh Application
          </button>
        </div>

        {detailLoading && <p role="status">Loading application...</p>}
        {error && <p role="alert" className="error-panel">{error}</p>}
        {notice && <p role="status">{notice}</p>}

        {application && (
          <>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 16,
            }}>
              <section className="operations-card" style={{ padding: 20 }}>
                <h3>Personal Details</h3>
                <Information label="Mobile">{application.phone}</Information>
                <Information label="Email">{application.email}</Information>
                <Information label="Date of birth">{application.date_of_birth}</Information>
                <Information label="Gender">{application.gender}</Information>
                <Information label="Account">{application.is_active ? 'Active' : 'Inactive'}</Information>
              </section>
              <section className="operations-card" style={{ padding: 20 }}>
                <h3>Address and Work Area</h3>
                <Information label="Address">
                  {[application.address_line1, application.address_line2].filter(Boolean).join(', ')}
                </Information>
                <Information label="City / State">
                  {[application.city, application.state].filter(Boolean).join(', ')}
                </Information>
                <Information label="Pincode">{application.pincode}</Information>
                <Information label="Work area">{application.work_area}</Information>
                <Information label="Experience">{`${application.experience_years} years`}</Information>
                <Information label="Service radius">{`${application.service_radius_km} km`}</Information>
              </section>
              <section className="operations-card" style={{ padding: 20 }}>
                <h3>Onboarding Checks</h3>
                <Information label="Phone verification">
                  {application.phone_verified ? 'Verified' : 'Pending representative call'}
                </Information>
                <Information label="Address verification">
                  {application.address_verified ? 'Verified' : 'Pending'}
                </Information>
                <Information label="Technician KYC">{statusLabel(application.kyc_status)}</Information>
                <Information label="KYC record">{statusLabel(application.detailed_kyc_status)}</Information>
                <Information label="Application">{statusLabel(application.status)}</Information>
                {canViewKyc && (
                  <button type="button" disabled={busy} onClick={() => onReviewKyc(application.technician_id)}>
                    Open KYC Review
                  </button>
                )}
              </section>
            </div>

            <section className="operations-card" style={{ padding: 20, marginTop: 20 }}>
              <h3>Work Capabilities</h3>
              <p><strong>Services:</strong> {detail.services.map((item) => `${item.name} (${item.category})`).join(', ') || 'None'}</p>
              <p><strong>Skills:</strong> {detail.skills.map((item) => item.name).join(', ') || 'None'}</p>
              <p><strong>Tools:</strong> {detail.tools.map((item) => item.name).join(', ') || 'None'}</p>
              {application.review_reason && (
                <p style={{ whiteSpace: 'pre-wrap' }}>
                  <strong>Last review remarks:</strong> {application.review_reason}
                </p>
              )}
            </section>

            {canReview && pending && (
              <section className="operations-card" style={{ padding: 20, marginTop: 20 }}>
                <h3>Review Application</h3>
                <p>
                  Call the registered number before recording phone verification.
                  Check the applicant's address evidence before recording address verification.
                </p>
                {!approvalReady && (
                  <p>Final approval requires Start Review, phone verification, address verification and approved KYC.</p>
                )}
                {actionError && <p role="alert" className="error-panel">{actionError}</p>}

                <form onSubmit={submitReview}>
                  <label style={{ display: 'block' }}>
                    Action
                    <select value={action} required disabled={busy || detailLoading} onChange={(event) => {
                      setAction(event.target.value)
                      setConfirmed(false)
                      setActionError('')
                    }} style={{ display: 'block', padding: 12, width: '100%', marginTop: 8 }}>
                      <option value="">Choose an action</option>
                      {actions.map((item) => (
                        <option key={item} value={item} disabled={item === 'APPROVE' && !approvalReady}>
                          {labels[item]}
                        </option>
                      ))}
                    </select>
                  </label>

                  {checkRequired && (
                    <label style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                      <input type="checkbox" checked={confirmed} disabled={busy || detailLoading}
                        onChange={(event) => setConfirmed(event.target.checked)} />
                      <span>
                        {action === 'VERIFY_PHONE'
                          ? 'I called the registered number and confirmed it belongs to this applicant.'
                          : 'I checked the address evidence and verified the applicant address.'}
                      </span>
                    </label>
                  )}

                  <label style={{ display: 'block', marginTop: 16 }}>
                    Review remarks
                    <textarea value={reason} minLength={3} maxLength={1000} rows={4}
                      required disabled={busy || detailLoading}
                      onChange={(event) => setReason(event.target.value)}
                      style={{ display: 'block', width: '100%', boxSizing: 'border-box', padding: 12, marginTop: 8 }} />
                  </label>
                  <button type="submit" disabled={
                    busy || detailLoading || !action || reason.trim().length < 3
                    || (checkRequired && !confirmed)
                  } style={{ marginTop: 16 }}>
                    {busy ? 'Saving...' : 'Confirm Review Action'}
                  </button>
                </form>
              </section>
            )}

            {application.status === 'APPROVED' && (
              <p>Onboarding is approved. The technician can refresh their application screen, update GPS and choose Go Online.</p>
            )}
          </>
        )}
      </section>
    )
  }

  return (
    <section>
      <div className="page-heading">
        <div>
          <h2>Technician Applications</h2>
          <p>Review new registrations and complete onboarding checks.</p>
        </div>
        <button type="button" disabled={loading} onClick={() => {
          setLoading(true)
          setList(null)
          setError('')
          setReload((current) => current + 1)
        }}>Refresh Applications</button>
      </div>

      <form onSubmit={(event) => {
        event.preventDefault()
        setQuery(search.trim())
        setPage(1)
        setLoading(true)
        setList(null)
        setReload((current) => current + 1)
      }} style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 20 }}>
        <input type="search" aria-label="Search name, mobile or email"
          placeholder="Name, mobile or email" maxLength={150}
          value={search} onChange={(event) => setSearch(event.target.value)}
          style={{ padding: 10, flex: '1 1 200px' }} />
        <select aria-label="Application status" value={filter} onChange={(event) => {
          setFilter(event.target.value)
          setPage(1)
          setLoading(true)
          setList(null)
        }} style={{ padding: 10 }}>
          <option value="">All statuses</option>
          {['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED'].map((item) => (
            <option key={item} value={item}>{statusLabel(item)}</option>
          ))}
        </select>
        <button type="submit" disabled={loading}>Search</button>
      </form>

      {loading && <p role="status">Loading applications...</p>}
      {error && <p role="alert" className="error-panel">{error}</p>}
      {!loading && list?.applications?.length === 0 && <p>No applications found.</p>}

      {Boolean(list?.applications?.length) && (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 750, textAlign: 'left', borderCollapse: 'collapse' }}>
            <thead>
              <tr>{['Applicant', 'Status', 'Phone', 'KYC', 'Address', 'Action'].map((item) => (
                <th scope="col" key={item} style={{ padding: 12 }}>{item}</th>
              ))}</tr>
            </thead>
            <tbody>
              {list.applications.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid #dce5ee' }}>
                  <td style={{ padding: 12 }}><strong>{item.full_name}</strong><div>{item.phone}</div><div>{item.city}</div></td>
                  <td style={{ padding: 12 }}>{statusLabel(item.status)}</td>
                  <td style={{ padding: 12 }}>{item.phone_verified ? 'Verified' : 'Pending'}</td>
                  <td style={{ padding: 12 }}>{statusLabel(item.kyc_status)}</td>
                  <td style={{ padding: 12 }}>{item.address_verified ? 'Verified' : 'Pending'}</td>
                  <td style={{ padding: 12 }}>
                    <button type="button" onClick={() => openApplication(item.id)}>Open Application</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}>
        <button type="button" disabled={loading || page === 1} onClick={() => {
          setPage((current) => current - 1)
          setLoading(true)
          setList(null)
        }}>Previous</button>
        <span>Page {page}</span>
        <button type="button" disabled={loading || !list?.pagination?.has_more} onClick={() => {
          setPage((current) => current + 1)
          setLoading(true)
          setList(null)
        }}>Next</button>
      </div>
    </section>
  )
}
