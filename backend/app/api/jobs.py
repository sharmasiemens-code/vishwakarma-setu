from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user

router = APIRouter(
    prefix="/jobs",
    tags=["Jobs"],
)


class JobCreate(BaseModel):
    service_request_id: str
    technician_id: str
    estimated_amount: float | None = None


class JobResponse(BaseModel):
    action: str
    remarks: str | None = None

@router.post("")
def create_job(
    request: JobCreate,
    db: Session = Depends(get_db),
):
    # 1. Get the service request
    service_request_query = text("""
        SELECT
            sr.id,
            sr.customer_id,
            sr.service_id,
            sr.status
        FROM service_requests sr
        WHERE sr.id = :service_request_id;
    """)

    service_request = db.execute(
        service_request_query,
        {
            "service_request_id": request.service_request_id,
        },
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

    # 7. Create job
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

        db.commit()

        return {
            "status": "success",
            "message": "Job created and assigned successfully",
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
            detail=f"Could not create job: {str(exc)}",
        )


@router.post("/{job_id}/respond")
def respond_to_job(
    job_id: str,
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
            detail=f"Could not update job: {str(exc)}",
        )
class JobStatusUpdate(BaseModel):
    new_status: str
    remarks: str | None = None

@router.post("/{job_id}/status")
def update_job_status(
    job_id: str,
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
            detail=f"Could not update job status: {str(exc)}",
        )
@router.get("/{job_id}/history")
def get_job_history(
    job_id: str,
    db: Session = Depends(get_db)
):
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
        LEFT JOIN users u
            ON u.id = h.changed_by
        WHERE h.job_id = :job_id
        ORDER BY h.created_at ASC
    """)

    results = db.execute(
        query,
        {"job_id": job_id}
    ).mappings().all()

    return {
        "status": "success",
        "total": len(results),
        "history": [dict(row) for row in results]
    }
@router.get("/{job_id}")
def get_job(job_id: str, db: Session = Depends(get_db)):
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

        JOIN service_requests sr
            ON sr.id = j.service_request_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN technicians t
            ON t.id = j.technician_id

        JOIN users u
            ON u.id = t.user_id

        WHERE j.id = :job_id
    """)

    result = db.execute(
        query,
        {"job_id": job_id}
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
    customer_id: str,
    db: Session = Depends(get_db)
):
    query = text("""
        SELECT
            j.id,
            j.service_request_id,
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

            s.id AS service_id,
            s.name AS service_name,

            t.business_name AS technician_business_name,
            u.full_name AS technician_name

        FROM jobs j

        JOIN service_requests sr
            ON sr.id = j.service_request_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN technicians t
            ON t.id = j.technician_id

        JOIN users u
            ON u.id = t.user_id

        WHERE j.customer_id = :customer_id

        ORDER BY j.created_at DESC
    """)

    results = db.execute(
        query,
        {"customer_id": customer_id}
    ).mappings().all()

    return {
        "status": "success",
        "total": len(results),
        "jobs": [dict(row) for row in results]
    }
@router.get("/technician/{technician_id}")
def get_technician_jobs(
    technician_id: str,
    db: Session = Depends(get_db)
):
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
        {"technician_id": technician_id}
    ).mappings().all()

    return {
        "status": "success",
        "total": len(results),
        "jobs": [dict(row) for row in results]
    }