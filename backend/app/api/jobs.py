from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session
from enum import Enum

from app.db.database import get_db
from app.core.security import get_current_user
from app.core.notifications import create_notification


router = APIRouter(
    prefix="/jobs",
    tags=["Jobs"],
)


class JobCreate(BaseModel):
    service_request_id: UUID
    technician_id: UUID
    estimated_amount: float | None = None


class JobResponse(BaseModel):
    action: str
    remarks: str | None = Field(None, max_length=1000)

@router.post("")
def create_job(
    request: JobCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can assign a technician
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can assign technicians",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )
    # 1. Get the service request
    service_request_query = text("""
    SELECT
        sr.id,
        sr.customer_id,
        sr.service_id,
        sr.status
    FROM service_requests sr
    JOIN customers c
        ON c.id = sr.customer_id
    JOIN users u
        ON u.id = c.user_id
    WHERE
        sr.id = :service_request_id
        AND c.user_id = :user_id
        AND u.is_active = TRUE
        AND u.is_verified = TRUE;
""")

    service_request = db.execute(
        service_request_query,
        {
    "service_request_id": request.service_request_id,
    "user_id": user_id,
}
    ).fetchone()

    if not service_request:
        raise HTTPException(
            status_code=404,
            detail="Service request not found",
        )

    # 2. Request must still be OPEN
    if service_request.status != "OPEN":
        raise HTTPException(
            status_code=409,
            detail=f"Service request is not OPEN. Current status: {service_request.status}",
        )

    # 3. Verify technician
    technician_query = text("""
        SELECT
            t.id,
            t.user_id,
            t.kyc_status,
            t.availability_status
        FROM technicians t
        JOIN users u
            ON u.id = t.user_id
        WHERE
            t.id = :technician_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE;
    """)

    technician = db.execute(
        technician_query,
        {
            "technician_id": request.technician_id,
        },
    ).fetchone()

    if not technician:
        raise HTTPException(
            status_code=404,
            detail="Technician not found or inactive",
        )

    # 4. Technician must be KYC approved
    if technician.kyc_status != "APPROVED":
        raise HTTPException(
            status_code=409,
            detail="Technician KYC is not approved",
        )

    # 5. Technician must be ONLINE
    if technician.availability_status != "ONLINE":
        raise HTTPException(
            status_code=409,
            detail="Technician is not currently ONLINE",
        )

    # 6. Verify technician matches requested service
    # 6. Technician GPS must be fresh and within the request search radius
    location_query = text("""
        SELECT
            ST_Distance(
                tl.location,
                sr.location
            ) AS distance_meters
        FROM technician_locations tl
        JOIN service_requests sr
            ON sr.id = :service_request_id
        JOIN technicians t
            ON t.id = tl.technician_id
        WHERE
            tl.technician_id = :technician_id
            AND tl.location IS NOT NULL
            AND sr.location IS NOT NULL
            AND tl.last_seen_at >= NOW() - INTERVAL '10 minutes'
            AND ST_DWithin(
                tl.location,
                sr.location,
                LEAST(
                    sr.search_radius_meters,
                    t.service_radius_km * 1000
                )
            )
        LIMIT 1;
    """)

    technician_location = db.execute(
        location_query,
        {
            "service_request_id": request.service_request_id,
            "technician_id": request.technician_id,
        },
    ).fetchone()

    if not technician_location:
        raise HTTPException(
            status_code=409,
            detail="Technician GPS location is unavailable, stale, or outside the service area",
        )

    distance_km = round(float(technician_location.distance_meters) / 1000, 2)
    matching_query = text("""
        SELECT 1
        FROM service_requests sr
        JOIN technicians t
            ON t.id = :technician_id

        WHERE
            sr.id = :service_request_id

            -- Required skill
            AND EXISTS (
                SELECT 1
                FROM service_skills ss
                JOIN technician_skills ts
                    ON ts.skill_id = ss.skill_id
                WHERE
                    ss.service_id = sr.service_id
                    AND ss.is_required = TRUE
                    AND ts.technician_id = t.id
            )

            -- ALL required tools
            AND NOT EXISTS (
                SELECT 1
                FROM service_tools st
                WHERE
                    st.service_id = sr.service_id
                    AND st.is_required = TRUE
                    AND NOT EXISTS (
                        SELECT 1
                        FROM technician_tools tt
                        WHERE
                            tt.technician_id = t.id
                            AND tt.tool_id = st.tool_id
                    )
            );
    """)

    technician_matches = db.execute(
        matching_query,
        {
            "service_request_id": request.service_request_id,
            "technician_id": request.technician_id,
        },
    ).fetchone()

    if not technician_matches:
        raise HTTPException(
            status_code=409,
            detail="Technician does not match the required skills and tools for this service",
        )

    # 7. Only one active job is allowed per service request
    active_job_query = text("""
        SELECT id, status
        FROM jobs
        WHERE
            service_request_id = :service_request_id
            AND status IN (
                'ASSIGNED',
                'ACCEPTED',
                'ON_THE_WAY',
                'ARRIVED',
                'IN_PROGRESS'
            )
        LIMIT 1;
    """)

    active_job = db.execute(
        active_job_query,
        {
            "service_request_id": request.service_request_id,
        },
    ).fetchone()

    if active_job:
        raise HTTPException(
            status_code=409,
            detail=(
                "This service request already has an active job "
                f"with status: {active_job.status}"
            ),
        )

    # 8. Create job
   
    insert_job_query = text("""
        INSERT INTO jobs (
            service_request_id,
            technician_id,
            customer_id,
            status,
            estimated_amount
        )
        VALUES (
            :service_request_id,
            :technician_id,
            :customer_id,
            'ASSIGNED',
            :estimated_amount
        )
        RETURNING
            id,
            service_request_id,
            technician_id,
            customer_id,
            status,
            estimated_amount,
            assigned_at,
            created_at;
    """)

    try:
        result = db.execute(
            insert_job_query,
            {
                "service_request_id": request.service_request_id,
                "technician_id": request.technician_id,
                "customer_id": service_request.customer_id,
                "estimated_amount": request.estimated_amount,
            },
        )

        job = result.fetchone()

        # 8. Add initial job status history
        history_query = text("""
            INSERT INTO job_status_history (
                job_id,
                old_status,
                new_status,
                changed_by,
                remarks
            )
            VALUES (
                :job_id,
                NULL,
                'ASSIGNED',
                NULL,
                'Job assigned to technician'
            );
        """)

        db.execute(
            history_query,
            {
                "job_id": job.id,
            },
        )

        # Notify technician about new job assignment
        create_notification(
            db=db,
            user_id=str(technician.user_id),
            title="New Job Assigned",
            message="A new service job has been assigned to you.",
            notification_type="JOB_ASSIGNED",
            reference_id=str(job.id),
        )

        db.commit()

        return {
            "status": "success",
            "message": "Job created and assigned successfully",
            "distance_km": distance_km,
            "job": dict(job._mapping),
        }

    except Exception as exc:
        db.rollback()

        if "jobs_service_request_id_key" in str(exc):
            raise HTTPException(
                status_code=409,
                detail="This service request has already been assigned to a job",
            )

        raise HTTPException(
            status_code=500,
            detail="Could not respond to job",
        )

class JobCancellationRequest(BaseModel):
    reason: str | None = Field(None, max_length=1000)


@router.post("/{job_id}/cancel")
def cancel_job_by_customer(
    job_id: UUID,
    request: JobCancellationRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can cancel their jobs
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can cancel jobs",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    # 1. Get job and verify customer ownership
    job_query = text("""
        SELECT
            j.id,
            j.service_request_id,
            j.technician_id,
            j.customer_id,
            j.status
        FROM jobs j
        JOIN customers c
            ON c.id = j.customer_id
        JOIN users u
            ON u.id = c.user_id
        WHERE
            j.id = :job_id
            AND c.user_id = :user_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE;
    """)

    job = db.execute(
        job_query,
        {
            "job_id": job_id,
            "user_id": user_id,
        },
    ).fetchone()

    if not job:
        raise HTTPException(
            status_code=404,
            detail="Job not found for this customer",
        )

    # 2. Validate cancellation status
    allowed_statuses = {
        "ASSIGNED",
        "ACCEPTED",
        "ON_THE_WAY",
    }

    if job.status not in allowed_statuses:
        raise HTTPException(
            status_code=409,
            detail=f"Job cannot be cancelled from status: {job.status}",
        )

    reason = request.reason or "Cancelled by customer"

    try:
        # 3. Cancel the job
        update_query = text("""
            UPDATE jobs
            SET
                status = 'CANCELLED',
                cancelled_at = now(),
                cancellation_reason = :reason,
                updated_at = now()
            WHERE id = :job_id
            RETURNING
                id,
                service_request_id,
                technician_id,
                customer_id,
                status,
                estimated_amount,
                assigned_at,
                accepted_at,
                cancelled_at,
                cancellation_reason,
                created_at,
                updated_at;
        """)

        result = db.execute(
            update_query,
            {
                "job_id": job_id,
                "reason": reason,
            },
        )

        updated_job = result.fetchone()

        # 4. Add status history
        history_query = text("""
            INSERT INTO job_status_history (
                job_id,
                old_status,
                new_status,
                changed_by,
                remarks
            )
            VALUES (
                :job_id,
                :old_status,
                'CANCELLED',
                :changed_by,
                :remarks
            );
        """)

        db.execute(
            history_query,
            {
                "job_id": job_id,
                "old_status": job.status,
                "changed_by": user_id,
                "remarks": reason,
            },
        )

        # 5. Notify technician
        technician_user_query = text("""
            SELECT user_id
            FROM technicians
            WHERE id = :technician_id
        """)

        technician_user_id = db.execute(
            technician_user_query,
            {"technician_id": str(job.technician_id)},
        ).scalar()

        if technician_user_id:
            create_notification(
                db=db,
                user_id=str(technician_user_id),
                title="Job Cancelled",
                message="The customer has cancelled your assigned service job.",
                notification_type="JOB_CANCELLED",
                reference_id=str(job_id),
            )

        db.commit()

        return {
            "status": "success",
            "message": "Job cancelled successfully",
            "job": dict(updated_job._mapping),
        }

    except HTTPException:
        db.rollback()
        raise

    except Exception:
        db.rollback()
        raise HTTPException(
            status_code=500,
            detail="Could not cancel job",
        )

@router.post("/{job_id}/respond")
def respond_to_job(
    job_id: UUID,
    request: JobResponse,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Normalize action
    action = request.action.upper().strip()
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Only technicians can respond to jobs",
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token",
        )

    if action not in {"ACCEPT", "REJECT"}:
        raise HTTPException(
            status_code=400,
            detail="Action must be ACCEPT or REJECT",
        )

    # 1. Get the job and verify assigned technician
    job_query = text("""
        SELECT
            j.id,
            j.technician_id,
            j.customer_id,
            j.status,
            j.service_request_id
        FROM jobs j
        WHERE j.id = :job_id;
    """)

    job = db.execute(
        job_query,
        {"job_id": job_id},
    ).fetchone()

    if not job:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

        # 2. Only the assigned technician can respond
    if str(job.technician_id) != str(technician_id):
        raise HTTPException(
            status_code=403,
            detail="This job is not assigned to this technician",
        )

    # 3. Only ASSIGNED jobs can be accepted/rejected
    if job.status != "ASSIGNED":
        raise HTTPException(
            status_code=409,
            detail=f"Job cannot be responded to. Current status: {job.status}",
        )

    if action == "ACCEPT":
        new_status = "ACCEPTED"
        remarks = request.remarks or "Technician accepted the job"

        update_query = text("""
            UPDATE jobs
            SET
                status = 'ACCEPTED',
                accepted_at = now(),
                updated_at = now()
            WHERE id = :job_id
            RETURNING
                id,
                service_request_id,
                technician_id,
                customer_id,
                status,
                estimated_amount,
                assigned_at,
                accepted_at,
                created_at,
                updated_at;
        """)

    else:
        new_status = "CANCELLED"
        remarks = request.remarks or "Technician rejected the job"

        update_query = text("""
            UPDATE jobs
            SET
                status = 'CANCELLED',
                cancelled_at = now(),
                cancellation_reason = :remarks,
                updated_at = now()
            WHERE id = :job_id
            RETURNING
                id,
                service_request_id,
                technician_id,
                customer_id,
                status,
                estimated_amount,
                assigned_at,
                accepted_at,
                cancelled_at,
                cancellation_reason,
                created_at,
                updated_at;
        """)

    try:
        if action == "ACCEPT":
            result = db.execute(
                update_query,
                {"job_id": job_id},
            )
        else:
            result = db.execute(
                update_query,
                {
                    "job_id": job_id,
                    "remarks": remarks,
                },
            )

        updated_job = result.fetchone()

        # 4. Add status history
        history_query = text("""
            INSERT INTO job_status_history (
                job_id,
                old_status,
                new_status,
                changed_by,
                remarks
            )
            VALUES (
                :job_id,
                'ASSIGNED',
                :new_status,
                (
                    SELECT user_id
                    FROM technicians
                    WHERE id = :technician_id
                ),
                :remarks
            );
        """)
        db.execute(
            history_query,
            {
                "job_id": job_id,
                "technician_id": technician_id,
                "new_status": new_status,
                "remarks": remarks,
            },
        )

        # 5. Create notification for the customer
        customer_user_query = text("""
            SELECT user_id
            FROM customers
            WHERE id = :customer_id
        """)

        customer_user_id = db.execute(
            customer_user_query,
            {"customer_id": str(job.customer_id)},
        ).scalar()

        if customer_user_id:
            if action == "ACCEPT":
                create_notification(
                    db=db,
                    user_id=str(customer_user_id),
                    title="Job Accepted",
                    message="Your technician has accepted your service job.",
                    notification_type="JOB_ACCEPTED",
                    reference_id=str(job_id),
                )
            else:
                create_notification(
                    db=db,
                    user_id=str(customer_user_id),
                    title="Job Cancelled",
                    message=(
                        "The assigned technician has rejected your service job. "
                        "You can select another available technician."
                    ),
                    notification_type="JOB_CANCELLED",
                    reference_id=str(job_id),
                )

        db.commit()

        return {
            "status": "success",
            "message": (
                "Job accepted successfully"
                if action == "ACCEPT"
                else "Job rejected successfully"
            ),
            "job": dict(updated_job._mapping),
        }

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Could not respond to job",
        )
class JobStatus(str, Enum):
    ON_THE_WAY = "ON_THE_WAY"
    ARRIVED = "ARRIVED"
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"


class JobStatusUpdate(BaseModel):
    new_status: JobStatus
    remarks: str | None = Field(None, max_length=1000)

    @field_validator("new_status", mode="before")
    @classmethod
    def normalize_status(cls, value):
        if isinstance(value, str):
            return value.strip().upper()
        return value

@router.post("/{job_id}/status")
def update_job_status(
    job_id: UUID,
    request: JobStatusUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    new_status = request.new_status.upper().strip()
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Only technicians can update job status",
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token",
        )

    allowed_statuses = {
        "ON_THE_WAY",
        "ARRIVED",
        "IN_PROGRESS",
        "COMPLETED",
    }

    if new_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid status. Allowed values: "
                "ON_THE_WAY, ARRIVED, IN_PROGRESS, COMPLETED"
            ),
        )

    # Get job and verify assigned technician
    job_query = text("""
        SELECT
            j.id,
            j.technician_id,
            j.status,
            j.service_request_id,
            j.customer_id
        FROM jobs j
        WHERE j.id = :job_id;
    """)

    job = db.execute(
        job_query,
        {"job_id": job_id},
    ).fetchone()

    if not job:
        raise HTTPException(
            status_code=404,
            detail="Job not found",
        )

    # Only assigned technician can update the job
    if str(job.technician_id) != str(technician_id):
        raise HTTPException(
            status_code=403,
            detail="This job is not assigned to this technician",
        )

    # Define valid status transitions
    valid_transitions = {
        "ACCEPTED": {"ON_THE_WAY"},
        "ON_THE_WAY": {"ARRIVED"},
        "ARRIVED": {"IN_PROGRESS"},
        "IN_PROGRESS": {"COMPLETED"},
    }

    current_status = job.status

    if current_status not in valid_transitions:
        raise HTTPException(
            status_code=409,
            detail=f"Job cannot be progressed from status: {current_status}",
        )

    if new_status not in valid_transitions[current_status]:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Invalid status transition: "
                f"{current_status} -> {new_status}"
            ),
        )

    remarks = request.remarks

    if not remarks:
        default_remarks = {
            "ON_THE_WAY": "Technician is on the way",
            "ARRIVED": "Technician has arrived at customer location",
            "IN_PROGRESS": "Work has started",
            "COMPLETED": "Work completed successfully",
        }

        remarks = default_remarks[new_status]

    # Update appropriate timestamp
    if new_status == "ON_THE_WAY":
        update_query = text("""
            UPDATE jobs
            SET
                status = 'ON_THE_WAY',
                updated_at = now()
            WHERE id = :job_id
            RETURNING
                id,
                service_request_id,
                technician_id,
                customer_id,
                status,
                estimated_amount,
                assigned_at,
                accepted_at,
                started_at,
                completed_at,
                updated_at;
        """)

    elif new_status == "ARRIVED":
        update_query = text("""
            UPDATE jobs
            SET
                status = 'ARRIVED',
                updated_at = now()
            WHERE id = :job_id
            RETURNING
                id,
                service_request_id,
                technician_id,
                customer_id,
                status,
                estimated_amount,
                assigned_at,
                accepted_at,
                started_at,
                completed_at,
                updated_at;
        """)

    elif new_status == "IN_PROGRESS":
        update_query = text("""
            UPDATE jobs
            SET
                status = 'IN_PROGRESS',
                started_at = COALESCE(started_at, now()),
                updated_at = now()
            WHERE id = :job_id
            RETURNING
                id,
                service_request_id,
                technician_id,
                customer_id,
                status,
                estimated_amount,
                assigned_at,
                accepted_at,
                started_at,
                completed_at,
                updated_at;
        """)

    else:
        update_query = text("""
            UPDATE jobs
            SET
                status = 'COMPLETED',
                completed_at = now(),
                updated_at = now()
            WHERE id = :job_id
            RETURNING
                id,
                service_request_id,
                technician_id,
                customer_id,
                status,
                estimated_amount,
                assigned_at,
                accepted_at,
                started_at,
                completed_at,
                updated_at;
        """)

    try:
        result = db.execute(
            update_query,
            {"job_id": job_id},
        )

        updated_job = result.fetchone()

        # When the job is completed, close the related service request
        if new_status == "COMPLETED":
            service_request_update = text("""
                UPDATE service_requests
                SET
                    status = 'COMPLETED',
                    updated_at = now()
                WHERE id = :service_request_id
            """)

            db.execute(
                service_request_update,
                {
                    "service_request_id": job.service_request_id
                },
            )

        # Record status history
        history_query = text("""
            INSERT INTO job_status_history (
                job_id,
                old_status,
                new_status,
                changed_by,
                remarks
            )
            VALUES (
                :job_id,
                :old_status,
                :new_status,
                (
                    SELECT user_id
                    FROM technicians
                    WHERE id = :technician_id
                ),
                :remarks
            );
        """)

        db.execute(
            history_query,
            {
                "job_id": job_id,
                "old_status": current_status,
                "new_status": new_status,
                "technician_id": technician_id,
                "remarks": remarks,
            },
        )

        # Create notification for customer
        customer_user_query = text("""
            SELECT user_id
            FROM customers
            WHERE id = :customer_id
        """)

        customer_user_id = db.execute(
            customer_user_query,
            {"customer_id": str(job.customer_id)},
        ).scalar()

        if customer_user_id:
            notification_messages = {
                "ON_THE_WAY": (
                    "Technician On The Way",
                    "Your technician is on the way to your location.",
                    "TECHNICIAN_ON_THE_WAY",
                ),
                "ARRIVED": (
                    "Technician Arrived",
                    "Your technician has arrived at your location.",
                    "TECHNICIAN_ARRIVED",
                ),
                "IN_PROGRESS": (
                    "Work Started",
                    "Your technician has started working on your service request.",
                    "JOB_IN_PROGRESS",
                ),
                "COMPLETED": (
                    "Job Completed",
                    "Your service job has been completed successfully.",
                    "JOB_COMPLETED",
                ),
            }

            notification_data = notification_messages.get(new_status)

            if notification_data:
                title, message, notification_type = notification_data

                create_notification(
                    db=db,
                    user_id=str(customer_user_id),
                    title=title,
                    message=message,
                    notification_type=notification_type,
                    reference_id=str(job_id),
                )

        db.commit()

        return {
            "status": "success",
            "message": f"Job status updated to {new_status}",
            "job": dict(updated_job._mapping),
        }

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Could not update job status",
        )
