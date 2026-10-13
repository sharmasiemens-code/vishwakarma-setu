BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.jobs
    ADD COLUMN completion_work_summary varchar(2000),
    ADD COLUMN completion_summary_version integer NOT NULL DEFAULT 1,
    ADD CONSTRAINT jobs_completion_summary_length_check CHECK (
        completion_work_summary IS NULL
        OR char_length(btrim(completion_work_summary)) BETWEEN 10 AND 2000
    ),
    ADD CONSTRAINT jobs_completion_summary_version_check CHECK (
        completion_summary_version >= 1
    );

COMMENT ON COLUMN public.jobs.completion_work_summary IS
    'Technician description of the work actually performed, shown to the customer before completion approval.';

COMMENT ON COLUMN public.jobs.completion_summary_version IS
    'Version used to reject approval of a changed completion price sheet.';

INSERT INTO public.admin_permissions (code, description)
VALUES (
    'customers.read',
    'View customer account details and marketplace activity'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_code, permission_code)
VALUES ('SUPER_ADMIN', 'customers.read')
ON CONFLICT DO NOTHING;

COMMIT;
