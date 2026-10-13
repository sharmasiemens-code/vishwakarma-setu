import { useEffect, useState } from 'react'
import { apiRequest } from '../api/client'

function money(value) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 2,
  }).format(Number(value || 0))
}

function monthLabel(value) {
  return new Date(`${value}-01T12:00:00`).toLocaleDateString('en-IN', {
    month: 'short', year: '2-digit',
  })
}

export default function Earnings({ onBack }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/technicians/me/earnings', {
      signal: controller.signal,
      cache: 'no-store',
    }).then((result) => {
      if (controller.signal.aborted) return
      setData(result)
      setLoading(false)
      setError('')
    }).catch((err) => {
      if (controller.signal.aborted) return
      setData(null)
      setLoading(false)
      setError(err.message || 'Unable to load your work value.')
    })
    return () => controller.abort()
  }, [reload])

  const monthly = data?.monthly || []
  const maximum = Math.max(1, ...monthly.map((item) => Number(item.work_value)))
  const summary = data?.summary

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: 24 }}>
      <button type="button" onClick={onBack}>Back to Dashboard</button>
      <section className="welcome-card" style={{ marginTop: 20 }}>
        <h1>Earnings &amp; Work Value</h1>
        <p>Your completed jobs and monthly work value.</p>
        <p>
          Payments are not tracked yet. These totals show completed-work value,
          and do not confirm money received or profit.
        </p>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            setData(null)
            setError('')
            setReload((current) => current + 1)
          }}
        >
          {loading ? 'Loading...' : 'Refresh Totals'}
        </button>
      </section>

      {error && <p role="alert" className="dashboard-error">{error}</p>}

      {summary && (
        <>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 16, marginTop: 20,
          }}>
            <section className="welcome-card">
              <h2>Lifetime Work Value</h2>
              <strong style={{ fontSize: 28 }}>
                {money(summary.lifetime_work_value)}
              </strong>
            </section>
            <section className="welcome-card">
              <h2>Completed Jobs</h2>
              <strong style={{ fontSize: 28 }}>{summary.completed_jobs}</strong>
            </section>
            <section className="welcome-card">
              <h2>This Month</h2>
              <strong style={{ fontSize: 28 }}>
                {money(monthly.at(-1)?.work_value)}
              </strong>
              <p>{monthly.at(-1)?.completed_jobs || 0} completed jobs</p>
            </section>
          </div>

          {summary.estimated_value_jobs > 0 && (
            <p>
              {summary.estimated_value_jobs} older jobs use their recorded
              estimate because no final amount was saved.
            </p>
          )}
          {summary.missing_amount_jobs > 0 && (
            <p>
              {summary.missing_amount_jobs} completed jobs have no valid amount
              and are excluded from the monetary total.
            </p>
          )}
          {summary.undated_jobs > 0 && (
            <p>
              {summary.undated_jobs} jobs have no completion date and cannot
              appear in the monthly graph.
            </p>
          )}

          <section className="welcome-card" style={{ marginTop: 20 }}>
            <h2>Monthly Completed-Work Value</h2>
            <p>Last 12 months, using India time. Scroll sideways on smaller screens.</p>
            <div style={{ overflowX: 'auto' }}>
              <div aria-hidden="true" style={{
                display: 'flex', alignItems: 'flex-end', gap: 12,
                minWidth: 720, height: 260, paddingTop: 40,
              }}>
                {monthly.map((item) => (
                  <div key={item.month} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, marginBottom: 6 }}>
                      {money(item.work_value)}
                    </div>
                    <div style={{
                      height: Math.max(2, Number(item.work_value) / maximum * 180),
                      background: 'linear-gradient(180deg, #1b9a8a, #176b78)',
                      borderRadius: '6px 6px 0 0',
                    }} />
                    <div style={{ fontSize: 12, marginTop: 8 }}>
                      {monthLabel(item.month)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <details style={{ marginTop: 20 }}>
              <summary>View Monthly Figures</summary>
              <table style={{ width: '100%', marginTop: 12, textAlign: 'left' }}>
                <thead>
                  <tr>
                    <th scope="col">Month</th>
                    <th scope="col">Completed jobs</th>
                    <th scope="col">Work value</th>
                  </tr>
                </thead>
                <tbody>
                  {monthly.map((item) => (
                    <tr key={item.month}>
                      <td>{monthLabel(item.month)}</td>
                      <td>{item.completed_jobs}</td>
                      <td>{money(item.work_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>
        </>
      )}
    </main>
  )
}
