-- Apply after all existing C30/C31/RG/WF migrations, before restarting backend.
BEGIN;
SET LOCAL lock_timeout = '10s';
ALTER TABLE public.users ADD COLUMN password_version INTEGER NOT NULL DEFAULT 0
    CHECK (password_version >= 0);
INSERT INTO public.admin_permissions (code, description)
VALUES ('passwords.reset', 'Search customer/technician accounts and manually reset passwords');
INSERT INTO public.admin_role_permissions (role_code, permission_code)
VALUES ('SUPER_ADMIN', 'passwords.reset');
-- Preserve all previously installed audit actions.
DO $$
DECLARE previous_expression TEXT;
BEGIN
    SELECT pg_get_expr(conbin, conrelid) INTO STRICT previous_expression
    FROM pg_constraint
    WHERE conrelid = 'public.admin_audit_logs'::regclass
      AND conname = 'admin_audit_logs_action_check';
    ALTER TABLE public.admin_audit_logs DROP CONSTRAINT admin_audit_logs_action_check;
    EXECUTE format('ALTER TABLE public.admin_audit_logs ADD CONSTRAINT admin_audit_logs_action_check CHECK ((%s) OR action = %L)', previous_expression, 'USER_PASSWORD_RESET');
END $$;
COMMIT;
