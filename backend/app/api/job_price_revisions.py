from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, StrictInt, StrictStr, field_validator
from typing import Literal
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.notifications import create_notification
from app.core.security import get_current_user
from app.db.database import get_db


router = APIRouter(prefix="/jobs", tags=["Job Price Revisions"])


class PriceRevisionProposal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # A decimal string avoids floating-point rounding of money.
    proposed_amount: StrictStr = Field(
        pattern=r"^(0|[1-9][0-9]{0,9})(\.[0-9]{1,2})?$",
        max_length=13,
    )
    reason: StrictStr = Field(min_length=10, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value):
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Explain the price revision in at least ten characters")
        return value

    @field_validator("proposed_amount")
    @classmethod
    def positive_amount(cls, value):
        if Decimal(value) <= 0:
            raise ValueError("The proposed total price must be positive")
        return value


@router.post("/{job_id}/price-revisions")
def propose_job_price_revision(
    job_id: UUID,
    payload: PriceRevisionProposal,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Technician access required")

    technician_id = current_user.get("technician_id")
    if not technician_id:
        raise HTTPException(status_code=403, detail="Technician profile required")

    amount = Decimal(payload.proposed_amount)

    try:
        # Every price mutation and PIN operation locks this job first.
        job = db.execute(
            text("""
                SELECT j.id, j.status, j.estimated_amount, j.started_at,
                       c.user_id AS customer_user_id
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

        if job["status"] != "ARRIVED" or job["started_at"] is not None:
            raise HTTPException(
                status_code=409,
                detail="Price revisions are allowed only after arrival and before work starts",
            )

        previous = job["estimated_amount"]
        if previous is not None:
            if not previous.is_finite() or previous < 0:
                raise HTTPException(
                    status_code=409,
                    detail="The existing job estimate requires correction before revision",
                )
            if amount <= previous:
                raise HTTPException(
                    status_code=422,
                    detail="The revised total price must exceed the current agreed estimate",
                )

        pending = db.execute(
            text("""
                SELECT id
                FROM public.job_price_revisions
                WHERE job_id = :job_id AND status = 'PENDING'
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if pending is not None:
            raise HTTPException(
                status_code=409,
                detail="A price revision is already awaiting customer approval",
            )

        pin = db.execute(
            text("""
                SELECT consumed_at
                FROM public.job_start_pins
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if pin is not None and pin["consumed_at"] is not None:
            raise HTTPException(
                status_code=409,
                detail="A price revision cannot be proposed after the Start PIN has been used",
            )

        row = db.execute(
            text("""
                INSERT INTO public.job_price_revisions (
                    job_id, proposed_by, previous_amount, proposed_amount, reason
                )
                VALUES (
                    :job_id, CAST(:actor_id AS uuid), :previous, :amount, :reason
                )
                RETURNING id, job_id, previous_amount, proposed_amount, reason,
                          status, version, created_at, updated_at
            """),
            {
                "job_id": job_id,
                "actor_id": current_user["sub"],
                "previous": previous,
                "amount": amount,
                "reason": payload.reason,
            },
        ).mappings().one()

        # Preserve failed attempts and lockout when invalidating the old PIN.
        db.execute(
            text("""
                UPDATE public.job_start_pins
                SET expires_at = LEAST(expires_at, clock_timestamp()),
                    updated_at = clock_timestamp()
                WHERE job_id = :job_id
            """),
            {"job_id": job_id},
        )

        create_notification(
            db=db,
            user_id=str(job["customer_user_id"]),
            title="Price Revision Requires Your Approval",
            message=(
                "Your technician proposed a revised total price. "
                "Review the amount and reason before approving or declining. "
                "Work cannot start while this proposal is pending."
            ),
            notification_type="JOB_PRICE_REVISION_PROPOSED",
            reference_id=str(job_id),
        )

        revision = dict(row)
        # Return money as decimal strings.
        revision["previous_amount"] = (
            format(previous, ".2f") if previous is not None else None
        )
        revision["proposed_amount"] = format(amount, ".2f")

        db.commit()
        response.headers["Cache-Control"] = "no-store"

        return {
            "status": "success",
            "message": "Price revision proposed. Waiting for customer approval.",
            "revision": revision,
        }

    except Exception:
        db.rollback()
        raise


class PriceRevisionDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["APPROVED", "DECLINED"]
    expected_version: StrictInt = Field(ge=1)
    decision_reason: StrictStr | None = Field(
        default=None, min_length=3, max_length=1000,
    )

    @field_validator("decision_reason")
    @classmethod
    def clean_decision_reason(cls, value):
        if value is None:
            return None
        value = value.strip()
        if len(value) < 3:
            raise ValueError("A decision reason must contain at least three characters")
        return value


@router.put("/{job_id}/price-revisions/{revision_id}/decision")
def decide_job_price_revision(
    job_id: UUID,
    revision_id: UUID,
    payload: PriceRevisionDecision,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(status_code=403, detail="Customer access required")

    try:
        job = db.execute(
            text("""
                SELECT j.id, j.status, j.started_at, j.estimated_amount,
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

        if job["status"] != "ARRIVED" or job["started_at"] is not None:
            raise HTTPException(
                status_code=409,
                detail="Price decisions are allowed only before work starts, after arrival",
            )

        revision = db.execute(
            text("""
                SELECT id, status, version, previous_amount, proposed_amount
                FROM public.job_price_revisions
                WHERE id = :revision_id AND job_id = :job_id
                FOR UPDATE
            """),
            {"revision_id": revision_id, "job_id": job_id},
        ).mappings().first()

        if revision is None:
            raise HTTPException(status_code=404, detail="Price revision not found")

        if revision["version"] != payload.expected_version:
            raise HTTPException(
                status_code=409,
                detail="The price revision has changed. Refresh before deciding.",
            )

        if revision["status"] != "PENDING":
            raise HTTPException(
                status_code=409,
                detail="This price revision is no longer awaiting a decision",
            )

        if job["estimated_amount"] != revision["previous_amount"]:
            raise HTTPException(
                status_code=409,
                detail="The agreed price has changed. Refresh the price revision.",
            )

        pin = db.execute(
            text("""
                SELECT consumed_at FROM public.job_start_pins
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if pin is not None and pin["consumed_at"] is not None:
            raise HTTPException(
                status_code=409,
                detail="The Start PIN has already been used",
            )

        if payload.decision == "APPROVED":
            db.execute(
                text("""
                    UPDATE public.jobs
                    SET estimated_amount = :amount,
                        updated_at = clock_timestamp()
                    WHERE id = :job_id
                """),
                {"amount": revision["proposed_amount"], "job_id": job_id},
            )

        row = db.execute(
            text("""
                UPDATE public.job_price_revisions
                SET status = :decision,
                    version = version + 1,
                    decided_by = CAST(:actor_id AS uuid),
                    decided_at = clock_timestamp(),
                    decision_reason = :reason,
                    updated_at = clock_timestamp()
                WHERE id = :revision_id AND job_id = :job_id
                RETURNING id, job_id, previous_amount, proposed_amount, reason,
                          status, version, decision_reason, decided_at,
                          created_at, updated_at
            """),
            {
                "decision": payload.decision,
                "actor_id": current_user["sub"],
                "reason": payload.decision_reason,
                "revision_id": revision_id,
                "job_id": job_id,
            },
        ).mappings().one()

        # A customer must generate a fresh PIN after the price decision.
        # Preserve attempts, lockout and the existing regeneration cooldown.
        db.execute(
            text("""
                UPDATE public.job_start_pins
                SET expires_at = LEAST(expires_at, clock_timestamp())
                WHERE job_id = :job_id
            """),
            {"job_id": job_id},
        )

        approved = payload.decision == "APPROVED"
        create_notification(
            db=db,
            user_id=str(job["technician_user_id"]),
            title="Price Revision Approved" if approved else "Price Revision Declined",
            message=(
                "The customer approved your revised total price. "
                "Ask for a newly generated Start PIN before starting work."
                if approved else
                "The customer declined your revised price. "
                "The previous agreed estimate remains unchanged."
            ),
            notification_type=(
                "JOB_PRICE_REVISION_APPROVED"
                if approved else "JOB_PRICE_REVISION_DECLINED"
            ),
            reference_id=str(job_id),
        )

        result = dict(row)
        for field in ("previous_amount", "proposed_amount"):
            value = result[field]
            result[field] = format(value, ".2f") if value is not None else None

        agreed = (
            revision["proposed_amount"] if approved else job["estimated_amount"]
        )
        db.commit()
        response.headers["Cache-Control"] = "no-store"

        return {
            "status": "success",
            "message": (
                "Revised price approved. A fresh Start PIN is required before work starts."
                if approved else
                "Revised price declined. The previous agreed estimate is unchanged."
            ),
            "agreed_amount": format(agreed, ".2f") if agreed is not None else None,
            "revision": result,
        }

    except Exception:
        db.rollback()
        raise


class PriceRevisionWithdrawal(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: StrictInt = Field(ge=1)


@router.put("/{job_id}/price-revisions/{revision_id}/withdraw")
def withdraw_job_price_revision(
    job_id: UUID,
    revision_id: UUID,
    payload: PriceRevisionWithdrawal,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Technician access required")

    technician_id = current_user.get("technician_id")
    if not technician_id:
        raise HTTPException(status_code=403, detail="Technician profile required")

    try:
        job = db.execute(
            text("""
                SELECT j.id, j.status, j.started_at, j.estimated_amount,
                       c.user_id AS customer_user_id
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

        if job["status"] != "ARRIVED" or job["started_at"] is not None:
            raise HTTPException(
                status_code=409,
                detail="A price proposal can be withdrawn only before work starts, after arrival",
            )

        revision = db.execute(
            text("""
                SELECT id, status, version, proposed_by
                FROM public.job_price_revisions
                WHERE id = :revision_id AND job_id = :job_id
                FOR UPDATE
            """),
            {"revision_id": revision_id, "job_id": job_id},
        ).mappings().first()

        if revision is None:
            raise HTTPException(status_code=404, detail="Price revision not found")

        if str(revision["proposed_by"]) != str(current_user["sub"]):
            raise HTTPException(status_code=403, detail="Only the proposer can withdraw this revision")

        if revision["version"] != payload.expected_version:
            raise HTTPException(
                status_code=409,
                detail="The price revision has changed. Refresh before withdrawing.",
            )

        if revision["status"] != "PENDING":
            raise HTTPException(
                status_code=409,
                detail="Only a pending price revision can be withdrawn",
            )

        pin = db.execute(
            text("""
                SELECT consumed_at FROM public.job_start_pins
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if pin is not None and pin["consumed_at"] is not None:
            raise HTTPException(status_code=409, detail="The Start PIN has already been used")

        row = db.execute(
            text("""
                UPDATE public.job_price_revisions
                SET status = 'WITHDRAWN',
                    version = version + 1,
                    decided_by = CAST(:actor_id AS uuid),
                    decided_at = clock_timestamp(),
                    updated_at = clock_timestamp()
                WHERE id = :revision_id AND job_id = :job_id
                RETURNING id, job_id, previous_amount, proposed_amount, reason,
                          status, version, decision_reason, decided_at,
                          created_at, updated_at
            """),
            {
                "actor_id": current_user["sub"],
                "revision_id": revision_id,
                "job_id": job_id,
            },
        ).mappings().one()

        db.execute(
            text("""
                UPDATE public.job_start_pins
                SET expires_at = LEAST(expires_at, clock_timestamp()),
                    updated_at = clock_timestamp()
                WHERE job_id = :job_id
            """),
            {"job_id": job_id},
        )

        create_notification(
            db=db,
            user_id=str(job["customer_user_id"]),
            title="Price Revision Withdrawn",
            message=(
                "Your technician withdrew the pending price revision. "
                "The agreed estimate remains unchanged. "
                "Generate a fresh Start PIN when ready to start work."
            ),
            notification_type="JOB_PRICE_REVISION_WITHDRAWN",
            reference_id=str(job_id),
        )

        result = dict(row)
        for field in ("previous_amount", "proposed_amount"):
            value = result[field]
            result[field] = format(value, ".2f") if value is not None else None

        agreed = job["estimated_amount"]
        db.commit()
        response.headers["Cache-Control"] = "no-store"

        return {
            "status": "success",
            "message": "Price revision withdrawn. The agreed estimate is unchanged.",
            "agreed_amount": format(agreed, ".2f") if agreed is not None else None,
            "revision": result,
        }

    except Exception:
        db.rollback()
        raise


@router.get("/{job_id}/price-revisions")
def get_job_price_revisions(
    job_id: UUID,
    response: Response,
    page: int = Query(default=1, ge=1, le=10000),
    page_size: int = Query(default=25, ge=1, le=100),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    if role not in ("CUSTOMER", "TECHNICIAN"):
        raise HTTPException(
            status_code=403,
            detail="Customer or technician access required",
        )

    # One statement gives a consistent view of job price and revision history.
    rows = db.execute(
        text("""
            SELECT j.status AS job_status, j.estimated_amount AS agreed_amount,
                   j.started_at,
                   EXISTS (
                       SELECT 1 FROM public.job_price_revisions pending
                       WHERE pending.job_id = j.id AND pending.status = 'PENDING'
                   ) AS has_pending_revision,
                   history.*
            FROM public.jobs j
            JOIN public.customers c ON c.id = j.customer_id
            JOIN public.technicians t ON t.id = j.technician_id
            JOIN public.users actor
              ON actor.id = CAST(:actor_id AS uuid)
            LEFT JOIN LATERAL (
                SELECT r.id, r.job_id, r.previous_amount, r.proposed_amount,
                       r.reason, r.status, r.version, r.decision_reason,
                       r.decided_at, r.created_at, r.updated_at
                FROM public.job_price_revisions r
                WHERE r.job_id = j.id
                ORDER BY r.created_at DESC, r.id DESC
                LIMIT :limit OFFSET :offset
            ) history ON TRUE
            WHERE j.id = :job_id
              AND actor.role = :role
              AND actor.is_active = TRUE
              AND actor.is_verified = TRUE
              AND (
                  (:role = 'CUSTOMER' AND c.user_id = actor.id)
                  OR (
                      :role = 'TECHNICIAN'
                      AND t.user_id = actor.id
                      AND t.id = CAST(:technician_id AS uuid)
                  )
              )
            ORDER BY history.created_at DESC, history.id DESC
        """),
        {
            "job_id": job_id,
            "actor_id": current_user["sub"],
            "role": role,
            "technician_id": current_user.get("technician_id"),
            "limit": page_size + 1,
            "offset": (page - 1) * page_size,
        },
    ).mappings().all()

    if not rows:
        raise HTTPException(status_code=404, detail="Job not found")

    first = rows[0]
    history = [row for row in rows if row["id"] is not None]
    fields = (
        "id", "job_id", "previous_amount", "proposed_amount", "reason",
        "status", "version", "decision_reason", "decided_at",
        "created_at", "updated_at",
    )
    revisions = []
    for row in history[:page_size]:
        item = {field: row[field] for field in fields}
        for field in ("previous_amount", "proposed_amount"):
            value = item[field]
            item[field] = format(value, ".2f") if value is not None else None
        revisions.append(item)

    amount = first["agreed_amount"]
    response.headers["Cache-Control"] = "no-store"

    return {
        "status": "success",
        "job_id": str(job_id),
        "job_status": first["job_status"],
        "agreed_amount": format(amount, ".2f") if amount is not None else None,
        "has_pending_revision": first["has_pending_revision"],
        "can_generate_start_pin": (
            first["job_status"] == "ARRIVED"
            and first["started_at"] is None
            and not first["has_pending_revision"]
        ),
        "revisions": revisions,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "has_more": len(history) > page_size,
        },
    }


class PriceDisagreementCancellation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision_id: UUID
    expected_version: StrictInt = Field(ge=1)
    reason: StrictStr = Field(min_length=10, max_length=1000)

    @field_validator("reason")
    @classmethod
    def clean_reason(cls, value):
        value = value.strip()
        if len(value) < 10:
            raise ValueError("Explain the cancellation in at least ten characters")
        return value


@router.post("/{job_id}/price-disagreement-cancellation")
def cancel_job_after_price_decline(
    job_id: UUID,
    payload: PriceDisagreementCancellation,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Technician access required")

    technician_id = current_user.get("technician_id")
    if not technician_id:
        raise HTTPException(status_code=403, detail="Technician profile required")

    parameters = {
        "job_id": job_id,
        "technician_id": technician_id,
        "actor_id": current_user["sub"],
    }

    try:
        reference = db.execute(
            text("""
                SELECT j.service_request_id
                FROM public.jobs j
                JOIN public.technicians t ON t.id = j.technician_id
                JOIN public.users u ON u.id = t.user_id
                WHERE j.id = :job_id
                  AND t.id = CAST(:technician_id AS uuid)
                  AND u.id = CAST(:actor_id AS uuid)
                  AND u.role = 'TECHNICIAN'
                  AND u.is_active = TRUE AND u.is_verified = TRUE
            """),
            parameters,
        ).mappings().first()

        if reference is None:
            raise HTTPException(status_code=404, detail="Assigned job not found")

        # Request first, then job: serialize with new assignment.
        request_row = db.execute(
            text("""
                SELECT id, status FROM public.service_requests
                WHERE id = :request_id
                FOR UPDATE
            """),
            {"request_id": reference["service_request_id"]},
        ).mappings().first()

        job = db.execute(
            text("""
                SELECT j.id, j.status, j.started_at, j.service_request_id,
                       c.user_id AS customer_user_id
                FROM public.jobs j
                JOIN public.technicians t ON t.id = j.technician_id
                JOIN public.users u ON u.id = t.user_id
                JOIN public.customers c ON c.id = j.customer_id
                WHERE j.id = :job_id
                  AND t.id = CAST(:technician_id AS uuid)
                  AND u.id = CAST(:actor_id AS uuid)
                  AND u.role = 'TECHNICIAN'
                  AND u.is_active = TRUE AND u.is_verified = TRUE
                FOR UPDATE OF j
            """),
            parameters,
        ).mappings().first()

        if job is None:
            raise HTTPException(status_code=404, detail="Assigned job not found")

        if job["status"] != "ARRIVED" or job["started_at"] is not None:
            raise HTTPException(
                status_code=409,
                detail="Price disagreement cancellation is allowed only after arrival and before work starts",
            )

        if request_row is None or request_row["status"] != "OPEN":
            raise HTTPException(
                status_code=409,
                detail="The service request is not available for reassignment",
            )

        latest = db.execute(
            text("""
                SELECT id, status, version
                FROM public.job_price_revisions
                WHERE job_id = :job_id
                ORDER BY created_at DESC, id DESC
                LIMIT 1
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if (
            latest is None
            or latest["id"] != payload.revision_id
            or latest["version"] != payload.expected_version
            or latest["status"] != "DECLINED"
        ):
            raise HTTPException(
                status_code=409,
                detail="The latest price revision must be declined. Refresh price status.",
            )

        pending = db.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1 FROM public.job_price_revisions
                    WHERE job_id = :job_id AND status = 'PENDING'
                )
            """),
            {"job_id": job_id},
        ).scalar_one()

        if pending:
            raise HTTPException(status_code=409, detail="Resolve the pending price proposal first")

        pin = db.execute(
            text("""
                SELECT consumed_at FROM public.job_start_pins
                WHERE job_id = :job_id FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        if pin is not None and pin["consumed_at"] is not None:
            raise HTTPException(status_code=409, detail="Work start has already been confirmed")

        # Store the supplied explanation as the cancellation reason.
        updated = db.execute(
            text("""
                UPDATE public.jobs
                SET status = 'CANCELLED',
                    cancelled_at = clock_timestamp(),
                    cancellation_reason = :reason,
                    updated_at = clock_timestamp()
                WHERE id = :job_id
                RETURNING id, service_request_id, status, estimated_amount,
                          cancellation_reason, cancelled_at, updated_at
            """),
            {"job_id": job_id, "reason": payload.reason},
        ).mappings().one()

        db.execute(
            text("""
                UPDATE public.job_start_pins
                SET expires_at = LEAST(expires_at, clock_timestamp()),
                    updated_at = clock_timestamp()
                WHERE job_id = :job_id
            """),
            {"job_id": job_id},
        )

        # History uses a fixed message so entered PINs cannot leak through remarks.
        db.execute(
            text("""
                INSERT INTO public.job_status_history (
                    job_id, old_status, new_status, changed_by, remarks
                )
                VALUES (
                    :job_id, 'ARRIVED', 'CANCELLED',
                    CAST(:actor_id AS uuid),
                    'Technician cancelled before work start after customer declined the revised price'
                )
            """),
            {"job_id": job_id, "actor_id": current_user["sub"]},
        )

        create_notification(
            db=db,
            user_id=str(job["customer_user_id"]),
            title="Job Cancelled After Price Disagreement",
            message=(
                "Your technician cancelled before starting work after the revised "
                "price was declined. Your request remains open; you can choose another technician."
            ),
            notification_type="JOB_CANCELLED",
            reference_id=str(job_id),
        )

        result = dict(updated)
        amount = result["estimated_amount"]
        result["estimated_amount"] = format(amount, ".2f") if amount is not None else None
        db.commit()
        response.headers["Cache-Control"] = "no-store"

        return {
            "status": "success",
            "message": "Job cancelled. The customer can select another technician.",
            "job": result,
        }

    except Exception:
        db.rollback()
        raise
