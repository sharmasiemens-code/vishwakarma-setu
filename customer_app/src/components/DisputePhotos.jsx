import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchDisputePhoto,
  listDisputePhotos,
  uploadDisputePhoto,
} from '../api/disputePhotos'
import RequestPhotoPicker from './RequestPhotoPicker'

function SavedPhoto({ disputeId, photo, disabled }) {
  const imageRef = useRef(null)
  const [error, setError] = useState('')
  const [fullImage, setFullImage] = useState('')
  const [opening, setOpening] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    const image = imageRef.current
    let url = ''

    fetchDisputePhoto(disputeId, photo.id, 'thumbnail', controller.signal)
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
  }, [disputeId, photo.id])

  useEffect(() => {
    return () => {
      if (fullImage) URL.revokeObjectURL(fullImage)
    }
  }, [fullImage])

  async function openImage() {
    setOpening(true)
    setError('')
    try {
      const blob = await fetchDisputePhoto(disputeId, photo.id, 'image')
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
        alt={`Issue photo ${photo.slot}`}
        style={{ width: '100%', height: 150, objectFit: 'cover', borderRadius: 8 }}
      />
      <p>Issue photo {photo.slot}</p>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={openImage} disabled={opening || disabled}>
        {opening ? 'Opening...' : 'View photo'}
      </button>
      {fullImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Issue photo ${photo.slot}`}
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
            alt={`Issue photo ${photo.slot}, enlarged`}
            style={{ maxWidth: '100%', maxHeight: '80vh', objectFit: 'contain' }}
          />
        </div>
      )}
    </article>
  )
}

export default function DisputePhotos({
  disputeId,
  editable = false,
  disabled = false,
  onBusyChange,
}) {
  const [photos, setPhotos] = useState([])
  const [files, setFiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const operationLock = useRef(false)

  const loadPhotos = useCallback(async (signal) => {
    const data = await listDisputePhotos(disputeId, signal)
    if (!signal?.aborted) {
      setPhotos(data.photos || [])
      setLoading(false)
    }
  }, [disputeId])

  useEffect(() => {
    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      void loadPhotos(controller.signal).catch((err) => {
        if (!controller.signal.aborted) {
          setError(err.message || 'Unable to load saved photos.')
          setLoading(false)
        }
      })
    }, 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [loadPhotos])

  async function perform(operation) {
    if (operationLock.current || disabled) return
    operationLock.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setMessage('')
    try {
      await operation()
    } catch (err) {
      setError(err.message || 'Unable to update photos.')
    } finally {
      // Refresh even after a failure: an upload may have committed
      // before its response was interrupted.
      try {
        await loadPhotos()
      } catch {
        setError('Unable to confirm saved photos. Refresh before trying again.')
      }
      operationLock.current = false
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  function uploadSelected() {
    if (!editable || !files.length) return

    void perform(async () => {
      if (photos.length + files.length > 5) {
        throw new Error('Saved and selected photos cannot exceed five.')
      }

      const selected = [...files]
      // Clear the selection to prevent blind retries after an uncertain response.
      setFiles([])
      let confirmed = 0
      try {
        for (const file of selected) {
          await uploadDisputePhoto(disputeId, file)
          confirmed += 1
        }
        setMessage('Issue photos saved.')
      } catch (err) {
        throw new Error(
          `${confirmed} upload(s) confirmed. Review saved photos before retrying. `
          + (err.message || 'Upload could not be confirmed.'),
          { cause: err },
        )
      }
    })
  }

  return (
    <section className="dashboard-section" aria-label="Issue photos">
      <h2>Issue Photos</h2>
      <p>{photos.length} / 5 saved photos</p>
      {loading && <p>Loading photos...</p>}
      {error && <p role="alert" className="dashboard-error">{error}</p>}
      {message && <p role="status">{message}</p>}

      <button
        type="button"
        disabled={busy || disabled}
        onClick={() => {
          void perform(() => loadPhotos())
        }}
      >
        Refresh photos
      </button>

      {!loading && !photos.length && <p>No work photos saved.</p>}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: 14,
        marginTop: 16,
      }}>
        {photos.map((photo) => (
          <SavedPhoto
            key={photo.id}
            disputeId={disputeId}
            photo={photo}
            disabled={busy || disabled}
          />
        ))}
      </div>

      {editable ? (
        <>
          <RequestPhotoPicker
            files={files}
            onChange={setFiles}
            disabled={loading || busy || disabled || photos.length >= 5}
          />
          <button
            type="button"
            disabled={loading || busy || disabled || !files.length}
            onClick={uploadSelected}
          >
            {busy ? 'Updating photos...' : 'Upload selected photos'}
          </button>
          <p>Saved issue photos are retained with the dispute.</p>
        </>
      ) : (
        <p>Uploads are closed for this issue. Saved photos remain available.</p>
      )}
    </section>
  )
}
