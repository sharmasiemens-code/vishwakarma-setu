from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.admin_rbac import require_permission
from app.db.database import get_db


router = APIRouter(prefix="/admin", tags=["Admin Audit"])

AuditAction = Literal[
    "ADMIN_ROLE_ASSIGNED",
    "ADMIN_USER_CREATED",
    "ADMIN_USER_STATUS_CHANGED",
    "TECHNICIAN_ACCOUNT_STATUS_CHANGED",
    "TECHNICIAN_KYC_STATUS_CHANGED",
    "SYSTEM_SETTING_CHANGED",
]

TargetType = Literal["USER", "TECHNICIAN", "TECHNICIAN_KYC", "SYSTEM_SETTING"]


@router.get("/audit-logs")
def list_admin_audit_logs(
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=25, ge=1, le=100),
    action: AuditAction | None = None,
    actor_user_id: UUID | None = None,
    target_type: TargetType | None = None,
    target_id: UUID | None = None,
    created_from: datetime | None = None,
    created_to: datetime | None = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("audit.read")),
):
    """
    Read audit events. Date filters are inclusive and require a timezone.
    This endpoint exposes no audit mutation operations.
    """
    for value in (created_from, created_to):
        if value is not None and (
            value.tzinfo is None or value.utcoffset() is None
        ):
            raise HTTPException(
                status_code=422,
                detail="Audit date filters must include a timezone",
            )

    if (
        created_from is not None
        and created_to is not None
        and created_from > created_to
    ):
        raise HTTPException(
            status_code=422,
            detail="created_from must not exceed created_to",
        )

    clauses = []
    parameters = {}

    for column, value in (
        ("action", action),
        ("actor_user_id", actor_user_id),
        ("target_type", target_type),
        ("target_id", target_id),
    ):
        if value is not None:
            clauses.append(f"{column} = :{column}")
            parameters[column] = value

    if created_from is not None:
        clauses.append("created_at >= :created_from")
        parameters["created_from"] = created_from

    if created_to is not None:
        clauses.append("created_at <= :created_to")
        parameters["created_to"] = created_to

    where = " WHERE " + " AND ".join(clauses) if clauses else ""

    # Fetch one extra row to determine whether another page exists.
    # A separate total-count query is avoided.
    parameters["limit"] = page_size + 1
    parameters["offset"] = (page - 1) * page_size

    rows = db.execute(
        text(
            """
            SELECT
                id,
                actor_user_id,
                actor_role_code,
                action,
                target_type,
                target_id,
                before_values,
                after_values,
                reason,
                created_at
            FROM public.admin_audit_logs
            """
            + where
            + """
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        parameters,
    ).mappings().all()

    return {
        "status": "success",
        "audit_logs": [dict(row) for row in rows[:page_size]],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "has_more": len(rows) > page_size,
        },
    }