@router.get("/{job_id}/history")
def get_job_history(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access customer job history"
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication"
        )

    query = text("""
        SELECT
            h.id,
            h.old_status,
            h.new_status,
            h.changed_by,
            h.remarks,
            h.created_at,
            u.full_name AS changed_by_name

        FROM job_status_history h

        JOIN jobs j
            ON j.id = h.job_id

        JOIN customers c
            ON c.id = j.customer_id

        JOIN users cu
            ON cu.id = c.user_id

        LEFT JOIN users u
            ON u.id = h.changed_by

        WHERE
            h.job_id = :job_id
            AND cu.id = :user_id
            AND cu.is_active = TRUE
            AND cu.is_verified = TRUE

        ORDER BY h.created_at ASC
    """)

    results = db.execute(
        query,
        {
            "job_id": job_id,
            "user_id": user_id,
        }
    ).mappings().all()

    if not results:
        raise HTTPException(
            status_code=404,
            detail="Job history not found"
        )

    return {
        "status": "success",
        "total": len(results),
        "history": [dict(row) for row in results]
    }

@router.get("/{job_id}")
def get_job(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access customer jobs"
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication"
        )

    query = text("""
        SELECT
            j.id,
            j.service_request_id,
            j.technician_id,
            j.customer_id,
            j.status,
            j.estimated_amount,
            j.final_amount,
            j.assigned_at,
            j.accepted_at,
            j.started_at,
            j.completed_at,
            j.cancelled_at,
            j.cancellation_reason,
            j.created_at,
            j.updated_at,

            sr.title AS service_request_title,
            sr.description AS service_request_description,
            sr.address_line1,
            sr.address_line2,
            sr.city,
            sr.state,
            sr.pincode,
            sr.preferred_date,
            sr.preferred_time_start,
            sr.preferred_time_end,

            s.id AS service_id,
            s.name AS service_name,

            u.full_name AS technician_name,
            t.business_name AS technician_business_name,
            t.experience_years AS technician_experience_years,
            t.rating_average AS technician_rating,
            t.total_jobs AS technician_total_jobs

        FROM jobs j

        JOIN customers c
            ON c.id = j.customer_id

        JOIN users cu
            ON cu.id = c.user_id

        JOIN service_requests sr
            ON sr.id = j.service_request_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN technicians t
            ON t.id = j.technician_id

        JOIN users u
            ON u.id = t.user_id

        WHERE
            j.id = :job_id
            AND cu.id = :user_id
            AND cu.is_active = TRUE
AND cu.is_verified = TRUE
    """)

    result = db.execute(
        query,
        {
            "job_id": job_id,
            "user_id": user_id,
        }
    ).mappings().first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Job not found"
        )

    return {
        "status": "success",
        "job": dict(result)
    }
