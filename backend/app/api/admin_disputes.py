from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, Query
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.admin_audit import write_admin_audit
from app.core.admin_rbac import (
    get_admin_access,
    require_locked_super_admin,
    require_permission,
)
from app.core.notifications import create_notification
from app.db.database import get_db


router = APIRouter(prefix="/admin", tags=["Admin Disputes"])


class DisputeStatusUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["UNDER_REVIEW", "RESOLVED"]
    expected_version: Annotated[StrictInt, Field(ge=1)]
    reason: StrictStr = Field(min_length=3, max_length=1000)


@router.put("/disputes/{dispute_id}/status")
def update_dispute_status(
    dispute_id: UUID,
    payload: DisputeStatusUpdate,
    response: Response,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("disputes.resolve")),
):
    reason = payload.reason.strip()
    if len(reason) < 3:
        raise HTTPException(status_code=422, detail="Provide a meaningful reason")

    try:
        require_locked_super_admin(db, admin, "disputes.resolve")
        actor = get_admin_access(current_admin=admin, db=db)

        job_id = db.execute(
            text("SELECT job_id FROM public.job_disputes WHERE id = :id"),
            {"id": dispute_id},
        ).scalar_one_or_none()
        if job_id is None:
            raise HTTPException(status_code=404, detail="Dispute not found")

        # All completion and issue mutations serialize on the job first.
        job = db.execute(
            text("""
                SELECT j.id, j.status,
                       c.user_id AS customer_user_id,
                       t.user_id AS technician_user_id
                FROM public.jobs j
                JOIN public.customers c ON c.id = j.customer_id
                JOIN public.technicians t ON t.id = j.technician_id
                WHERE j.id = :job_id
                FOR UPDATE OF j
            """),
            {"job_id": job_id},
        ).mappings().one()

        review = db.execute(
            text("""
                SELECT status FROM public.job_completion_requests
                WHERE job_id = :job_id FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        db.execute(
            text("""
                SELECT id FROM public.job_happy_codes
                WHERE job_id = :job_id FOR UPDATE
            """),
            {"job_id": job_id},
        ).all()

        current = db.execute(
            text("""
                SELECT id, job_id, status, version, resolution_code
                FROM public.job_disputes
                WHERE id = :id FOR UPDATE
            """),
            {"id": dispute_id},
        ).mappings().one()

        if current["version"] != payload.expected_version:
            raise HTTPException(
                status_code=409, detail="Dispute changed. Refresh and retry."
            )
        if current["status"] == "RESOLVED":
            raise HTTPException(status_code=409, detail="Dispute already resolved")
        if job["status"] != "IN_PROGRESS":
            raise HTTPException(status_code=409, detail="Job must remain in progress")
        if review is None or review["status"] != "ISSUE_REPORTED":
            raise HTTPException(
                status_code=409, detail="Completion review requires investigation"
            )

        if current["status"] == payload.status:
            result = dict(current)
            db.rollback()
            response.headers["Cache-Control"] = "no-store"
            return {"status": "success", "changed": False, "dispute": result}

        resolving = payload.status == "RESOLVED"
        if not resolving and current["status"] != "OPEN":
            raise HTTPException(status_code=409, detail="Invalid review transition")

        if resolving:
            db.execute(
                text("""
                    UPDATE public.job_happy_codes
                    SET expires_at = LEAST(expires_at, clock_timestamp()),
                        updated_at = clock_timestamp()
                    WHERE job_id = :job_id
                """),
                {"job_id": job_id},
            )
            db.execute(
                text("""
                    UPDATE public.job_completion_requests
                    SET status = 'WORK_RESUMED',
                        approved_by = NULL,
                        approved_at = NULL,
                        completed_at = NULL,
                        updated_at = clock_timestamp()
                    WHERE job_id = :job_id
                """),
                {"job_id": job_id},
            )

        updated = db.execute(
            text("""
                UPDATE public.job_disputes
                SET status = :status,
                    version = version + 1,
                    resolution_code = :resolution_code,
                    resolution_reason = :resolution_reason,
                    resolved_by = CAST(:resolved_by AS uuid),
                    resolved_at = CASE WHEN :resolving
                                       THEN clock_timestamp() ELSE NULL END,
                    updated_at = clock_timestamp()
                WHERE id = :id
                RETURNING id, job_id, status, version, resolution_code,
                          resolution_reason, resolved_by, resolved_at, updated_at
            """),
            {
                "id": dispute_id,
                "status": payload.status,
                "resolution_code": "RETURN_TO_WORK" if resolving else None,
                "resolution_reason": reason if resolving else None,
                "resolved_by": actor["sub"] if resolving else None,
                "resolving": resolving,
            },
        ).mappings().one()

        fields = ("status", "version", "resolution_code")
        write_admin_audit(
            db=db,
            admin=actor,
            action=(
                "JOB_DISPUTE_RESOLVED"
                if resolving else "JOB_DISPUTE_REVIEW_STARTED"
            ),
            target_type="JOB_DISPUTE",
            target_id=dispute_id,
            before_values={key: current[key] for key in fields},
            after_values={key: updated[key] for key in fields},
            reason=reason,
        )

        for user_id in (job["customer_user_id"], job["technician_user_id"]):
            create_notification(
                db=db,
                user_id=str(user_id),
                title="Work Issue Resolved" if resolving else "Work Issue Under Review",
                message=(
                    "The issue was resolved by returning the job for corrective work. "
                    "A fresh technician review request and customer approval are required."
                    if resolving else
                    "An administrator has started reviewing the reported work issue."
                ),
                notification_type=(
                    "JOB_DISPUTE_RESOLVED" if resolving else "JOB_DISPUTE_UNDER_REVIEW"
                ),
                reference_id=str(job_id),
            )

        result = dict(updated)
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {"status": "success", "changed": True, "dispute": result}

    except Exception:
        db.rollback()
        raise


@router.get("/disputes")
def list_admin_disputes(
    response: Response,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=25, ge=1, le=100),
    dispute_status: Literal["OPEN", "UNDER_REVIEW", "RESOLVED"] | None = None,
    job_id: UUID | None = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("disputes.read")),
):
    clauses = []
    parameters = {
        "limit": page_size + 1,
        "offset": (page - 1) * page_size,
    }
    if dispute_status is not None:
        clauses.append("d.status = :dispute_status")
        parameters["dispute_status"] = dispute_status
    if job_id is not None:
        clauses.append("d.job_id = :job_id")
        parameters["job_id"] = job_id

    where = " WHERE " + " AND ".join(clauses) if clauses else ""
    rows = db.execute(
        text("""
            SELECT d.id, d.job_id, d.description, d.status, d.version,
                   d.resolution_code, d.resolution_reason,
                   d.created_at, d.updated_at, d.resolved_at,
                   j.status AS job_status
            FROM public.job_disputes d
            JOIN public.jobs j ON j.id = d.job_id
        """ + where + """
            ORDER BY d.created_at DESC, d.id DESC
            LIMIT :limit OFFSET :offset
        """),
        parameters,
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "success",
        "disputes": [dict(row) for row in rows[:page_size]],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "has_more": len(rows) > page_size,
        },
    }


@router.get("/disputes/{dispute_id}")
def get_admin_dispute(
    dispute_id: UUID,
    response: Response,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("disputes.read")),
):
    row = db.execute(
        text("""
            SELECT d.id, d.job_id, d.description, d.status, d.version,
                   d.resolution_code, d.resolution_reason,
                   d.created_at, d.updated_at, d.resolved_at,
                   j.status AS job_status,
                   r.status AS completion_review_status
            FROM public.job_disputes d
            JOIN public.jobs j ON j.id = d.job_id
            LEFT JOIN public.job_completion_requests r ON r.job_id = d.job_id
            WHERE d.id = :id
        """),
        {"id": dispute_id},
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Dispute not found")

    response.headers["Cache-Control"] = "no-store"
    return {"status": "success", "dispute": dict(row)}
