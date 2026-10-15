BEGIN;
SET LOCAL lock_timeout = '10s';
CREATE TABLE public.push_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    installation_id UUID NOT NULL UNIQUE,
    user_id UUID NOT NULL REFERENCES public.users(id),
    token TEXT NOT NULL UNIQUE CHECK (length(token) BETWEEN 20 AND 4096),
    auth_version INTEGER NOT NULL CHECK (auth_version >= 0),
    active BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX push_devices_user_idx ON public.push_devices(user_id) WHERE active;
CREATE TABLE public.push_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id UUID NOT NULL REFERENCES public.notifications(id) ON DELETE CASCADE,
    device_id UUID NOT NULL REFERENCES public.push_devices(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.users(id),
    auth_version INTEGER NOT NULL,
    state VARCHAR(20) NOT NULL DEFAULT 'PENDING'
        CHECK (state IN ('PENDING', 'SENT', 'SKIPPED', 'FAILED')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '15 minutes',
    last_error_code VARCHAR(80),
    completed_at TIMESTAMPTZ,
    UNIQUE(notification_id, device_id)
);
CREATE INDEX push_outbox_pending_idx ON public.push_outbox(next_attempt_at) WHERE state = 'PENDING';
CREATE FUNCTION public.queue_android_push() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO public.push_outbox (notification_id, device_id, user_id, auth_version)
    SELECT NEW.id, d.id, d.user_id, d.auth_version
    FROM public.push_devices d JOIN public.users u ON u.id = d.user_id
    WHERE d.user_id = NEW.user_id AND d.active AND u.is_active
      AND u.role = 'TECHNICIAN' AND d.auth_version = u.password_version;
    RETURN NEW;
END $$;
CREATE TRIGGER notifications_queue_android_push AFTER INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.queue_android_push();
COMMIT;
