BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE public.job_price_revisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE RESTRICT,
    proposed_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    previous_amount numeric(12,2),
    proposed_amount numeric(12,2) NOT NULL,
    reason varchar(1000) NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'PENDING',
    version integer NOT NULL DEFAULT 1,
    decided_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
    decided_at timestamptz,
    decision_reason varchar(1000),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT price_revision_amount_check CHECK (
        proposed_amount > 0
        AND proposed_amount <> 'NaN'::numeric
        AND (
            previous_amount IS NULL
            OR (
                previous_amount >= 0
                AND previous_amount <> 'NaN'::numeric
                AND proposed_amount > previous_amount
            )
        )
    ),
    CONSTRAINT price_revision_reason_check CHECK (
        char_length(btrim(reason)) BETWEEN 10 AND 1000
    ),
    CONSTRAINT price_revision_status_check CHECK (
        status IN ('PENDING', 'APPROVED', 'DECLINED', 'WITHDRAWN')
    ),
    CONSTRAINT price_revision_version_check CHECK (version >= 1),
    CONSTRAINT price_revision_decision_check CHECK (
        (
            status = 'PENDING'
            AND decided_by IS NULL
            AND decided_at IS NULL
            AND decision_reason IS NULL
        )
        OR (
            status IN ('APPROVED', 'DECLINED', 'WITHDRAWN')
            AND decided_by IS NOT NULL
            AND decided_at IS NOT NULL
            AND decided_at >= created_at
        )
    ),
    CONSTRAINT price_revision_decision_reason_check CHECK (
        decision_reason IS NULL
        OR char_length(btrim(decision_reason)) BETWEEN 3 AND 1000
    ),
    CONSTRAINT price_revision_withdrawal_actor_check CHECK (
        status <> 'WITHDRAWN' OR decided_by = proposed_by
    )
);

CREATE UNIQUE INDEX job_price_revisions_one_pending_per_job
    ON public.job_price_revisions (job_id)
    WHERE status = 'PENDING';

CREATE INDEX job_price_revisions_job_created_idx
    ON public.job_price_revisions (job_id, created_at DESC, id DESC);

COMMENT ON TABLE public.job_price_revisions IS
    'Pre-start price increase proposals. Customer approval is required; historical proposals are retained.';

COMMENT ON COLUMN public.job_price_revisions.previous_amount IS
    'Agreed job estimate at proposal time; NULL means no previous estimate was recorded.';

COMMENT ON COLUMN public.job_price_revisions.proposed_amount IS
    'Proposed total job price, not an additional charge.';

COMMIT;
