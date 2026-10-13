from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session


def require_no_pending_price_revision(
    db: Session,
    job_id: UUID,
) -> None:
    """
    Caller must hold the job row lock.
    Proposal and decision endpoints must acquire that same lock first.
    This helper never commits or rolls back.
    """
    pending = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.job_price_revisions
                WHERE job_id = :job_id
                  AND status = 'PENDING'
            )
        """),
        {"job_id": job_id},
    ).scalar_one()

    if pending:
        raise HTTPException(
            status_code=409,
            detail=(
                "A price revision is awaiting customer approval. "
                "Resolve it before generating a Start PIN or starting work."
            ),
        )
