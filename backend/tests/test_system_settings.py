"""Operational settings policy, transaction and runtime regression tests."""
import os
from pathlib import Path
from uuid import uuid4

os.environ.setdefault('JWT_SECRET_KEY', 'test-only-settings-secret')
os.environ.setdefault('DATABASE_URL', 'postgresql+psycopg://test:test@localhost/test')

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from app.api import admin_settings, matching
from app.core.system_settings import SETTING_DEFINITIONS, get_system_settings, operational_query, validate_setting_value
from app.services import technician_presence

DEFAULTS = {key: d['default'] for key, d in SETTING_DEFINITIONS.items()}


class Result:
    def __init__(self, row=None, rows=None): self.row, self.rows = row, rows or []
    def mappings(self): return self
    def all(self): return self.rows
    def first(self): return self.row
    def one(self): return self.row
    def fetchall(self): return self.rows
    def __iter__(self): return iter(self.rows)


class Database:
    def __init__(self):
        self.values = dict(DEFAULTS)
        self.row = {'id': uuid4(), 'key': 'gps_timeout_minutes', 'value': 10,
                    'version': 1, 'updated_by': None, 'updated_at': None}
        self.statements = []
        self.committed = self.rolled_back = self.closed = False
    def execute(self, statement, params=None):
        sql = str(statement)
        self.statements.append((sql, {**statement.compile().params, **(params or {})}))
        if 'SELECT key, value' in sql:
            return Result(rows=[{'key': k, 'value': v} for k, v in self.values.items()])
        if sql.lstrip().startswith('UPDATE public.system_settings'):
            return Result(row={**self.row, 'value': params['value'], 'version': self.row['version'] + 1})
        if 'FOR UPDATE' in sql: return Result(row=self.row)
        return Result()
    def commit(self): self.committed = True
    def rollback(self): self.rolled_back = True
    def close(self): self.closed = True


def payload(**overrides):
    return admin_settings.SystemSettingUpdate(value=20, expected_version=1, reason='Improve heartbeat tolerance', **overrides)


@pytest.mark.parametrize('key', list(SETTING_DEFINITIONS))
def test_setting_bounds_and_strict_types(key):
    d = SETTING_DEFINITIONS[key]
    assert validate_setting_value(key, d['minimum']) == d['minimum']
    assert validate_setting_value(key, d['maximum']) == d['maximum']
    for value in [True, 1.5, str(d['default']), d['minimum'] - 1, d['maximum'] + 1]:
        with pytest.raises(ValueError): validate_setting_value(key, value)


def test_unknown_and_incomplete_settings_fail_closed():
    with pytest.raises(ValueError): validate_setting_value('unknown', 5)
    db = Database(); del db.values['gps_timeout_minutes']
    with pytest.raises(RuntimeError): get_system_settings(db)
    db.values['gps_timeout_minutes'] = 100
    with pytest.raises(ValueError): get_system_settings(db)


def test_committed_values_are_read_each_time():
    db = Database()
    assert get_system_settings(db)['gps_timeout_minutes'] == 10
    db.values['gps_timeout_minutes'] = 20
    assert get_system_settings(db)['gps_timeout_minutes'] == 20
    assert not db.committed and not db.rolled_back


def test_parameters_are_bound_without_interpolating_sql():
    query = operational_query({**DEFAULTS, 'gps_timeout_minutes': 20},
                              "SELECT :latitude WHERE NOW() > NOW() - (:gps_timeout_minutes * INTERVAL '1 minute')")
    assert query.compile().params == {'latitude': None, 'gps_timeout_minutes': 20}
    assert ':gps_timeout_minutes' in str(query)


def test_update_and_audit_commit_together(monkeypatch):
    db = Database(); events = []
    monkeypatch.setattr(admin_settings, 'require_locked_super_admin', lambda *args: None)
    monkeypatch.setattr(admin_settings, 'write_admin_audit', lambda **kw: events.append(kw))
    result = admin_settings.update_system_setting('gps_timeout_minutes', payload(), db, {'sub': str(uuid4())})
    assert result['changed'] and result['setting']['value'] == 20
    assert events[0]['before_values']['value'] == 10
    assert events[0]['after_values']['version'] == 2
    assert db.committed


