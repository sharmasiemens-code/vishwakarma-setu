# Manual password recovery

Customers and technicians change their password with their current password.
Forgotten passwords are handled manually in Admin Panel → Password Recovery.
Existing passwords and hashes are never returned. No SMS/email/OTP recovery is added.

## Installation

1. Back up your database using your existing procedure.
2. Apply `backend/migrations/PR_001_password_recovery.sql` after all existing migrations and **before restarting the updated backend**. It adds `users.password_version`, the Super Admin `passwords.reset` permission, and extends the audit constraint without removing existing actions.
3. Restart the backend and three Vite development servers (or build/deploy updated apps).
4. Sign in to the admin panel again to reload permissions.

In psql connected to the existing project database on Windows:

```sql
\set ON_ERROR_STOP on
\i C:/TechExpertMarketplace/backend/migrations/PR_001_password_recovery.sql
```

Apply this migration once. Do not rerun old migrations. This change has not been applied to the live database.

## Administrator workflow

Only Super Admin receives access in this release. Search by name, mobile or email and optionally filter by customer/technician. Select Reset Password, verify the displayed account owner through the registered contact, enter and confirm a new password, enter an audit reason without credentials, and check identity verification. Communicate the password manually through the verified contact. The form clears passwords after success or failure. Inactive accounts and administrator accounts cannot be reset here.

## Customer and technician workflow

Choose Change Password on the dashboard or pending technician application screen, enter the current password and confirm the new one. After success, sign in again. Login screens direct forgotten-password cases to the administrator.

Policy follows registration: 8–72 characters with a letter and number, no surrounding spaces or control characters, maximum 72 UTF-8 bytes for bcrypt. New password must differ from the old one.

## Security and concurrency

Changes increment password_version. Login JWTs include the current version; all previous tokens are rejected after commit. Legacy tokens without the claim work only at version zero. Self-service changes recheck token version under a row lock. Admin resets recheck Super Admin privileges under a lock and compare the version returned by search; stale resets return HTTP 409. Reset and credential-free audit event commit together; audit failures roll back the password update. Already-running requests may complete; subsequent authentication checks deny revoked tokens.

Passwords are not stored in browser storage, audit snapshots, or validation responses.

## Verification

From backend: `python -m pytest tests -q`. In each app: `npm run lint` and `npm run build`.
Tests cover policy, incorrect current passwords, inactive/protected accounts, permission denial, audit rollback, concurrent/stale requests, token revocation, pending technician access, fresh login claims, and validation redaction. Database tests use isolated test doubles. Live PostgreSQL migration and browser acceptance remain pending in the user's environment.

Acceptance: reset a test customer and technician; verify old password/token fail, new login succeeds, self-service change succeeds, and USER_PASSWORD_RESET appears in Audit Logs. Confirm customer/technician accounts cannot call reset APIs.
