import { useEffect, useMemo, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

function StatusBadge({ children, type = 'neutral' }) {
  return (
    <span className={`status-badge ${type}`}>
      {children}
    </span>
  )
}

function Technicians({ onViewTechnician }) {
  const [technicians, setTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('ALL')

  useEffect(() => {
    let cancelled = false

    async function loadTechnicians() {
      try {
        setLoading(true)
        setError('')

        const data = await apiRequest(
          '/admin/technicians',
          {},
          getToken(),
        )

        if (!cancelled) {
          setTechnicians(data?.technicians || [])
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err.message || 'Unable to load technicians',
          )
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    loadTechnicians()

    return () => {
      cancelled = true
    }
  }, [])

  const filteredTechnicians = useMemo(() => {
    const query = search.trim().toLowerCase()

    return technicians.filter((technician) => {
      const matchesSearch =
        !query ||
        technician.full_name
          ?.toLowerCase()
          .includes(query) ||
        technician.business_name
          ?.toLowerCase()
          .includes(query) ||
        technician.phone
          ?.toLowerCase()
          .includes(query) ||
        technician.email
          ?.toLowerCase()
          .includes(query)

      let matchesStatus = true

      if (statusFilter === 'BUSY') {
        matchesStatus = technician.is_busy
      } else if (statusFilter === 'ONLINE') {
        matchesStatus =
          technician.availability_status === 'ONLINE' &&
          !technician.is_busy
      } else if (statusFilter === 'OFFLINE') {
        matchesStatus =
          technician.availability_status === 'OFFLINE'
      }

      return matchesSearch && matchesStatus
    })
  }, [technicians, search, statusFilter])

  const onlineCount = technicians.filter(
    (technician) =>
      technician.availability_status === 'ONLINE' &&
      !technician.is_busy,
  ).length

  const busyCount = technicians.filter(
    (technician) => technician.is_busy,
  ).length

  const pendingKycCount = technicians.filter(
    (technician) =>
      technician.kyc?.verification_status !== 'APPROVED',
  ).length

  if (loading) {
    return (
      <div className="module-state-card">
        Loading technicians...
      </div>
    )
  }

  if (error) {
    return (
      <div className="module-state-card error">
        {error}
      </div>
    )
  }

  return (
    <section className="technicians-page">
      <div className="module-page-header">
        <div>
          <span className="module-eyebrow">
            TECHNICIAN MANAGEMENT
          </span>

          <h2>Technicians</h2>

          <p>
            Monitor technician accounts, KYC,
            availability, workload and marketplace
            performance.
          </p>
        </div>

        <div className="technician-summary">
          <div>
            <strong>{technicians.length}</strong>
            <span>Total</span>
          </div>

          <div>
            <strong>{onlineCount}</strong>
            <span>Online</span>
          </div>

          <div>
            <strong>{busyCount}</strong>
            <span>Busy</span>
          </div>

          <div>
            <strong>{pendingKycCount}</strong>
            <span>Pending KYC</span>
          </div>
        </div>
      </div>

      <div className="technician-toolbar">
        <input
          type="search"
          value={search}
          onChange={(event) =>
            setSearch(event.target.value)
          }
          placeholder="Search name, business, phone or email..."
        />

        <select
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value)
          }
        >
          <option value="ALL">All Technicians</option>
          <option value="ONLINE">Online</option>
          <option value="BUSY">Busy</option>
          <option value="OFFLINE">Offline</option>
        </select>
      </div>

      <div className="technician-table-card">
        <div className="table-scroll">
          <table className="technician-table">
            <thead>
              <tr>
                <th>Technician</th>
                <th>Status</th>
                <th>KYC</th>
                <th>Rating</th>
                <th>Jobs</th>
                <th>Skills</th>
                <th>Tools</th>
                <th>Account</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {filteredTechnicians.map((technician) => {
                const operationalStatus =
                  technician.is_busy
                    ? 'BUSY'
                    : technician.availability_status

                return (
                  <tr key={technician.technician_id}>
                    <td>
                      <div className="technician-name-cell">
                        <strong>
                          {technician.full_name}
                        </strong>

                        <span>
                          {technician.business_name ||
                            'Independent Technician'}
                        </span>

                        <small>
                          {technician.phone}
                        </small>
                      </div>
                    </td>

                    <td>
                      <StatusBadge
                        type={
                          operationalStatus === 'BUSY'
                            ? 'warning'
                            : operationalStatus === 'ONLINE'
                              ? 'success'
                              : 'neutral'
                        }
                      >
                        {operationalStatus}
                      </StatusBadge>
                    </td>

                    <td>
                      <StatusBadge
                        type={
                          technician.kyc
                            ?.verification_status ===
                          'APPROVED'
                            ? 'success'
                            : 'warning'
                        }
                      >
                        {technician.kyc
                          ?.verification_status ||
                          technician.kyc?.status ||
                          'PENDING'}
                      </StatusBadge>
                    </td>

                    <td>
                      <strong>
                        ★{' '}
                        {Number(
                          technician.rating_average || 0,
                        ).toFixed(1)}
                      </strong>
                    </td>

                    <td>{technician.total_jobs}</td>
                    <td>{technician.skills_count}</td>
                    <td>{technician.tools_count}</td>

                    <td>
                      <StatusBadge
                        type={
                          technician.account?.is_active
                            ? 'success'
                            : 'danger'
                        }
                      >
                        {technician.account?.is_active
                          ? 'ACTIVE'
                          : 'DISABLED'}
                      </StatusBadge>
                    </td>

                    <td>
<button
  type="button"
  className="table-action-button"
  onClick={() =>
    onViewTechnician(
      technician.technician_id,
    )
  }
>
  View
</button>                    </td>
                  </tr>
                )
              })}

              {filteredTechnicians.length === 0 && (
                <tr>
                  <td
                    colSpan="9"
                    className="empty-table-message"
                  >
                    No technicians match the selected
                    filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="table-footer">
        Showing {filteredTechnicians.length} of{' '}
        {technicians.length} technicians
      </div>
    </section>
  )
}

export default Technicians