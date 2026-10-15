from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator
from datetime import date
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.core.personal_details import optional_email, optional_birth_date
from app.core.security import get_current_user
from app.db.database import get_db

router = APIRouter(prefix="/customers/me/profile", tags=["Customer profile"])


class CustomerProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: StrictStr = Field(min_length=2, max_length=150)
    email: StrictStr | None = Field(default=None, max_length=254)
    date_of_birth: date | None = None

    _email = field_validator("email", mode="before")(optional_email)
    _dob = field_validator("date_of_birth", mode="before")(optional_birth_date)

    @field_validator("full_name")
    @classmethod
    def name(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Enter your full name")
        return value


def require_customer(user):
    if user.get("role") != "CUSTOMER":
        raise HTTPException(403, "Customer access required")


@router.get("")
def get_profile(response: Response, current_user=Depends(get_current_user), db=Depends(get_db)):
    require_customer(current_user)
    row = db.execute(text("""
        SELECT u.full_name, u.phone, u.email, c.date_of_birth
        FROM public.users u JOIN public.customers c ON c.user_id = u.id
        WHERE u.id = CAST(:actor AS uuid) AND u.is_active = TRUE
    """), {"actor": current_user["sub"]}).mappings().first()
    if row is None:
        raise HTTPException(404, "Customer profile not found")
    response.headers["Cache-Control"] = "no-store"
    return {"profile": dict(row)}


@router.put("")
def update_profile(data: CustomerProfileUpdate, response: Response,
                   current_user=Depends(get_current_user), db=Depends(get_db)):
    require_customer(current_user)
    try:
        if data.email:
            db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:email, 0))"), {"email": data.email})
            duplicate = db.execute(text("""
                SELECT id FROM public.users
                WHERE lower(email) = :email AND id <> CAST(:actor AS uuid) LIMIT 1
            """), {"email": data.email, "actor": current_user["sub"]}).first()
            if duplicate:
                raise HTTPException(409, "This email is already registered")
        row = db.execute(text("""
            SELECT c.id FROM public.customers c JOIN public.users u ON u.id = c.user_id
            WHERE u.id = CAST(:actor AS uuid) AND u.is_active = TRUE FOR UPDATE OF u, c
        """), {"actor": current_user["sub"]}).first()
        if row is None:
            raise HTTPException(404, "Customer profile not found")
        db.execute(text("""
            UPDATE public.users SET full_name = :name, email = :email
            WHERE id = CAST(:actor AS uuid)
        """), {"actor": current_user["sub"], "name": data.full_name, "email": data.email})
        db.execute(text("""
            UPDATE public.customers SET date_of_birth = :dob WHERE user_id = CAST(:actor AS uuid)
        """), {"actor": current_user["sub"], "dob": data.date_of_birth})
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {"status": "success", "message": "Profile saved"}
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "This email is already registered") from None
    except Exception:
        db.rollback()
        raise
