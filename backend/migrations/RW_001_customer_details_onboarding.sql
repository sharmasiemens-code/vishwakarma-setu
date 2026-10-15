BEGIN;
SET LOCAL lock_timeout = '10s';

-- Additive: existing customers keep NULL and can continue signing in unchanged.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS date_of_birth date;
COMMENT ON COLUMN public.customers.date_of_birth IS
    'Optional private customer calendar date. Never include in matching or technician responses.';

-- Drafts are private to the account. Passwords and verification documents are
-- never accepted here. Existing submitted applications remain unchanged.
CREATE TABLE IF NOT EXISTS public.technician_onboarding_drafts (
    technician_id uuid PRIMARY KEY REFERENCES public.technicians(id) ON DELETE RESTRICT,
    details jsonb NOT NULL DEFAULT '{}'::jsonb,
    version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
