BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.job_completion_requests
    DROP CONSTRAINT completion_request_status_check,
    ADD CONSTRAINT completion_request_status_check CHECK (
        status IN (
            'REQUESTED',
            'APPROVED',
            'ISSUE_REPORTED',
            'WORK_RESUMED',
            'COMPLETED'
        )
    );

COMMENT ON COLUMN public.job_completion_requests.status IS
    'WORK_RESUMED requires a fresh technician completion request before customer approval.';

COMMIT;
