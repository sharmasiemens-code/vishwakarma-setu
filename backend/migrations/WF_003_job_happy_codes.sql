BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.job_completion_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL UNIQUE
        REFERENCES public.jobs(id) ON DELETE RESTRICT,
    requested_by uuid NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    status varchar(30) NOT NULL DEFAULT 'REQUESTED',
    requested_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    approved_by uuid
        REFERENCES public.users(id) ON DELETE RESTRICT,
    approved_at timestamp with time zone,
    completed_at timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT completion_request_status_check
        CHECK (status IN (
            'REQUESTED', 'APPROVED', 'ISSUE_REPORTED', 'COMPLETED'
        )),
    CONSTRAINT completion_request_approval_pair_check
        CHECK (
            (approved_by IS NULL AND approved_at IS NULL)
            OR
            (approved_by IS NOT NULL AND approved_at IS NOT NULL)
        ),
    CONSTRAINT completion_request_approval_check
        CHECK (
            status NOT IN ('APPROVED', 'COMPLETED')
            OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)
        ),
    CONSTRAINT completion_request_completed_check
        CHECK (
            (status = 'COMPLETED' AND completed_at IS NOT NULL)
            OR
            (status <> 'COMPLETED' AND completed_at IS NULL)
        )
);

CREATE TABLE public.job_happy_codes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL UNIQUE
        REFERENCES public.job_completion_requests(job_id) ON DELETE RESTRICT,
    issued_by uuid NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    generation integer NOT NULL DEFAULT 1,
    nonce uuid NOT NULL DEFAULT gen_random_uuid(),
    code_verifier varchar(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    failed_attempts smallint NOT NULL DEFAULT 0,
    locked_until timestamp with time zone,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT happy_code_generation_check
        CHECK (generation >= 1),
    CONSTRAINT happy_code_verifier_check
        CHECK (code_verifier ~ '^[a-f0-9]{64}$'),
    CONSTRAINT happy_code_attempts_check
        CHECK (failed_attempts BETWEEN 0 AND 5),
    CONSTRAINT happy_code_expiry_check
        CHECK (expires_at > created_at),
    CONSTRAINT happy_code_consumed_check
        CHECK (consumed_at IS NULL OR consumed_at >= created_at),
    CONSTRAINT happy_code_lock_check
        CHECK (locked_until IS NULL OR failed_attempts = 5)
);

COMMENT ON TABLE public.job_completion_requests IS
    'Customer review of technician-requested completion; job stays active until code verification.';

COMMENT ON TABLE public.job_happy_codes IS
    'Single-use Happy Code HMAC verifiers. Never store plaintext codes.';

COMMIT;
