import { useEffect, useState } from 'react'
import { apiRequest } from '../api/client'
import { useLanguage } from '../../../shared/Experience'

export default function Ratings({ jobId, onBack }) {
  const { t, language } = useLanguage()
  const [data, setData] = useState(null)
  const [selected, setSelected] = useState(null)
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      Promise.all([
        apiRequest(`/ratings/me?limit=20&offset=${page * 20}`, { signal: controller.signal }),
        jobId ? apiRequest(`/ratings/job/${encodeURIComponent(jobId)}`, { signal: controller.signal }) : Promise.resolve(null),
      ]).then(([result, focused]) => { if (!controller.signal.aborted) { setData(result); setSelected(focused?.rating || null); setError('') } })
        .catch((err) => { if (!controller.signal.aborted) setError(err.message) })
    }
    load()
    window.addEventListener('focus', load)
    return () => { controller.abort(); window.removeEventListener('focus', load) }
  }, [jobId, page, reload])
  const review = (row) => <article className="setu-review" key={row.id} aria-label={`${row.rating} out of 5`}>
    <strong>{row.rating} / 5</strong><p>{row.review || (language === 'hi' ? 'ग्राहक ने केवल रेटिंग दी है।' : 'Customer left a rating without a written review.')}</p>
    <small>{new Date(row.created_at).toLocaleDateString(language === 'hi' ? 'hi-IN' : 'en-IN')}</small>
  </article>
  return <main className="setu-empty"><div className="setu-actions"><button onClick={onBack}>{t('Back')}</button><button onClick={() => setReload(reload + 1)}>{t('Retry')}</button></div>
    <h1>{t('Your Ratings')}</h1>
    {error && <p role="alert">{error}</p>}
    {!data && !error && <p role="status">Loading reviews…</p>}
    {data && <><p>{data.rating_average == null ? '—' : Number(data.rating_average).toFixed(2)} / 5 · {data.total_reviews} {language === 'hi' ? 'समीक्षाएँ' : 'reviews'}</p>
      {selected && <section aria-label="Review from notification"><h2>{language === 'hi' ? 'सूचना की समीक्षा' : 'Review from your notification'}</h2>{review(selected)}</section>}
      {data.total_reviews === 0 && <p>{t('No reviews yet. Completed jobs can receive a customer review.')}</p>}
      {data.reviews.filter((row) => row.id !== selected?.id).map(review)}
      <div className="setu-actions"><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button disabled={(page + 1) * 20 >= data.total_reviews} onClick={() => setPage(page + 1)}>Next</button></div>
    </>}
  </main>
}
