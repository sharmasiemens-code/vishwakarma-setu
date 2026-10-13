BEGIN;

SET LOCAL lock_timeout = '10s';

-- Return a canonical Indian mobile number, or NULL for other formats.
CREATE FUNCTION public.registration_mobile_key(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $function$
    WITH cleaned AS (
        SELECT regexp_replace(value, '[^0-9]', '', 'g') AS digits
        WHERE btrim(value) ~ '^[+0-9 ()-]+$'
    ),
    normalized AS (
        SELECT CASE
            WHEN length(digits) = 12 AND left(digits, 2) = '91'
                THEN substring(digits FROM 3)
            WHEN length(digits) = 11 AND left(digits, 1) = '0'
                THEN substring(digits FROM 2)
            ELSE digits
        END AS mobile
        FROM cleaned
    )
    SELECT CASE
        WHEN mobile ~ '^[6-9][0-9]{9}$' THEN mobile
        ELSE NULL
    END
    FROM normalized;
$function$;

-- Prevent concurrent account changes during duplicate checking/index creation.
LOCK TABLE public.users IN SHARE ROW EXCLUSIVE MODE;

DO $block$
BEGIN
    IF EXISTS (
        SELECT public.registration_mobile_key(phone)
        FROM public.users
        WHERE public.registration_mobile_key(phone) IS NOT NULL
        GROUP BY public.registration_mobile_key(phone)
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Existing accounts share a normalized mobile number. Resolve duplicates before applying registration migration.';
    END IF;
END;
$block$;

CREATE UNIQUE INDEX users_registration_mobile_unique
    ON public.users (public.registration_mobile_key(phone));

ALTER TABLE public.users
    ADD COLUMN phone_verified_at timestamptz,
    ADD COLUMN phone_verified_by uuid
        REFERENCES public.users(id) ON DELETE RESTRICT,
    ADD CONSTRAINT users_phone_verification_pair_check CHECK (
        (phone_verified_at IS NULL AND phone_verified_by IS NULL)
        OR
        (phone_verified_at IS NOT NULL AND phone_verified_by IS NOT NULL)
    );

COMMENT ON COLUMN public.users.phone_verified_at IS
    'Manual phone verification timestamp. NULL means phone ownership has not been verified. Existing account eligibility does not establish phone ownership.';

COMMENT ON COLUMN public.users.phone_verified_by IS
    'Administrator who recorded manual phone verification. Administrator authorization must be enforced by the application.';

COMMENT ON FUNCTION public.registration_mobile_key(text) IS
    'Canonical Indian mobile number for registration uniqueness; accepts local, country-code and leading-zero formats.';

COMMIT;
