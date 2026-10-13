BEGIN;

SET LOCAL lock_timeout = '5s';

LOCK TABLE public.service_request_photos IN ACCESS EXCLUSIVE MODE;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.service_request_photos) THEN
        RAISE EXCEPTION
            'Photo table is no longer empty. Inspect records before migration.';
    END IF;
END
$$;

ALTER TABLE public.service_request_photos
    ALTER COLUMN file_url DROP NOT NULL,
    ADD COLUMN uploaded_by uuid NOT NULL
        REFERENCES public.users(id) ON DELETE RESTRICT,
    ADD COLUMN slot smallint NOT NULL,
    ADD COLUMN storage_key varchar(100) NOT NULL,
    ADD COLUMN thumbnail_storage_key varchar(100) NOT NULL,
    ADD COLUMN content_type varchar(50) NOT NULL,
    ADD COLUMN original_file_size_bytes integer NOT NULL,
    ADD COLUMN file_size_bytes integer NOT NULL,
    ADD COLUMN thumbnail_size_bytes integer NOT NULL,
    ADD COLUMN width integer NOT NULL,
    ADD COLUMN height integer NOT NULL,

    ADD CONSTRAINT request_photo_slot_check
        CHECK (slot BETWEEN 1 AND 5),

    ADD CONSTRAINT request_photo_request_slot_unique
        UNIQUE (service_request_id, slot),

    ADD CONSTRAINT request_photo_storage_key_unique
        UNIQUE (storage_key),

    ADD CONSTRAINT request_photo_thumbnail_key_unique
        UNIQUE (thumbnail_storage_key),

    ADD CONSTRAINT request_photo_storage_key_check CHECK (
        storage_key ~ '^[a-f0-9]{32}\.(jpg|png|webp)$'
        AND thumbnail_storage_key ~ '^[a-f0-9]{32}\.(jpg|png|webp)$'
        AND storage_key <> thumbnail_storage_key
    ),

    ADD CONSTRAINT request_photo_content_type_check CHECK (
        content_type IN ('image/jpeg', 'image/png', 'image/webp')
    ),

    ADD CONSTRAINT request_photo_sizes_check CHECK (
        original_file_size_bytes BETWEEN 1 AND 5242880
        AND file_size_bytes BETWEEN 1 AND 5242880
        AND thumbnail_size_bytes BETWEEN 1 AND 1048576
    ),

    ADD CONSTRAINT request_photo_dimensions_check CHECK (
        width BETWEEN 1 AND 4096
        AND height BETWEEN 1 AND 4096
        AND width::bigint * height::bigint <= 16777216
    );

COMMIT;
