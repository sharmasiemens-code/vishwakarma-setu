"""Validation, privacy and transaction regressions without external services."""
import os
from datetime import date
from uuid import uuid4

os.environ.setdefault('JWT_SECRET_KEY', 'test-only-real-world-signing-secret')
os.environ.setdefault('DATABASE_URL', 'postgresql+psycopg://test:test@localhost/test')

import pytest
from fastapi import FastAPI, HTTPException, Response
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.api import auth, onboarding, profile, ratings
from app.core.security import get_current_user


@pytest.mark.parametrize('extra', [{}, {'email': '', 'date_of_birth': ''}, {'email': None, 'date_of_birth': None},
                                    {'email': 'user@example.com'}, {'date_of_birth': '1998-03-04'},
                                    {'email': ' User@Example.com ', 'date_of_birth': '1998-03-04'}])
def test_customer_optional_fields(extra):
    value = auth.CustomerRegistration(full_name='Customer Name', phone='9876543210', password='Password123', **extra)
    assert value.email in (None, 'user@example.com')
    if value.date_of_birth:
        assert value.date_of_birth == date(1998, 3, 4)


@pytest.mark.parametrize('extra', [{'email': 'invalid'}, {'email': 'a..b@example.com'}, {'email': '.a@example.com'},
                                    {'date_of_birth': '2999-01-01'}, {'date_of_birth': '2000-01-01T00:00:00Z'},
                                    {'date_of_birth': 1000000}, {'date_of_birth': '2000-02-30'}])
def test_reject_invalid_optional_details(extra):
    with pytest.raises(ValidationError):
        auth.CustomerRegistration(full_name='Customer Name', phone='9876543210', password='Password123', **extra)


def test_profile_cannot_update_phone_role_or_another_customer():
    with pytest.raises(ValidationError):
        profile.CustomerProfileUpdate(full_name='Name', role='ADMIN', phone='9876543210', user_id=str(uuid4()))
    with pytest.raises(HTTPException) as error:
        profile.get_profile(Response(), {'role': 'TECHNICIAN'}, None)
    assert error.value.status_code == 403


@pytest.mark.parametrize('details', [{'password': 'Private123'}, {'phone': '9876543210'}, {'service_ids': ['not-a-uuid']}, {'city': {'nested': 'bad'}}])
def test_draft_never_accepts_credentials_or_unbounded_inputs(details):
    with pytest.raises(ValidationError):
        onboarding.DraftUpdate(details=details, expected_version=0)


@pytest.mark.parametrize('value', [True, 3.5, '5', 0, 6])
def test_rating_requires_integer_in_range(value):
    with pytest.raises(ValidationError):
        ratings.RatingCreate(job_id=uuid4(), rating=value)


def test_auth_validation_never_echoes_passwords():
    app = FastAPI()
    app.include_router(auth.router)
    app.include_router(onboarding.router)
    for path, body in [('/auth/login', {'password': 'Private123'}),
                       ('/auth/register/customer', {'full_name': 'A', 'password': 'Private123'}),
                       ('/auth/register/technician/account', {'password': 'Private123'})]:
        response = TestClient(app).post(path, json=body)
        assert response.status_code == 422
        assert 'Private123' not in response.text
        assert 'input' not in response.text


class Result:
    def __init__(self, row=None): self.row = row
    def mappings(self): return self
    def first(self): return self.row
    def scalar_one_or_none(self): return self.row


class DraftDB:
    def __init__(self): self.calls = []; self.rollback_count = 0
    def execute(self, statement, params=None):
        sql = str(statement); self.calls.append((sql, params))
        if 'FOR UPDATE' in sql: return Result({'id': 'owned'})
        if 'SELECT version' in sql: return Result(2)
        return Result()
    def rollback(self): self.rollback_count += 1


def test_stale_draft_rejected_without_writing():
    db = DraftDB()
    actor = {'role': 'TECHNICIAN', 'sub': str(uuid4()), 'technician_id': str(uuid4())}
    with pytest.raises(HTTPException) as error:
        onboarding.save_draft(onboarding.DraftUpdate(expected_version=1, details={'city': 'Delhi'}), Response(), actor, db)
    assert error.value.status_code == 409
    assert db.rollback_count == 1
    assert not any('INSERT' in sql for sql, _ in db.calls)


def test_job_rating_checks_both_role_and_owner():
    db = DraftDB()
    actor = {'role': 'TECHNICIAN', 'sub': str(uuid4())}
    with pytest.raises(HTTPException) as error:
        ratings.get_job_rating(uuid4(), actor, db)
    assert error.value.status_code == 404
    sql, params = db.calls[-1]
    assert params['role'] == 'TECHNICIAN' and params['user_id'] == actor['sub']
    assert 't.user_id = CAST(:user_id AS uuid)' in sql
    assert 'c.user_id = CAST(:user_id AS uuid)' in sql


def test_legacy_technician_registration_keeps_required_fields():
    details = dict(full_name='Test Technician', phone='9876543210', password='Original123',
                   email='tech@example.com', date_of_birth='1990-01-02', gender='OTHER',
                   address_line1='Test address', city='Delhi', state='Delhi', pincode='110001',
                   work_area='Test area', experience_years='2', service_radius_km='10',
                   service_ids=[uuid4()], skill_ids=[uuid4()], tool_ids=[uuid4()])
    assert auth.TechnicianRegistration(**details).date_of_birth == date(1990, 1, 2)
    for field in ['email', 'date_of_birth']:
        missing = {key: value for key, value in details.items() if key != field}
        with pytest.raises(ValidationError): auth.TechnicianRegistration(**missing)
