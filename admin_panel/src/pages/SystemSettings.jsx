import { useEffect, useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken, hasPermission } from '../auth/auth'

function SettingEditor({ setting, canEdit, onSaved, onConflict }) {
  const [value, setValue] = useState(String(setting.value))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [conflict, setConflict] = useState(false)

  async function save(event) {
    event.preventDefault()
    if (busy || !canEdit || conflict) return
    const number = Number(value)
    if (!value.trim() || !Number.isInteger(number) || number < setting.minimum || number > setting.maximum) {
      setError(`Enter a whole number between ${setting.minimum} and ${setting.maximum}.`)
      return
    }
    if (reason.trim().length < 3) { setError('Enter a meaningful reason of at least three characters.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      const result = await apiRequest(`/admin/settings/${setting.key}`, {
        method: 'PUT',
        body: JSON.stringify({ value: number, expected_version: setting.version, reason: reason.trim() }),
      }, getToken())
      setMessage(result.message)
      setReason('')
      onSaved(result.setting)
    } catch (err) {
      if (err.status === 409) {
        setConflict(true)
        setError('This setting changed since you loaded it. Reload settings and review the latest value before saving.')
      } else setError(err.message || 'Unable to update setting.')
    } finally { setBusy(false) }
  }

  return <section className="settings-card">
    <h3>{setting.name}</h3>
    <p>{setting.description}</p>
    <p>Default: {setting.default} {setting.unit} · Allowed: {setting.minimum}–{setting.maximum} · Version: {setting.version}</p>
    <form onSubmit={save}>
      <label htmlFor={`${setting.key}-value`}>Value ({setting.unit})</label>
      <input id={`${setting.key}-value`} type="number" step="1" min={setting.minimum} max={setting.maximum}
        required value={value} disabled={busy || !canEdit || conflict}
        onChange={(e) => { setValue(e.target.value); setMessage('') }} />
      {canEdit && <>
        <label htmlFor={`${setting.key}-reason`}>Reason for change</label>
        <textarea id={`${setting.key}-reason`} required minLength={3} maxLength={1000}
          value={reason} disabled={busy || conflict} onChange={(e) => setReason(e.target.value)} />
        <button type="submit" disabled={busy || conflict || Number(value) === setting.value}>
          {busy ? 'Saving…' : 'Save Setting'}
        </button>
      </>}
    </form>
    {error && <p role="alert" className="error-panel">{error}</p>}
    {message && <p role="status">{message}</p>}
    {conflict && <button type="button" onClick={onConflict}>Reload Settings</button>}
    <p className="settings-meta">Last updated: {setting.updated_at ? new Date(setting.updated_at).toLocaleString() : 'Not available'}</p>
  </section>
}

export default function SystemSettings({ user }) {
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const canEdit = hasPermission(user, 'settings.write')

  useEffect(() => {
    const controller = new AbortController()
    apiRequest('/admin/settings', { signal: controller.signal, cache: 'no-store' }, getToken())
      .then((data) => {
        if (controller.signal.aborted) return
        setSettings(data.settings); setError(''); setLoading(false)
      }).catch((err) => {
        if (controller.signal.aborted) return
        setError(err.message || 'Unable to load settings.'); setSettings(null); setLoading(false)
      })
    return () => controller.abort()
  }, [revision])

  function reload() { setLoading(true); setSettings(null); setError(''); setRevision((r) => r + 1) }

  return <section aria-label="System settings">
    <div className="page-heading"><div><h2>System Settings</h2><p>Control GPS freshness and operational warning thresholds.</p></div>
      <button type="button" disabled={loading} onClick={reload}>Refresh Settings</button>
    </div>
    <p>Saved values apply to subsequent matching, assignment and monitoring checks. The presence worker checks approximately every minute. Existing jobs are preserved.</p>
    {!canEdit && <p>You have read-only access to these settings.</p>}
    {loading && <p role="status">Loading settings…</p>}
    {error && <p role="alert" className="error-panel">{error}</p>}
    <div className="settings-grid">{settings?.map((setting) => <SettingEditor
      key={`${revision}-${setting.key}`} setting={setting} canEdit={canEdit} onConflict={reload}
      onSaved={(updated) => setSettings((previous) => previous.map((item) => item.key === updated.key ? updated : item))}
    />)}</div>
  </section>
}
