BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TABLE IF NOT EXISTS public.service_request_idempotency (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    request_key uuid NOT NULL,
    payload_hash char(64) NOT NULL,
    response jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (user_id, request_key)
);
COMMIT;
