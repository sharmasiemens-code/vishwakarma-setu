# Real-world readiness: implementation and validation

Feature branch: `feat/real-world-readiness`. Changes are local for review; nothing has been deployed, publicly published or sent to real users.

## What inspection established

| Area | Existing behavior | Changes and limits |
|---|---|---|
| Customer accounts | Mobile/password registration; mobile/email login; no profile editor | Optional normalized email and calendar DOB; private owner-only profile API/editor; old account/password claims preserved |
| Technician onboarding | Full application required before account creation; admin phone/KYC/address/application review | Short account creation, private versioned server drafts, resumable skills/service-area form, searchable selections; existing approval gate retained; legacy pending accounts keep their existing review screen rather than being forced to reapply |
| Service requests | Four-step wizard, private compressed photos, GPS/manual coordinates, matching by skills/tools/radius | Retry-safe submission keys, blank-coordinate rejection, no automatic write retries; manual coordinates remain available when GPS is denied |
| Matching and jobs | Fresh location, KYC, skills/tools and active-job exclusion; state transitions | Technician lock and database uniqueness prevent conflicting assignments; acceptance rejects a second active job; double-tap guards |
| Start/completion | Customer-issued Start PIN and Happy Code, HMAC verifiers, expiry, cooldown and five-attempt lockout already existed | Preserved; tested against PostgreSQL through the actual routes; validation responses redact input; no codes in technician responses or notifications |
| Ratings | Rating insert and transactional inbox notification; technician job-review API denied; notification click only marked read | Both participants can read their job review; owner ratings page with live averages/counts and pagination; notification opens its specific review; dashboard refreshes for new rating notifications; concurrent duplicate ratings prevented |
| Notifications | Database inbox, polling, mark-read/read-all; creation commits atomically with the related action | Kept transactional; no push/SMS/email delivery service or external retry worker has been added |
| Admin | Permission-based roles, audit log, KYC/application/settings/customer/dispute screens | Existing permissions/audit preserved; consistent logo/layout and API session handling; full admin browser acceptance remains manual |

The UI shares spacing, colors, accessible controls, contrast, focus states, reduced-motion behavior and a compact SVG brand. Main registration/profile/onboarding/actions have a maintainable English/Hindi dictionary in `shared/messages.js`. Hindi coverage is partial: some older job, request, admin and server error text remains English. No invented ratings, testimonials or counts were added. The previous prefilled ₹1,200 estimate is removed. Assignment explains proposed versus agreed price; this change does not invent a platform fee or implement payments.

## Database requirements and migration safety

The owner confirmed there is no existing database. **The repository still does not contain a supported production base-schema/first-admin bootstrap.** Its old migrations require existing tables; C30 also requires a specific existing administrator. Do not apply those migrations blindly to an empty database. `backend/tests/fixtures/marketplace_base.sql` is an explicitly synthetic legacy fixture for automated tests, not a production initializer or an authoritative schema export.

For an existing database that already has the repository's C30/C31/RG/WF/PR migrations and C32 runtime activation, take a backup, stop application writes and apply these in order with `ON_ERROR_STOP=1`:

1. `RW_001_customer_details_onboarding.sql`: nullable `customers.date_of_birth` and private technician draft table. Existing rows retain NULL DOB. No DOB goes into JWTs, matching or technician/customer job responses.
2. `RW_002_job_integrity.sql`: unique rating per job and one active assignment per technician. The migration deliberately fails if old duplicate reviews or conflicting active jobs exist; it never deletes or merges them. Investigate conflicts before retrying. Index creation takes write locks; schedule a maintenance window for large tables.
3. `RW_003_request_idempotency.sql`: customer-scoped submission key/hash and committed response. Retrying the same key/body returns the original result; changed bodies with the same key get 409. The browser retains an uncertain key in session storage until a successful response. Keys require browser cryptography (HTTPS or local development). No offline queue/synchronization is implemented.

The new migrations are transactional and repeatable. Integration checks apply each twice. Earlier migrations are not generally repeatable. Do not rerun all old migrations on a live database. Use C32_002 rather than C32_001 as documented in SYSTEM_SETTINGS.md.

Rollback: restore the previous application version first and retain the new nullable column/tables/indexes unless a reviewed rollback requires removal. Removing the DOB column or draft/idempotency tables loses newly saved information; dropping indexes weakens concurrency protection. Back up/export new data before any removal. Do not roll back by deleting customers or job history. No existing database was modified during this work.

## Exact Windows PowerShell commands

Use Node.js 24 and Python 3.12. Run from the branch containing these changes at `C:\TechExpertMarketplace`. If the branch is not yet in your Windows checkout, transfer/review these changes first; this task did not push a remote branch.

```powershell
Set-Location C:\TechExpertMarketplace
git status --short
node --version
py -3.12 --version
py -3.12 -m venv backend\.venv
& .\backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
& .\backend\.venv\Scripts\python.exe -m pip check
foreach ($app in @('customer_app', 'technician_app', 'admin_panel')) {
    Push-Location $app
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed: $app" }
    npm run lint
    if ($LASTEXITCODE -ne 0) { throw "Lint failed: $app" }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed: $app" }
    Pop-Location
}
```

