import { useEffect, useState } from 'react'
import { apiRequest } from '../api/client'
import { isAppActive } from '../mobile/location'

export default function TechnicianRatings({ technicianId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!technicianId) return
    let cancelled = false
    let pending = false
    async function load() {
      if (pending || !(await isAppActive())) return
      pending = true
      try {
        const result = await apiRequest(`/ratings/technician/${technicianId}`)
        if (!cancelled) { setData(result); setError('') }
      } catch (err) {
        if (!cancelled) setError(err.message || 'Unable to load ratings.')
      } finally { pending = false }
    }
    void load()
    const interval = window.setInterval(load, 15000)
    return () => { cancelled = true; window.clearInterval(interval) }
  }, [technicianId, refresh])
  if (!technicianId) return null
  return (
    <section className="welcome-card" aria-label="Customer ratings and reviews">
      <h2>Customer Ratings &amp; Reviews</h2>
      <button type="button" onClick={() => setRefresh((value) => value + 1)}>Refresh Ratings</button>
      {error && <p role="alert">{error}</p>}
      {!data && !error && <p>Loading ratings...</p>}
      {data && <>
        <p><strong>{Number(data.technician?.rating_average ?? 0).toFixed(2)} / 5</strong> · {data.total_reviews} reviews</p>
        {data.reviews?.length === 0 && <p>No customer ratings yet.</p>}
        {data.reviews?.map((review) => (
          <article key={review.id} style={{ borderTop: '1px solid #ddd', padding: '12px 0' }}>
            <strong aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)} · {review.rating}/5</strong>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{review.review || 'No written review.'}</p>
            <small>{new Date(review.created_at).toLocaleString()}</small>
          </article>
        ))}
      </>}
    </section>
  )
}
