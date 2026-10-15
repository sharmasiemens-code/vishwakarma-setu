"""Real PostGIS regression suite; creates and drops only its own random test DB.
SETU_TEST_ADMIN_URL must point to an administrative disposable test server.
The reconstructed legacy fixture is NOT a production bootstrap.
"""
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from uuid import uuid4
import psycopg
from psycopg import sql
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

pytestmark = pytest.mark.skipif(not os.getenv('SETU_TEST_ADMIN_URL'), reason='Disposable PostgreSQL test server not configured')
ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture(scope='module')
def database():
    url = os.environ['SETU_TEST_ADMIN_URL']
    name = 'setu_test_' + uuid4().hex
    admin = psycopg.connect(url, autocommit=True)
    admin.execute(sql.SQL('CREATE DATABASE {}').format(sql.Identifier(name)))
    connection = psycopg.connect(url, dbname=name, autocommit=True)
    engine = None
    try:
        connection.execute((ROOT / 'tests/fixtures/marketplace_base.sql').read_text())
        names = ['C30_001_admin_rbac', 'C31_001_admin_audit', 'RG_001_registration_foundation', 'RG_002_technician_applications', 'RG_003_technician_onboarding_audit', 'WF_001_request_photo_metadata', 'WF_002_job_start_pins', 'WF_003_job_happy_codes', 'WF_004_job_disputes', 'WF_005_dispute_permissions_audit', 'WF_006_completion_work_resumed', 'WF_007_job_dispute_photos', 'WF_008_job_price_revisions', 'WF_009_completion_summary_customers', 'PR_001_password_recovery', 'C32_002_settings_runtime', 'RW_001_customer_details_onboarding', 'RW_002_job_integrity', 'RW_003_request_idempotency']
        for migration in names:
            connection.execute((ROOT / 'migrations' / (migration + '.sql')).read_text())
        connection.execute((ROOT.parent / 'database/migrations/h38_job_reassignment.sql').read_text())
        for migration in names[-3:]:
            connection.execute((ROOT / 'migrations' / (migration + '.sql')).read_text())
        engine = create_engine('postgresql+psycopg://', creator=lambda: psycopg.connect(url, dbname=name))
        yield engine
    finally:
        if engine: engine.dispose()
        connection.close()
        admin.execute(sql.SQL('DROP DATABASE {} WITH (FORCE)').format(sql.Identifier(name)))
        admin.close()

