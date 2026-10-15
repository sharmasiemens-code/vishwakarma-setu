export function validateMobileApi(value, allowHttp = false) {
  if (!value) throw new Error('Set VITE_API_BASE_URL in .env.android.local before preparing Android.')
  let url
  try { url = new URL(value) } catch { throw new Error('VITE_API_BASE_URL must be an absolute HTTP(S) address.') }
  if (url.username || url.password || url.search || url.hash) throw new Error('API address must not contain credentials, query parameters or fragments.')
  if (url.hostname.endsWith('.example')) throw new Error('Replace the example API address with your actual backend address.')
  if (url.pathname !== '/' && url.pathname !== '') throw new Error('Use the backend origin without a path, for example https://api.example.in.')
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error('Android requires HTTPS. For USB local testing only, set MOBILE_ALLOW_HTTP=1.')
  }
  if (!allowHttp && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Release preparation requires a reachable HTTPS backend, not localhost.')
  }
  return url.origin
}

export function makeCapacitorConfig(allowHttp = false) {
  return {
    appId: 'in.vishwakarmasetu.technician',
    appName: 'Vishwakarma Setu Technician',
    webDir: 'dist',
    plugins: { PushNotifications: { presentationOptions: ['sound', 'banner', 'list'] } },
    server: { androidScheme: allowHttp ? 'http' : 'https' },
    android: { allowMixedContent: false },
  }
}
