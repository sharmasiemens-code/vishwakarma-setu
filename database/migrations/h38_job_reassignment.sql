-- H38: Allow job reassignment after cancellation/rejection.
-- Preserve historical CANCELLED/COMPLETED jobs while allowing
-- only one active job per service request.

ALTER TABLE jobs
DROP CONSTRAINT IF EXISTS jobs_service_request_id_key;

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_one_active_per_service_request
ON jobs (service_request_id)
WHERE status IN (
    'ASSIGNED',
    'ACCEPTED',
    'ON_THE_WAY',
    'ARRIVED',
    'IN_PROGRESS'
);
