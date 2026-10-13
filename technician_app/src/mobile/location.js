import { Capacitor } from '@capacitor/core'
import { Geolocation } from '@capacitor/geolocation'
import { App } from '@capacitor/app'

export async function isAppActive() {
  if (Capacitor.isNativePlatform()) return (await App.getState()).isActive
  return document.visibilityState === 'visible'
}

export async function getCurrentLocation() {
  const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  if (Capacitor.isNativePlatform()) {
    let permissions = await Geolocation.checkPermissions()
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      permissions = await Geolocation.requestPermissions({ permissions: ['location'] })
    }
    if (permissions.location !== 'granted' && permissions.coarseLocation !== 'granted') {
      throw new Error('Location permission was denied. Allow location in Android Settings → Apps → Vishwakarma Setu Technician → Permissions.')
    }
    return Geolocation.getCurrentPosition(options)
  }
  if (!navigator.geolocation) throw new Error('Location is not supported by this browser.')
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, options))
}
