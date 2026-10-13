# C32 System Settings

Super Admin can change three operational thresholds in Admin Panel → System Settings.
Each change requires a reason and is audited atomically. Existing configured values are preserved.

| Setting | Default | Allowed | Runtime effect |
| --- | --- | --- | --- |
| GPS timeout | 10 minutes | 5–60 minutes | Matching, request summaries/matches, assignment, going ONLINE, presence checks, admin GPS status |
| Unmatched request warning | 30 minutes | 5–1440 minutes | OPEN requests without any job appear in Exceptions after the threshold |
| Stuck active job warning | 2 hours | 1–168 hours | Active jobs without an update appear in Exceptions after the threshold |

Busy technician exclusion and existing active jobs are preserved. The presence worker only moves ONLINE technicians without active jobs to OFFLINE. Updates affect subsequent operations without a backend restart; the presence worker runs approximately once a minute. Increasing the timeout does not automatically bring an OFFLINE technician ONLINE.

## Installation on the existing Windows project

Back up your database using your existing procedure. After retrieving the feature branch, apply **C32_002_settings_runtime.sql**, not the old C32_001 migration, before restarting the updated backend. The new activation migration works with either an existing C32 table or a missing one, preserves existing values, and extends audit constraints without removing workflow/password events.

```powershell
psql -U postgres -d tech_expert_marketplace
```

```sql
\set ON_ERROR_STOP on
\i C:/TechExpertMarketplace/backend/migrations/C32_002_settings_runtime.sql
SELECT key, value, version FROM public.system_settings ORDER BY key;
SELECT role_code, permission_code FROM public.admin_role_permissions
WHERE permission_code IN ('settings.read', 'settings.write') ORDER BY permission_code;
```

The migration should end in COMMIT. Restart the backend/admin Vite server and sign in again to refresh admin permissions. No production database was accessed during development.

## Acceptance checks

1. Open System Settings as Super Admin. Verify three values match the database.
2. Change a warning threshold with a reason. Refresh: value and version persist. Audit Logs includes SYSTEM_SETTING_CHANGED and its before/after snapshots.
3. Check Exceptions: displayed warning thresholds match saved values.
4. Change GPS timeout and confirm Technician Locations describes the same freshness window. Verify matches/assignment respect that window with a test technician. Restore original values after the test.
5. Two admin tabs: change a value in one, then try a different value from the other. The stale save must be rejected and require Reload Settings.
6. Out-of-range, decimal and blank values must be rejected. Restricted admins and customer/technician accounts must not be able to update settings.

Backend automated checks use isolated test doubles for database queries and transactions, including parameter binding, latest values, stale writes, no-op updates, rollback on audit failure, permission rechecks and runtime integration. Live migration and browser acceptance remain pending.
