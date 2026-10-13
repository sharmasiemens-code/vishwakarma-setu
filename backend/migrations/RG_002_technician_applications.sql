BEGIN;
SET LOCAL lock_timeout = '10s';

CREATE TABLE public.technician_applications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    technician_id uuid NOT NULL UNIQUE
        REFERENCES public.technicians(id) ON DELETE RESTRICT,
    date_of_birth date NOT NULL,
    gender varchar(20) NOT NULL,
    address_line1 varchar(300) NOT NULL,
    address_line2 varchar(300),
    city varchar(100) NOT NULL,
    state varchar(100) NOT NULL,
    pincode varchar(6) NOT NULL,
    work_area varchar(300) NOT NULL,
    status varchar(30) NOT NULL DEFAULT 'SUBMITTED',
    version integer NOT NULL DEFAULT 1,
    review_reason varchar(1000),
    reviewed_by uuid REFERENCES public.users(id) ON DELETE RESTRICT,
    reviewed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),

    CONSTRAINT technician_application_gender_check
        CHECK (gender IN ('MALE', 'FEMALE', 'OTHER')),
    CONSTRAINT technician_application_status_check
        CHECK (status IN (
            'SUBMITTED', 'UNDER_REVIEW', 'APPROVED',
            'REJECTED', 'RESUBMISSION_REQUIRED'
        )),
    CONSTRAINT technician_application_version_check CHECK (version >= 1),
    CONSTRAINT technician_application_age_check CHECK (
        date_of_birth >= DATE '1900-01-01'
        AND date_of_birth <= (
            (created_at AT TIME ZONE 'Asia/Kolkata')::date
            - INTERVAL '18 years'
        )::date
    ),
    CONSTRAINT technician_application_address_check
        CHECK (char_length(btrim(address_line1)) BETWEEN 3 AND 300),
    CONSTRAINT technician_application_city_check
        CHECK (char_length(btrim(city)) BETWEEN 2 AND 100),
    CONSTRAINT technician_application_state_check
        CHECK (char_length(btrim(state)) BETWEEN 2 AND 100),
    CONSTRAINT technician_application_area_check
        CHECK (char_length(btrim(work_area)) BETWEEN 3 AND 300),
    CONSTRAINT technician_application_pincode_check
        CHECK (pincode ~ '^[1-9][0-9]{5}$'),
    CONSTRAINT technician_application_review_pair_check CHECK (
        (reviewed_by IS NULL AND reviewed_at IS NULL)
        OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    ),
    CONSTRAINT technician_application_decision_check CHECK (
        status NOT IN ('APPROVED', 'REJECTED', 'RESUBMISSION_REQUIRED')
        OR (
            reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
            AND review_reason IS NOT NULL
            AND char_length(btrim(review_reason)) BETWEEN 3 AND 1000
        )
    )
);

CREATE INDEX technician_applications_status_created_idx
    ON public.technician_applications (status, created_at DESC, id DESC);

CREATE TABLE public.technician_application_services (
    application_id uuid NOT NULL
        REFERENCES public.technician_applications(id) ON DELETE RESTRICT,
    service_id uuid NOT NULL
        REFERENCES public.services(id) ON DELETE RESTRICT,
    PRIMARY KEY (application_id, service_id)
);

COMMENT ON TABLE public.technician_applications IS
    'Self-submitted technician onboarding details. Application approval requires manual phone verification and KYC approval enforced by the application.';

COMMENT ON TABLE public.technician_application_services IS
    'Services selected during technician onboarding; categories are derived from the selected services.';

INSERT INTO public.admin_permissions (code, description)
VALUES
    ('technician_applications.read', 'View technician registration applications'),
    ('technician_applications.review', 'Review technician applications and record manual phone verification')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.admin_role_permissions (role_code, permission_code)
VALUES
    ('SUPER_ADMIN', 'technician_applications.read'),
    ('SUPER_ADMIN', 'technician_applications.review')
ON CONFLICT DO NOTHING;

COMMIT;