@router.get("/customer/{customer_id}")
def get_customer_jobs(
    customer_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access customer jobs"
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication"
        )

    query = text("""
        SELECT
            j.id,
            j.service_request_id,
            j.technician_id,
            j.customer_id,
            j.status,
            j.estimated_amount,
            j.final_amount,
            j.assigned_at,
            j.accepted_at,
            j.started_at,
            j.completed_at,
            j.cancelled_at,
            j.created_at,
            j.updated_at,

            sr.title AS service_request_title,
            sr.description AS service_request_description,

            s.id AS service_id,
            s.name AS service_name,

            t.business_name AS technician_business_name,
            u.full_name AS technician_name

        FROM jobs j

        JOIN customers c
            ON c.id = j.customer_id

        JOIN users cu
            ON cu.id = c.user_id

        JOIN service_requests sr
            ON sr.id = j.service_request_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN technicians t
            ON t.id = j.technician_id

        JOIN users u
            ON u.id = t.user_id

        WHERE
            j.customer_id = c.id
            AND cu.id = :user_id
            AND cu.is_active = TRUE
            AND cu.is_verified = TRUE

        ORDER BY j.created_at DESC
    """)

    results = db.execute(
        query,
        {
            "user_id": user_id
        }
    ).mappings().all()

    return {
        "status": "success",
        "total": len(results),
        "jobs": [dict(row) for row in results]
    }