Prepare local configuration (prints variable names, never secret values). It preserves existing entries; existing blank entries need manual completion.

```powershell
& .\backend\.venv\Scripts\python.exe backend\tools\prepare_local_env.py
notepad backend\.env
```

Set `DATABASE_URL=postgresql+psycopg://<local-db-user>:<URL-encoded-password>@127.0.0.1:5432/<database>` using your actual local development database. Never paste credentials into chat. The helper generates separate cryptographic signing keys only for missing JWT/PIN/Happy Code entries. Keep backend/.env private and untracked. On Windows, restrict its file ACL to your account as appropriate. Keep the keys stable across restarts; rotating them invalidates tokens or outstanding codes. A new empty database still needs the missing supported base-schema/administrator bootstrap before the following application commands can pass.

**Only on an already initialized, backed-up database**, with the old migrations installed:

```powershell
$databaseName = Read-Host 'Existing development database name'
$dbUser = Read-Host 'Development database user'
New-Item -ItemType Directory -Force C:\TechExpertMarketplace_Backups | Out-Null
$backupPath = "C:\TechExpertMarketplace_Backups\before-real-world-$(Get-Date -Format yyyyMMdd-HHmmss).backup"
pg_dump -h 127.0.0.1 -U $dbUser -d $databaseName -Fc -f $backupPath
if ($LASTEXITCODE -ne 0) { throw 'Backup failed; stop here' }
foreach ($migration in @('RW_001_customer_details_onboarding', 'RW_002_job_integrity', 'RW_003_request_idempotency')) {
    psql -h 127.0.0.1 -U $dbUser -d $databaseName -v ON_ERROR_STOP=1 -f "backend\migrations\$migration.sql"
    if ($LASTEXITCODE -ne 0) { throw "Migration failed: $migration; do not restart writes" }
}
& .\backend\.venv\Scripts\python.exe backend\tools\check_runtime.py
if ($LASTEXITCODE -ne 0) { throw 'Runtime preflight failed' }
```

Start the backend in its own PowerShell window:

```powershell
Set-Location C:\TechExpertMarketplace\backend
& .\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Start each frontend in a separate PowerShell window:

```powershell
Set-Location C:\TechExpertMarketplace\customer_app
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

```powershell
Set-Location C:\TechExpertMarketplace\technician_app
npm run dev -- --host 127.0.0.1 --port 5174 --strictPort
```

```powershell
Set-Location C:\TechExpertMarketplace\admin_panel
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

For local validation, request the API health and actual service catalog:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/services
```

Health alone does not check database readiness. Inspect backend logs for technician-presence worker errors. Frontend API URLs default to the local backend. Each app now supports `VITE_API_BASE_URL` in its own ignored `.env.local`. For a phone accessing your Windows computer, configure a reachable API address, bind development servers deliberately to your LAN, and set explicit comma-separated `CORS_ORIGINS` in backend/.env. Browser geolocation requires a secure context; use a controlled HTTPS development arrangement or the confirmed manual-coordinate fallback. No deployment or public access has been configured here.

## Automated tests

Standard backend tests (the PostGIS integration tests skip unless explicitly configured):

```powershell
Set-Location C:\TechExpertMarketplace\backend
& .\.venv\Scripts\python.exe -m pytest tests -q
```

To exercise the real SQL/migrations/concurrency flows on a **separate disposable local server**, with Docker Desktop running:

```powershell
docker run -d --name setu-readiness-test-db -p 127.0.0.1:55432:5432 -e POSTGRES_HOST_AUTH_METHOD=trust -e POSTGRES_DB=setu_test postgis/postgis@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5
docker exec setu-readiness-test-db pg_isready -U postgres -d setu_test
# Wait for "accepting connections" before continuing.
$env:SETU_TEST_ADMIN_URL = 'postgresql://postgres@127.0.0.1:55432/setu_test'
Set-Location C:\TechExpertMarketplace\backend
& .\.venv\Scripts\python.exe -m pytest tests -q
Remove-Item Env:SETU_TEST_ADMIN_URL
docker stop setu-readiness-test-db
docker rm setu-readiness-test-db
```

Trust authentication above is only for that disposable loopback-bound test container. Never use it for application data. The fixture creates and drops only its randomly named `setu_test_*` database. It applies old and new migrations to the synthetic base, then sends requests through FastAPI with actual JWT verification and SQLAlchemy/psycopg sessions. Admin approval is emulated by fixture SQL; this does not validate the administrator review UI/API.

With all three dev servers running, run mobile Chromium interaction checks:

```powershell
Set-Location C:\TechExpertMarketplace\tests\browser
npm ci
npx playwright install chromium
npm test
```

These browser checks use explicitly synthetic API fixtures and a 390×844 viewport. They verify forms, saved drafts, Hindi toggle, offline messaging, notification navigation, manual location, session handling and horizontal overflow. They do not prove live end-to-end browser/database behavior or performance on low-cost Android hardware. On Linux with system Chromium, set `CHROMIUM_PATH=/usr/bin/chromium` before running. Shared UI lint can be run from the repository root with `customer_app\node_modules\.bin\eslint.cmd --config shared\eslint.config.mjs shared`.

