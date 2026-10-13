from datetime import timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.job_start_pin import (
    create_start_pin_verifier,
    generate_start_pin,
    matches_start_pin,
)
from app.core.job_price_revision import require_no_pending_price_revision
from app.core.security import get_current_user
from app.db.database import get_db


router = APIRouter(prefix="/jobs", tags=["Job Start PIN"])
PIN_EXPIRY_MINUTES = 15
REGENERATION_COOLDOWN_SECONDS = 60


@router.post("/{job_id}/start-pin")
def issue_job_start_pin(
    job_id: UUID,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(status_code=403, detail="Customer access required")

    try:
        # All PIN operations must lock the job before its PIN row.
        job = db.execute(
            text("""
                SELECT j.id, j.status
                FROM public.jobs j
                JOIN public.customers c ON c.id = j.customer_id
                JOIN public.users u ON u.id = c.user_id
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

        if job["status"] != "ARRIVED":
            raise HTTPException(
                status_code=409,
                detail="Start PIN is available only after technician arrival",
            )

        require_no_pending_price_revision(db, job_id)

        current = db.execute(
            text("""
                SELECT *
                FROM public.job_start_pins
                WHERE job_id = :job_id
                FOR UPDATE
            """),
            {"job_id": job_id},
        ).mappings().first()

        now = db.execute(text("SELECT clock_timestamp()")).scalar_one()
        attempts = 0

        if current is not None:
            if current["consumed_at"] is not None:
                raise HTTPException(
                    status_code=409, detail="Start PIN has already been used"
                )

            if (
                current["locked_until"] is not None
                and current["locked_until"] > now
            ):
                raise HTTPException(
                    status_code=429,
                    detail="Start PIN is temporarily locked",
                )

            if now < current["updated_at"] + timedelta(
                seconds=REGENERATION_COOLDOWN_SECONDS
            ):
                raise HTTPException(
                    status_code=429,
                    detail="Wait before generating another Start PIN",
                )

            # Regeneration must not bypass the verification attempt limit.
            attempts = current["failed_attempts"]
            if current["locked_until"] is not None:
                attempts = 0

        generation = current["generation"] + 1 if current else 1
        nonce = uuid4()
        pin = generate_start_pin()

        # Ensure a regenerated PIN differs from its immediate predecessor.
        if current is not None:
            while matches_start_pin(
                job_id,
                current["generation"],
                current["nonce"],
                pin,
                current["pin_verifier"],
            ):
                pin = generate_start_pin()

        verifier = create_start_pin_verifier(job_id, generation, nonce, pin)
        expires_at = now + timedelta(minutes=PIN_EXPIRY_MINUTES)

        db.execute(
            text("""
                INSERT INTO public.job_start_pins (
                    job_id, issued_by, generation, nonce, pin_verifier,
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
                    pin_verifier = EXCLUDED.pin_verifier,
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
        db.commit()

        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"

        return {
            "status": "success",
            "job_id": str(job_id),
            "start_pin": pin,
            "expires_at": expires_at,
            "generation": generation,
            "message": (
                "Share this PIN with your technician only when ready "
                "for work to start. It is displayed once."
            ),
        }

    except Exception:
        db.rollback()
        raise


def verify_job_start_pin(
    db: Session,
    job_id: UUID,
    pin: str,
) -> None:
    """
    Caller must authorize the assigned technician, lock the job row,
    and validate ARRIVED -> IN_PROGRESS before calling this helper.

    Success does not commit: PIN consumption and work start must be atomic.
    Failed attempts commit before returning an HTTP error so they persist.
    """
    require_no_pending_price_revision(db, job_id)

    current = db.execute(
        text("""
            SELECT *
            FROM public.job_start_pins
            WHERE job_id = :job_id
            FOR UPDATE
        """),
        {"job_id": job_id},
    ).mappings().first()

    if current is None:
        raise HTTPException(
            status_code=409,
            detail="Ask the customer to generate a Start PIN",
        )

    now = db.execute(text("SELECT clock_timestamp()")).scalar_one()

    if current["consumed_at"] is not None:
        raise HTTPException(status_code=409, detail="Start PIN already used")

    if current["locked_until"] is not None and current["locked_until"] > now:
        raise HTTPException(
            status_code=429,
            detail="Start PIN is temporarily locked",
        )

    if current["expires_at"] <= now:
        raise HTTPException(
            status_code=409,
            detail="Start PIN expired. Ask the customer to regenerate it",
        )

    attempts = current["failed_attempts"]
    if current["locked_until"] is not None:
        attempts = 0

    if not matches_start_pin(
        job_id,
        current["generation"],
        current["nonce"],
        pin,
        current["pin_verifier"],
    ):
        attempts += 1
        locked_until = now + timedelta(minutes=15) if attempts >= 5 else None

        db.execute(
            text("""
                UPDATE public.job_start_pins
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
                "Start PIN is temporarily locked"
                if locked_until else "Incorrect Start PIN"
            ),
        )

    db.execute(
        text("""
            UPDATE public.job_start_pins
            SET consumed_at = :now,
                failed_attempts = :attempts,
                locked_until = NULL,
                updated_at = :now
            WHERE job_id = :job_id
        """),
        {"job_id": job_id, "attempts": attempts, "now": now},
    )