def test_audit_failure_rolls_back_update(monkeypatch):
    db = Database()
    monkeypatch.setattr(admin_settings, 'require_locked_super_admin', lambda *args: None)
    def fail(**kwargs): raise RuntimeError('Audit failed')
    monkeypatch.setattr(admin_settings, 'write_admin_audit', fail)
    with pytest.raises(RuntimeError): admin_settings.update_system_setting('gps_timeout_minutes', payload(), db, {'sub': str(uuid4())})
    assert db.rolled_back and not db.committed


@pytest.mark.parametrize('version,value,status', [(2, 20, 409), (1, 100, 422)])
def test_stale_and_out_of_range_update_rejected(monkeypatch, version, value, status):
    db = Database(); db.row['version'] = version
    monkeypatch.setattr(admin_settings, 'require_locked_super_admin', lambda *args: None)
    data = admin_settings.SystemSettingUpdate(value=value, expected_version=1, reason='Test reason')
    with pytest.raises(HTTPException) as exc: admin_settings.update_system_setting('gps_timeout_minutes', data, db, {})
    assert exc.value.status_code == status
    assert db.rolled_back and not db.committed
    assert not any(s.lstrip().startswith('UPDATE') for s, _ in db.statements)


def test_unchanged_value_does_not_audit(monkeypatch):
    db = Database()
    monkeypatch.setattr(admin_settings, 'require_locked_super_admin', lambda *args: None)
    def unexpected(**kw): raise AssertionError('No-op must not create an audit')
    monkeypatch.setattr(admin_settings, 'write_admin_audit', unexpected)
    data = admin_settings.SystemSettingUpdate(value=10, expected_version=1, reason='No change')
    result = admin_settings.update_system_setting('gps_timeout_minutes', data, db, {})
    assert not result['changed'] and db.rolled_back and not db.committed


def test_revoked_write_permission_is_rechecked(monkeypatch):
    db = Database()
    def denied(*args): raise HTTPException(403, 'Denied')
    monkeypatch.setattr(admin_settings, 'require_locked_super_admin', denied)
    with pytest.raises(HTTPException): admin_settings.update_system_setting('gps_timeout_minutes', payload(), db, {})
    assert not db.committed


def test_update_model_rejects_coercion():
    for value in [True, '20', 20.5]:
        with pytest.raises(ValidationError): admin_settings.SystemSettingUpdate(value=value, expected_version=1, reason='Test reason')


def test_presence_uses_changed_timeout_and_preserves_active_jobs(monkeypatch):
    db = Database(); db.values['gps_timeout_minutes'] = 25
    monkeypatch.setattr(technician_presence, 'SessionLocal', lambda: db)
    technician_presence.synchronize_technician_presence()
    sql, params = next((s,p) for s,p in db.statements if s.lstrip().startswith('UPDATE technicians'))
    assert params['timeout_minutes'] == 25
    assert 'AND NOT EXISTS' in sql and "'IN_PROGRESS'" in sql and "'ASSIGNED'" in sql
    assert db.committed and db.closed


def test_matching_uses_changed_timeout():
    db = Database(); db.values['gps_timeout_minutes'] = 25
    result = matching.find_matching_technicians(uuid4(), 23.1, 79.9, 10, {'role': 'CUSTOMER'}, db)
    assert result['total_matches'] == 0
    sql, params = db.statements[-1]
    assert params['gps_timeout_minutes'] == 25
    assert 'INTERVAL \'10 minutes\'' not in sql
    assert "active_job.status IN" in sql


def test_exception_thresholds_and_descriptions_match_configuration():
    from app.api.admin import get_admin_exceptions
    db = Database(); db.values.update(unmatched_request_minutes=90, stuck_active_job_hours=8)
    result = get_admin_exceptions(db, {'sub': str(uuid4()), 'role': 'ADMIN'})
    assert result['thresholds'] == {'unmatched_request_minutes': 90, 'stuck_active_job_hours': 8}
    configured = [(s,p) for s,p in db.statements if 'INTERVAL' in s]
    assert any(p.get('unmatched_request_minutes') == 90 for _,p in configured)
    assert any(p.get('stuck_active_job_hours') == 8 for _,p in configured)
