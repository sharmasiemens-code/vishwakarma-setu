"""Read-only runtime preflight. Do not print connection strings or secret values."""
import os
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError

load_dotenv(Path(__file__).resolve().parents[1] / '.env')
required = ('DATABASE_URL', 'JWT_SECRET_KEY', 'START_PIN_HMAC_SECRET', 'HAPPY_CODE_HMAC_SECRET')
missing = [name for name in required if not os.environ.get(name)]
if missing:
    raise SystemExit('Missing configuration: ' + ', '.join(missing))
keys = [os.environ[name] for name in required[1:]]
if any(len(key.encode()) < 32 for key in keys) or len(set(keys)) != len(keys):
    raise SystemExit('Use three separate signing secrets, each at least 32 bytes.')
engine = create_engine(os.environ['DATABASE_URL'], pool_pre_ping=True, hide_parameters=True)
try:
    with engine.connect() as db:
        db.execute(text('SELECT 1')).scalar_one()
        db.execute(text('SELECT PostGIS_Version()')).scalar_one()
        tables = set(inspect(db).get_table_names(schema='public'))
        needed = {'users', 'customers', 'technicians', 'technician_kyc', 'service_categories', 'services',
                  'skills', 'tools', 'service_skills', 'service_tools', 'technician_skills', 'technician_tools',
                  'technician_locations', 'service_requests', 'service_request_photos', 'jobs', 'job_status_history',
                  'ratings', 'notifications', 'admin_roles', 'admin_permissions', 'admin_role_permissions',
                  'admin_user_roles', 'admin_audit_logs', 'system_settings', 'technician_applications',
                  'technician_application_services', 'technician_onboarding_drafts', 'service_request_idempotency',
                  'job_start_pins', 'job_happy_codes', 'job_completion_requests', 'job_price_revisions',
                  'job_disputes', 'job_dispute_photos'}
        absent = needed - tables
        if absent:
            raise SystemExit('Database is missing required tables: ' + ', '.join(sorted(absent)))
        db.execute(text('SELECT date_of_birth FROM public.customers LIMIT 0'))
        db.execute(text('SELECT password_version FROM public.users LIMIT 0'))
        constraints = set(db.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname='public'")).scalars())
        if not {'rw_ratings_one_per_job', 'rw_jobs_one_active_per_technician'} <= constraints:
            raise SystemExit('Apply RW_002_job_integrity.sql before starting the application.')
    print('Database connectivity, PostGIS, required tables/columns/indexes and signing-key configuration passed.')
    print('This preflight does not prove every schema column or application workflow is correct.')
except SQLAlchemyError as exc:
    raise SystemExit('Database preflight failed (' + type(getattr(exc, 'orig', exc)).__name__ + '). Check access, PostGIS and migrations; connection details were withheld.') from None
finally:
    engine.dispose()
