from decimal import Decimal as BillingDecimal
import re as billing_re
from pydantic import (
    BaseModel as BillingBaseModel,
    ConfigDict as BillingConfigDict,
    Field as BillingField,
    StrictInt as BillingStrictInt,
    StrictStr as BillingStrictStr,
    field_validator as billing_validator,
)


class CompletionWorkSummary(BillingBaseModel):
    model_config = BillingConfigDict(extra="forbid")
    summary: BillingStrictStr = BillingField(min_length=10, max_length=2000)
    expected_version: BillingStrictInt = BillingField(ge=1)

    @billing_validator("summary")
    @classmethod
    def clean_summary(cls, value):
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Describe the completed work in at least ten characters")
        return value


def build_completion_price_sheet(job):
    summary = job["completion_work_summary"]
    amount = job["estimated_amount"]
    if not summary:
        raise HTTPException(
            status_code=409,
            detail="Ask the technician to add the completed-work summary first",
        )
    if amount is None or not amount.is_finite() or amount < 0:
        raise HTTPException(
            status_code=409,
            detail="A valid agreed amount is required before completion approval",
        )
    return {
        "work_summary": summary,
        "summary_version": job["completion_summary_version"],
        "currency": "INR",
        "agreed_amount": format(amount, ".2f"),
        "total_payable": format(amount, ".2f"),
    }


from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import Response
from pydantic import BaseModel, ConfigDict, StrictBool

from app.core.job_happy_code import (
    create_happy_code_verifier,
    generate_happy_code,
    matches_happy_code,
)
from app.core.job_start_pin import matches_start_pin

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.notifications import create_notification
from app.core.security import get_current_user
from app.db.database import get_db


router = APIRouter(prefix="/jobs", tags=["Job Completion"])


