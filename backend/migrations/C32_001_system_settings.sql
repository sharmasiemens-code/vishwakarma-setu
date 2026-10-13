BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.system_settings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    key varchar(100) NOT NULL UNIQUE,
    value integer NOT NULL,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT system_settings_key_value_check CHECK (
        (
            key = 'gps_timeout_minutes'
            AND value BETWEEN 5 AND 60
        )
        OR (
            key = 'unmatched_request_minutes'
            AND value BETWEEN 5 AND 1440
        )
        OR (
            key = 'stuck_active_job_hours'
            AND value BETWEEN 1 AND 168
        )
    )
);

INSERT INTO public.system_settings (key, value)
VALUES
    ('gps_timeout_minutes', 10),
    ('unmatched_request_minutes', 30),
    ('stuck_active_job_hours', 2);

INSERT INTO public.admin_permissions (code, description)
VALUES
    ('settings.read', 'View operational system settings'),
    ('settings.write', 'Update operational system settings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_code, permission_code)
VALUES
    ('SUPER_ADMIN', 'settings.read'),
    ('SUPER_ADMIN', 'settings.write')
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
            'SYSTEM_SETTING_CHANGED'
        )
    ),
    DROP CONSTRAINT admin_audit_logs_target_type_check,
    ADD CONSTRAINT admin_audit_logs_target_type_check CHECK (
        target_type IN (
            'USER',
            'TECHNICIAN',
            'TECHNICIAN_KYC',
            'SYSTEM_SETTING'
        )
    );

COMMIT;
