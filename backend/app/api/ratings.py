from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.database import get_db
from app.core.security import get_current_user
from app.core.notifications import create_notification


router = APIRouter(
    prefix="/ratings",
    tags=["Ratings"],
)


class RatingCreate(BaseModel):
    job_id: UUID
    rating: int = Field(..., ge=1, le=5)
    review: str | None = None


@router.post("")
def create_rating(
    request: RatingCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can submit ratings
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can submit ratings",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    # Verify that the job belongs to this customer and is completed
    job_query = text("""
        SELECT
            j.id,
            j.customer_id,
            j.technician_id,
            j.status,
            c.user_id AS customer_user_id
        FROM jobs j
        JOIN customers c
            ON c.id = j.customer_id
        JOIN users u
            ON u.id = c.user_id
        WHERE
            j.id = :job_id
            AND c.user_id = :user_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE
        LIMIT 1
    """)

    job = db.execute(
        job_query,
        {
            "job_id": request.job_id,
            "user_id": user_id,
        },
    ).mappings().first()

    if not job:
        raise HTTPException(
            status_code=404,
            detail="Completed job not found for this customer",
        )

    if job["status"] != "COMPLETED":
        raise HTTPException(
            status_code=409,
            detail="Rating is allowed only after job completion",
        )

    # Check whether this job has already been rated
    existing_query = text("""
        SELECT id
        FROM ratings
        WHERE job_id = :job_id
        LIMIT 1
    """)

    existing = db.execute(
        existing_query,
        {"job_id": request.job_id},
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="This job has already been rated",
        )

    # Insert rating
    insert_query = text("""
        INSERT INTO ratings (
            job_id,
            customer_id,
            technician_id,
            rating,
            review
        )
        VALUES (
            :job_id,
            :customer_id,
            :technician_id,
            :rating,
            :review
        )
        RETURNING
            id,
            job_id,
            customer_id,
            technician_id,
            rating,
            review,
            created_at
    """)

    try:
        result = db.execute(
            insert_query,
            {
                "job_id": request.job_id,
                "customer_id": job["customer_id"],
                "technician_id": job["technician_id"],
                "rating": request.rating,
                "review": request.review,
            },
        )

        new_rating = result.mappings().first()

        # Recalculate technician average rating
        rating_update_query = text("""
            UPDATE technicians t
            SET
                rating_average = (
                    SELECT ROUND(AVG(r.rating)::numeric, 2)
                    FROM ratings r
                    WHERE r.technician_id = t.id
                ),
                updated_at = NOW()
            WHERE t.id = :technician_id
        """)

        db.execute(
            rating_update_query,
            {
                "technician_id": job["technician_id"],
            },
        )

        # Get technician user ID for notification
        technician_user_query = text("""
            SELECT user_id
            FROM technicians
            WHERE id = :technician_id
        """)

        technician_user_id = db.execute(
            technician_user_query,
            {
                "technician_id": job["technician_id"],
            },
        ).scalar()

        # Notify technician about the new rating
        if technician_user_id:
            create_notification(
                db=db,
                user_id=str(technician_user_id),
                title="New Rating Received",
                message="Customer has rated your completed service.",
                notification_type="RATING_RECEIVED",
                reference_id=str(request.job_id),
            )

        db.commit()

        return {
            "status": "success",
            "message": "Rating submitted successfully",
            "rating": dict(new_rating),
        }

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Unable to submit rating",
        )
@router.get("/job/{job_id}")
def get_job_rating(
    job_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can access their job rating
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access job ratings",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    query = text("""
        SELECT
            r.id,
            r.job_id,
            r.customer_id,
            r.technician_id,
            r.rating,
            r.review,
            r.created_at
        FROM ratings r
        JOIN customers c
            ON c.id = r.customer_id
        JOIN users u
            ON u.id = c.user_id
        WHERE
            r.job_id = :job_id
            AND c.user_id = :user_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE
        LIMIT 1
    """)

    result = db.execute(
        query,
        {
            "job_id": job_id,
            "user_id": user_id,
        },
    ).mappings().first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Rating not found for this job",
        )

    return {
        "status": "success",
        "rating": dict(result),
    }
@router.get("/technician/{technician_id}")
def get_technician_ratings(
    technician_id: str,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # User must be authenticated
    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication",
        )

    # Verify that technician is active, verified and approved
    technician_query = text("""
        SELECT
            t.id AS technician_id,
            u.full_name,
            t.business_name,
            t.rating_average,
            t.total_jobs
        FROM technicians t
        JOIN users u
            ON u.id = t.user_id
        WHERE
            t.id = :technician_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE
            AND t.kyc_status = 'APPROVED'
        LIMIT 1
    """)

    technician = db.execute(
        technician_query,
        {
            "technician_id": technician_id,
        },
    ).mappings().first()

    if not technician:
        raise HTTPException(
            status_code=404,
            detail="Verified technician not found",
        )

    # Return public reviews only.
    # Do not expose customer identity or contact information.
    ratings_query = text("""
        SELECT
            r.id,
            r.rating,
            r.review,
            r.created_at
        FROM ratings r
        WHERE
            r.technician_id = :technician_id
        ORDER BY r.created_at DESC
    """)

    ratings = db.execute(
        ratings_query,
        {
            "technician_id": technician_id,
        },
    ).mappings().all()

    return {
        "status": "success",
        "technician": dict(technician),
        "total_reviews": len(ratings),
        "reviews": [dict(row) for row in ratings],
    }
