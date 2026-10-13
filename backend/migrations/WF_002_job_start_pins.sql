BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.job_start_pins (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL UNIQUE
        REFERENCES public.jobs(id) ON DELETE RESTRICT,
    issued_by uuid NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    generation integer NOT NULL DEFAULT 1,
    nonce uuid NOT NULL DEFAULT gen_random_uuid(),
    pin_verifier varchar(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    failed_attempts smallint NOT NULL DEFAULT 0,
    locked_until timestamp with time zone,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT job_start_pin_generation_check
        CHECK (generation >= 1),
    CONSTRAINT job_start_pin_verifier_check
        CHECK (pin_verifier ~ '^[a-f0-9]{64}$'),
    CONSTRAINT job_start_pin_attempts_check
        CHECK (failed_attempts BETWEEN 0 AND 5),
    CONSTRAINT job_start_pin_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT job_start_pin_consumed_check
        CHECK (consumed_at IS NULL OR consumed_at >= created_at),
    CONSTRAINT job_start_pin_lock_check
        CHECK (locked_until IS NULL OR failed_attempts = 5)
);

COMMENT ON TABLE public.job_start_pins IS
    'Single-use customer Start PIN verifiers. Never store plaintext PINs.';

COMMENT ON COLUMN public.job_start_pins.pin_verifier IS
    'HMAC-SHA256 verifier bound to job, generation and nonce; secret held outside database.';

COMMIT;
