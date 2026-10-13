BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO public.admin_permissions (code, description)
VALUES
    ('disputes.read', 'View customer work disputes'),
    ('disputes.resolve', 'Review disputes and return jobs for corrective work')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_code, permission_code)
VALUES
    ('SUPER_ADMIN', 'disputes.read'),
    ('SUPER_ADMIN', 'disputes.resolve')
ON CONFLICT DO NOTHING;

ALTER TABLE public.admin_audit_logs
    DROP CONSTRAINT admin_audit_logs_action_check,
    ADD CONSTRAINT admin_audit_logs_action_check CHECK (
        action IN (
            'ADMIN_ROLE_ASSIGNED',
            'ADMIN_USER_CREATED',
            'ADMIN_USER_STATUS_CHANGED',
            'TECHNICIAN_ACCOUNT_STATUS_CHANGED',
            'TECHNICIAN_KYC_STATUS_CHANGED',
            'SYSTEM_SETTING_CHANGED',
            'JOB_DISPUTE_REVIEW_STARTED',
            'JOB_DISPUTE_RESOLVED'
        )
    ),
    DROP CONSTRAINT admin_audit_logs_target_type_check,
    ADD CONSTRAINT admin_audit_logs_target_type_check CHECK (
        target_type IN (
            'USER', 'TECHNICIAN', 'TECHNICIAN_KYC',
            'SYSTEM_SETTING', 'JOB_DISPUTE'
        )
    );

COMMIT;
