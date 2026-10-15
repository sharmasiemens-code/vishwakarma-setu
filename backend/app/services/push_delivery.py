"""Bounded, durable FCM delivery. Never put account data or PINs on the lock screen."""
import os
import threading
from datetime import timedelta
from sqlalchemy import text
from app.db.database import SessionLocal

CHANNEL_ID = 'vishwakarma_jobs_v1'
_init_lock = threading.Lock()


def push_enabled():
    return os.getenv('PUSH_ENABLED', '0') == '1'


def firebase_app():
    import firebase_admin
    from firebase_admin import credentials
    project = os.getenv('FIREBASE_PROJECT_ID')
    if not project:
        raise RuntimeError('FIREBASE_PROJECT_ID is required when push is enabled')
    with _init_lock:
        try:
            app = firebase_admin.get_app('vishwakarma-push')
            app.credential.get_credential()
            return app
        except ValueError:
            credential = credentials.ApplicationDefault()
            credential.get_credential()
            return firebase_admin.initialize_app(credential,
                {'projectId': project, 'httpTimeout': 10}, name='vishwakarma-push')


def build_message(notification, token):
    from firebase_admin import messaging
    kind = notification.get('notification_type') or 'UPDATE'
    title = 'New job request' if kind == 'JOB_ASSIGNED' else 'Vishwakarma Setu'
    return messaging.Message(
        token=token,
        notification=messaging.Notification(title=title, body='Open the Technician app to view your update.'),
        data={'notification_id': str(notification['notification_id'])},
        android=messaging.AndroidConfig(priority='high', ttl=timedelta(minutes=15),
            restricted_package_name='in.vishwakarmasetu.technician',
            notification=messaging.AndroidNotification(channel_id=CHANNEL_ID,
                sound='default', tag=str(notification['notification_id']), visibility='private')),
    )


def send_to_firebase(notification, token):
    from firebase_admin import messaging
    return messaging.send(build_message(notification, token), app=firebase_app())


def failure_kind(error):
    # Error bodies may contain registration tokens: only allowlisted codes are persisted.
    from firebase_admin import messaging
    if isinstance(error, messaging.UnregisteredError): return 'UNREGISTERED', 'disable'
    if isinstance(error, messaging.SenderIdMismatchError): return 'SENDER_ID_MISMATCH', 'fail'
    from firebase_admin import exceptions
    if isinstance(error, (exceptions.InvalidArgumentError, ValueError)):
        return 'INVALID_ARGUMENT', 'fail'
    return 'DELIVERY_UNAVAILABLE', 'retry'


def deliver_one(send=send_to_firebase):
    db = SessionLocal()
    try:
        row = db.execute(text('''
            SELECT o.id, o.device_id, o.user_id, o.auth_version,
                   o.notification_id, o.attempts, o.expires_at <= now() AS expired,
                   n.notification_type, n.is_read
            FROM public.push_outbox o JOIN public.notifications n ON n.id = o.notification_id
            WHERE o.state = 'PENDING' AND o.next_attempt_at <= now()
            ORDER BY o.next_attempt_at, o.id LIMIT 1 FOR UPDATE OF o SKIP LOCKED
        ''')).mappings().first()
        if not row:
            db.rollback()
            return False
        device = db.execute(text('''
            SELECT d.token, d.user_id, d.active, d.auth_version,
                   u.is_active, u.role, u.password_version
            FROM public.push_devices d JOIN public.users u ON u.id = d.user_id
            WHERE d.id = :id FOR UPDATE OF d
        '''), {'id': row['device_id']}).mappings().first()
        valid = (device and device['active'] and device['is_active']
                 and device['role'] == 'TECHNICIAN'
                 and str(device['user_id']) == str(row['user_id'])
                 and device['auth_version'] == row['auth_version'] == device['password_version'])
        state, code = 'SKIPPED', None
        attempts = row['attempts']
        if valid and not row['expired'] and not row['is_read']:
            attempts += 1
            try:
                send(row, device['token'])
                state = 'SENT'
            except Exception as error:
                code, action = failure_kind(error)
                state = 'PENDING' if action == 'retry' and attempts < 5 else 'FAILED'
                if action == 'disable':
                    db.execute(text('UPDATE public.push_devices SET active = FALSE WHERE id = :id'),
                               {'id': row['device_id']})
        db.execute(text('''
            UPDATE public.push_outbox SET state = :state, attempts = :attempts,
                last_error_code = :code,
                next_attempt_at = now() + (:delay * INTERVAL '1 second'),
                completed_at = CASE WHEN :state = 'PENDING' THEN NULL ELSE now() END
            WHERE id = :id
        '''), {'id': row['id'], 'state': state, 'attempts': attempts, 'code': code,
               'delay': min(300, 5 * (2 ** attempts))})
        db.commit()
        return True
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def deliver_pending_pushes():
    if not push_enabled(): return 0
    # Validate credentials before claiming work; configuration failures don't exhaust retries.
    firebase_app()
    count = 0
    while count < 20 and deliver_one(): count += 1
    return count
