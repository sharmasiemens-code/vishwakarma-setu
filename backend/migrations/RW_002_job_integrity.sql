BEGIN;
SET LOCAL lock_timeout = '10s';

-- Never silently delete/merge existing jobs or reviews. If legacy duplicates
-- exist, this transaction aborts so an administrator can investigate them.
CREATE UNIQUE INDEX IF NOT EXISTS rw_ratings_one_per_job ON public.ratings(job_id);
CREATE UNIQUE INDEX IF NOT EXISTS rw_jobs_one_active_per_technician
    ON public.jobs(technician_id)
    WHERE status IN ('ASSIGNED','ACCEPTED','ON_THE_WAY','ARRIVED','IN_PROGRESS');
CREATE INDEX IF NOT EXISTS rw_ratings_technician_created
    ON public.ratings(technician_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS rw_jobs_technician_status
    ON public.jobs(technician_id, status);
COMMIT;
