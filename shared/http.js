// No automatic mutation retries: an interrupted response may already be committed.
export async function requestJson(url, options = {}, onUnauthorized) {
  const controller = new AbortController()
  const relay = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) relay()
  options.signal?.addEventListener('abort', relay, { once: true })
  const timeout = setTimeout(() => controller.abort(new Error('Request timed out')), 30000)
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, cache: options.cache || 'no-store' })
    let data = null
    try { data = await response.json() } catch { /* Preserve HTTP status for non-JSON responses. */ }
    if (!response.ok) {
      if (response.status === 401) onUnauthorized?.()
      let message = typeof data?.detail === 'string' ? data.detail : `Request failed (${response.status}). Please try again.`
      if (Array.isArray(data?.detail)) message = data.detail.map((item) => `${(item.loc || []).filter((part) => part !== 'body').join(' → ')}: ${item.msg || 'Invalid value'}`).join('\n')
      const error = new Error(message)
      error.status = response.status
      throw error
    }
    if (data === null) throw new Error('The server response could not be confirmed. Refresh before submitting again.')
    return data
  } catch (error) {
    if (options.signal?.aborted) throw error
    if (error.status) throw error
    const method = (options.method || 'GET').toUpperCase()
    throw new Error(['GET', 'HEAD'].includes(method)
      ? 'Unable to connect. Check your connection and retry.'
      : 'The response could not be confirmed. Reconnect and refresh before submitting again.', { cause: error })
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', relay)
  }
}