@pytest.fixture
def client(database, monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", "test-only-postgres-signing-secret-not-for-runtime")
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://test:test@localhost/test")
    from app.main import app
    from app.db.database import get_db
    from app.core import security
    factory = sessionmaker(bind=database)
    def sessions():
        with factory() as session: yield session
    app.dependency_overrides[get_db] = sessions
    monkeypatch.setattr(security, 'SessionLocal', factory)
    monkeypatch.setenv('START_PIN_HMAC_SECRET', 'test-only-start-pin-secret-for-postgres-suite-12345')
    monkeypatch.setenv('HAPPY_CODE_HMAC_SECRET', 'test-only-happy-code-secret-for-postgres-suite-67890')
    yield TestClient(app)
    app.dependency_overrides.clear()

def good(response, status=200):
    assert response.status_code == status, (response.status_code, response.text)
    return response.json()

def headers(account): return {'Authorization': 'Bearer ' + account['access_token']}

def test_registration_profile_onboarding_and_full_job_journey(client, database):
    def register(phone, **extra):
        return good(client.post('/auth/register/customer', json={'full_name': 'Test Customer', 'phone': phone, 'password': 'Original123', **extra}), 201)
    owner = headers(register('9876543210'))
    other = headers(register('9876543211', email='Other@Example.com', date_of_birth='1998-05-06'))
    good(client.post('/auth/login', json={'email': 'other@example.com', 'password': 'Original123'}))
    good(client.post('/auth/login', json={'identifier': '+91 9876543210', 'password': 'Original123'}))
    good(client.put('/customers/me/profile', headers=owner, json={'full_name': 'Updated Name', 'email': 'me@example.com', 'date_of_birth': '1995-06-07'}))
    value = good(client.get('/customers/me/profile', headers=owner))['profile']
    assert value['date_of_birth'] == '1995-06-07' and value['email'] == 'me@example.com'
    good(client.put('/customers/me/profile', headers=owner, json={'full_name': 'Updated Name', 'email': '', 'date_of_birth': ''}))
    assert good(client.get('/customers/me/profile', headers=owner))['profile']['date_of_birth'] is None
    for extra in [{'date_of_birth': '2999-01-01'}, {'email': 'invalid'}]:
        assert client.put('/customers/me/profile', headers=owner, json={'full_name': 'Updated Name', **extra}).status_code == 422
    tech = good(client.post('/auth/register/technician/account', json={'full_name': 'Test Technician', 'phone': '9876543212', 'password': 'Original123'}), 201)
    worker = headers(tech); tid = tech['user']['technician_id']
    assert client.post('/technicians/me/availability', headers=worker, json={'availability_status': 'ONLINE'}).status_code == 403
    assert client.get('/customers/me/profile', headers=worker).status_code == 403
    assert good(client.get('/auth/technician/application', headers=worker))['application']['onboarding_required'] is True
    good(client.put('/auth/technician/onboarding', headers=worker, json={'expected_version': 1, 'details': {'city': 'Delhi'}}))
    assert client.put('/auth/technician/onboarding', headers=worker, json={'expected_version': 1, 'details': {'city': 'Changed'}}).status_code == 409
    assert good(client.get('/auth/technician/onboarding', headers=worker))['draft']['details']['city'] == 'Delhi'
    with database.begin() as db:
        category = db.execute(text("INSERT INTO service_categories(name) VALUES ('Test plumbing') RETURNING id")).scalar_one()
        service = db.execute(text("INSERT INTO services(category_id,name) VALUES (:id,'Test tap repair') RETURNING id"), {'id': category}).scalar_one()
        skill = db.execute(text("INSERT INTO skills(name) VALUES ('Test skill') RETURNING id")).scalar_one()
        tool = db.execute(text("INSERT INTO tools(name) VALUES ('Test spanner') RETURNING id")).scalar_one()
        db.execute(text('INSERT INTO service_skills(service_id,skill_id) VALUES (:s,:k)'), {'s': service, 'k': skill})
        db.execute(text('INSERT INTO service_tools(service_id,tool_id) VALUES (:s,:k)'), {'s': service, 'k': tool})
    details = {'email': 'technician@example.com', 'date_of_birth': '1990-01-02', 'gender': 'OTHER', 'address_line1': 'Test address', 'address_line2': '', 'city': 'Delhi', 'state': 'Delhi', 'pincode': '110001', 'work_area': 'Test area', 'experience_years': '2', 'service_radius_km': '10', 'service_ids': [str(service)], 'skill_ids': [str(skill)], 'tool_ids': [str(tool)]}
    good(client.post('/auth/technician/onboarding/submit', headers=worker, json=details), 201)
    legacy = good(client.post('/auth/register/technician', json={**details, 'email': 'legacy-tech@example.com', 'full_name': 'Legacy Technician', 'phone': '9876543213', 'password': 'Original123'}), 201)
    assert good(client.get('/auth/technician/application', headers=headers(legacy)))['application']['onboarding_required'] is False
    assert client.post('/auth/technician/onboarding/submit', headers=worker, json=details).status_code == 409
    assert not good(client.get('/auth/technician/application', headers=worker))['application']['can_work']
    # Only the fixture emulates admin review via SQL; admin review UI/API needs acceptance.
    with database.begin() as db:
        db.execute(text("UPDATE users SET is_verified=true, phone_verified_at=now(), phone_verified_by='97db8fe2-4424-4cfc-af70-2cf4342369a1' WHERE id=CAST(:id AS uuid)"), {'id': tech['user']['user_id']})
        db.execute(text("UPDATE technicians SET kyc_status='APPROVED' WHERE id=CAST(:id AS uuid)"), {'id': tid})
        db.execute(text("UPDATE technician_kyc SET verification_status='APPROVED', address_verified=true WHERE technician_id=CAST(:id AS uuid)"), {'id': tid})
        db.execute(text("UPDATE technician_applications SET status='APPROVED', reviewed_by='97db8fe2-4424-4cfc-af70-2cf4342369a1', reviewed_at=now(), review_reason='Integration fixture approval' WHERE technician_id=CAST(:id AS uuid)"), {'id': tid})
    good(client.post('/technicians/me/location', headers=worker, json={'latitude': 28.61, 'longitude': 77.21}))
    good(client.post('/technicians/me/availability', headers=worker, json={'availability_status': 'ONLINE'}))
    payload = {'service_id': str(service), 'title': 'Test leaking tap', 'description': 'Fixture service request', 'address_line1': 'Test address', 'city': 'Delhi', 'state': 'Delhi', 'latitude': 28.61, 'longitude': 77.21}
    key = str(uuid4())
    first = good(client.post('/service-requests', headers={**owner, 'Idempotency-Key': key}, json=payload))
    assert good(client.post('/service-requests', headers={**owner, 'Idempotency-Key': key}, json=payload)) == first
    assert client.post('/service-requests', headers={**owner, 'Idempotency-Key': key}, json={**payload, 'title': 'Changed title'}).status_code == 409
    matches = good(client.get(f'/matching/technicians?service_id={service}&latitude=28.61&longitude=77.21', headers=owner))
    assert any(row['technician_id'] == tid for row in matches['technicians'])
    assert 'date_of_birth' not in str(matches)
    job = good(client.post('/jobs', headers=owner, json={'service_request_id': first['service_request']['id'], 'technician_id': tid, 'estimated_amount': 500}))['job']['id']
    assert client.post(f'/jobs/{job}/respond', headers=other, json={'action': 'ACCEPT'}).status_code == 403
    second = good(client.post('/service-requests', headers=owner, json=payload))
    assert client.post('/jobs', headers=owner, json={'service_request_id': second['service_request']['id'], 'technician_id': tid, 'estimated_amount': 500}).status_code == 409
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post(f'/jobs/{job}/respond', headers=worker, json={'action': 'ACCEPT'}).status_code, range(2)))
    assert sorted(results) == [200, 409]
    assert not good(client.get(f'/matching/technicians?service_id={service}&latitude=28.61&longitude=77.21', headers=owner))['technicians']
    for state in ['ON_THE_WAY', 'ARRIVED']:
        good(client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': state}))
    assert client.post(f'/jobs/{job}/start-pin', headers=worker).status_code in (403, 404)
    pin = good(client.post(f'/jobs/{job}/start-pin', headers=owner))['start_pin']
    wrong = '0000' if pin != '0000' else '0001'
    assert client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'IN_PROGRESS', 'start_pin': wrong}).status_code == 403
    with database.connect() as db:
        assert db.execute(text('SELECT failed_attempts FROM job_start_pins WHERE job_id=CAST(:id AS uuid)'), {'id': job}).scalar_one() == 1
    good(client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'IN_PROGRESS', 'start_pin': pin}))
    good(client.put(f'/jobs/{job}/completion-summary', headers=worker, json={'summary': 'Replaced test washer and checked for leaks', 'expected_version': 1}))
    good(client.post(f'/jobs/{job}/completion-request', headers=worker))
    sheet = good(client.get(f'/jobs/{job}/completion-price-sheet', headers=owner))['price_sheet']
    happy = good(client.post(f'/jobs/{job}/completion-approval', headers=owner, json={'accept_work': True, 'expected_summary_version': sheet['summary_version'], 'expected_total': sheet['total_payable']}))['happy_code']
    good(client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'COMPLETED', 'happy_code': happy}))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: client.post('/ratings', headers=owner, json={'job_id': job, 'rating': 4, 'review': 'Test review'}).status_code, range(2)))
    assert sorted(results) == [200, 409]
    notes = good(client.get('/notifications', headers=worker))['notifications']
    assert next(row for row in notes if row['notification_type'] == 'RATING_RECEIVED')['reference_id'] == job
    assert pin not in str(notes) and happy not in str(notes)
    review = good(client.get(f'/ratings/job/{job}', headers=worker))['rating']
    assert review['rating'] == 4 and 'customer_id' not in review
    assert client.get(f'/ratings/job/{job}', headers=other).status_code == 404
    summary = good(client.get('/ratings/me', headers=worker))
    assert summary['total_reviews'] == 1 and float(summary['rating_average']) == 4
    assert good(client.get('/technicians/me/dashboard', headers=worker))['dashboard']['profile']['total_jobs'] == 1