@router.post("/{job_id}/completion-request")
def request_job_completion(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Technician access required")

    technician_id = current_user.get("technician_id")
    if not technician_id:
        raise HTTPException(status_code=403, detail="Technician profile required")

    try:
        # Shared lock order: job, completion request, Happy Code.
        job = db.execute(
            text("""
                SELECT j.id, j.status, c.user_id AS customer_user_id
                FROM public.jobs j
                JOIN public.technicians t ON t.id = j.technician_id
                JOIN public.users u ON u.id = t.user_id
                JOIN public.customers c ON c.id = j.customer_id
                WHERE j.id = :job_id
                  AND t.id = CAST(:technician_id AS uuid)
                  AND u.id = CAST(:actor_id AS uuid)
                  AND u.role = 'TECHNICIAN'
                  AND u.is_active = TRUE
                  AND u.is_verified = TRUE
                FOR UPDATE OF j
            """),
            {
                "job_id": job_id,
                "technician_id": technician_id,
                "actor_id": current_user["sub"],
            },
        ).mappings().first()

        if job is None:
            raise HTTPException(status_code=404, detail="Assigned job not found")

        if job["status"] != "IN_PROGRESS":
            raise HTTPException(
                status_code=409,
                detail="Completion can be requested only while work is in progress",
            )

        require_no_open_job_dispute(db, job_id)

        existing = db.execute(
            text("""
                SELECT id, job_id, status, requested_at,
                       approved_at, completed_at, updated_at
                FROM public.job_completion_requests
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if existing is not None and existing["status"] != "WORK_RESUMED":
            if existing["status"] == "ISSUE_REPORTED":
                raise HTTPException(
                    status_code=409,
                    detail="The reported issue must be resolved before completion",
                )

            if existing["status"] == "COMPLETED":
                raise HTTPException(
                    status_code=409,
                    detail="Completion has already been confirmed",
                )

            result = dict(existing)
            db.rollback()
            return {
                "status": "success",
                "changed": False,
                "message": "Completion has already been requested",
                "completion_request": result,
            }

        if existing is not None:
            row = db.execute(
                text("""
                    UPDATE public.job_completion_requests
                    SET status = 'REQUESTED',
                        requested_by = CAST(:actor_id AS uuid),
                        requested_at = clock_timestamp(),
                        approved_by = NULL,
                        approved_at = NULL,
                        completed_at = NULL,
                        updated_at = clock_timestamp()
                    WHERE job_id = :job_id
                    RETURNING id, job_id, status, requested_at,
                              approved_at, completed_at, updated_at
                """),
                {"job_id": job_id, "actor_id": current_user["sub"]},
            ).mappings().one()
        else:
            row = db.execute(
                text("""
                    INSERT INTO public.job_completion_requests (
                        job_id, requested_by
                    )
                    VALUES (:job_id, CAST(:actor_id AS uuid))
                    RETURNING id, job_id, status, requested_at,
                              approved_at, completed_at, updated_at
                """),
                {"job_id": job_id, "actor_id": current_user["sub"]},
            ).mappings().one()

        create_notification(
            db=db,
            user_id=str(job["customer_user_id"]),
            title="Please Review Completed Work",
            message=(
                "Your technician has requested completion confirmation. "
                "Review the work before approving and sharing your Happy Code."
            ),
            notification_type="JOB_COMPLETION_REQUESTED",
            reference_id=str(job_id),
        )

        result = dict(row)
        db.commit()

        return {
            "status": "success",
            "changed": True,
            "message": "Completion requested. Waiting for customer review.",
            "completion_request": result,
        }

    except Exception:
        db.rollback()
        raise


class CompletionApproval(BaseModel):
    model_config = ConfigDict(extra="forbid")
    accept_work: StrictBool
    expected_summary_version: BillingStrictInt = BillingField(ge=1)
    expected_total: BillingStrictStr = BillingField(max_length=13)

    @billing_validator("expected_total")
    @classmethod
    def validate_total(cls, value):
        if billing_re.fullmatch(
            r"(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?", value
        ) is None:
            raise ValueError("Provide the displayed total as a decimal string")
        return value


@router.post("/{job_id}/completion-approval")
def approve_job_completion(
    job_id: UUID,
    payload: CompletionApproval,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(status_code=403, detail="Customer access required")

    if payload.accept_work is not True:
        raise HTTPException(
            status_code=422,
            detail="Approve only after reviewing and accepting the work",
        )

    try:
        job = db.execute(
            text("""
                SELECT j.id, j.status, j.estimated_amount, j.final_amount,
                       j.completion_work_summary, j.completion_summary_version,
                       t.user_id AS technician_user_id
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
                detail="Completion approval requires work to be in progress",
            )

        require_no_open_job_dispute(db, job_id)

        completion = db.execute(
            text("""
                SELECT *
                FROM public.job_completion_requests
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if completion is None:
            raise HTTPException(
                status_code=409,
                detail="The technician must request completion first",
            )

        if completion["status"] not in {"REQUESTED", "APPROVED"}:
            raise HTTPException(
                status_code=409,
                detail="This completion request cannot be approved",
            )

        sheet = build_completion_price_sheet(job)
        if (
            payload.expected_summary_version != sheet["summary_version"]
            or BillingDecimal(payload.expected_total)
                != BillingDecimal(sheet["total_payable"])
        ):
            raise HTTPException(
                status_code=409,
                detail="The completion price sheet changed. Review it again.",
            )

        if (
            job["final_amount"] is not None
            and job["final_amount"] != job["estimated_amount"]
        ):
            raise HTTPException(
                status_code=409,
                detail="The recorded final amount differs from the agreed price",
            )

        db.execute(
            text("""
                UPDATE public.jobs
                SET final_amount = estimated_amount,
                    updated_at = clock_timestamp()
                WHERE id = :job_id
            """),
            {"job_id": job_id},
        )

        current = db.execute(
            text("""
                SELECT *
                FROM public.job_happy_codes
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        now = db.execute(text("SELECT clock_timestamp()")).scalar_one()
        attempts = 0

        if current is not None:
            if current["consumed_at"] is not None:
                raise HTTPException(status_code=409, detail="Happy Code already used")

            if current["locked_until"] is not None and current["locked_until"] > now:
                raise HTTPException(
                    status_code=429, detail="Happy Code is temporarily locked"
                )

            if now < current["updated_at"] + timedelta(seconds=60):
                raise HTTPException(
                    status_code=429,
                    detail="Wait before generating another Happy Code",
                )

            attempts = current["failed_attempts"]
            if current["locked_until"] is not None:
                attempts = 0

        start = db.execute(
            text("""
                SELECT generation, nonce, pin_verifier
                FROM public.job_start_pins
                WHERE job_id = :job_id
            """),
            {"job_id": job_id},
        ).mappings().first()

        def excluded(candidate):
            if start is not None and matches_start_pin(
                job_id, start["generation"], start["nonce"],
                candidate, start["pin_verifier"],
            ):
                return True
            return current is not None and matches_happy_code(
                job_id, current["generation"], current["nonce"],
                candidate, current["code_verifier"],
            )

        code = generate_happy_code()
        while excluded(code):
            code = generate_happy_code()

        generation = current["generation"] + 1 if current else 1
        nonce = uuid4()
        verifier = create_happy_code_verifier(job_id, generation, nonce, code)
        expires_at = now + timedelta(minutes=15)

        db.execute(
            text("""
                INSERT INTO public.job_happy_codes (
                    job_id, issued_by, generation, nonce, code_verifier,
                    expires_at, failed_attempts, created_at, updated_at
                )
                VALUES (
                    :job_id, CAST(:actor_id AS uuid), :generation,
                    :nonce, :verifier, :expires_at, :attempts, :now, :now
                )
                ON CONFLICT (job_id) DO UPDATE SET
                    issued_by = EXCLUDED.issued_by,
                    generation = EXCLUDED.generation,
                    nonce = EXCLUDED.nonce,
                    code_verifier = EXCLUDED.code_verifier,
                    expires_at = EXCLUDED.expires_at,
                    failed_attempts = EXCLUDED.failed_attempts,
                    locked_until = NULL,
                    consumed_at = NULL,
                    updated_at = EXCLUDED.updated_at
            """),
            {
                "job_id": job_id,
                "actor_id": current_user["sub"],
                "generation": generation,
                "nonce": nonce,
                "verifier": verifier,
                "expires_at": expires_at,
                "attempts": attempts,
                "now": now,
            },
        )

        if completion["status"] == "REQUESTED":
            db.execute(
                text("""
                    UPDATE public.job_completion_requests
                    SET status = 'APPROVED',
                        approved_by = CAST(:actor_id AS uuid),
                        approved_at = :now,
                        updated_at = :now
                    WHERE job_id = :job_id
                """),
                {"job_id": job_id, "actor_id": current_user["sub"], "now": now},
            )

            create_notification(
                db=db,
                user_id=str(job["technician_user_id"]),
                title="Customer Approved Work",
                message=(
                    "The customer approved the work. Ask them for the "
                    "Happy Code to confirm completion."
                ),
                notification_type="JOB_COMPLETION_APPROVED",
                reference_id=str(job_id),
            )

        db.commit()
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"

        return {
            "status": "success",
            "job_id": str(job_id),
            "happy_code": code,
            "expires_at": expires_at,
            "generation": generation,
            "message": (
                "Share this Happy Code only after accepting the completed work. "
                "It is displayed once."
            ),
        }

    except Exception:
        db.rollback()
        raise


def verify_job_happy_code(
    db: Session,
    job_id: UUID,
    code: str,
) -> None:
    """
    Caller must authorize the assigned technician, lock the job,
    and validate IN_PROGRESS -> COMPLETED before calling.

    Success remains uncommitted so job completion, history, notifications,
    approval completion and code consumption commit together.
    Wrong-attempt counters commit before returning an HTTP error.
    """
    require_no_open_job_dispute(db, job_id)

    completion = db.execute(
        text("""
            SELECT status
            FROM public.job_completion_requests
            WHERE job_id = :job_id
            FOR UPDATE
        """),
        {"job_id": job_id},
    ).mappings().first()

    if completion is None or completion["status"] != "APPROVED":
        raise HTTPException(
            status_code=409,
            detail="Customer approval is required before completion",
        )

    current = db.execute(
        text("""
            SELECT *
            FROM public.job_happy_codes
            WHERE job_id = :job_id
            FOR UPDATE
        """),
        {"job_id": job_id},
    ).mappings().first()

    if current is None:
        raise HTTPException(
            status_code=409,
            detail="Ask the customer to generate their Happy Code",
        )

    now = db.execute(text("SELECT clock_timestamp()")).scalar_one()

    if current["consumed_at"] is not None:
        raise HTTPException(status_code=409, detail="Happy Code already used")

    if current["locked_until"] is not None and current["locked_until"] > now:
        raise HTTPException(
            status_code=429,
            detail="Happy Code is temporarily locked",
        )

    if current["expires_at"] <= now:
        raise HTTPException(
            status_code=409,
            detail="Happy Code expired. Ask the customer to regenerate it",
        )

    attempts = current["failed_attempts"]
    if current["locked_until"] is not None:
        attempts = 0

    if not matches_happy_code(
        job_id,
        current["generation"],
        current["nonce"],
        code,
        current["code_verifier"],
    ):
        attempts += 1
        locked_until = now + timedelta(minutes=15) if attempts >= 5 else None

        db.execute(
            text("""
                UPDATE public.job_happy_codes
                SET failed_attempts = :attempts,
                    locked_until = :locked_until,
                    updated_at = :now
                WHERE job_id = :job_id
            """),
            {
                "job_id": job_id,
                "attempts": attempts,
                "locked_until": locked_until,
                "now": now,
            },
        )
        db.commit()

        raise HTTPException(
            status_code=429 if locked_until else 403,
            detail=(
                "Happy Code is temporarily locked"
                if locked_until else "Incorrect Happy Code"
            ),
        )

    db.execute(
        text("""
            UPDATE public.job_happy_codes
            SET consumed_at = :now,
                failed_attempts = :attempts,
                locked_until = NULL,
                updated_at = :now
            WHERE job_id = :job_id
        """),
        {"job_id": job_id, "attempts": attempts, "now": now},
    )

    db.execute(
        text("""
            UPDATE public.job_completion_requests
            SET status = 'COMPLETED',
                completed_at = :now,
                updated_at = :now
            WHERE job_id = :job_id
        """),
        {"job_id": job_id, "now": now},
    )


@router.get("/{job_id}/completion")
def get_job_completion_status(
    job_id: UUID,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    if role not in {"CUSTOMER", "TECHNICIAN"}:
        raise HTTPException(
            status_code=403,
            detail="Customer or assigned technician access required",
        )

    row = db.execute(
        text("""
            SELECT j.id AS job_id, j.status AS job_status,
                   r.id AS completion_request_id,
                   r.status AS completion_status,
                   r.requested_at, r.approved_at, r.completed_at,
                   h.expires_at, h.locked_until,
                   h.consumed_at,
                   (h.id IS NOT NULL) AS code_issued
            FROM public.jobs j
            JOIN public.customers c ON c.id = j.customer_id
            JOIN public.technicians t ON t.id = j.technician_id
            JOIN public.users actor ON actor.id = CAST(:actor_id AS uuid)
            LEFT JOIN public.job_completion_requests r ON r.job_id = j.id
            LEFT JOIN public.job_happy_codes h ON h.job_id = j.id
            WHERE j.id = :job_id
              AND actor.is_active = TRUE
              AND actor.is_verified = TRUE
              AND actor.role = :actor_role
              AND (
                  (actor.role = 'CUSTOMER' AND c.user_id = actor.id)
                  OR
                  (actor.role = 'TECHNICIAN' AND t.user_id = actor.id)
              )
        """),
        {
            "job_id": job_id,
            "actor_id": current_user["sub"],
            "actor_role": role,
        },
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    completion_request = None
    if row["completion_request_id"] is not None:
        completion_request = {
            "id": row["completion_request_id"],
            "status": row["completion_status"],
            "requested_at": row["requested_at"],
            "approved_at": row["approved_at"],
            "completed_at": row["completed_at"],
        }

    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"

    return {
        "status": "success",
        "job_id": str(row["job_id"]),
        "job_status": row["job_status"],
        "completion_request": completion_request,
        "happy_code_status": {
            "issued": row["code_issued"],
            "expires_at": row["expires_at"],
            "locked_until": row["locked_until"],
            "consumed": row["consumed_at"] is not None,
        },
    }


def require_no_open_job_dispute(db: Session, job_id: UUID) -> None:
    """
    Caller must hold the job row lock.
    Issue reporting also locks the job, serializing these checks.
    This helper never commits or rolls back.
    """
    has_open_dispute = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.job_disputes
                WHERE job_id = :job_id
                  AND status IN ('OPEN', 'UNDER_REVIEW')
            )
        """),
        {"job_id": job_id},
    ).scalar_one()

    if has_open_dispute:
        raise HTTPException(
            status_code=409,
            detail="Resolve the reported work issue before approving or completing",
        )


@router.get("/{job_id}/completion-price-sheet")
def get_completion_price_sheet(
    job_id: UUID,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    if role not in {"CUSTOMER", "TECHNICIAN"}:
        raise HTTPException(status_code=403, detail="Job participant access required")

    row = db.execute(
        text("""
            SELECT j.id, j.status, j.estimated_amount,
                   j.completion_work_summary, j.completion_summary_version,
                   sr.title AS request_title, s.name AS service_name
            FROM public.jobs j
            JOIN public.customers c ON c.id = j.customer_id
            JOIN public.technicians t ON t.id = j.technician_id
            JOIN public.service_requests sr ON sr.id = j.service_request_id
            JOIN public.services s ON s.id = sr.service_id
            JOIN public.users actor ON actor.id = CAST(:actor_id AS uuid)
            WHERE j.id = :job_id
              AND actor.role = :role
              AND actor.is_active = TRUE
              AND actor.is_verified = TRUE
              AND (
                  (actor.role = 'CUSTOMER' AND c.user_id = actor.id)
                  OR
                  (actor.role = 'TECHNICIAN' AND t.user_id = actor.id)
              )
        """),
        {
            "job_id": job_id,
            "actor_id": current_user["sub"],
            "role": role,
        },
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Job not found")

    amount = row["estimated_amount"]
    valid_amount = (
        amount is not None and amount.is_finite() and amount >= 0
    )
    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "success",
        "job_status": row["status"],
        "price_sheet": {
            "request_title": row["request_title"],
            "service_name": row["service_name"],
            "work_summary": row["completion_work_summary"],
            "summary_version": row["completion_summary_version"],
            "currency": "INR",
            "agreed_amount": format(amount, ".2f") if valid_amount else None,
            "total_payable": format(amount, ".2f") if valid_amount else None,
            "ready": bool(row["completion_work_summary"]) and valid_amount,
        },
    }


@router.put("/{job_id}/completion-summary")
def save_completion_work_summary(
    job_id: UUID,
    payload: CompletionWorkSummary,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Technician access required")

    try:
        job = db.execute(
            text("""
                SELECT j.id, j.status, j.completion_work_summary,
                       j.completion_summary_version
                FROM public.jobs j
                JOIN public.technicians t ON t.id = j.technician_id
                JOIN public.users u ON u.id = t.user_id
                WHERE j.id = :job_id
                  AND t.id = CAST(:technician_id AS uuid)
                  AND u.id = CAST(:actor_id AS uuid)
                  AND u.role = 'TECHNICIAN'
                  AND u.is_active = TRUE AND u.is_verified = TRUE
                FOR UPDATE OF j
            """),
            {
                "job_id": job_id,
                "technician_id": current_user.get("technician_id"),
                "actor_id": current_user["sub"],
            },
        ).mappings().first()

        if job is None:
            raise HTTPException(status_code=404, detail="Assigned job not found")
        if job["status"] != "IN_PROGRESS":
            raise HTTPException(status_code=409, detail="Work must be in progress")

        require_no_open_job_dispute(db, job_id)

        completion = db.execute(
            text("""
                SELECT status
                FROM public.job_completion_requests
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if completion is not None and completion["status"] not in {
            "REQUESTED", "WORK_RESUMED",
        }:
            raise HTTPException(
                status_code=409,
                detail="The work summary cannot change after approval or during an issue",
            )

        if job["completion_summary_version"] != payload.expected_version:
            raise HTTPException(
                status_code=409,
                detail="The work summary changed. Refresh before saving.",
            )

        changed = job["completion_work_summary"] != payload.summary
        version = job["completion_summary_version"]

        if changed:
            version += 1
            db.execute(
                text("""
                    UPDATE public.jobs
                    SET completion_work_summary = :summary,
                        completion_summary_version = :version,
                        updated_at = clock_timestamp()
                    WHERE id = :job_id
                """),
                {
                    "job_id": job_id,
                    "summary": payload.summary,
                    "version": version,
                },
            )

        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {
            "status": "success",
            "changed": changed,
            "work_summary": payload.summary,
            "summary_version": version,
        }
    except Exception:
        db.rollback()
        raise
