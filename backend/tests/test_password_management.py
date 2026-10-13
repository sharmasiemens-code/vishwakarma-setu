"""Password management regression tests; isolated from the production database."""
import os
import sys
from pathlib import Path
from uuid import uuid4

os.environ.setdefault('JWT_SECRET_KEY', 'test-only-password-management-secret')
os.environ.setdefault('DATABASE_URL', 'postgresql+psycopg://test:test@localhost/test')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi import FastAPI, HTTPException, Response
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api import passwords
from app.core import security
from app.core.admin_rbac import require_permission


class Result:
    def __init__(self, row=None, rows=None):
        self.row = row
        self.rows = rows or []
    def mappings(self): return self
    def first(self): return self.row
    def all(self): return self.rows
    def scalar_one(self): return True


class Database:
    def __init__(self, role='CUSTOMER', active=True, version=0):
        self.row = {'id': uuid4(), 'role': role, 'is_active': active,
                    'is_verified': True, 'password_version': version,
                    'password_hash': security.hash_password('Original123')}
        self.statements = []
        self.committed = False
        self.rolled_back = False
    def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append((sql, params))
        if 'SELECT' in sql: return Result(self.row)
        return Result()
    def commit(self): self.committed = True
    def rollback(self): self.rolled_back = True
    def close(self): pass


def change(**overrides):
    return passwords.ChangePassword(**{
        'current_password': 'Original123', 'new_password': 'Replacement456',
        'confirm_password': 'Replacement456', **overrides,
    })


def reset(**overrides):
    return passwords.ResetPassword(**{
        'new_password': 'Replacement456', 'confirm_password': 'Replacement456',
        'expected_version': 0, 'identity_verified': True,
        'reason': 'Verified owner on registered contact', **overrides,
    })


@pytest.mark.parametrize('value', ['short1', 'lettersOnly', '12345678', ' Password123', 'Password123\n', 'é' * 36 + '1'])
def test_password_policy(value):
    with pytest.raises(ValidationError):
        change(new_password=value, confirm_password=value)


def test_confirmation_and_identity_required():
    with pytest.raises(ValidationError): change(confirm_password='Different789')
    with pytest.raises(ValidationError): reset(identity_verified=False)
    with pytest.raises(ValidationError): reset(reason='   ')
    with pytest.raises(ValidationError): reset(expected_version=True)


@pytest.mark.parametrize('role', ['CUSTOMER', 'TECHNICIAN'])
def test_change_stores_only_hash_and_increments_version(role):
    db = Database(role=role)
    passwords.change_password(change(), Response(), {'sub': str(db.row['id'])}, db)
    updates = [(s, p) for s, p in db.statements if s.lstrip().startswith('UPDATE')]
    assert len(updates) == 1 and 'password_version + 1' in updates[0][0]
    assert security.verify_password('Replacement456', updates[0][1]['hash'])
    assert 'Replacement456' not in str(db.statements)
    assert db.committed


@pytest.mark.parametrize('overrides,version,status', [
    ({'current_password': 'Wrong123'}, 0, 400),
    ({'new_password': 'Original123', 'confirm_password': 'Original123'}, 0, 400),
    ({}, 1, 401),
])
def test_change_rejects_invalid_or_stale_requests(overrides, version, status):
    db = Database(version=version)
    with pytest.raises(HTTPException) as exc:
        passwords.change_password(change(**overrides), Response(), {'sub': str(db.row['id'])}, db)
    assert exc.value.status_code == status
    assert db.rolled_back and not db.committed
    assert not any(s.lstrip().startswith('UPDATE') for s, _ in db.statements)


@pytest.mark.parametrize('role,active', [('ADMIN', True), ('CUSTOMER', False)])
def test_protected_or_inactive_accounts_cannot_be_reset(role, active):
    with pytest.raises(HTTPException) as exc:
        passwords.locked_user(Database(role=role, active=active), uuid4())
    assert exc.value.status_code == 403


def test_admin_reset_is_atomic_and_does_not_audit_credentials(monkeypatch):
    db = Database()
    events = []
    monkeypatch.setattr(passwords, 'require_locked_super_admin', lambda *args: None)
    monkeypatch.setattr(passwords, 'write_admin_audit', lambda **kw: events.append(kw))
    passwords.reset_password(db.row['id'], reset(), Response(), {'sub': str(uuid4())}, db)
    assert db.committed and len(events) == 1
    assert events[0]['before_values'] == {'password_version': 0}
    assert events[0]['after_values'] == {'password_version': 1}
    assert 'password_hash' not in str(events)
    assert 'Replacement456' not in str(events)