def isolated_job(database):
    """New test participants with no contact details or reusable credentials."""
    from app.core.security import create_access_token
    customer_user, worker_user, customer, technician, request, job = [uuid4() for _ in range(6)]
    with database.begin() as db:
        for user, role in [(customer_user, 'CUSTOMER'), (worker_user, 'TECHNICIAN')]:
            db.execute(text("INSERT INTO users(id,full_name,role,is_verified) VALUES (:id,'Code regression fixture',:role,true)"), {'id': user, 'role': role})
        db.execute(text('INSERT INTO customers(id,user_id) VALUES (:id,:user)'), {'id': customer, 'user': customer_user})
        db.execute(text("INSERT INTO technicians(id,user_id,kyc_status) VALUES (:id,:user,'APPROVED')"), {'id': technician, 'user': worker_user})
        db.execute(text("INSERT INTO technician_kyc(technician_id,verification_status,address_verified) VALUES (:id,'APPROVED',true)"), {'id': technician})
        category = db.execute(text("INSERT INTO service_categories(name) VALUES ('Code fixture category') RETURNING id")).scalar_one()
        service = db.execute(text("INSERT INTO services(category_id,name) VALUES (:id,'Code fixture service') RETURNING id"), {'id': category}).scalar_one()
        db.execute(text('INSERT INTO service_requests(id,customer_id,service_id) VALUES (:id,:customer,:service)'), {'id': request, 'customer': customer, 'service': service})
        db.execute(text("INSERT INTO jobs(id,service_request_id,customer_id,technician_id,status,estimated_amount) VALUES (:id,:request,:customer,:technician,'ARRIVED',100)"), {'id': job, 'request': request, 'customer': customer, 'technician': technician})
    def token(user, role, tech=None):
        return headers({'access_token': create_access_token({'sub': str(user), 'role': role, 'technician_id': str(tech) if tech else None, 'password_version': 0})})
    return str(job), token(customer_user, 'CUSTOMER'), token(worker_user, 'TECHNICIAN', technician)