@router.get("/technician/me")
def get_my_technician_jobs(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # 1. Only technicians can access this endpoint
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Only technicians can access technician jobs",
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token",
        )

    query = text("""
        SELECT
            j.id,
            j.service_request_id,
            j.customer_id,
            j.status,
            j.estimated_amount,
            j.final_amount,
            j.assigned_at,
            j.accepted_at,
            j.started_at,
            j.completed_at,
            j.cancelled_at,
            j.created_at,
            j.updated_at,

            sr.title AS service_request_title,
            sr.description AS service_request_description,
            sr.address_line1,
            sr.address_line2,
            sr.city,
            sr.state,
            sr.pincode,

            s.id AS service_id,
            s.name AS service_name,

            u.full_name AS customer_name,
            u.phone AS customer_phone

        FROM jobs j

        JOIN service_requests sr
            ON sr.id = j.service_request_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN customers c
            ON c.id = j.customer_id

        JOIN users u
            ON u.id = c.user_id

        WHERE j.technician_id = :technician_id

        ORDER BY j.created_at DESC
    """)

    results = db.execute(
        query,
        {"technician_id": technician_id},
    ).mappings().all()

    return {
        "status": "success",
        "technician_id": technician_id,
        "total": len(results),
        "jobs": [dict(row) for row in results],
    }
