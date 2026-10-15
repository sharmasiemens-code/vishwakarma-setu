import { useEffect, useRef, useState } from 'react'
import { createPushSession, supportsPhoneAlerts } from '../mobile/push'

export default function PushAlerts() {
  const session = useRef(null)
  const [message, setMessage] = useState('Enable phone alerts for job updates.')
  const [busy, setBusy] = useState(false)
  const supported = supportsPhoneAlerts()

  useEffect(() => {
    if (!supported) return
    const push = createPushSession(setMessage)
    session.current = push
    push.enable(false).catch(() => setMessage('Phone alerts could not connect. Try enabling again.'))
    function resumed() { push.enable(false).catch(() => {}) }
    window.addEventListener('technician-app-resumed', resumed)
    return () => { session.current = null; push.dispose(); window.removeEventListener('technician-app-resumed', resumed) }
  }, [supported])

  if (!supported) return null
  async function update(action) {
    if (busy) return
    setBusy(true)
    try { await session.current?.[action]() }
    catch (error) { setMessage(error.message || 'Unable to update phone alerts. Try again.') }
    finally { setBusy(false) }
  }
  return <section aria-label="Phone alerts" style={{ padding: 16, margin: '12px 0', border: '1px solid #dce5ee', borderRadius: 12 }}>
    <strong>Phone alerts</strong><p role="status">{message}</p>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <button type="button" disabled={busy} onClick={() => update('enable')}>Enable Phone Alerts</button>
      <button type="button" disabled={busy} onClick={() => update('disable')}>Disable Phone Alerts</button>
    </div>
  </section>
}
