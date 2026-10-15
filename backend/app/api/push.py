from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.api.passwords import PasswordRoute
from app.core.security import get_current_user
from app.db.database import get_db
from app.services.push_delivery import push_enabled

# Reuse input-redacting validation responses for device tokens.
router = APIRouter(prefix='/push', tags=['Android Push'], route_class=PasswordRoute)


class DeviceRegistration(BaseModel):
    model_config = ConfigDict(extra='forbid')
    installation_id: UUID
    token: StrictStr = Field(min_length=20, max_length=4096, repr=False, exclude=True)

    @field_validator('token')
    @classmethod
    def valid_token(cls, value):
        if not value.isascii() or any(c.isspace() or ord(c) < 33 for c in value):
            raise ValueError('Invalid notification registration token')
        return value


def technician_only(user):
    if user.get('role') != 'TECHNICIAN':
        raise HTTPException(403, 'Technician access required')


@router.post('/devices')
def register_device(data: DeviceRegistration, response: Response,
                    user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    technician_only(user)
    try:
        account = db.execute(text('''
            SELECT role, is_active, password_version FROM public.users
            WHERE id = :id FOR UPDATE
        '''), {'id': user['sub']}).mappings().first()
        if not account or not account['is_active'] or account['role'] != 'TECHNICIAN':
            raise HTTPException(403, 'Active technician account required')
        if account['password_version'] != user.get('password_version', 0):
            raise HTTPException(401, 'Please log in again')
        count = db.execute(text('''
            SELECT COUNT(*) FROM public.push_devices
            WHERE user_id = :id AND active AND installation_id != :installation
        '''), {'id': user['sub'], 'installation': data.installation_id}).scalar_one()
        if count >= 5:
            raise HTTPException(409, 'Five phones are already registered. Sign out on an unused phone first.')
        db.execute(text('''
            INSERT INTO public.push_devices (installation_id, user_id, token, auth_version)
            VALUES (:installation, :user, :token, :version)
            ON CONFLICT (installation_id) DO UPDATE SET
                user_id = EXCLUDED.user_id, token = EXCLUDED.token,
                auth_version = EXCLUDED.auth_version, active = TRUE, updated_at = now()
        '''), {'installation': data.installation_id, 'user': user['sub'],
               'token': data.token, 'version': account['password_version']})
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, 'Phone registration changed. Try registering this phone again.') from None
    except Exception:
        db.rollback()
        raise
    response.headers['Cache-Control'] = 'no-store'
    return {'status': 'registered', 'delivery_enabled': push_enabled()}


@router.delete('/devices/{installation_id}')
def unregister_device(installation_id: UUID, response: Response,
                      user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    technician_only(user)
    try:
        db.execute(text('''
            UPDATE public.push_devices SET active = FALSE, updated_at = now()
            WHERE installation_id = :installation AND user_id = :user
        '''), {'installation': installation_id, 'user': user['sub']})
        db.commit()
    except Exception:
        db.rollback()
        raise
    response.headers['Cache-Control'] = 'no-store'
    return {'status': 'unregistered'}
