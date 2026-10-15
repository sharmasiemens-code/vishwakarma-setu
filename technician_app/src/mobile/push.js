import { Capacitor } from '@capacitor/core'
import { PushNotifications } from '@capacitor/push-notifications'
import { apiRequest } from '../api/client'

export const JOB_CHANNEL = 'vishwakarma_jobs_v1'
const INSTALLATION_KEY = 'technician_push_installation'
const configured = import.meta.env.VITE_PUSH_ENABLED === '1'

export function supportsPhoneAlerts() {
  return Capacitor.getPlatform() === 'android' && configured
}

function installationId() {
  let id = localStorage.getItem(INSTALLATION_KEY)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(INSTALLATION_KEY, id) }
  return id
}

export async function detachPushDevice() {
  if (!supportsPhoneAlerts()) return
  const id = localStorage.getItem(INSTALLATION_KEY)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    if (id) await apiRequest(`/push/devices/${id}`, { method: 'DELETE', signal: controller.signal })
  } finally {
    clearTimeout(timeout)
    await PushNotifications.removeAllDeliveredNotifications().catch(() => {})
    // Invalidate the FCM token even if the HTTP unlink could not reach the backend.
    PushNotifications.unregister().catch(() => {})
  }
}

export function createPushSession(onStatus) {
  const session = localStorage.getItem('technician_access_token')
  let disposed = false
  let wanted = false
  const listeners = []
  const current = () => !disposed && session === localStorage.getItem('technician_access_token')
  const report = (message) => { if (current()) onStatus(message) }
  const started = (async () => {
    const registered = await PushNotifications.addListener('registration', async ({ value }) => {
      if (!current() || !wanted) return
      try {
        const result = await apiRequest('/push/devices', {
          method: 'POST', body: JSON.stringify({ installation_id: installationId(), token: value }),
        })
        report(result.delivery_enabled ? 'Phone alerts enabled.' : 'Phone registered. The notification service is not active yet.')
      } catch (error) { report(error.message || 'Phone registration failed. Try Enable Phone Alerts again.') }
    })
    if (disposed) await registered.remove(); else listeners.push(registered)
    const failed = await PushNotifications.addListener('registrationError', () => report('Phone registration failed. Check internet access and try again.'))
    if (disposed) await failed.remove(); else listeners.push(failed)
  })()

  async function enable(prompt = true) {
    await started
    if (!current()) return
    if (!prompt && localStorage.getItem('technician_push_optout') === '1') {
      report('Phone alerts disabled on this phone.'); return
    }
    if (prompt) localStorage.removeItem('technician_push_optout')
    wanted = true
    let permission = await PushNotifications.checkPermissions()
    if (permission.receive !== 'granted' && prompt) permission = await PushNotifications.requestPermissions()
    if (!current()) return
    if (permission.receive !== 'granted') {
      wanted = false
      report('Phone alerts are off. Allow notifications in Android app settings, then try again.')
      return
    }
    await PushNotifications.createChannel({
      id: JOB_CHANNEL, name: 'Job alerts', description: 'Vishwakarma Setu job and work updates',
      importance: 5, visibility: 0, vibration: true, lights: true,
    })
    if (current() && wanted) {
      report('Registering this phone…')
      await PushNotifications.register()
    }
  }

  return {
    enable,
    async disable() {
      localStorage.setItem('technician_push_optout', '1')
      wanted = false
      await detachPushDevice()
      report('Phone alerts disabled on this phone.')
    },
    dispose() { disposed = true; wanted = false; listeners.forEach((listener) => listener.remove()) },
  }
}
