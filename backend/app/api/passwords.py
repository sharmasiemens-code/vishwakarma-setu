"""Manual recovery only. Never expose existing hashes or passwords."""
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StrictStr, field_validator, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.admin_audit import write_admin_audit
from app.core.admin_rbac import require_permission, require_locked_super_admin
from app.core.security import get_current_user, hash_password, verify_password
from app.db.database import get_db

class PasswordRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()

        async def handler(request):
            try:
                return await original(request)
            except RequestValidationError as exc:
                # FastAPI's default error includes submitted input, including secrets.
                errors = [{"loc": e["loc"], "msg": e["msg"], "type": e["type"]}
                          for e in exc.errors()]
                return JSONResponse(status_code=422, content={"detail": errors},
                                    headers={"Cache-Control": "no-store"})
        return handler


router = APIRouter(tags=["Password Management"], route_class=PasswordRoute)


class NewPassword(BaseModel):
    model_config = ConfigDict(extra="forbid")
    new_password: StrictStr = Field(min_length=8, max_length=72, repr=False, exclude=True)
    confirm_password: StrictStr = Field(min_length=8, max_length=72, repr=False, exclude=True)

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, value):
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must not exceed 72 UTF-8 bytes")
        if value != value.strip() or any(ord(c) < 32 or ord(c) == 127 for c in value):
            raise ValueError("Password cannot contain control characters or surrounding spaces")
        if not any(c.isalpha() for c in value) or not any(c.isdigit() for c in value):
            raise ValueError("Password must contain a letter and a number")
        return value

    @model_validator(mode="after")
    def matching_passwords(self):
        if self.new_password != self.confirm_password:
            raise ValueError("New passwords do not match")
        return self


class ChangePassword(NewPassword):
    current_password: StrictStr = Field(min_length=1, max_length=128, repr=False, exclude=True)


class ResetPassword(NewPassword):
    expected_version: int = Field(ge=0, strict=True)
    reason: StrictStr = Field(min_length=3, max_length=1000)
    identity_verified: bool = Field(strict=True)

    @model_validator(mode="after")
    def verified_identity(self):
        if not self.identity_verified:
            raise ValueError("Verify the account owner's identity before resetting")
        if len(self.reason.strip()) < 3:
            raise ValueError("Enter a meaningful reset reason; do not include passwords")
        return self


def password_matches(value, stored):
    try:
        return bool(stored) and verify_password(value, stored)
    except (ValueError, TypeError):
        return False


def locked_user(db, user_id):
    row = db.execute(text("""
        SELECT id, role, is_active, password_hash, password_version
        FROM public.users WHERE id = :id FOR UPDATE
    """), {"id": user_id}).mappings().first()
    if not row:
        raise HTTPException(404, "Account not found")
    if row["role"] not in {"CUSTOMER", "TECHNICIAN"}:
        raise HTTPException(403, "This operation supports customers and technicians only")
    if not row["is_active"]:
        raise HTTPException(403, "Inactive accounts cannot change or reset passwords")
    return row


def update_password(db, row, value):
    if password_matches(value, row["password_hash"]):
        raise HTTPException(400, "Choose a different password")
    db.execute(text("""
        UPDATE public.users SET password_hash = :hash,
            password_version = password_version + 1, updated_at = NOW()
        WHERE id = :id
    """), {"id": row["id"], "hash": hash_password(value)})


@router.post("/auth/change-password")
def change_password(data: ChangePassword, response: Response,
                    current_user: dict = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    try:
        row = locked_user(db, current_user["sub"])
        # Recheck after obtaining the lock: concurrent reset/change invalidates this session.
        if current_user.get("password_version", 0) != row["password_version"]:
            raise HTTPException(401, "Password changed. Please log in again")
        if not password_matches(data.current_password, row["password_hash"]):
            raise HTTPException(400, "Current password is incorrect")
        update_password(db, row, data.new_password)
        db.commit()
    except Exception:
        db.rollback()
        raise
    response.headers["Cache-Control"] = "no-store"
    return {"status": "success", "message": "Password changed. Please log in again."}


@router.get("/admin/password-recovery/accounts")
def recovery_accounts(response: Response,
                      search: str = Query(min_length=2, max_length=150),
                      role: Literal["CUSTOMER", "TECHNICIAN"] | None = None,
                      page: int = Query(default=1, ge=1, le=10000),
                      db: Session = Depends(get_db),
                      admin: dict = Depends(require_permission("passwords.reset"))):
    value = search.strip()
    if len(value) < 2:
        raise HTTPException(422, "Enter at least two characters")
    # Treat wildcard characters literally.
    value = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    rows = db.execute(text("""
        SELECT id, full_name, email, phone, role, is_active, password_version
        FROM public.users
        WHERE role IN ('CUSTOMER', 'TECHNICIAN')
          AND (CAST(:role AS text) IS NULL OR role = :role)
          AND (full_name ILIKE :search OR email ILIKE :search OR phone ILIKE :search)
        ORDER BY full_name, id LIMIT 26 OFFSET :offset
    """), {"role": role, "search": "%" + value + "%", "offset": (page - 1) * 25}).mappings().all()
    response.headers["Cache-Control"] = "no-store"
    return {"accounts": [dict(r) for r in rows[:25]], "has_more": len(rows) > 25}


@router.post("/admin/password-recovery/accounts/{user_id}/reset")
def reset_password(user_id: UUID, data: ResetPassword, response: Response,
                   admin: dict = Depends(require_permission("passwords.reset")),
                   db: Session = Depends(get_db)):
    try:
        # Recheck privileges under the same transaction as the mutation.
        require_locked_super_admin(db, admin, "passwords.reset")
        row = locked_user(db, user_id)
        if row["password_version"] != data.expected_version:
            raise HTTPException(409, "Account password changed. Search again before resetting")
        update_password(db, row, data.new_password)
        write_admin_audit(
            db=db, admin=admin, action="USER_PASSWORD_RESET", target_type="USER",
            target_id=user_id,
            before_values={"password_version": row["password_version"]},
            after_values={"password_version": row["password_version"] + 1},
            reason=data.reason.strip(),
        )
        db.commit()
    except Exception:
        db.rollback()
        raise
    response.headers["Cache-Control"] = "no-store"
    return {"status": "success", "message": "Password reset. Previous sessions have been revoked."}
