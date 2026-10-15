# Technician Android phone alerts (FCM)

Firebase project: `vishwakarma-setu`. Android package: `in.vishwakarmasetu.technician`.
The existing in-app notification list is retained. Android sound/banner alerts are sent through Firebase Cloud Messaging (FCM).

## 1. Firebase Android configuration

Keep the downloaded client configuration at:

`C:\TechExpertMarketplace\technician_app\android\app\google-services.json`

The existing Capacitor Gradle template already includes the Google Services plugin. Do not duplicate Firebase's example Gradle blocks. Complete the Firebase registration wizard with Next/Continue to console. The Capacitor push plugin supplies the native Firebase Messaging SDK.

## 2. Install the backend queue migration

After checking out `feature/technician-push`, connect with:

```powershell
psql -U postgres -d tech_expert_marketplace
```

```sql
\set ON_ERROR_STOP on
\i C:/TechExpertMarketplace/backend/migrations/PN_001_android_push.sql
SELECT to_regclass('public.push_devices'), to_regclass('public.push_outbox');
```

Apply once, after existing migrations. It creates a phone registry and a durable queue. New notification inserts enqueue alerts in the same transaction; a rolled-back job/notification does not queue an alert. Historical notifications are not backfilled.

## 3. Configure backend-only Firebase credentials

In Firebase: Settings → Service accounts → Firebase Admin SDK → Generate new private key.
Keep this downloaded **service-account private key** on the backend computer only, outside the repository, for example:

`C:\TechExpertMarketplace_Secrets\firebase-service-account.json`

This is different from the Android `google-services.json` client configuration. Never put the private key in the Android app, upload it to chat or commit it to Git.

Install the optional push dependency set:

```powershell
Set-Location C:\TechExpertMarketplace\backend
& .\.venv\Scripts\python.exe -m pip install -r requirements-push.txt
```

Add these entries to your existing backend `.env` while keeping its database/JWT settings:

```dotenv
PUSH_ENABLED=1
FIREBASE_PROJECT_ID=vishwakarma-setu
GOOGLE_APPLICATION_CREDENTIALS=C:/TechExpertMarketplace_Secrets/firebase-service-account.json
```

Restart the backend using its own virtual environment. Firebase requires outbound internet access from the backend and the phone. Keep the existing USB forwarding for the phone-to-local-backend connection.

```powershell
Set-Location C:\TechExpertMarketplace\backend
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

## 4. Rebuild the Android app

Stop any Technician Vite server before reinstalling dependencies to avoid Windows Rolldown file locks.
Keep your existing `.env.android.local`, generated native project and local Gradle distribution settings.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    Set-Location C:\TechExpertMarketplace\technician_app
    npm ci
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
    npm run test:mobile
    if ($LASTEXITCODE -ne 0) { throw 'Mobile tests failed.' }
    npm run android:prepare
    if ($LASTEXITCODE -ne 0) { throw 'Android preparation failed.' }
    npm run android:open
}
```

Preparation checks the Firebase client package name, enables the packaged push UI when the file is present, adds POST_NOTIFICATIONS and the default job channel, and syncs the new native plugin. No Firebase private key is needed to build the APK.

In Android Studio use JVM 21, sync, then Generate APKs. Install the newly generated debug APK over the existing app:

```powershell
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
& $adbPath -s R9ZX90G0WNL reverse tcp:8000 tcp:8000
& $adbPath -s R9ZX90G0WNL install -r "C:\TechExpertMarketplace\technician_app\android\app\build\outputs\apk\debug\app-debug.apk"
```

## 5. Phone acceptance

1. Log in with an approved technician account. On the dashboard select Enable Phone Alerts and allow Android notification permission.
2. Confirm Phone alerts enabled. If it says the service is not active yet, check PUSH_ENABLED and restart the backend.
3. Keep phone internet on and USB forwarding active. Assign a new job from the Customer app.
4. Confirm a banner/sound in the foreground, then repeat with the app minimized. Tap the alert: the app opens the dashboard; current job details remain behind authentication.
5. Check phone notification/channel settings and Do Not Disturb if delivery arrives without sound/banner. Android controls final presentation.
6. Disable Phone Alerts, background/resume and confirm it stays disabled. Re-enable and test again.
7. Sign out and confirm subsequent updates are not sent to the unlinked phone. Logout attempts HTTP unlink and FCM token invalidation; offline unlink is best-effort. Existing delivered notifications are cleared locally.
8. Change/reset the password and confirm old device registrations stop receiving new pushes. Log in again to register the current session.

Notification-type payloads are used so Android can display background notifications. A system force-stop can block delivery until the user reopens the app. OS battery restrictions, offline phones, disabled channels and Do Not Disturb can also affect delivery. This feature does not add background GPS tracking.

## Delivery behavior

- Registration requires the authenticated active technician, uses the current password version and allows at most five active phones per user.
- Logout unlink is scoped to the current user/installation. Registration supports switching accounts on one installation and FCM token rotation.
- The worker runs every five seconds when enabled. It claims rows with FOR UPDATE SKIP LOCKED, then checks device ownership, account status, current credential version, unread status and a 15-minute deadline.
- Generic lock-screen text excludes customer contact data, job descriptions, PINs and Happy Codes. Only notification ID is included as app data.
- Temporary failures retry up to five attempts with backoff; unregistered FCM tokens are disabled. Error bodies and tokens are not logged. Delivery is at-least-once around crashes: a stable notification tag reduces duplicates but does not guarantee exactly-once display.
- Network sends run outside the job-assignment transaction. Provider failure cannot undo a job assignment.
- No notifications are queued for phones that have not registered yet. Approval notifications emitted before first registration remain available in-app.

## Diagnostics (no private tokens)

```sql
SELECT user_id, active, auth_version, updated_at FROM public.push_devices;
SELECT state, last_error_code, COUNT(*) FROM public.push_outbox
GROUP BY state, last_error_code ORDER BY state;
```

UNREGISTERED indicates an expired/uninstalled phone token. SENDER_ID_MISMATCH means Android configuration and backend Firebase project credentials differ. DELIVERY_UNAVAILABLE requires checking backend internet, credentials and the Firebase Cloud Messaging API. The normal job workflow and in-app notifications continue if push is disabled or unavailable.

## Validation

142 backend tests (including 27 push regressions) and five mobile configuration tests passed; technician lint/web build, fixture-based Android plugin sync, permission/channel metadata and packaged push UI were verified. Backend tests cover ownership, protected roles, stale credentials, token redaction, retries, invalid tokens and skip-locked claims. Live PostgreSQL migration/concurrency testing could not run in the restricted runtime; apply and validate the migration locally. No real Firebase credentials were accessed, no messages were sent during development, and native APK/phone acceptance remains pending.
