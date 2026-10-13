import { useEffect, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function DetailItem({ label, value }) {
  return (
    <div className="detail-item">
      <span>{label}</span>
      <strong>{value ?? '—'}</strong>
    </div>
  )
}

function TechnicianDetail({
  technicianId,
  onBack,
}) {
  const [technician, setTechnician] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
const [accountReason, setAccountReason] =
  useState('')

const [accountUpdating, setAccountUpdating] =
  useState(false)

const [accountMessage, setAccountMessage] =
  useState('')
const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let cancelled = false

    async function loadTechnician() {
      try {
        setLoading(true)
        setError('')

        const data = await apiRequest(
          `/admin/technicians/${technicianId}`,
          {},
          getToken(),
        )

        if (!cancelled) {
          setTechnician(data?.technician || null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              'Unable to load technician details',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadTechnician()

    return () => {
      cancelled = true
    }
  }, [technicianId, refreshKey])

async function handleAccountStatusChange() {
  if (!technician) {
    return
  }

  const reason = accountReason.trim()

  if (reason.length < 3) {
    setAccountMessage(
      'Please enter a reason before changing the account status.',
    )
    return
  }

  const currentlyActive =
    technician.account?.is_active

  const nextStatus = !currentlyActive

  const action = nextStatus
    ? 'enable'
    : 'disable'

  const confirmed = window.confirm(
    `Are you sure you want to ${action} ${technician.full_name}'s account?`,
  )

  if (!confirmed) {
    return
  }

  try {
    setAccountUpdating(true)
    setAccountMessage('')

    const result = await apiRequest(
      `/admin/technicians/${technicianId}/account-status`,
      {
        method: 'PATCH',
        body: JSON.stringify({
          is_active: nextStatus,
          reason,
        }),
      },
      getToken(),
    )

    setAccountMessage(
      result?.message ||
        'Account status updated successfully.',
    )

    setAccountReason('')

    setRefreshKey((value) => value + 1)
  } catch (err) {
    setAccountMessage(
      err.message ||
        'Unable to update account status.',
    )
  } finally {
    setAccountUpdating(false)
  }
}

  if (loading) {
    return (
      <div className="module-state-card">
        Loading technician details...
      </div>
    )
  }

  if (error || !technician) {
    return (
      <div className="module-state-card error">
        {error || 'Technician not found'}
      </div>
    )
  }

  const operationalStatus = technician.is_busy
    ? 'BUSY'
    : technician.availability_status

  return (
    <section className="technician-detail-page">
      <div className="detail-topbar">
        <button
          type="button"
          className="back-button"
          onClick={onBack}
        >
          ← Back to Technicians
        </button>

        <div className="detail-statuses">
          <span
            className={`status-badge ${
              operationalStatus === 'ONLINE'
                ? 'success'
                : operationalStatus === 'BUSY'
                  ? 'warning'
                  : 'neutral'
            }`}
          >
            {operationalStatus}
          </span>

          <span
            className={`status-badge ${
              technician.kyc?.verification_status ===
              'APPROVED'
                ? 'success'
                : 'warning'
            }`}
          >
            KYC{' '}
            {technician.kyc?.verification_status ||
              technician.kyc?.status ||
              'PENDING'}
          </span>
        </div>
      </div>

      <div className="technician-profile-header">
        <div className="technician-avatar">
          {technician.full_name
            ?.split(' ')
            .map((part) => part[0])
            .slice(0, 2)
            .join('')
            .toUpperCase()}
        </div>

        <div>
          <span className="module-eyebrow">
            TECHNICIAN PROFILE
          </span>

          <h2>{technician.full_name}</h2>

          <p>
            {technician.business_name ||
              'Independent Technician'}
          </p>
        </div>
      </div>

      <div className="detail-stats-grid">
        <div>
          <strong>
            ★{' '}
            {Number(
              technician.rating_statistics
                ?.average_rating || 0,
            ).toFixed(1)}
          </strong>
          <span>Average Rating</span>
        </div>

        <div>
          <strong>
            {technician.rating_statistics
              ?.total_ratings || 0}
          </strong>
          <span>Ratings</span>
        </div>

        <div>
          <strong>
            {technician.job_statistics?.total || 0}
          </strong>
          <span>Total Jobs</span>
        </div>

        <div>
          <strong>
            {technician.job_statistics?.completed || 0}
          </strong>
          <span>Completed</span>
        </div>

        <div>
          <strong>
            {technician.job_statistics?.active || 0}
          </strong>
          <span>Active</span>
        </div>

        <div>
          <strong>
            {technician.job_statistics?.cancelled || 0}
          </strong>
          <span>Cancelled</span>
        </div>
      </div>

      <div className="detail-grid">
        <section className="detail-card">
          <h3>Profile & Contact</h3>

          <div className="detail-item-grid">
            <DetailItem
              label="Full Name"
              value={technician.full_name}
            />

            <DetailItem
              label="Business"
              value={technician.business_name}
            />

            <DetailItem
              label="Phone"
              value={technician.phone}
            />

            <DetailItem
              label="Email"
              value={technician.email}
            />

            <DetailItem
              label="Experience"
              value={
                technician.experience_years != null
                  ? `${technician.experience_years} years`
                  : null
              }
            />

            <DetailItem
              label="Service Radius"
              value={
                technician.service_radius_km != null
                  ? `${technician.service_radius_km} km`
                  : null
              }
            />
          </div>

          {technician.bio && (
            <div className="detail-bio">
              <span>Bio</span>
              <p>{technician.bio}</p>
            </div>
          )}
        </section>

        <section className="detail-card">
          <h3>Account & KYC</h3>

          <div className="detail-item-grid">
            <DetailItem
              label="Account"
              value={
                technician.account?.is_active
                  ? 'ACTIVE'
                  : 'DISABLED'
              }
            />

            <DetailItem
              label="User Verified"
              value={
                technician.account?.is_verified
                  ? 'YES'
                  : 'NO'
              }
            />

            <DetailItem
              label="KYC Status"
              value={
                technician.kyc
                  ?.verification_status ||
                technician.kyc?.status
              }
            />

            <DetailItem
              label="Address Verified"
              value={
                technician.kyc?.address_verified
                  ? 'YES'
                  : 'NO'
              }
            />

            <DetailItem
              label="Police Verification"
              value={
                technician.kyc
                  ?.police_verification_status
              }
            />

            <DetailItem
              label="Identity Document"
              value={
                technician.kyc
                  ?.identity_document_type
              }
            />
          </div>
        </section>

<section className="detail-card account-control-card">
  <div className="account-control-heading">
    <div>
      <h3>Account Control</h3>

      <p>
        Enable or disable this technician's access
        to the marketplace.
      </p>
    </div>

    <span
      className={`status-badge ${
        technician.account?.is_active
          ? 'success'
          : 'danger'
      }`}
    >
      {technician.account?.is_active
        ? 'ACTIVE'
        : 'DISABLED'}
    </span>
  </div>

  <div className="account-control-warning">
    {technician.account?.is_active
      ? 'Disabling this account prevents the technician from authenticating and operating in the marketplace. Existing historical records are preserved.'
      : 'This technician account is currently disabled. Enabling it restores marketplace access.'}
  </div>

  <label className="account-reason-field">
    <span>Reason for change</span>

    <textarea
      value={accountReason}
      onChange={(event) =>
        setAccountReason(event.target.value)
      }
      placeholder={
        technician.account?.is_active
          ? 'Example: Account suspended pending verification'
          : 'Example: Verification completed — restore access'
      }
      rows="3"
      maxLength="500"
      disabled={accountUpdating}
    />
  </label>

  {accountMessage && (
    <div className="account-control-message">
      {accountMessage}
    </div>
  )}

  <button
    type="button"
    className={
      technician.account?.is_active
        ? 'account-action-button danger'
        : 'account-action-button enable'
    }
    onClick={handleAccountStatusChange}
    disabled={accountUpdating}
  >
    {accountUpdating
      ? 'Updating...'
      : technician.account?.is_active
        ? 'Disable Technician Account'
        : 'Enable Technician Account'}
  </button>
</section>


        <section className="detail-card">
          <h3>Availability & Location</h3>

          <div className="detail-item-grid">
            <DetailItem
              label="Availability"
              value={
                technician.availability_status
              }
            />

            <DetailItem
              label="Busy"
              value={
                technician.is_busy ? 'YES' : 'NO'
              }
            />

            <DetailItem
              label="Location Accuracy"
              value={
                technician.location
                  ?.accuracy_meters != null
                  ? `${technician.location.accuracy_meters} m`
                  : null
              }
            />

            <DetailItem
              label="Battery"
              value={
                technician.location
                  ?.battery_percent != null
                  ? `${technician.location.battery_percent}%`
                  : null
              }
            />

            <DetailItem
              label="Last Seen"
              value={
                technician.location?.last_seen_at
                  ? new Date(
                      technician.location.last_seen_at,
                    ).toLocaleString()
                  : null
              }
            />
          </div>
        </section>

        <section className="detail-card">
          <h3>Skills</h3>

          <div className="detail-tag-list">
            {technician.skills?.map((skill) => (
              <div
                className="detail-tag"
                key={skill.id}
              >
                <strong>{skill.name}</strong>

                {skill.experience_years != null && (
                  <span>
                    {skill.experience_years} yrs
                  </span>
                )}
              </div>
            ))}

            {!technician.skills?.length && (
              <p className="detail-empty">
                No skills assigned.
              </p>
            )}
          </div>
        </section>

        <section className="detail-card">
          <h3>Tools</h3>

          <div className="detail-tag-list">
            {technician.tools?.map((tool) => (
              <div
                className="detail-tag"
                key={tool.id}
              >
                <strong>{tool.name}</strong>
                <span>
                  Qty {tool.quantity || 0}
                </span>
              </div>
            ))}

            {!technician.tools?.length && (
              <p className="detail-empty">
                No tools assigned.
              </p>
            )}
          </div>
        </section>

        <section className="detail-card">
          <h3>Recent Reviews</h3>

          <div className="review-list">
            {technician.recent_reviews?.map(
              (review) => (
                <div
                  className="review-item"
                  key={review.id}
                >
                  <div>
                    <strong>
                      ★ {review.rating}
                    </strong>

                    <span>
                      {review.created_at
                        ? new Date(
                            review.created_at,
                          ).toLocaleDateString()
                        : ''}
                    </span>
                  </div>

                  <p>
                    {review.review ||
                      'No written review'}
                  </p>
                </div>
              ),
            )}

            {!technician.recent_reviews?.length && (
              <p className="detail-empty">
                No reviews available.
              </p>
            )}
          </div>
        </section>
      </div>
    </section>
  )
}

export default TechnicianDetail