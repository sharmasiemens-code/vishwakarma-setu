import os
from uuid import uuid4
os.environ.setdefault('JWT_SECRET_KEY', 'test-only-push-secret')
os.environ.setdefault('DATABASE_URL', 'postgresql+psycopg://test:test@localhost/test')

import pytest
from fastapi import HTTPException, Response, FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.api import push
from app.core.security import get_current_user
from app.services import push_delivery as delivery


class Result:
    def __init__(self, row=None, value=0): self.row, self.value = row, value
    def mappings(self): return self
    def first(self): return self.row
    def scalar_one(self): return self.value


class Database:
    def __init__(self):
        self.user = {'role': 'TECHNICIAN', 'is_active': True, 'password_version': 1}
        self.count = 0
        self.outbox = {'id': uuid4(), 'device_id': uuid4(), 'user_id': uuid4(),
                       'auth_version': 1, 'notification_id': uuid4(), 'attempts': 0,
                       'expired': False, 'is_read': False, 'notification_type': 'JOB_ASSIGNED'}
        self.device = {'token': 'test-device-token-1234567890', 'user_id': self.outbox['user_id'],
                       'active': True, 'auth_version': 1, 'is_active': True,
                       'role': 'TECHNICIAN', 'password_version': 1}
        self.calls = []
        self.committed = self.rolled_back = self.closed = False
    def execute(self, sql, params=None):
        sql = str(sql); self.calls.append((sql, params))
        if 'SELECT role, is_active' in sql: return Result(self.user)
        if 'COUNT(*)' in sql: return Result(value=self.count)
        if 'FROM public.push_outbox o' in sql: return Result(self.outbox)
        if 'FROM public.push_devices d' in sql: return Result(self.device)
        return Result()
    def commit(self): self.committed = True
    def rollback(self): self.rolled_back = True
    def close(self): self.closed = True


def registration(**values):
    return push.DeviceRegistration(**{'installation_id': uuid4(), 'token': 'test-device-token-1234567890', **values})


def current_user(**values):
    return {'sub': str(uuid4()), 'role': 'TECHNICIAN', 'password_version': 1, **values}


@pytest.mark.parametrize('token', ['', 'short', 'a'*4097, 'token contains spaces 123456789', 'é'*30])
def test_registration_rejects_invalid_tokens(token):
    with pytest.raises(ValidationError): registration(token=token)


def test_registration_uses_authenticated_user_and_credential_version():
    db = Database(); user = current_user()
    result = push.register_device(registration(), Response(), user, db)
    params = next(p for s,p in db.calls if 'INSERT INTO public.push_devices' in s)
    assert params['user'] == user['sub'] and params['version'] == 1
    assert result['status'] == 'registered' and 'token' not in result
    assert db.committed


@pytest.mark.parametrize('role', ['CUSTOMER','ADMIN'])
def test_non_technicians_cannot_register(role):
    db = Database()
    with pytest.raises(HTTPException) as exc: push.register_device(registration(), Response(), current_user(role=role), db)
    assert exc.value.status_code == 403 and not db.calls


@pytest.mark.parametrize('version,active,count,status', [(2,True,0,401), (1,False,0,403), (1,True,5,409)])
def test_registration_denies_stale_disabled_or_excess_devices(version,active,count,status):
    db = Database(); db.user.update(password_version=version,is_active=active); db.count=count
    with pytest.raises(HTTPException) as exc: push.register_device(registration(),Response(),current_user(),db)
    assert exc.value.status_code==status and db.rolled_back and not db.committed


def test_unregister_only_mutates_current_users_installation():
    db=Database(); user=current_user(); installation=uuid4()
    push.unregister_device(installation,Response(),user,db)
    sql,params=db.calls[0]
    assert 'user_id = :user' in sql and params=={'installation':installation,'user':user['sub']}
    assert db.committed


