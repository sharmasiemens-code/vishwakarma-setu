from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictInt
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.admin_audit import write_admin_audit
from app.core.admin_rbac import require_permission, require_locked_super_admin
from app.core.system_settings import (
    SETTING_DEFINITIONS,
    get_system_settings,
    validate_setting_value,
)
from app.db.database import get_db


router = APIRouter(prefix="/admin", tags=["System Settings"])

SettingKey = Literal[
    "gps_timeout_minutes",
    "unmatched_request_minutes",
    "stuck_active_job_hours",
]


class SystemSettingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: StrictInt
    expected_version: Annotated[StrictInt, Field(ge=1)]
    reason: str = Field(min_length=3, max_length=1000)


def serialize_setting(row):
    return {
        **dict(row),
        **SETTING_DEFINITIONS[row["key"]],
    }


@router.get("/settings")
def list_system_settings(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("settings.read")),
):
    # Check completeness and bounds before presenting configuration.
    get_system_settings(db)

    rows = db.execute(
        text("""
            SELECT id, key, value, version, updated_by, updated_at
            FROM public.system_settings
            ORDER BY key
        """)
    ).mappings().all()

    return {
        "status": "success",
        "settings": [serialize_setting(row) for row in rows],
    }


@router.put("/settings/{setting_key}")
def update_system_setting(
    setting_key: SettingKey,
    payload: SystemSettingUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("settings.write")),
):
    try:
        try:
            validate_setting_value(setting_key, payload.value)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

        reason = payload.reason.strip()
        if len(reason) < 3:
            raise HTTPException(
                status_code=422,
                detail="Provide a meaningful reason of at least three characters",
            )

        # Recheck current Super Admin privileges after acquiring locks.
        require_locked_super_admin(db, admin, "settings.write")

        current = db.execute(
            text("""
                SELECT id, key, value, version, updated_by, updated_at
                FROM public.system_settings
                WHERE key = :key
                FOR UPDATE
            """),
            {"key": setting_key},
        ).mappings().first()

        if current is None:
            raise HTTPException(
                status_code=409,
                detail="System setting is not configured",
            )

        if current["version"] != payload.expected_version:
            raise HTTPException(
                status_code=409,
                detail="Setting changed since it was loaded. Refresh and retry.",
            )

        if current["value"] == payload.value:
            result = serialize_setting(current)
            db.rollback()
            return {
                "status": "success",
                "changed": False,
                "message": "Setting already has this value",
                "setting": result,
            }

        updated = db.execute(
            text("""
                UPDATE public.system_settings
                SET value = :value,
                    version = version + 1,
                    updated_by = CAST(:actor_id AS uuid),
                    updated_at = clock_timestamp()
                WHERE id = :id
                RETURNING id, key, value, version, updated_by, updated_at
            """),
            {
                "id": current["id"],
                "value": payload.value,
                "actor_id": admin["sub"],
            },
        ).mappings().one()

        write_admin_audit(
            db=db,
            admin=admin,
            action="SYSTEM_SETTING_CHANGED",
            target_type="SYSTEM_SETTING",
            target_id=current["id"],
            before_values={
                "key": current["key"],
                "value": current["value"],
                "version": current["version"],
            },
            after_values={
                "key": updated["key"],
                "value": updated["value"],
                "version": updated["version"],
            },
            reason=reason,
        )

        result = serialize_setting(updated)
        db.commit()

        return {
            "status": "success",
            "changed": True,
            "message": "System setting updated",
            "setting": result,
        }

    except Exception:
        db.rollback()
        raise
