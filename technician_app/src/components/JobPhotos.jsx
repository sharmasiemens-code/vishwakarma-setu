import { useEffect, useRef, useState } from 'react'
import { fetchRequestPhoto, listRequestPhotos } from '../api/photos'

function SavedPhoto({ requestId, photo, editable, disabled, onRemove }) {
  const imageRef = useRef(null)
  const [error, setError] = useState('')
  const [fullImage, setFullImage] = useState('')
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const image = imageRef.current
    let url = ''

    fetchRequestPhoto(requestId, photo.id, 'thumbnail', controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        url = URL.createObjectURL(blob)
        if (image) image.src = url
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message || 'Unable to load photo.')
        }
      })

    return () => {
      controller.abort()
      if (image) image.removeAttribute('src')
      if (url) URL.revokeObjectURL(url)
    }
  }, [requestId, photo.id])

  useEffect(() => {
    return () => {
      if (fullImage) URL.revokeObjectURL(fullImage)
    }
  }, [fullImage])

  async function openImage() {
    setOpening(true)
    setError('')
    try {
      const blob = await fetchRequestPhoto(requestId, photo.id, 'image')
      setFullImage(URL.createObjectURL(blob))
    } catch (err) {
      setError(err.message || 'Unable to open photo.')
    } finally {
      setOpening(false)
    }
  }

  return (
    <article style={{ border: '1px solid #dce5ee', borderRadius: 10, padding: 12 }}>
      <img
        ref={imageRef}
        alt={`Work photo ${photo.slot}`}
        style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 8 }}
      />
      <p>Work photo {photo.slot}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={openImage} disabled={opening || disabled}>
        {opening ? 'Opening...' : 'View photo'}
      </button>
      {editable && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => onRemove(photo.id)}
          style={{ marginLeft: 8 }}
        >
          Remove
        </button>
      )}

      {fullImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Work photo ${photo.slot}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setFullImage('')
          }}
          style={{
            position: 'fixed', inset: 0, zIndex: 1500,
            background: 'rgba(0,0,0,0.8)', padding: 20,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 12,
          }}
        >
          <button type="button" autoFocus onClick={() => setFullImage('')}>
            Close photo
          </button>
          <img
            src={fullImage}
            alt={`Work photo ${photo.slot}, enlarged`}
            style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
          />
        </div>
      )}
    </article>
  )
}

export default function JobPhotos({ requestId, disabled = false }) {
  const [open, setOpen] = useState(false)
  const [photos, setPhotos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()

    listRequestPhotos(requestId, controller.signal)
      .then((data) => {
        if (controller.signal.aborted) return
        setPhotos(data.photos || [])
        setError('')
        setLoading(false)
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        setPhotos([])
        setError(err.message || 'Unable to load work photos.')
        setLoading(false)
      })

    return () => controller.abort()
  }, [requestId, open])

  function togglePhotos() {
    if (!open) {
      setLoading(true)
      setError('')
      setPhotos([])
    }
    setOpen((current) => !current)
  }

  return (
    <section aria-label="Work photos" style={{ marginTop: 16 }}>
      <button
        type="button"
        onClick={togglePhotos}
        disabled={disabled}
        aria-expanded={open}
      >
        {open ? 'Hide Work Photos' : 'View Work Photos'}
      </button>

      {open && (
        <>
          <p>Review the work photos before accepting this job.</p>
          {loading && <p>Loading photos...</p>}
          {error && <p role="alert" className="dashboard-error">{error}</p>}
          {!loading && !error && !photos.length && (
            <p>The customer has not uploaded work photos.</p>
          )}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}>
            {photos.map((photo) => (
              <SavedPhoto
                key={photo.id}
                requestId={requestId}
                photo={photo}
                editable={false}
                disabled={disabled}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
