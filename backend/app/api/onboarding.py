"""Account-first onboarding. Drafts never confer work eligibility."""
import json
from uuid import UUID

from app.core.safe_routes import SafeRoute

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.auth import (
    CustomerRegistration, TechnicianDetails, validate_technician_choices,
    save_technician_application, registration_hash_password,
)
from app.core.security import create_access_token, get_current_user
from app.db.database import get_db

router = APIRouter(prefix="/auth", tags=["Technician onboarding"], route_class=SafeRoute)


@router.post("/register/technician/account", status_code=201)
def create_account(data: CustomerRegistration, response: Response, db=Depends(get_db)):
    try:
        if data.email:
            db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:email, 0))"), {"email": data.email})
        existing = db.execute(text("""
            SELECT id FROM public.users WHERE public.registration_mobile_key(phone) = :phone
                OR lower(email) = CAST(:email AS text) LIMIT 1
        """), {"phone": data.phone, "email": data.email}).first()
        if existing:
            raise HTTPException(409, "Mobile number or email already registered. Please sign in.")
        user_id = db.execute(text("""
            INSERT INTO public.users (full_name, phone, email, password_hash, role, is_active, is_verified)
            VALUES (:name, :phone, :email, :hash, 'TECHNICIAN', TRUE, FALSE) RETURNING id
        """), {"name": data.full_name, "phone": data.phone, "email": data.email,
               "hash": registration_hash_password(data.password)}).scalar_one()
        technician_id = db.execute(text("""
            INSERT INTO public.technicians (user_id, experience_years, service_radius_km, kyc_status, availability_status)
            VALUES (:user_id, 0, 10, 'SUBMITTED', 'OFFLINE') RETURNING id
        """), {"user_id": user_id}).scalar_one()
        db.execute(text("""
            INSERT INTO public.technician_kyc (technician_id, verification_status, address_verified)
            VALUES (:id, 'SUBMITTED', FALSE)
        """), {"id": technician_id})
        initial_details = {"email": data.email or ""}
        if data.date_of_birth is not None:
            initial_details["date_of_birth"] = data.date_of_birth.isoformat()
        db.execute(text("""
            INSERT INTO public.technician_onboarding_drafts (technician_id, details)
            VALUES (:id, CAST(:details AS jsonb))
        """), {"id": technician_id, "details": json.dumps(initial_details)})
        token = create_access_token({"sub": str(user_id), "role": "TECHNICIAN",
                                     "technician_id": str(technician_id), "password_version": 0})
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {"access_token": token, "token_type": "bearer", "user": {
            "user_id": str(user_id), "technician_id": str(technician_id), "role": "TECHNICIAN",
            "full_name": data.full_name, "is_verified": False, "phone_verified": False,
        }}
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Mobile number or email already registered. Please sign in.") from None
    except Exception:
        db.rollback()
        raise


def lock_technician(db, actor):
    if actor.get("role") != "TECHNICIAN":
        raise HTTPException(403, "Technician access required")
    row = db.execute(text("""
        SELECT t.id FROM public.technicians t JOIN public.users u ON u.id = t.user_id
        WHERE t.id = CAST(:id AS uuid) AND u.id = CAST(:actor AS uuid)
          AND u.is_active = TRUE FOR UPDATE OF t, u
    """), {"id": actor.get("technician_id"), "actor": actor["sub"]}).first()
    if row is None:
        raise HTTPException(404, "Technician account not found")
    return actor["technician_id"]


class DraftUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: StrictInt = Field(ge=0)
    details: dict = Field(max_length=20)

    @field_validator("details")
    @classmethod
    def safe_draft(cls, value):
        allowed = set(TechnicianDetails.model_fields)
        if set(value) - allowed:
            raise ValueError("Unknown onboarding field; never save passwords in a draft")
        for key, entry in value.items():
            if key.endswith("_ids"):
                if not isinstance(entry, list) or len(entry) > 50:
                    raise ValueError("Too many selections")
                for item in entry:
                    if not isinstance(item, str):
                        raise ValueError("Invalid selection")
                    UUID(item)
            elif not isinstance(entry, str) or len(entry) > 1000:
                raise ValueError("Invalid onboarding detail")
        return value


