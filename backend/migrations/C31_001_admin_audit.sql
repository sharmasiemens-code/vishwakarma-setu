BEGIN;

SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.admin_roles
        WHERE code = 'SUPER_ADMIN'
    ) THEN
        RAISE EXCEPTION 'C30 roles are missing. Migration aborted.';
    END IF;
END
$$;

CREATE TABLE public.admin_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    actor_user_id UUID NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,

    -- Role at the time of the action.
    actor_role_code VARCHAR(40) NOT NULL,

    action VARCHAR(60) NOT NULL
        CHECK (action IN (
            'ADMIN_ROLE_ASSIGNED',
            'ADMIN_USER_CREATED',
            'ADMIN_USER_STATUS_CHANGED',
            'TECHNICIAN_ACCOUNT_STATUS_CHANGED',
            'TECHNICIAN_KYC_STATUS_CHANGED'
        )),

    -- Target identifiers remain available if the target is deleted.
    target_type VARCHAR(40) NOT NULL
        CHECK (target_type IN (
            'USER',
            'TECHNICIAN',
            'TECHNICIAN_KYC'
        )),

    target_id UUID NOT NULL,

    before_values JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (
            jsonb_typeof(before_values) = 'object'
            AND octet_length(before_values::text) <= 16384
        ),

    after_values JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (
            jsonb_typeof(after_values) = 'object'
            AND octet_length(after_values::text) <= 16384
        ),

    reason VARCHAR(1000),

    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX admin_audit_logs_created_idx
    ON public.admin_audit_logs (created_at DESC, id DESC);

CREATE INDEX admin_audit_logs_actor_idx
    ON public.admin_audit_logs (
        actor_user_id, created_at DESC, id DESC
    );

CREATE INDEX admin_audit_logs_target_idx
    ON public.admin_audit_logs (
        target_type, target_id, created_at DESC, id DESC
    );

CREATE INDEX admin_audit_logs_action_idx
    ON public.admin_audit_logs (
        action, created_at DESC, id DESC
    );

-- Reject ordinary SQL attempts to alter or clear audit history.
CREATE FUNCTION public.reject_admin_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION
        'Administrative audit logs are append-only'
        USING ERRCODE = '42501';
END;
$$;

CREATE TRIGGER admin_audit_logs_append_only
BEFORE UPDATE OR DELETE OR TRUNCATE
ON public.admin_audit_logs
FOR EACH STATEMENT
EXECUTE FUNCTION public.reject_admin_audit_mutation();

INSERT INTO public.admin_permissions (code, description)
VALUES (
    'audit.read',
    'Read administrative audit history'
);

INSERT INTO public.admin_role_permissions (
    role_code,
    permission_code
)
VALUES (
    'SUPER_ADMIN',
    'audit.read'
);

COMMIT;