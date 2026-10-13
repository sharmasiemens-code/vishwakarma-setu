import { useEffect, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

export default function Customers() {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    const parameters = new URLSearchParams({
      page: String(page),
      page_size: '25',
      search: query,
    })

    apiRequest(
      `/admin/customers?${parameters}`,
      { signal: controller.signal, cache: 'no-store' },
      getToken(),
    ).then((data) => {
      if (controller.signal.aborted) return
      setResult(data)
      setError('')
      setLoading(false)
    }).catch((err) => {
      if (controller.signal.aborted) return
      setResult(null)
      setError(err.message || 'Unable to load customers.')
      setLoading(false)
    })

    return () => controller.abort()
  }, [page, query, reload])

  function findCustomers(event) {
    event.preventDefault()
    setLoading(true)
    setResult(null)
    setError('')
    setPage(1)
    setQuery(search.trim())
    setReload((current) => current + 1)
  }

  function changePage(next) {
    setLoading(true)
    setResult(null)
    setError('')
    setPage(next)
  }

  return (
    <section aria-label="Customer accounts">
      <div className="page-heading">
        <div>
          <h2>Customers</h2>
          <p>Customer accounts and marketplace activity.</p>
        </div>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setResult(null)
            setError('')
            setReload((current) => current + 1)
          }}
        >
          Refresh Customers
        </button>
      </div>

      <form onSubmit={findCustomers} style={{ marginBottom: 20 }}>
        <label htmlFor="customer-search">Search by name, mobile or email</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
          <input
            id="customer-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            maxLength={150}
            style={{ padding: 10, flex: '1 1 220px' }}
          />
          <button type="submit" disabled={loading}>Search</button>
        </div>
      </form>

      {loading && <p role="status">Loading customers...</p>}
      {error && <p role="alert" className="error-panel">{error}</p>}

      {!loading && result?.customers?.length === 0 && (
        <p>No customers found.</p>
      )}

      {Boolean(result?.customers?.length) && (
        <div style={{ overflowX: 'auto' }} tabIndex={0} aria-label="Customer table">
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 850 }}>
            <thead>
              <tr>
                {[
                  'Customer', 'Contact', 'Account', 'Phone verification',
                  'Registered', 'Requests', 'Jobs', 'Completed',
                ].map((heading) => (
                  <th key={heading} scope="col" style={{ padding: 12, textAlign: 'left' }}>
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.customers.map((customer) => (
                <tr key={customer.customer_id} style={{ borderTop: '1px solid #dce5ee' }}>
                  <td style={{ padding: 12 }}>
                    <strong>{customer.full_name}</strong>
                    <div>{[customer.city, customer.state].filter(Boolean).join(', ')}</div>
                  </td>
                  <td style={{ padding: 12 }}>
                    <div>{customer.phone}</div>
                    <div>{customer.email || 'Email not provided'}</div>
                  </td>
                  <td style={{ padding: 12 }}>{customer.is_active ? 'Active' : 'Inactive'}</td>
                  <td style={{ padding: 12 }}>
                    {customer.phone_verified ? 'Verified' : 'Not verified'}
                  </td>
                  <td style={{ padding: 12 }}>
                    {new Date(customer.registered_at).toLocaleDateString()}
                  </td>
                  <td style={{ padding: 12 }}>{customer.request_count}</td>
                  <td style={{ padding: 12 }}>{customer.job_count}</td>
                  <td style={{ padding: 12 }}>{customer.completed_job_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 20 }}>
        <button
          type="button"
          disabled={loading || page <= 1}
          onClick={() => changePage(page - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          type="button"
          disabled={loading || !result?.pagination?.has_more}
          onClick={() => changePage(page + 1)}
        >
          Next
        </button>
      </div>
    </section>
  )
}