def test_validation_does_not_echo_token():
    app=FastAPI(); app.include_router(push.router)
    app.dependency_overrides[get_current_user]=lambda:current_user()
    app.dependency_overrides[push.get_db]=Database
    token='Sensitive device token 123456789'
    response=TestClient(app).post('/push/devices',json={'installation_id':str(uuid4()),'token':token})
    assert response.status_code==422 and token not in response.text


def test_fcm_payload_has_sound_channel_and_no_private_job_data():
    from firebase_admin import messaging
    row=Database().outbox
    message=delivery.build_message(row,'test-token')
    assert message.notification.title=='New job request'
    assert message.data=={'notification_id':str(row['notification_id'])}
    assert message.android.notification.channel_id==delivery.CHANNEL_ID
    assert message.android.notification.sound=='default'
    assert message.android.priority=='high'
    assert message.android.restricted_package_name=='in.vishwakarmasetu.technician'
    assert messaging.Message is type(message)


def run_delivery(monkeypatch,db,send):
    monkeypatch.setattr(delivery,'SessionLocal',lambda:db)
    return delivery.deliver_one(send=send)


def test_successful_delivery_marks_sent_after_send(monkeypatch):
    db=Database(); sent=[]
    assert run_delivery(monkeypatch,db,lambda row,token:sent.append((row,token)))
    update=next(p for s,p in db.calls if 'UPDATE public.push_outbox' in s)
    assert update['state']=='SENT' and update['attempts']==1
    assert len(sent)==1 and db.committed and db.closed


@pytest.mark.parametrize('field,value', [('active',False),('is_active',False),('role','CUSTOMER'),('password_version',2),('user_id',uuid4())])
def test_invalid_or_reassigned_devices_are_not_sent(monkeypatch,field,value):
    db=Database(); db.device[field]=value
    def unexpected(*args): raise AssertionError('Must not send')
    run_delivery(monkeypatch,db,unexpected)
    update=next(p for s,p in db.calls if 'UPDATE public.push_outbox' in s)
    assert update['state']=='SKIPPED' and update['attempts']==0


@pytest.mark.parametrize('field',['expired','is_read'])
def test_expired_or_read_notifications_are_skipped(monkeypatch,field):
    db=Database(); db.outbox[field]=True
    sent=[]; run_delivery(monkeypatch,db,lambda *args:sent.append(args))
    assert not sent
    assert next(p for s,p in db.calls if 'UPDATE public.push_outbox' in s)['state']=='SKIPPED'


def test_temporary_failures_retry_without_exposing_exception_body(monkeypatch):
    db=Database()
    def fail(*args): raise RuntimeError('Sensitive token and request body')
    run_delivery(monkeypatch,db,fail)
    update=next(p for s,p in db.calls if 'UPDATE public.push_outbox' in s)
    assert update['state']=='PENDING' and update['attempts']==1 and update['delay']==10
    assert update['code']=='DELIVERY_UNAVAILABLE'
    assert 'Sensitive' not in str(db.calls)


def test_unregistered_token_is_disabled(monkeypatch):
    from firebase_admin import messaging
    db=Database()
    def fail(*args): raise messaging.UnregisteredError('Unregistered')
    run_delivery(monkeypatch,db,fail)
    assert any('UPDATE public.push_devices SET active = FALSE' in s for s,p in db.calls)
    assert next(p for s,p in db.calls if 'UPDATE public.push_outbox' in s)['state']=='FAILED'


def test_retry_limit_is_bounded(monkeypatch):
    db=Database(); db.outbox['attempts']=4
    def fail(*args): raise RuntimeError('Network down')
    run_delivery(monkeypatch,db,fail)
    assert next(p for s,p in db.calls if 'UPDATE public.push_outbox' in s)['state']=='FAILED'


def test_worker_disabled_by_default(monkeypatch):
    monkeypatch.delenv('PUSH_ENABLED',raising=False)
    assert delivery.deliver_pending_pushes()==0


def test_delivery_uses_skip_locked_claims(monkeypatch):
    db=Database(); db.outbox=None
    assert not run_delivery(monkeypatch,db,lambda *args:None)
    assert 'SKIP LOCKED' in db.calls[0][0] and db.rolled_back and db.closed
