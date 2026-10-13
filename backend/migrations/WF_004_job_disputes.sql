BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.job_disputes (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL
        REFERENCES public.jobs(id) ON DELETE RESTRICT,
    reported_by uuid NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    description varchar(2000) NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'OPEN',
    version integer NOT NULL DEFAULT 1,
    resolution_code varchar(40),
    resolution_reason varchar(1000),
    resolved_by uuid
        REFERENCES public.users(id) ON DELETE RESTRICT,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamp with time zone NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT job_dispute_description_check
        CHECK (char_length(btrim(description)) BETWEEN 10 AND 2000),
    CONSTRAINT job_dispute_status_check
        CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED')),
    CONSTRAINT job_dispute_version_check
        CHECK (version >= 1),
    CONSTRAINT job_dispute_resolution_code_check
        CHECK (
            resolution_code IS NULL
            OR resolution_code = 'RETURN_TO_WORK'
        ),
    CONSTRAINT job_dispute_resolution_check
        CHECK (
            (
                status = 'RESOLVED'
                AND resolution_code IS NOT NULL
                AND resolution_reason IS NOT NULL
                AND char_length(btrim(resolution_reason)) BETWEEN 3 AND 1000
                AND resolved_by IS NOT NULL
                AND resolved_at IS NOT NULL
            )
            OR
            (
                status IN ('OPEN', 'UNDER_REVIEW')
                AND resolution_code IS NULL
                AND resolution_reason IS NULL
                AND resolved_by IS NULL
                AND resolved_at IS NULL
            )
        )
);

CREATE UNIQUE INDEX job_disputes_one_open_per_job
    ON public.job_disputes (job_id)
    WHERE status IN ('OPEN', 'UNDER_REVIEW');

CREATE INDEX job_disputes_status_created_idx
    ON public.job_disputes (status, created_at DESC, id DESC);

CREATE INDEX job_disputes_job_created_idx
    ON public.job_disputes (job_id, created_at DESC, id DESC);

COMMENT ON TABLE public.job_disputes IS
    'Customer work issues. Open disputes block normal completion; resolution requires an audited administrator action.';

COMMENT ON COLUMN public.job_disputes.resolution_code IS
    'RETURN_TO_WORK resumes work and requires fresh customer completion approval. It does not complete the job.';

COMMIT;
