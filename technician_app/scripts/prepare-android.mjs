import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { loadEnv } from 'vite'
import { validateMobileApi, makeCapacitorConfig } from './mobile-policy.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const env = { ...loadEnv('android', root, ''), ...process.env }
const allowHttp = env.MOBILE_ALLOW_HTTP === '1'
const api = validateMobileApi(env.VITE_API_BASE_URL, allowHttp)
const firebaseFile = resolve(root, 'android/app/google-services.json')
if (existsSync(firebaseFile)) {
  const firebase = JSON.parse(readFileSync(firebaseFile, 'utf8'))
  const matches = firebase.client?.some((client) => client.client_info?.android_client_info?.package_name === 'in.vishwakarmasetu.technician')
  if (!matches) throw new Error('google-services.json does not match the Technician Android package name.')
  env.VITE_PUSH_ENABLED = '1'
} else env.VITE_PUSH_ENABLED = '0'

function run(script, args) {
  const result = spawnSync(process.execPath, [resolve(root, script), ...args], {
    cwd: root, stdio: 'inherit', env: { ...env, VITE_API_BASE_URL: api },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${script} failed; Android preparation stopped.`)
}

writeFileSync(resolve(root, 'capacitor.config.json'), JSON.stringify(makeCapacitorConfig(allowHttp), null, 2) + '\n')
run('node_modules/vite/bin/vite.js', ['build', '--mode', 'android'])
if (!existsSync(resolve(root, 'android'))) run('node_modules/@capacitor/cli/bin/capacitor', ['add', 'android'])

const manifestPath = resolve(root, 'android/app/src/main/AndroidManifest.xml')
let manifest = readFileSync(manifestPath, 'utf8')
for (const permission of ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'POST_NOTIFICATIONS']) {
  if (!manifest.includes(`android.permission.${permission}`)) {
    manifest = manifest.replace('</manifest>', `    <uses-permission android:name="android.permission.${permission}" />\n</manifest>`)
  }
}
manifest = manifest.replace(/android:allowBackup="true"/, 'android:allowBackup="false"')
writeFileSync(manifestPath, manifest)

// Cleartext is enabled only in Android's debug source set for explicit USB/LAN testing.
const debugDirectory = resolve(root, 'android/app/src/debug')
mkdirSync(debugDirectory, { recursive: true })
writeFileSync(resolve(debugDirectory, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">\n  <application android:usesCleartextTraffic="${allowHttp}" tools:replace="android:usesCleartextTraffic" />\n</manifest>\n`)
// Main/release manifest always denies HTTP even after a previous debug build.
manifest = readFileSync(manifestPath, 'utf8')
if (/android:usesCleartextTraffic=/.test(manifest)) manifest = manifest.replace(/android:usesCleartextTraffic="[^"]*"/, 'android:usesCleartextTraffic="false"')
else manifest = manifest.replace('<application', '<application android:usesCleartextTraffic="false"')
const channelMetadata = '<meta-data android:name="com.google.firebase.messaging.default_notification_channel_id" android:value="vishwakarma_jobs_v1" />'
if (!manifest.includes('com.google.firebase.messaging.default_notification_channel_id')) {
  manifest = manifest.replace('</application>', '    ' + channelMetadata + '\n    </application>')
}
writeFileSync(manifestPath, manifest)
run('node_modules/@capacitor/cli/bin/capacitor', ['sync', 'android'])
console.log(`Android prepared for ${api}. ${allowHttp ? 'Local HTTP testing: build DEBUG only.' : 'HTTPS mode.'}`)
console.log('Next: npm run android:open. In Android Studio build a debug APK for device testing.')
