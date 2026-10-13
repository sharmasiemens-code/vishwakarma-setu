import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function formatStatus(value) {
  if (!value) {
    return 'Not Available'
  }

  return value.replaceAll('_', ' ')
}

function formatDate(value) {
  if (!value) {
    return 'Not Available'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleString()
}

function DetailItem({ label, value }) {
  return (
    <div className="kyc-detail-item">
      <span>{label}</span>
      <strong>{value || 'Not Available'}</strong>
    </div>
  )
}

const actionOptions = [
  {
    status: 'UNDER_REVIEW',
    label: 'Mark Under Review',
  },
  {
    status: 'APPROVED',
    label: 'Approve KYC',
  },
  {
    status: 'RESUBMISSION_REQUIRED',
    label: 'Request Resubmission',
  },
  {
    status: 'REJECTED',
    label: 'Reject KYC',
  },
]

function KycDetail({ technicianId, onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [selectedStatus, setSelectedStatus] =
    useState('')

  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] =
    useState('')
  const [successMessage, setSuccessMessage] =
    useState('')

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true)
      setError('')

      const response = await apiRequest(
        `/admin/kyc/${technicianId}`,
        {},
        getToken(),
      )

      setData(response)
    } catch (err) {
      setError(
        err.message ||
          'Unable to load KYC details',
      )
    } finally {
      setLoading(false)
    }
  }, [technicianId])

  useEffect(() => {
    let active = true

    async function load() {
      try {
        setLoading(true)
        setError('')

        const response = await apiRequest(
          `/admin/kyc/${technicianId}`,
          {},
          getToken(),
        )

        if (active) {
          setData(response)
        }
      } catch (err) {
        if (active) {
          setError(
            err.message ||
              'Unable to load KYC details',
          )
        }
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    load()

    return () => {
      active = false
    }
  }, [technicianId])

  async function handleSubmit(event) {
    event.preventDefault()

    setActionError('')
    setSuccessMessage('')

    if (!selectedStatus) {
      setActionError(
        'Please select a KYC action.',
      )
      return
    }

    if (remarks.trim().length < 3) {
      setActionError(
        'Please enter meaningful remarks before updating KYC.',
      )
      return
    }

    const technicianName =
      data?.technician?.full_name ||
      'this technician'

    const actionLabel =
      actionOptions.find(
        (item) =>
          item.status === selectedStatus,
      )?.label || formatStatus(selectedStatus)

    const confirmed = window.confirm(
      `${actionLabel} for ${technicianName}?\n\nRemarks: ${remarks.trim()}`,
    )

    if (!confirmed) {
      return
    }

    try {
      setSaving(true)

      const response = await apiRequest(
        `/admin/kyc/${technicianId}/status`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            verification_status:
              selectedStatus,
            remarks: remarks.trim(),
          }),
        },
        getToken(),
      )

      setSuccessMessage(
        response.message ||
          'KYC status updated successfully.',
      )

      setSelectedStatus('')
      setRemarks('')

      await loadDetail()
    } catch (err) {
      setActionError(
        err.message ||
          'Unable to update KYC status.',
      )
    } finally {
      setSaving(false)
    }
  }

  const technician = data?.technician || {}
  const kyc = data?.kyc || {}

  const status =
    kyc.verification_status ||
    kyc.technician_status ||
    'MISSING_RECORD'

  return (
    <>
      <section className="page-heading kyc-detail-heading">
        <div>
          <button
            type="button"
            className="kyc-back-button"
            onClick={onBack}
          >
            ← Back to KYC Verification
          </button>

          <div className="kyc-detail-title">
            <span className="section-label">
              KYC VERIFICATION
            </span>

            <h2>
              {technician.full_name ||
                'Technician KYC'}
            </h2>

            <p>
              Review technician identity, account
              and verification information.
            </p>
          </div>
        </div>
      </section>

      {loading && !data && (
        <div className="status-panel">
          Loading KYC details...
        </div>
      )}

      {error && (
        <div className="error-panel">
          {error}
        </div>
      )}

      {!error && data && (
        <>
          <section className="operations-card kyc-detail-summary">
            <div>
              <span className="section-label">
                VERIFICATION STATUS
              </span>

              <h3>
                {technician.full_name ||
                  'Technician'}
              </h3>

              <p>
                {technician.business_name ||
                  'No business name'}
              </p>
            </div>

            <span
              className={`kyc-status-badge status-${status
                .toLowerCase()
                .replaceAll('_', '-')}`}
            >
              {formatStatus(status)}
            </span>
          </section>

          <div className="kyc-detail-grid">
            <section className="operations-card kyc-detail-card">
              <div className="kyc-card-heading">
                <span className="section-label">
                  TECHNICIAN
                </span>
                <h3>Profile Information</h3>
              </div>

              <div className="kyc-detail-items">
                <DetailItem
                  label="Full Name"
                  value={technician.full_name}
                />

                <DetailItem
                  label="Business Name"
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
                  label="Technician ID"
                  value={technician.technician_id}
                />

                <DetailItem
                  label="Account Status"
                  value={
                    technician.account?.is_active
                      ? 'Active'
                      : 'Inactive'
                  }
                />
              </div>
            </section>

            <section className="operations-card kyc-detail-card">
              <div className="kyc-card-heading">
                <span className="section-label">
                  IDENTITY
                </span>
                <h3>Identity Document</h3>
              </div>

              <div className="kyc-detail-items">
                <DetailItem
                  label="Document Type"
                  value={
                    kyc.identity_document?.type
                  }
                />

                <DetailItem
                  label="Document Reference"
                  value={
                    kyc.identity_document
                      ?.reference
                  }
                />

                <DetailItem
                  label="Address Document"
                  value={
                    kyc.address_document
                      ?.reference
                  }
                />

                <DetailItem
                  label="Address Verification"
                  value={
                    kyc.address_verified
                      ? 'Verified'
                      : 'Not Verified'
                  }
                />

                <DetailItem
                  label="Police Verification"
                  value={formatStatus(
                    kyc.police_verification_status,
                  )}
                />
              </div>
            </section>

            <section className="operations-card kyc-detail-card">
              <div className="kyc-card-heading">
                <span className="section-label">
                  REVIEW
                </span>
                <h3>Verification History</h3>
              </div>

              <div className="kyc-detail-items">
                <DetailItem
                  label="KYC Status"
                  value={formatStatus(
                    kyc.verification_status,
                  )}
                />

                <DetailItem
                  label="Technician Status"
                  value={formatStatus(
                    kyc.technician_status,
                  )}
                />

                <DetailItem
                  label="Reviewed By"
                  value={
                    kyc.reviewer?.full_name
                  }
                />

                <DetailItem
                  label="Reviewer Email"
                  value={kyc.reviewer?.email}
                />

                <DetailItem
                  label="Decision Time"
                  value={formatDate(
                    kyc.verified_at,
                  )}
                />

                <DetailItem
                  label="Last Updated"
                  value={formatDate(
                    kyc.updated_at,
                  )}
                />
              </div>
            </section>

            <section className="operations-card kyc-detail-card">
              <div className="kyc-card-heading">
                <span className="section-label">
                  REVIEW NOTES
                </span>
                <h3>
                  Rejection / Resubmission Reason
                </h3>
              </div>

              <div className="kyc-review-reason">
                {kyc.rejection_reason ||
                  'No rejection or resubmission reason recorded.'}
              </div>
            </section>
          </div>

          <section className="operations-card kyc-action-card">
            <div className="kyc-card-heading">
              <span className="section-label">
                ADMIN ACTION
              </span>

              <h3>Update KYC Verification</h3>

              <p>
                Select the appropriate verification
                decision and record the reason for
                the action.
              </p>
            </div>

            {successMessage && (
              <div className="kyc-success-panel">
                {successMessage}
              </div>
            )}

            {actionError && (
              <div className="error-panel">
                {actionError}
              </div>
            )}

            <form
              className="kyc-action-form"
              onSubmit={handleSubmit}
            >
              <div className="kyc-action-options">
                {actionOptions.map((action) => (
                  <label
                    key={action.status}
                    className={`kyc-action-option ${
                      selectedStatus ===
                      action.status
                        ? 'selected'
                        : ''
                    }`}
                  >
                    <input
                      type="radio"
                      name="kyc-status"
                      value={action.status}
                      checked={
                        selectedStatus ===
                        action.status
                      }
                      disabled={saving}
                      onChange={(event) => {
                        setSelectedStatus(
                          event.target.value,
                        )
                        setActionError('')
                        setSuccessMessage('')
                      }}
                    />

                    <span>{action.label}</span>
                  </label>
                ))}
              </div>

              <label className="kyc-remarks-field">
                <span>
                  Admin Remarks
                  <strong> *</strong>
                </span>

                <textarea
                  value={remarks}
                  disabled={saving}
                  maxLength={1000}
                  rows={4}
                  placeholder="Enter the reason or remarks for this KYC decision..."
                  onChange={(event) => {
                    setRemarks(event.target.value)
                    setActionError('')
                  }}
                />

                <small>
                  {remarks.length}/1000 characters
                </small>
              </label>

              <div className="kyc-action-footer">
                <span>
                  Current status:{' '}
                  <strong>
                    {formatStatus(status)}
                  </strong>
                </span>

                <button
                  type="submit"
                  className="kyc-submit-button"
                  disabled={
                    saving ||
                    !selectedStatus ||
                    remarks.trim().length < 3
                  }
                >
                  {saving
                    ? 'Updating...'
                    : 'Confirm KYC Action'}
                </button>
              </div>
            </form>
          </section>
        </>
      )}
    </>
  )
}

export default KycDetail