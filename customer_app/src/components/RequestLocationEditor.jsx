import { useRef, useState } from 'react'
import { apiRequest } from '../api/client'

export default function RequestLocationEditor({
  requestId, disabled, onBusyChange, onSaved,
}) {
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [accuracy, setAccuracy] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const lock = useRef(false)

  function start() {
    if (lock.current || disabled) return false
    lock.current = true
    setBusy(true)
    onBusyChange?.(true)
    setError('')
    setNotice('')
    return true
  }

  function finish() {
    lock.current = false
    setBusy(false)
    onBusyChange?.(false)
  }

  async function capture() {
    if (!start()) return
    try {
      if (!navigator.geolocation) throw new Error('This browser does not support location access.')
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 20000,
        })
      })
      setLatitude(String(position.coords.latitude))
      setLongitude(String(position.coords.longitude))
      setAccuracy(position.coords.accuracy)
      setNotice('Location captured. Check that it is the actual work site before saving.')
    } catch (err) {
      setError(err.message || 'Unable to obtain your location.')
    } finally {
      finish()
    }
  }

  async function save(event) {
    event.preventDefault()
    if (lock.current || disabled) return
    const lat = Number(latitude)
    const lng = Number(longitude)
    if (
      !latitude.trim() || !longitude.trim()
      || !Number.isFinite(lat) || !Number.isFinite(lng)
      || lat < -90 || lat > 90 || lng < -180 || lng > 180
    ) {
      setError('Enter valid latitude and longitude.')
      return
    }
    if (!window.confirm(
      `Save the WORK SITE at latitude ${lat}, longitude ${lng}? Technician matches will be refreshed.`,
    )) return
    if (!start()) return

    try {
      await apiRequest(`/service-requests/${requestId}/location`, {
        method: 'PATCH',
        body: JSON.stringify({ latitude: lat, longitude: lng }),
      })
      setNotice('Work location saved.')
      try {
        await onSaved?.()
      } catch {
        setError('Location saved. Refresh the request page to reload technician matches.')
      }
    } catch (err) {
      setError(
        (err.message || 'Unable to save the work location.')
        + ' If the response was interrupted, refresh the request page before retrying.',
      )
    } finally {
      finish()
    }
  }

  return (
    <section className="dashboard-section" aria-label="Update work location">
      <h2>Update Work Location</h2>
      <p>
        Use your current location only when you are at the work site.
        Otherwise enter verified coordinates for that site.
      </p>
      <button type="button" onClick={capture} disabled={busy || disabled}>
        {busy ? 'Working...' : 'Capture My Current Location'}
      </button>

      <form onSubmit={save} style={{ marginTop: 16 }}>
        <label style={{ display: 'block' }}>
          Latitude
          <input
            type="number" step="any" min="-90" max="90" required
            value={latitude}
            onChange={(event) => {
              setLatitude(event.target.value)
              setAccuracy(null)
              setNotice('')
            }}
            disabled={busy || disabled}
            style={{ display: 'block', padding: 10 }}
          />
        </label>
        <label style={{ display: 'block', marginTop: 12 }}>
          Longitude
          <input
            type="number" step="any" min="-180" max="180" required
            value={longitude}
            onChange={(event) => {
              setLongitude(event.target.value)
              setAccuracy(null)
              setNotice('')
            }}
            disabled={busy || disabled}
            style={{ display: 'block', padding: 10 }}
          />
        </label>
        {accuracy !== null && (
          <p>
            Reported accuracy: approximately {Math.round(accuracy)} metres.
            Check the coordinates before saving.
          </p>
        )}
        <p>This changes the map position only. Your written address remains unchanged.</p>
        <button type="submit" disabled={busy || disabled} style={{ marginTop: 12 }}>
          Save Work Location
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
  )
}