def test_audit_failure_rolls_back_password_update(monkeypatch):
    db = Database()
    monkeypatch.setattr(passwords, 'require_locked_super_admin', lambda *args: None)
    def failed_audit(**kwargs): raise RuntimeError('Audit storage unavailable')
    monkeypatch.setattr(passwords, 'write_admin_audit', failed_audit)
    with pytest.raises(RuntimeError):
        passwords.reset_password(db.row['id'], reset(), Response(), {}, db)
    assert db.rolled_back and not db.committed


def test_conflicting_reset_is_rejected(monkeypatch):
    db = Database(version=1)
    monkeypatch.setattr(passwords, 'require_locked_super_admin', lambda *args: None)
    with pytest.raises(HTTPException) as exc:
        passwords.reset_password(db.row['id'], reset(), Response(), {}, db)
    assert exc.value.status_code == 409
    assert db.rolled_back and not db.committed


def test_reset_rechecks_actor_privileges(monkeypatch):
    db = Database()
    def denied(*args): raise HTTPException(403, 'Permission revoked')
    monkeypatch.setattr(passwords, 'require_locked_super_admin', denied)
    with pytest.raises(HTTPException) as exc:
        passwords.reset_password(db.row['id'], reset(), Response(), {}, db)
    assert exc.value.status_code == 403
    assert not any(s.lstrip().startswith('UPDATE') for s, _ in db.statements)


@pytest.mark.parametrize('token_version,db_version,allowed', [
    (None, 0, True), (None, 1, False), (0, 1, False),
    (1, 1, True), ('1', 1, False), (True, 1, False),
])
def test_previous_and_malformed_tokens_are_revoked(monkeypatch, token_version, db_version, allowed):
    db = Database(version=db_version)
    monkeypatch.setattr(security, 'SessionLocal', lambda: db)
    claims = {'sub': str(db.row['id']), 'role': 'CUSTOMER'}
    if token_version is not None: claims['password_version'] = token_version
    credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=security.create_access_token(claims))
    if allowed:
        assert security.get_current_user(credentials)['sub'] == claims['sub']
    else:
        with pytest.raises(HTTPException) as exc: security.get_current_user(credentials)
        assert exc.value.status_code == 401


def test_permission_dependency_denies_missing_grant():
    with pytest.raises(HTTPException) as exc:
        require_permission('passwords.reset')({'permissions': []})
    assert exc.value.status_code == 403


def test_invalid_request_never_echoes_passwords():
    app = FastAPI()
    app.include_router(passwords.router)
    app.dependency_overrides[security.get_current_user] = lambda: {'sub': str(uuid4()), 'role': 'CUSTOMER'}
    app.dependency_overrides[passwords.get_db] = lambda: Database()
    response = TestClient(app).post('/auth/change-password', json={
        'current_password': 'PrivateCurrent123', 'new_password': 'PrivateNew123',
        'confirm_password': 'OtherSecret456',
    })
    assert response.status_code == 422
    assert 'PrivateCurrent123' not in response.text
    assert 'PrivateNew123' not in response.text
    assert 'OtherSecret456' not in response.text
    assert response.headers['cache-control'] == 'no-store'


def test_login_issues_current_password_version():
    from app.api.auth import LoginRequest, login
    db = Database(version=4)
    db.row.update(full_name='Test Customer', email='test@example.com', phone='9000000000')
    db.execute = lambda *args: Result(rows=[db.row])
    result = login(LoginRequest(email='test@example.com', password='Original123'), db)
    assert security.decode_access_token(result['access_token'])['password_version'] == 4


@pytest.mark.parametrize('path,method,allowed', [
    ('/auth/change-password', 'POST', True), ('/jobs', 'POST', False),
])
def test_pending_technician_can_change_password_but_cannot_work(monkeypatch, path, method, allowed):
    from starlette.requests import Request
    db = Database(role='TECHNICIAN')
    technician_id = uuid4()
    def execute(statement, params=None):
        sql = str(statement)
        if 'JOIN public.technician_applications' in sql:
            return Result({'status': 'SUBMITTED', 'is_verified': False,
                           'phone_verified_at': None, 'kyc_status': 'PENDING',
                           'verification_status': 'PENDING', 'address_verified': False})
        if 'FROM technicians' in sql: return Result({'id': technician_id})
        return Result(db.row)
    db.execute = execute
    monkeypatch.setattr(security, 'SessionLocal', lambda: db)
    token = security.create_access_token({'sub': str(db.row['id']), 'role': 'TECHNICIAN',
                                         'technician_id': str(technician_id)})
    credentials = HTTPAuthorizationCredentials(scheme='Bearer', credentials=token)
    request = Request({'type': 'http', 'method': method, 'path': path, 'headers': []})
    if allowed:
        assert security.get_current_user(credentials, request)['role'] == 'TECHNICIAN'
    else:
        with pytest.raises(HTTPException) as exc: security.get_current_user(credentials, request)
        assert exc.value.status_code == 403