## Customer and technician acceptance checklist

- Register with neither optional field, either one alone, and both. Reject invalid email and future DOB; verify a leap-day calendar date stays unchanged. Existing accounts still sign in by their previous identifiers/passwords.
- Edit/clear optional Profile details, reload, and confirm only the owner can access them. Technician matching, job details, notifications and JWTs must never include customer DOB.
- Create a technician account without work details. Save progress, close/reopen, resume, search services and submit. In two tabs, a stale save must return a conflict. Invalid/revoked selections must fail server validation. An unapproved technician must not see jobs or go online.
- As a real admin in a development database, review the application, record phone verification, KYC and address checks, and approve. Confirm every existing audit/role restriction works. Test rejection and requests for corrections; self-service editing after formal submission is still a remaining gap.
- Deny GPS permission on both apps; use verified manual work/current-position coordinates. Check stale location exclusion. Move the technician and reconfirm location. Review each permission explanation before granting access.
- Create a request with photos. Simulate an interrupted submission, retry the same request, and confirm only one request exists. Review private photo access, compression, invalid-file rejection and partial-upload recovery.
- Match, assign, accept, travel, arrive, agree on price, obtain the customer's Start PIN, start work, add completion summary, request review, obtain Happy Code, complete and rate. Reject invalid transitions and a second conflicting assignment. Never give codes before their intended action.
- Submit an incorrect code five times; verify persistent lockout, no bypass by regeneration, no leaked code in errors, history, dashboard or inbox. Confirm expired/session-revoked users cannot mutate jobs.
- Technician receives a rating inbox notification, opens the actual review, sees its score/text and the true average/count, then refreshes. Another customer cannot read that job review.
- Check 320–390px screens, keyboard-only focus, Hindi labels, slow/reconnecting connections, expired login and retry states. No screen should promise offline submission.

## Prioritized remaining launch blockers

1. **Supported fresh-database bootstrap and first-administrator provisioning.** There is no authoritative legacy schema export in the repository. The integration fixture is not a substitute. Complete schema review, production constraints, migrations and initial-admin workflow before creating a real installation.
2. **Deployment/runtime configuration and live acceptance.** Provision PostgreSQL/PostGIS, stable private signing keys, HTTPS/origin configuration, private persistent photo storage/backups and test actual administrator review and customer/technician browser flows. This change is not a deployment.
3. **Abuse controls and operational visibility.** Add reviewed per-account/IP rate limits for login/registration, notification/outbox failure telemetry if external delivery is introduced, retention for drafts/idempotency responses, monitoring and recovery procedures. Current inbox notifications commit atomically; there is no external delivery status/retry system to inspect.
4. **Onboarding correction flow and localization coverage.** Existing admin correction reasons are visible, but self-service amendments to an already-submitted application are not introduced here. Translate remaining legacy screens and catalog names with reviewed Hindi wording. Do not invent translations of official service names silently.
5. **Product/operational decisions.** Customer support contact/escalation, cancellation policy, payments/platform-fee policy, private-data retention/consent and on-device usability/performance still need product acceptance. No paid services or pretend OTP verification were added.

## Recorded validation results

Current cloud instance, Linux, Python 3.12.14, Node.js 24.19.0, Chromium 154, PostgreSQL 16/PostGIS 3.4:

- Backend: **144 passed**, including the original 115 tests, 27 validation/privacy/compatibility tests and two real PostGIS integration scenarios with many workflow/concurrency/lockout assertions. The integration scenarios ran; they were not skipped. Two dependency deprecation warnings remain (Starlette TestClient/httpx and passlib/crypt).
- All three frontends: ESLint and Vite production builds passed. Shared UI lint and browser-test syntax checks passed.
- Chromium: **seven scenarios passed** at 390×844, using explicit mocked API fixtures: customer signup with/without optional details; Profile edit/Hindi/offline banner; technician saved-draft resume and submission; denied GPS/manual position; rating-notification navigation; slow temporary failure and expired sessions.
- Original and new incremental migrations applied against the synthetic PostGIS test base; the three new migrations also reapplied without losing fixture records. Concurrent acceptance and duplicate ratings produced one success and one conflict. Five incorrect Start PIN/Happy Code attempts caused persistent lockout; correct codes remained blocked during lockout.
- Local configuration helper ran twice and preserved the existing file byte-for-byte on the second run. It generated signing keys without printing values. Runtime preflight currently stops with **Missing configuration: DATABASE_URL**.
- Mobile login/registration appearance inspected in Chromium. No real Android device, Windows runtime, live administrator-review UI, production schema compatibility, production deployment, external notification delivery, or real user contact was tested. PowerShell commands are provided for Windows acceptance; they were not executed on Windows.

No application data was changed. Test inbox notifications stayed in disposable databases. Repository dependency lockfiles were preserved; browser tests have their own small pinned development dependency/lockfile. No paid integration, public publication or deployment was performed.