@router.get("/technician/onboarding")
def get_draft(response: Response, current_user=Depends(get_current_user), db=Depends(get_db)):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(403, "Technician access required")
    row = db.execute(text("""
        SELECT COALESCE(d.details, jsonb_build_object('email', COALESCE(u.email, ''))) AS details,
               COALESCE(d.version, 0) AS version
        FROM public.technicians t JOIN public.users u ON u.id = t.user_id
        LEFT JOIN public.technician_onboarding_drafts d ON d.technician_id = t.id
        WHERE t.id = CAST(:id AS uuid) AND t.user_id = CAST(:actor AS uuid)
    """), {"id": current_user.get("technician_id"), "actor": current_user["sub"]}).mappings().first()
    response.headers["Cache-Control"] = "no-store"
    return {"draft": dict(row) if row else {"details": {}, "version": 0}}


@router.put("/technician/onboarding")
def save_draft(data: DraftUpdate, response: Response, current_user=Depends(get_current_user), db=Depends(get_db)):
    try:
        tid = lock_technician(db, current_user)
        if db.execute(text("SELECT id FROM public.technician_applications WHERE technician_id = CAST(:id AS uuid)"), {"id": tid}).first():
            raise HTTPException(409, "Application already submitted. Refresh its status.")
        existing = db.execute(text("SELECT version FROM public.technician_onboarding_drafts WHERE technician_id = CAST(:id AS uuid)"), {"id": tid}).scalar_one_or_none()
        version = existing or 0
        if version != data.expected_version:
            raise HTTPException(409, "Your draft changed in another tab. Reload before editing.")
        db.execute(text("""
            INSERT INTO public.technician_onboarding_drafts (technician_id, details, version)
            VALUES (CAST(:id AS uuid), CAST(:details AS jsonb), :version)
            ON CONFLICT (technician_id) DO UPDATE SET details = EXCLUDED.details,
                version = EXCLUDED.version, updated_at = clock_timestamp()
        """), {"id": tid, "details": json.dumps(data.details), "version": version + 1})
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {"version": version + 1, "message": "Progress saved"}
    except Exception:
        db.rollback()
        raise


@router.post("/technician/onboarding/submit", status_code=201)
def submit_application(data: TechnicianDetails, response: Response,
                       current_user=Depends(get_current_user), db=Depends(get_db)):
    try:
        db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:email, 0))"), {"email": data.email})
        tid = lock_technician(db, current_user)
        if db.execute(text("SELECT id FROM public.technician_applications WHERE technician_id = CAST(:id AS uuid)"), {"id": tid}).first():
            raise HTTPException(409, "Application already submitted. Refresh its status.")
        validate_technician_choices(db, data)
        if db.execute(text("SELECT id FROM public.users WHERE lower(email) = :email AND id <> CAST(:id AS uuid) LIMIT 1"), {"email": data.email, "id": current_user["sub"]}).first():
            raise HTTPException(409, "Email already registered")
        db.execute(text("UPDATE public.users SET email = :email WHERE id = CAST(:id AS uuid)"), {"email": data.email, "id": current_user["sub"]})
        db.execute(text("""
            UPDATE public.technicians SET experience_years = :experience, service_radius_km = :radius
            WHERE id = CAST(:id AS uuid)
        """), {"id": tid, "experience": data.experience_years, "radius": data.service_radius_km})
        application_id = save_technician_application(db, data, tid)
        db.execute(text("DELETE FROM public.technician_onboarding_drafts WHERE technician_id = CAST(:id AS uuid)"), {"id": tid})
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {"status": "success", "application_id": str(application_id),
                "message": "Application sent. A representative will contact you for verification. Stay offline until approved."}
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Application or email changed. Refresh before trying again.") from None
    except Exception:
        db.rollback()
        raise
