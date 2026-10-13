import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function formatStatus(status) {
  if (!status) {
    return 'MISSING RECORD'
  }

  return status.replaceAll('_', ' ')
}

function KycVerification({ onReview }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] =
    useState('ALL')

  useEffect(() => {
    let cancelled = false

    async function loadKyc() {
      try {
        setLoading(true)
        setError('')

        const response = await apiRequest(
          '/admin/kyc',
          {},
          getToken(),
        )

        if (!cancelled) {
          setData(response)
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message ||
              'Unable to load KYC records',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadKyc()

    return () => {
      cancelled = true
    }
  }, [])

  const records = useMemo(() => {
    if (!data) {
      return []
    }

    /*
     * Keep this tolerant while the Admin API is
     * evolving. It supports the common response
     * keys without changing backend behaviour.
     */
    const source =
      data.technicians ||
      data.items ||
      data.data ||
      data.records ||
      []

    return Array.isArray(source) ? source : []
  }, [data])

  const filteredRecords = useMemo(() => {
    const query = search.trim().toLowerCase()

    return records.filter((record) => {
      const status =
  record.kyc?.verification_status ||
  record.kyc?.technician_status ||
  'MISSING_RECORD'

      const matchesStatus =
        statusFilter === 'ALL' ||
        status === statusFilter

      const searchableText = [
        record.full_name,
        record.business_name,
        record.phone,
        record.email,
        record.technician_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      const matchesSearch =
        !query || searchableText.includes(query)

      return matchesStatus && matchesSearch
    })
  }, [records, search, statusFilter])

  const summary = data?.summary || {}

  return (
    <>
      <section className="page-heading">
        <div>
          <span className="section-label">
            TECHNICIAN MANAGEMENT
          </span>

          <h2>KYC Verification</h2>

          <p>
            Review technician identity and
            verification status before marketplace
            activation.
          </p>
        </div>
      </section>

      {loading && (
        <div className="status-panel">
          Loading KYC records...
        </div>
      )}

      {error && (
        <div className="error-panel">
          {error}
        </div>
      )}

      {!loading && !error && data && (
        <>
          <div className="stats-grid kyc-stats-grid">
            <div className="stat-card">
              <div className="stat-title">
                Total Records
              </div>

              <div className="stat-value">
                {summary.total ?? 0}
              </div>

              <div className="stat-description">
                Technician KYC records
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-title">
                Pending
              </div>

              <div className="stat-value">
                {summary.pending ?? 0}
              </div>

              <div className="stat-description">
                Waiting for review
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-title">
                Under Review
              </div>

              <div className="stat-value">
                {summary.under_review ?? 0}
              </div>

              <div className="stat-description">
                Currently being reviewed
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-title">
                Approved
              </div>

              <div className="stat-value">
                {summary.approved ?? 0}
              </div>

              <div className="stat-description">
                Verification completed
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-title">
                Rejected
              </div>

              <div className="stat-value">
                {summary.rejected ?? 0}
              </div>

              <div className="stat-description">
                Verification rejected
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-title">
                Resubmission
              </div>

              <div className="stat-value">
                {summary.resubmission_required ?? 0}
              </div>

              <div className="stat-description">
                Documents required again
              </div>
            </div>
          </div>

          <section className="operations-card kyc-list-card">
            <div className="kyc-list-header">
              <div>
                <span className="section-label">
                  VERIFICATION QUEUE
                </span>

                <h3>Technician KYC Records</h3>
              </div>

              <div className="kyc-filter-row">
                <input
                  type="search"
                  value={search}
                  onChange={(event) =>
                    setSearch(event.target.value)
                  }
                  placeholder="Search technician..."
                  className="kyc-search-input"
                />

                <select
                  value={statusFilter}
                  onChange={(event) =>
                    setStatusFilter(
                      event.target.value,
                    )
                  }
                  className="kyc-status-filter"
                >
                  <option value="ALL">
                    All Statuses
                  </option>
                  <option value="PENDING">
                    Pending
                  </option>
                  <option value="SUBMITTED">
                    Submitted
                  </option>
                  <option value="UNDER_REVIEW">
                    Under Review
                  </option>
                  <option value="APPROVED">
                    Approved
                  </option>
                  <option value="REJECTED">
                    Rejected
                  </option>
                  <option value="RESUBMISSION_REQUIRED">
                    Resubmission Required
                  </option>
                  <option value="MISSING_RECORD">
                    Missing Record
                  </option>
                </select>
              </div>
            </div>

            {filteredRecords.length === 0 ? (
              <div className="kyc-empty-state">
                No KYC records match the current
                search or filter.
              </div>
            ) : (
              <div className="kyc-table-wrapper">
                <table className="kyc-table">
                  <thead>
                    <tr>
                      <th>Technician</th>
                      <th>Contact</th>
                      <th>KYC Status</th>
                      <th>Address</th>
                      <th>Police Verification</th>
                      <th>Action</th>
                    </tr>
                  </thead>

                  <tbody>
                    {filteredRecords.map(
                      (record) => {
const status =
  record.kyc?.verification_status ||
  record.kyc?.technician_status ||
  'MISSING_RECORD'
                        return (
                          <tr
                            key={
                              record.technician_id ||
                              record.id
                            }
                          >
                            <td>
                              <strong>
                                {record.full_name ||
                                  'Unnamed Technician'}
                              </strong>

                              {record.business_name && (
                                <span className="table-secondary">
                                  {
                                    record.business_name
                                  }
                                </span>
                              )}
                            </td>

                            <td>
                              <span>
                                {record.phone || '—'}
                              </span>

                              {record.email && (
                                <span className="table-secondary">
                                  {record.email}
                                </span>
                              )}
                            </td>

                            <td>
                              <span
                                className={`kyc-status-badge status-${status
                                  .toLowerCase()
                                  .replaceAll(
                                    '_',
                                    '-',
                                  )}`}
                              >
                                {formatStatus(status)}
                              </span>
                            </td>

<td>
  {record.kyc?.address_verified
    ? 'Verified'
    : 'Not Verified'}
</td>

<td>
  {formatStatus(
    record.kyc?.police_verification_status ||
      'NOT_AVAILABLE',
  )}
</td>
                            <td>
<button
  type="button"
  className="kyc-review-button active"
  onClick={() =>
    onReview(record.technician_id)
  }
>
  Review
</button>                            </td>
                          </tr>
                        )
                      },
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

export default KycVerification