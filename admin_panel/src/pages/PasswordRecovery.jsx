import { useState } from 'react'
import { apiRequest } from '../api/api'
import { getToken } from '../auth/auth'

const empty = { new_password: '', confirm_password: '', reason: '', identity_verified: false }

export default function PasswordRecovery() {
  const [search, setSearch] = useState('')
  const [role, setRole] = useState('')
  const [accounts, setAccounts] = useState([])
  const [query, setQuery] = useState(null)
  const [page, setPage] = useState(1)
  const [more, setMore] = useState(false)
  const [selected, setSelected] = useState(null)
  const [values, setValues] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  async function find(event, nextPage = 1) {
    event?.preventDefault()
    if (busy) return
    const current = event ? { search: search.trim(), role } : query
    if (!current || current.search.length < 2) { setError('Enter at least two characters.'); return }
    setBusy(true); setError(''); setMessage(''); setSelected(null); setValues(empty); setAccounts([])
    try {
      const params = new URLSearchParams({ search: current.search, page: String(nextPage) })
      if (current.role) params.set('role', current.role)
      const result = await apiRequest(`/admin/password-recovery/accounts?${params}`, {}, getToken())
      setAccounts(result.accounts); setMore(result.has_more); setPage(nextPage); setQuery(current)
    } catch (err) { setError(err.message || 'Account search failed.') }
    finally { setBusy(false) }
  }

  async function reset(event) {
    event.preventDefault()
    if (busy || !selected) return
    if (values.new_password !== values.confirm_password) { setError('New passwords do not match.'); return }
    setBusy(true); setError(''); setMessage('')
    try {
      await apiRequest(`/admin/password-recovery/accounts/${selected.id}/reset`, {
        method: 'POST', body: JSON.stringify({ ...values, expected_version: selected.password_version }),
      }, getToken())
      setMessage(`Password reset for ${selected.full_name}. Previous sessions are revoked. Tell the account owner their new password through your verified contact.`)
      setSelected(null); setValues(empty); setAccounts([]); setQuery(null)
    } catch (err) {
      setError(err.message || 'Password reset failed.')
      setValues((previous) => ({ ...previous, new_password: '', confirm_password: '' }))
      if (err.status === 409) { setSelected(null); setAccounts([]); setQuery(null) }
    } finally { setBusy(false) }
  }

  return <section aria-label="Password recovery">
    <h2>Password Recovery</h2>
    <p>Manually reset customer and technician passwords after verifying the account owner. Existing passwords cannot be viewed.</p>
    <form onSubmit={find} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
      <label>Name, mobile or email <input type="search" required minLength={2} maxLength={150} value={search} disabled={busy} onChange={(e) => setSearch(e.target.value)} /></label>
      <label>Account type <select value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}><option value="">Both</option><option value="CUSTOMER">Customer</option><option value="TECHNICIAN">Technician</option></select></label>
      <button disabled={busy} type="submit">{busy ? 'Working…' : 'Search'}</button>
    </form>
    {error && <p role="alert" className="error-panel">{error}</p>}
    {message && <p role="status">{message}</p>}
    {query && !busy && !accounts.length && <p>No accounts found.</p>}
    {accounts.map((account) => <div key={account.id} style={{ padding: 16, borderBottom: '1px solid #dce5ee' }}>
      <strong>{account.full_name}</strong> — {account.role}<p>{account.phone} · {account.email || 'No email'} · {account.is_active ? 'Active' : 'Inactive'}</p>
      <button type="button" disabled={busy || !account.is_active} onClick={() => { setSelected(account); setValues(empty); setError(''); setMessage('') }}>Reset Password</button>
    </div>)}
    {query && <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
      <button type="button" disabled={busy || page <= 1} onClick={() => find(null, page - 1)}>Previous</button>
      <span>Page {page}</span><button type="button" disabled={busy || !more} onClick={() => find(null, page + 1)}>Next</button>
    </div>}
    {selected && <form onSubmit={reset} style={{ marginTop: 24, maxWidth: 520 }}>
      <h3>Reset for {selected.full_name}</h3><p>{selected.role} · {selected.phone} · {selected.email || 'No email'}</p>
      <p>Use 8–72 characters with a letter and a number (maximum 72 UTF-8 bytes). The account owner must log in again.</p>
      {['new_password', 'confirm_password'].map((key) => <label key={key} style={{ display: 'block', marginBottom: 16 }}>
        {key === 'new_password' ? 'New password' : 'Confirm new password'}
        <input type="password" autoComplete="new-password" required minLength={8} maxLength={72} disabled={busy} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} style={{ display: 'block', width: '100%', padding: 10 }} />
      </label>)}
      <label>Reason (never enter passwords here)<textarea required minLength={3} maxLength={1000} disabled={busy} value={values.reason} onChange={(e) => setValues({ ...values, reason: e.target.value })} style={{ display: 'block', width: '100%' }} /></label>
      <label style={{ display: 'block', margin: '16px 0' }}><input type="checkbox" required disabled={busy} checked={values.identity_verified} onChange={(e) => setValues({ ...values, identity_verified: e.target.checked })} /> I verified this account owner's identity.</label>
      <button type="submit" disabled={busy}>{busy ? 'Resetting…' : 'Confirm Password Reset'}</button>
      <button type="button" disabled={busy} onClick={() => { setSelected(null); setValues(empty) }}>Cancel</button>
    </form>}
  </section>
}
