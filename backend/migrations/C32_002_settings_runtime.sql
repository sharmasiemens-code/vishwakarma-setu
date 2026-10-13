-- Safe activation after existing workflow/password migrations.
-- Keep existing C32 values and all installed audit actions/targets.
BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TABLE IF NOT EXISTS public.system_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key VARCHAR(100) NOT NULL UNIQUE,
    value INTEGER NOT NULL,
    version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_by UUID REFERENCES public.users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT system_settings_key_value_check CHECK (
        (key = 'gps_timeout_minutes' AND value BETWEEN 5 AND 60)
        OR (key = 'unmatched_request_minutes' AND value BETWEEN 5 AND 1440)
        OR (key = 'stuck_active_job_hours' AND value BETWEEN 1 AND 168)
    )
);
INSERT INTO public.system_settings (key, value) VALUES
    ('gps_timeout_minutes', 10),
    ('unmatched_request_minutes', 30),
    ('stuck_active_job_hours', 2)
ON CONFLICT (key) DO NOTHING;
INSERT INTO public.admin_permissions (code, description) VALUES
    ('settings.read', 'View operational system settings'),
    ('settings.write', 'Update operational system settings')
ON CONFLICT (code) DO NOTHING;
INSERT INTO public.admin_role_permissions (role_code, permission_code) VALUES
    ('SUPER_ADMIN', 'settings.read'), ('SUPER_ADMIN', 'settings.write')
ON CONFLICT DO NOTHING;
DO $$
DECLARE previous_expression TEXT;
BEGIN
    SELECT pg_get_expr(conbin, conrelid) INTO STRICT previous_expression
    FROM pg_constraint WHERE conrelid = 'public.admin_audit_logs'::regclass
        AND conname = 'admin_audit_logs_action_check';
    ALTER TABLE public.admin_audit_logs DROP CONSTRAINT admin_audit_logs_action_check;
    EXECUTE format('ALTER TABLE public.admin_audit_logs ADD CONSTRAINT admin_audit_logs_action_check CHECK ((%s) OR action = %L)', previous_expression, 'SYSTEM_SETTING_CHANGED');
    SELECT pg_get_expr(conbin, conrelid) INTO STRICT previous_expression
    FROM pg_constraint WHERE conrelid = 'public.admin_audit_logs'::regclass
        AND conname = 'admin_audit_logs_target_type_check';
    ALTER TABLE public.admin_audit_logs DROP CONSTRAINT admin_audit_logs_target_type_check;
    EXECUTE format('ALTER TABLE public.admin_audit_logs ADD CONSTRAINT admin_audit_logs_target_type_check CHECK ((%s) OR target_type = %L)', previous_expression, 'SYSTEM_SETTING');
    IF (SELECT COUNT(*) FROM public.system_settings) <> 3 OR EXISTS (
        SELECT 1 FROM public.system_settings WHERE NOT (
            (key = 'gps_timeout_minutes' AND value BETWEEN 5 AND 60)
            OR (key = 'unmatched_request_minutes' AND value BETWEEN 5 AND 1440)
            OR (key = 'stuck_active_job_hours' AND value BETWEEN 1 AND 168)
        ) OR version < 1
    ) THEN
        RAISE EXCEPTION 'Existing settings are invalid; activation rolled back';
    END IF;
END $$;
COMMIT;
