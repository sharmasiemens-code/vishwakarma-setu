BEGIN;
SET LOCAL lock_timeout = '10s';

ALTER TABLE public.admin_audit_logs
    DROP CONSTRAINT admin_audit_logs_action_check,
    ADD CONSTRAINT admin_audit_logs_action_check CHECK (
        action IN (
            'ADMIN_ROLE_ASSIGNED',
            'ADMIN_USER_CREATED',
            'ADMIN_USER_STATUS_CHANGED',
            'TECHNICIAN_ACCOUNT_STATUS_CHANGED',
            'TECHNICIAN_KYC_STATUS_CHANGED',
            'SYSTEM_SETTING_CHANGED',
            'JOB_DISPUTE_REVIEW_STARTED',
            'JOB_DISPUTE_RESOLVED',
            'TECHNICIAN_PHONE_VERIFIED',
            'TECHNICIAN_ADDRESS_VERIFIED',
            'TECHNICIAN_APPLICATION_STATUS_CHANGED'
        )
    ),
    DROP CONSTRAINT admin_audit_logs_target_type_check,
    ADD CONSTRAINT admin_audit_logs_target_type_check CHECK (
        target_type IN (
            'USER', 'TECHNICIAN', 'TECHNICIAN_KYC',
            'SYSTEM_SETTING', 'JOB_DISPUTE', 'TECHNICIAN_APPLICATION'
        )
    );

COMMIT;
