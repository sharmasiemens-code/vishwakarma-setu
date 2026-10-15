import { useRef, useState } from 'react'
import { apiRequest } from '../api/client'
import { useLanguage } from '../../../shared/Experience'

export default function ManualLocation({ onSaved }) {
  const { t, language } = useLanguage()
  const [latitude, setLatitude] = useState('')
  const [longitude, setLongitude] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  async function save(event) {
    event.preventDefault()
    if (lock.current) return
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) { setError('Enter both coordinates.'); return }
    lock.current = true; setBusy(true); setError('')
    try {
      await apiRequest('/technicians/me/location', { method: 'POST', body: JSON.stringify({ latitude: Number(latitude), longitude: Number(longitude), accuracy_meters: null, battery_percent: null }) })
      await onSaved()
    } catch (err) { setError(err.message) }
    finally { lock.current = false; setBusy(false) }
  }
  return <details className="setu-review"><summary>{t('Manual location')}</summary>
    <p>{language === 'hi' ? 'GPS बंद है तो अपने वर्तमान स्थान के अक्षांश और देशांतर मानचित्र से भरें। यह पता या लाइव GPS ट्रैकिंग नहीं है। काम मिलने के लिए स्थान ताज़ा रखना होगा।' : 'If GPS is unavailable, copy coordinates for your current position from a map. Confirm that you are there now. This does not track movement; update your position again when it changes or becomes stale.'}</p>
    <form className="setu-form" onSubmit={save}>
      <label>{t('Latitude')}<input type="number" inputMode="decimal" min="-90" max="90" step="any" required value={latitude} onChange={(event) => setLatitude(event.target.value)} disabled={busy} /></label>
      <label>{t('Longitude')}<input type="number" inputMode="decimal" min="-180" max="180" step="any" required value={longitude} onChange={(event) => setLongitude(event.target.value)} disabled={busy} /></label>
      <label><span><input type="checkbox" required disabled={busy} /> {language === 'hi' ? 'यह मेरा वर्तमान स्थान है' : 'I confirm this is my current position'}</span></label>
      <button type="submit" disabled={busy}>{t(busy ? 'Saving...' : 'Update Location')}</button>
    </form>
    {error && <p role="alert">{error}</p>}
  </details>
}