def test_confirmation_code_attempt_limits_and_privacy(client, database):
    job, owner, worker = isolated_job(database)
    pin = good(client.post(f'/jobs/{job}/start-pin', headers=owner))['start_pin']
    wrong = '0000' if pin != '0000' else '0001'
    for attempt in range(5):
        response = client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'IN_PROGRESS', 'start_pin': wrong})
        assert response.status_code == (429 if attempt == 4 else 403)
        assert pin not in response.text
    assert client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'IN_PROGRESS', 'start_pin': pin}).status_code == 429
    assert client.post(f'/jobs/{job}/start-pin', headers=owner).status_code == 429
    invalid = client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'IN_PROGRESS', 'start_pin': '99999'})
    assert invalid.status_code == 422 and '99999' not in invalid.text
    with database.begin() as db:
        assert db.execute(text('SELECT failed_attempts FROM job_start_pins WHERE job_id=CAST(:id AS uuid)'), {'id': job}).scalar_one() == 5
        # Advance only this test fixture beyond lockout; no clock/sleep required.
        db.execute(text("UPDATE job_start_pins SET locked_until=now()-interval '1 second' WHERE job_id=CAST(:id AS uuid)"), {'id': job})
    good(client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'IN_PROGRESS', 'start_pin': pin}))
    good(client.put(f'/jobs/{job}/completion-summary', headers=worker, json={'summary': 'Code lockout test work summary', 'expected_version': 1}))
    good(client.post(f'/jobs/{job}/completion-request', headers=worker))
    price = good(client.get(f'/jobs/{job}/completion-price-sheet', headers=owner))['price_sheet']
    happy = good(client.post(f'/jobs/{job}/completion-approval', headers=owner, json={'accept_work': True, 'expected_summary_version': price['summary_version'], 'expected_total': price['total_payable']}))['happy_code']
    wrong = '0000' if happy != '0000' else '0001'
    for attempt in range(5):
        response = client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'COMPLETED', 'happy_code': wrong})
        assert response.status_code == (429 if attempt == 4 else 403)
        assert happy not in response.text
    assert client.post(f'/jobs/{job}/status', headers=worker, json={'new_status': 'COMPLETED', 'happy_code': happy}).status_code == 429
    for data in [good(client.get('/notifications', headers=worker)), good(client.get('/technicians/me/dashboard', headers=worker))]:
        assert pin not in str(data) and happy not in str(data)
