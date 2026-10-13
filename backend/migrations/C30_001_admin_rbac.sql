BEGIN;

SET LOCAL lock_timeout = '10s';

-- Abort unless the administrator identified during the audit
-- still exists and remains active and verified.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.users
        WHERE id = '97db8fe2-4424-4cfc-af70-2cf4342369a1'
          AND role = 'ADMIN'
          AND is_active = TRUE
          AND is_verified = TRUE
    ) THEN
        RAISE EXCEPTION
            'Existing administrator validation failed. Migration aborted.';
    END IF;
END
$$;

CREATE TABLE public.admin_roles (
    code VARCHAR(40) PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.admin_permissions (
    code VARCHAR(100) PRIMARY KEY,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE public.admin_role_permissions (
    role_code VARCHAR(40) NOT NULL
        REFERENCES public.admin_roles(code),
    permission_code VARCHAR(100) NOT NULL
        REFERENCES public.admin_permissions(code),
    PRIMARY KEY (role_code, permission_code)
);

-- One administrative role per user.
-- Backend validation will also require users.role = 'ADMIN'.
CREATE TABLE public.admin_user_roles (
    user_id UUID PRIMARY KEY
        REFERENCES public.users(id),
    role_code VARCHAR(40) NOT NULL
        REFERENCES public.admin_roles(code),
    assigned_by UUID NOT NULL
        REFERENCES public.users(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_user_roles_role_code_idx
    ON public.admin_user_roles(role_code);

INSERT INTO public.admin_roles (code, name, description)
VALUES
    (
        'SUPER_ADMIN',
        'Super Admin',
        'Full administrative access, including administrator roles and accounts.'
    ),
    (
        'OPERATIONS_ADMIN',
        'Operations Admin',
        'Marketplace operations, technician account controls and master data.'
    ),
    (
        'KYC_VERIFIER',
        'KYC Verifier',
        'Review technician KYC and record verification decisions.'
    ),
    (
        'SUPPORT_ADMIN',
        'Support Admin',
        'Read operational summaries, notifications and exceptions for support.'
    ),
    (
        'FINANCE_ADMIN',
        'Finance Admin',
        'Reserved for finance modules; no operational access granted in C30.'
    );

INSERT INTO public.admin_permissions (code, description)
VALUES
    ('dashboard.read', 'Read marketplace dashboard statistics'),
    ('technicians.read', 'Read technician list and profile details'),
    ('technicians.account_status.write', 'Enable or disable technician accounts'),
    ('kyc.read', 'Read technician KYC list and details'),
    ('kyc.write', 'Record technician KYC decisions'),
    ('skills.read', 'Read skills'),
    ('skills.write', 'Create or update skills'),
    ('tools.read', 'Read tools'),
    ('tools.write', 'Create or update tools'),
    ('categories.read', 'Read service categories'),
    ('categories.write', 'Create or update service categories'),
    ('services.read', 'Read services'),
    ('services.write', 'Create or update services'),
    ('service_skills.read', 'Read service-to-skill mappings'),
    ('service_skills.write', 'Update service-to-skill mappings'),
    ('service_tools.read', 'Read service-to-tool mappings'),
    ('service_tools.write', 'Update service-to-tool mappings'),
    ('locations.read', 'Read technician locations'),
    ('availability.read', 'Read technician availability'),
    ('notifications.read', 'Read administrative notifications'),
    ('exceptions.read', 'Read operational exceptions'),
    ('admin_users.read', 'Read administrator accounts'),
    ('admin_users.create', 'Create administrator accounts'),
    ('admin_users.status.write', 'Enable or disable administrator accounts'),
    ('roles.read', 'Read administrative roles and permission definitions'),
    ('roles.assign', 'Assign administrative roles');

-- Super Admin receives every permission defined by this migration.
-- Future permissions must be granted explicitly by later migrations.
INSERT INTO public.admin_role_permissions (
    role_code,
    permission_code
)
SELECT 'SUPER_ADMIN', code
FROM public.admin_permissions;

INSERT INTO public.admin_role_permissions (
    role_code,
    permission_code
)
SELECT 'OPERATIONS_ADMIN', code
FROM public.admin_permissions
WHERE code IN (
    'dashboard.read',
    'technicians.read',
    'technicians.account_status.write',
    'skills.read',
    'skills.write',
    'tools.read',
    'tools.write',
    'categories.read',
    'categories.write',
    'services.read',
    'services.write',
    'service_skills.read',
    'service_skills.write',
    'service_tools.read',
    'service_tools.write',
    'locations.read',
    'availability.read',
    'notifications.read',
    'exceptions.read'
);

INSERT INTO public.admin_role_permissions (
    role_code,
    permission_code
)
VALUES
    ('KYC_VERIFIER', 'kyc.read'),
    ('KYC_VERIFIER', 'kyc.write'),
    ('SUPPORT_ADMIN', 'dashboard.read'),
    ('SUPPORT_ADMIN', 'notifications.read'),
    ('SUPPORT_ADMIN', 'exceptions.read');

-- No default role assignment and no automatic promotion
-- of other existing or newly created administrators.
INSERT INTO public.admin_user_roles (
    user_id,
    role_code,
    assigned_by
)
VALUES (
    '97db8fe2-4424-4cfc-af70-2cf4342369a1',
    'SUPER_ADMIN',
    '97db8fe2-4424-4cfc-af70-2cf4342369a1'
);

COMMIT;