@router.get("/technician/{technician_id}")
def get_technician_jobs(
    technician_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Only technicians can access technician jobs"
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid technician authentication"
        )

    technician_check = text("""
        SELECT t.id
        FROM technicians t
        JOIN users u
            ON u.id = t.user_id
        WHERE
            t.id = :technician_id
            AND u.id = :user_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE
        LIMIT 1
    """)

    technician_result = db.execute(
        technician_check,
        {
            "technician_id": technician_id,
            "user_id": user_id,
        }
    ).first()

    if not technician_result:
        raise HTTPException(
            status_code=403,
            detail="You are not authorized to access this technician's jobs"
        )

    query = text("""
        SELECT
            j.id,
            j.service_request_id,
            j.customer_id,
            j.technician_id,
            j.status,
            j.estimated_amount,
            j.final_amount,
            j.assigned_at,
            j.accepted_at,
            j.started_at,
            j.completed_at,
            j.cancelled_at,
            j.created_at,
            j.updated_at,

            sr.title AS service_request_title,
            sr.description AS service_request_description,
            sr.address_line1,
            sr.address_line2,
            sr.city,
            sr.state,
            sr.pincode,

            s.id AS service_id,
            s.name AS service_name,

            u.full_name AS customer_name,
            u.phone AS customer_phone

        FROM jobs j

        JOIN technicians t
            ON t.id = j.technician_id

        JOIN users tu
            ON tu.id = t.user_id

        JOIN service_requests sr
            ON sr.id = j.service_request_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN customers c
            ON c.id = j.customer_id

        JOIN users u
            ON u.id = c.user_id

        WHERE
            j.technician_id = :technician_id
            AND tu.id = :user_id
            AND tu.is_active = TRUE
            AND tu.is_verified = TRUE

        ORDER BY j.created_at DESC
    """)

    results = db.execute(
        query,
        {
            "technician_id": technician_id,
            "user_id": user_id,
        }
    ).mappings().all()

    return {
        "status": "success",
        "total": len(results),
        "jobs": [dict(row) for row in results]
    }
