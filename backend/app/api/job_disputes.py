from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, Query
from pydantic import BaseModel, ConfigDict, Field, StrictStr
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.notifications import create_notification
from app.core.security import get_current_user
from app.db.database import get_db


router = APIRouter(prefix="/jobs", tags=["Job Disputes"])


class JobIssueReport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: StrictStr = Field(min_length=10, max_length=2000)


@router.post("/{job_id}/disputes")
def report_job_issue(
    job_id: UUID,
    payload: JobIssueReport,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(status_code=403, detail="Customer access required")

    description = payload.description.strip()
    if len(description) < 10:
        raise HTTPException(
            status_code=422,
            detail="Describe the work issue in at least ten characters",
        )

    try:
        job = db.execute(
            text("""
                SELECT j.id, j.status, t.user_id AS technician_user_id
                FROM public.jobs j
                JOIN public.customers c ON c.id = j.customer_id
                JOIN public.users u ON u.id = c.user_id
                JOIN public.technicians t ON t.id = j.technician_id
                WHERE j.id = :job_id
                  AND u.id = CAST(:actor_id AS uuid)
                  AND u.role = 'CUSTOMER'
                  AND u.is_active = TRUE
                  AND u.is_verified = TRUE
                FOR UPDATE OF j
            """),
            {"job_id": job_id, "actor_id": current_user["sub"]},
        ).mappings().first()

        if job is None:
            raise HTTPException(status_code=404, detail="Job not found")

        if job["status"] != "IN_PROGRESS":
            raise HTTPException(
                status_code=409,
                detail="Completion issues can be reported only while work is in progress",
            )

        completion = db.execute(
            text("""
                SELECT status
                FROM public.job_completion_requests
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if completion is None:
            raise HTTPException(
                status_code=409,
                detail="A technician completion request is required for this review",
            )

        if completion["status"] == "COMPLETED":
            raise HTTPException(
                status_code=409,
                detail="Completion has already been confirmed",
            )

        existing = db.execute(
            text("""
                SELECT id, job_id, description, status, version, created_at
                FROM public.job_disputes
                WHERE job_id = :job_id
                  AND status IN ('OPEN', 'UNDER_REVIEW')
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if existing is not None:
            result = dict(existing)
            db.rollback()
            response.headers["Cache-Control"] = "no-store"
            return {
                "status": "success",
                "changed": False,
                "message": "This job already has an open issue",
                "dispute": result,
            }

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
                SET status = 'ISSUE_REPORTED',
                    updated_at = clock_timestamp()
                WHERE job_id = :job_id
            """),
            {"job_id": job_id},
        )

        row = db.execute(
            text("""
                INSERT INTO public.job_disputes (
                    job_id, reported_by, description
                )
                VALUES (:job_id, CAST(:actor_id AS uuid), :description)
                RETURNING id, job_id, description, status, version, created_at
            """),
            {
                "job_id": job_id,
                "actor_id": current_user["sub"],
                "description": description,
            },
        ).mappings().one()

        create_notification(
            db=db,
            user_id=str(job["technician_user_id"]),
            title="Customer Reported a Work Issue",
            message=(
                "The customer reported an issue with the work. "
                "Completion is blocked pending review and resolution."
            ),
            notification_type="JOB_ISSUE_REPORTED",
            reference_id=str(job_id),
        )

        result = dict(row)
        db.commit()
        response.headers["Cache-Control"] = "no-store"

        return {
            "status": "success",
            "changed": True,
            "message": "Issue reported. Completion is blocked pending resolution.",
            "dispute": result,
        }

    except Exception:
        db.rollback()
        raise


@router.get("/{job_id}/disputes")
def list_job_disputes(
    job_id: UUID,
    response: Response,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=25, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    if role not in {"CUSTOMER", "TECHNICIAN"}:
        raise HTTPException(
            status_code=403,
            detail="Customer or assigned technician access required",
        )

    allowed = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.jobs j
                JOIN public.customers c ON c.id = j.customer_id
                JOIN public.technicians t ON t.id = j.technician_id
                JOIN public.users actor ON actor.id = CAST(:actor_id AS uuid)
                WHERE j.id = :job_id
                  AND actor.is_active = TRUE
                  AND actor.is_verified = TRUE
                  AND actor.role = :role
                  AND (
                      (actor.role = 'CUSTOMER' AND c.user_id = actor.id)
                      OR
                      (actor.role = 'TECHNICIAN' AND t.user_id = actor.id)
                  )
            )
        """),
        {"job_id": job_id, "actor_id": current_user["sub"], "role": role},
    ).scalar_one()

    if not allowed:
        raise HTTPException(status_code=404, detail="Job not found")

    rows = db.execute(
        text("""
            SELECT id, job_id, description, status, version,
                   resolution_code, resolution_reason,
                   created_at, updated_at, resolved_at
            FROM public.job_disputes
            WHERE job_id = :job_id
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
        """),
        {
            "job_id": job_id,
            "limit": page_size + 1,
            "offset": (page - 1) * page_size,
        },
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "success",
        "job_id": str(job_id),
        "disputes": [dict(row) for row in rows[:page_size]],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "has_more": len(rows) > page_size,
        },
    }
