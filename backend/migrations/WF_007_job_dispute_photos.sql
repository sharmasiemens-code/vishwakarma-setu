BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE TABLE public.job_dispute_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispute_id uuid NOT NULL REFERENCES public.job_disputes(id) ON DELETE RESTRICT,
    uploaded_by uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 5),
    storage_key varchar(100) NOT NULL UNIQUE,
    thumbnail_storage_key varchar(100) NOT NULL UNIQUE,
    content_type varchar(50) NOT NULL CHECK (content_type = 'image/jpeg'),
    original_file_size_bytes integer NOT NULL
        CHECK (original_file_size_bytes BETWEEN 1 AND 5242880),
    file_size_bytes integer NOT NULL
        CHECK (file_size_bytes BETWEEN 1 AND 5242880),
    thumbnail_size_bytes integer NOT NULL
        CHECK (thumbnail_size_bytes BETWEEN 1 AND 1048576),
    width integer NOT NULL CHECK (width BETWEEN 1 AND 1600),
    height integer NOT NULL CHECK (height BETWEEN 1 AND 1600),
    uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT dispute_photo_slot_unique UNIQUE (dispute_id, slot),
    CONSTRAINT dispute_photo_storage_key_check CHECK (
        storage_key ~ '^[a-f0-9]{32}\.jpg$'
        AND thumbnail_storage_key ~ '^[a-f0-9]{32}\.jpg$'
        AND storage_key <> thumbnail_storage_key
    )
);

COMMENT ON TABLE public.job_dispute_photos IS
    'Private sanitized work issue images. Access requires dispute ownership, assigned technician or disputes.read permission.';

COMMIT;
