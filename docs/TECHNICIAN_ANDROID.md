# Technician Android app — first device build

The Technician React app now supports Capacitor Android packaging, native foreground GPS permission requests, Android Back navigation, resume-time location refresh and mobile safe-area/touch sizing. Its existing job/PIN/Happy Code/photo-viewing flows are reused. Customer Android packaging is the next app phase.

## Build prerequisites on Windows

- Node.js 22+ (the existing Vite version also needs a sufficiently recent Node release).
- Android Studio 2025.2.1 or newer with Android SDK Platform 36, build tools and platform tools.
- Use Android Studio's bundled JDK 21 for Gradle. The generated native sources target Java 21.
- Android phone with Developer options and USB debugging enabled, or Android Studio emulator.

Official setup: https://capacitorjs.com/docs/getting-started/environment-setup

## Prepare your local Android project

In PowerShell:

```powershell
Set-Location C:\TechExpertMarketplace\technician_app
npm ci
Copy-Item mobile.env.example .env.android.local
npm run test:mobile
npm run android:prepare
npm run android:open
```

Copy the example only the first time; retain your existing .env.android.local thereafter. It defaults to USB testing against http://127.0.0.1:8000 with MOBILE_ALLOW_HTTP=1. Android's generated project and config are local ignored build outputs, reproducible from the pinned package-lock and prepare script. Preparation retains an existing native project and synchronizes web assets/plugins; it does not delete your Android project. Keep any future custom native source additions separately in version control before relying on them.

## Reach your current backend over USB

Start the updated backend as usual. It now permits the packaged app origins http://localhost and https://localhost; authentication and permissions are unchanged.

Connect the phone, accept its USB debugging trust prompt, and run platform-tools adb from its installation directory. Typical PowerShell commands:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8000 tcp:8000
```

If your SDK is installed elsewhere, use its actual platform-tools directory. For the emulator use the same adb reverse command (select the device with -s when several are attached). With reverse active, the phone's 127.0.0.1:8000 is forwarded to the computer's backend. Without reverse, localhost points to the phone itself.

In Android Studio wait for Gradle sync. Select your device and Run, or use Build → Generate App Bundles or APKs → Generate APKs (menu labels vary by Studio version). A debug APK normally appears at:

`technician_app/android/app/build/outputs/apk/debug/app-debug.apk`

The debug build is automatically signed with a development key. It is for private device testing, not a signed production/Play Store release. Restart adb reverse after reconnecting the phone or restarting the emulator.

## HTTPS pilot configuration

Before distributing a pilot build beyond your USB connection, configure an actual reachable HTTPS backend:

```dotenv
VITE_API_BASE_URL=https://YOUR-ACTUAL-API-HOST
MOBILE_ALLOW_HTTP=0
```

Run android:prepare again. HTTP testing is allowed only through an explicit flag and the debug manifest. Main/release manifests deny cleartext; mixed content is disabled. The app packages local web assets, not a remotely hosted UI. The build script rejects missing/example/credential-bearing API URLs. No backend URL is assumed to exist yet.

Signing for distribution needs a private release keystore kept outside Git. Never commit signing keys, local env files, native local.properties or google-services service-account credentials.

## Real-device acceptance

- Launch/login/registration and password change; ensure wrong passwords and expired sessions are rejected.
- Allow location; update GPS, go ONLINE, receive/accept a test job. Deny permission and confirm a readable message without going ONLINE.
- Background and resume: GPS refreshes on return. Location is foreground only; the app does not promise tracking while closed or screen-off. Existing server stale-GPS/active-job rules still apply.
- Back from Earnings/Change Password returns to dashboard. Back closes a photo dialog first; at the root it offers an exit confirmation.
- View private work photos; verify no upload controls appear for technician-only views.
- Test Start PIN, work completion and Happy Code on the phone.
- Test narrow screens, keyboard and display cutouts.

## Notifications and remaining work

Existing notification polling works while the app is active. Push alerts that wake a background/closed app require the next FCM/device-token/backend delivery module and are not implemented in this phase. The official geolocation plugin also does not provide background geolocation: https://capacitorjs.com/docs/apis/geolocation.

Camera/gallery capture belongs to the Customer app's upload workflow; this Technician phase preserves existing read-only work-photo access. App icon polish, release signing, private distribution and Play Store preparation remain after device acceptance.

## Development verification

Mobile URL policy tests, technician ESLint and production web build passed. Android project generation, plugin sync, location permissions and debug/release network configuration were inspected in both local HTTP and HTTPS modes. Native APK compilation was not performed here: Android SDK/JDK 21 are unavailable in this environment. Native permission prompts, Back handling and phone layout must be verified on the user's Android device.