@router.get("/my/{job_id}")
def get_my_customer_job(
    job_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can access this endpoint
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access customer jobs",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    query = text("""
        SELECT
            j.id,
            j.service_request_id,
            j.customer_id,
            j.technician_id,
            j.status,
            j.estimated_amount,
            j.final_amount,
            j.assigned_at,
            j.accepted_at,
            j.started_at,
            j.completed_at,
            j.cancelled_at,
            j.cancellation_reason,
            j.created_at,
            j.updated_at,

            sr.title AS service_request_title,
            sr.description AS service_request_description,
            sr.address_line1,
            sr.address_line2,
            sr.city,
            sr.state,
            sr.pincode,
            sr.preferred_date,
            sr.preferred_time_start,
            sr.preferred_time_end,

            s.id AS service_id,
            s.name AS service_name,

            t.id AS technician_id,
            u.full_name AS technician_name,
            t.business_name AS technician_business_name,
            t.experience_years AS technician_experience_years,
            t.rating_average AS technician_rating,
            t.total_jobs AS technician_total_jobs,
            t.availability_status AS technician_availability_status

        FROM jobs j

        JOIN customers c
            ON c.id = j.customer_id

        JOIN users cu
            ON cu.id = c.user_id

        JOIN service_requests sr
            ON sr.id = j.service_request_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN technicians t
            ON t.id = j.technician_id

        JOIN users u
            ON u.id = t.user_id

        WHERE
            j.id = :job_id
            AND cu.id = :user_id
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
            detail="Job not found",
        )

    return {
        "status": "success",
        "job": dict(result),
    }