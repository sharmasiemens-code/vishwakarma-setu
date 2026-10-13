from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel, Field, ConfigDict, StrictFloat, field_validator
from sqlalchemy import text
from sqlalchemy.orm import Session
from datetime import date, time

from app.db.database import get_db
from app.core.security import get_current_user


router = APIRouter(
    prefix="/service-requests",
    tags=["Service Requests"],
)


class ServiceRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service_id: UUID
    title: str = Field(..., min_length=3, max_length=200)
    description: str | None = Field(None, max_length=2000)
    address_line1: str = Field(..., min_length=3, max_length=300)
    address_line2: str | None = Field(None, max_length=300)
    city: str = Field(..., min_length=2, max_length=100)
    state: str = Field(..., min_length=2, max_length=100)
    pincode: str | None = Field(None, min_length=3, max_length=10)
    latitude: StrictFloat = Field(..., ge=-90, le=90)
    longitude: StrictFloat = Field(..., ge=-180, le=180)
    preferred_date: date | None = None
    preferred_time_start: time | None = None
    preferred_time_end: time | None = None

    @field_validator(
        "preferred_time_start",
        "preferred_time_end",
        mode="before"
    )
    @classmethod
    def validate_preferred_time(cls, value):
        if value is None:
            return None

        if not isinstance(value, str):
            raise ValueError(
                "Preferred time must be provided as HH:MM or HH:MM:SS"
            )

        return value

    @field_validator(
        "title",
        "address_line1",
        "city",
        "state",
        mode="before"
    )
    @classmethod
    def validate_required_text(cls, value):
        if not isinstance(value, str):
            raise ValueError("Value must be a string")

        value = value.strip()

        if not value:
            raise ValueError("Value cannot be blank")

        return value

    @field_validator(
        "description",
        "address_line2",
        "pincode",
        mode="before"
    )
    @classmethod
    def normalize_optional_text(cls, value):
        if value is None:
            return None

        if not isinstance(value, str):
            raise ValueError("Value must be a string")

        value = value.strip()

        if not value:
            return None

        return value
@router.post("")
def create_service_request(
    request: ServiceRequestCreate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can create service requests
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can create service requests",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    # Find the customer profile linked to the authenticated user
    customer_query = text("""
        SELECT
            c.id,
            c.user_id
        FROM customers c
        JOIN users u
            ON u.id = c.user_id
        WHERE
            c.user_id = :user_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE;
    """)

    customer = db.execute(
        customer_query,
        {"user_id": user_id},
    ).fetchone()

    if not customer:
        raise HTTPException(
            status_code=404,
            detail="Customer profile not found or inactive",
        )

    customer_id = customer.id

    # Verify service
    service_query = text("""
        SELECT
            s.id,
            s.name,
            s.is_active
        FROM services s
        JOIN service_categories c
            ON c.id = s.category_id
        WHERE
            s.id = :service_id
            AND s.is_active = TRUE
            AND c.is_active = TRUE;
    """)

    service = db.execute(
        service_query,
        {"service_id": request.service_id},
    ).fetchone()

    if not service:
        raise HTTPException(
            status_code=404,
            detail="Service not found or inactive",
        )
    # Validate preferred time window
    if (
        request.preferred_time_start is not None
        and request.preferred_time_end is not None
        and request.preferred_time_end <= request.preferred_time_start
    ):
        raise HTTPException(
            status_code=422,
            detail="Preferred end time must be later than preferred start time",
        )
    # Create service request
    insert_query = text("""
        INSERT INTO service_requests (
            customer_id,
            service_id,
            title,
            description,
            address_line1,
            address_line2,
            city,
            state,
            pincode,
            location,
            search_radius_meters,
            status,
            preferred_date,
            preferred_time_start,
            preferred_time_end
        )
        VALUES (
            :customer_id,
            :service_id,
            :title,
            :description,
            :address_line1,
            :address_line2,
            :city,
            :state,
            :pincode,
            ST_SetSRID(
                ST_MakePoint(:longitude, :latitude),
                4326
            )::geography,
            10000,
            'OPEN',
            :preferred_date,
            :preferred_time_start,
            :preferred_time_end
        )
        RETURNING
            id,
            customer_id,
            service_id,
            title,
            description,
            address_line1,
            address_line2,
            city,
            state,
            pincode,
            search_radius_meters,
            status,
            preferred_date,
            preferred_time_start,
            preferred_time_end,
            created_at;
    """)

    try:
        result = db.execute(
            insert_query,
            {
                "customer_id": customer_id,
                "service_id": request.service_id,
                "title": request.title,
                "description": request.description,
                "address_line1": request.address_line1,
                "address_line2": request.address_line2,
                "city": request.city,
                "state": request.state,
                "pincode": request.pincode,
                "longitude": request.longitude,
                "latitude": request.latitude,
                "preferred_date": request.preferred_date,
                "preferred_time_start": request.preferred_time_start,
                "preferred_time_end": request.preferred_time_end,
            },
        )

        created_request = result.fetchone()

        db.commit()

        return {
            "status": "success",
            "message": "Service request created successfully",
            "service_request": dict(created_request._mapping),
        }

    except Exception as exc:
        db.rollback()

        raise HTTPException(
            status_code=500,
            detail="Could not create service request",
        )

@router.get("/my")
def get_my_service_requests(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can access their service requests
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access customer service requests",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    query = text("""
        SELECT
            sr.id,
            sr.service_id,
            s.name AS service_name,
            sc.name AS category_name,
            sr.title,
            sr.description,
            sr.address_line1,
            sr.address_line2,
            sr.city,
            sr.state,
            sr.pincode,
            sr.search_radius_meters,
            sr.status,
            sr.preferred_date,
            sr.preferred_time_start,
            sr.preferred_time_end,
            sr.created_at,
            sr.updated_at,

            (
                SELECT COUNT(*)
                FROM jobs j
                WHERE j.service_request_id = sr.id
            ) AS job_count

        FROM service_requests sr

        JOIN customers c
            ON c.id = sr.customer_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN service_categories sc
            ON sc.id = s.category_id

        WHERE
            c.user_id = :user_id

        ORDER BY
            sr.created_at DESC;
    """)

    rows = db.execute(
        query,
        {"user_id": user_id},
    ).mappings().all()

    return {
        "status": "success",
        "customer_user_id": user_id,
        "total_requests": len(rows),
        "service_requests": [
            dict(row)
            for row in rows
        ],
    }
@router.get("/{request_id}")
def get_my_service_request(
    request_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can access service request details
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access service request details",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    query = text("""
        SELECT
            sr.id,
            sr.customer_id,
            sr.service_id,

            s.name AS service_name,
            sc.name AS category_name,

            sr.title,
            sr.description,

            sr.address_line1,
            sr.address_line2,
            sr.city,
            sr.state,
            sr.pincode,

            ST_Y(sr.location::geometry) AS latitude,
            ST_X(sr.location::geometry) AS longitude,

            sr.search_radius_meters,
            sr.status,

            sr.preferred_date,
            sr.preferred_time_start,
            sr.preferred_time_end,

            sr.created_at,
            sr.updated_at,

            j.id AS job_id,
            j.status AS job_status,
            j.estimated_amount,
            j.final_amount,
            j.assigned_at,
            j.accepted_at,
            j.started_at,
            j.completed_at

        FROM service_requests sr

        JOIN customers c
            ON c.id = sr.customer_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN service_categories sc
            ON sc.id = s.category_id

        LEFT JOIN LATERAL (
    SELECT
        j1.id,
        j1.status,
        j1.estimated_amount,
        j1.final_amount,
        j1.assigned_at,
        j1.accepted_at,
        j1.started_at,
        j1.completed_at
    FROM jobs j1
    WHERE j1.service_request_id = sr.id
    ORDER BY j1.created_at DESC
    LIMIT 1
) j ON TRUE

        WHERE
            sr.id = :request_id
            AND c.user_id = :user_id;
    """)

    row = db.execute(
        query,
        {
            "request_id": request_id,
            "user_id": user_id,
        },
    ).mappings().first()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="Service request not found",
        )

    return {
        "status": "success",
        "service_request": dict(row),
    }

@router.get("/{request_id}/summary")
def get_service_request_summary(
    request_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can access request summary
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can access service request summary",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    # Get request and verify ownership
    request_query = text("""
        SELECT
            sr.id,
            sr.customer_id,
            sr.service_id,

            s.name AS service_name,
            sc.name AS category_name,

            sr.title,
            sr.description,

            sr.address_line1,
            sr.address_line2,
            sr.city,
            sr.state,
            sr.pincode,

            ST_Y(sr.location::geometry) AS latitude,
            ST_X(sr.location::geometry) AS longitude,

            sr.search_radius_meters,
            sr.status,

            sr.preferred_date,
            sr.preferred_time_start,
            sr.preferred_time_end,

            sr.created_at,
            sr.updated_at,

            j.id AS job_id,
            j.status AS job_status,
            j.estimated_amount,
            j.final_amount

        FROM service_requests sr

        JOIN customers c
            ON c.id = sr.customer_id

        JOIN services s
            ON s.id = sr.service_id

        JOIN service_categories sc
            ON sc.id = s.category_id

                LEFT JOIN LATERAL (
            SELECT
                j1.id,
                j1.status,
                j1.estimated_amount,
                j1.final_amount
            FROM jobs j1
            WHERE j1.service_request_id = sr.id
            ORDER BY j1.created_at DESC
            LIMIT 1
        ) j ON TRUE

        WHERE
            sr.id = :request_id
            AND c.user_id = :user_id;
    """)

    service_request = db.execute(
        request_query,
        {
            "request_id": request_id,
            "user_id": user_id,
        },
    ).mappings().first()

    if not service_request:
        raise HTTPException(
            status_code=404,
            detail="Service request not found",
        )

    # Find currently eligible technicians
    matching_query = text("""
        SELECT
            t.id AS technician_id,
            u.full_name,
            t.business_name,
            t.experience_years,
            t.rating_average,
            t.total_jobs,
            t.availability_status,

            ROUND(
                (
                    ST_Distance(
                        tl.location,
                        sr.location
                    ) / 1000.0
                )::numeric,
                2
            ) AS distance_km

        FROM service_requests sr

        JOIN technicians t
            ON t.kyc_status = 'APPROVED'
            AND t.availability_status = 'ONLINE'

        JOIN users u
            ON u.id = t.user_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE

        JOIN technician_locations tl
            ON tl.technician_id = t.id

        WHERE
            sr.id = :request_id

            -- GPS must be fresh
            AND tl.last_seen_at >= NOW() - INTERVAL '10 minutes'

            -- Technician must be within both request and technician radius
            AND ST_DWithin(
                tl.location,
                sr.location,
                LEAST(
                    sr.search_radius_meters,
                    t.service_radius_km * 1000
                )
            )

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
            )
            -- Technician must not already have an active job
            AND NOT EXISTS (
                SELECT 1
                FROM jobs active_job
                WHERE
                    active_job.technician_id = t.id
                    AND active_job.status IN (
                        'ASSIGNED',
                        'ACCEPTED',
                        'ON_THE_WAY',
                        'ARRIVED',
                        'IN_PROGRESS'
                    )
            )
        ORDER BY
            ST_Distance(
                tl.location,
                sr.location
            );
    """)

    matches = db.execute(
        matching_query,
        {"request_id": request_id},
    ).mappings().all()

    return {
        "status": "success",

        "service_request": dict(service_request),

        "matching": {
            "total_matches": len(matches),
            "search_radius_km": service_request["search_radius_meters"] / 1000,
            "technicians": [
                dict(match)
                for match in matches
            ],
        },
    }
@router.get("/{request_id}/matches")
def get_service_request_matches(
    request_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # Only customers can view matches for their requests
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can view service request matches",
        )

    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid customer authentication",
        )

    # Get service request and verify ownership
    request_query = text("""
        SELECT
            sr.id,
            sr.customer_id,
            sr.service_id,
            sr.search_radius_meters,
            sr.status,
            ST_Y(sr.location::geometry) AS latitude,
            ST_X(sr.location::geometry) AS longitude
        FROM service_requests sr
        JOIN customers c
            ON c.id = sr.customer_id
        WHERE
            sr.id = :request_id
            AND c.user_id = :user_id;
    """)

    service_request = db.execute(
        request_query,
        {
            "request_id": request_id,
            "user_id": user_id,
        },
    ).fetchone()

    if not service_request:
        raise HTTPException(
            status_code=404,
            detail="Service request not found",
        )

    # Find eligible technicians
    matching_query = text("""
        SELECT
            t.id AS technician_id,
            u.full_name,
            t.business_name,
            t.experience_years,
            t.rating_average,
            t.total_jobs,
            t.availability_status,

            ROUND(
                (
                    ST_Distance(
                        tl.location,
                        sr.location
                    ) / 1000.0
                )::numeric,
                2
            ) AS distance_km

        FROM service_requests sr

        JOIN technicians t
            ON t.kyc_status = 'APPROVED'
            AND t.availability_status = 'ONLINE'

        JOIN users u
            ON u.id = t.user_id
            AND u.is_active = TRUE
            AND u.is_verified = TRUE

        JOIN technician_locations tl
            ON tl.technician_id = t.id

        WHERE
            sr.id = :request_id

            -- Technician GPS must be fresh
            AND tl.last_seen_at >= NOW() - INTERVAL '10 minutes'

            -- Technician must be within request radius
            AND ST_DWithin(
                tl.location,
                sr.location,
                LEAST(
                    sr.search_radius_meters,
                    t.service_radius_km * 1000
                )
            )

            -- Technician must have the required primary skill
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

            -- Technician must have ALL required tools
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
            )
            -- Technician must not already have an active job
            AND NOT EXISTS (
                SELECT 1
                FROM jobs active_job
                WHERE
                    active_job.technician_id = t.id
                    AND active_job.status IN (
                        'ASSIGNED',
                        'ACCEPTED',
                        'ON_THE_WAY',
                        'ARRIVED',
                        'IN_PROGRESS'
                    )
            )
        ORDER BY
            ST_Distance(
                tl.location,
                sr.location
            );
    """)

    matches = db.execute(
        matching_query,
        {"request_id": request_id},
    ).fetchall()

    return {
        "status": "success",
        "service_request_id": str(service_request.id),
        "request_status": service_request.status,
        "search_radius_km": service_request.search_radius_meters / 1000,
        "customer_location": {
            "latitude": float(service_request.latitude),
            "longitude": float(service_request.longitude),
        },
        "total_matches": len(matches),
        "matches": [
            dict(match._mapping)
            for match in matches
        ],
    }


class ServiceRequestLocationUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    latitude: StrictFloat = Field(ge=-90, le=90, allow_inf_nan=False)
    longitude: StrictFloat = Field(ge=-180, le=180, allow_inf_nan=False)


@router.patch("/{request_id}/location")
def update_service_request_location(
    request_id: UUID,
    payload: ServiceRequestLocationUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(status_code=403, detail="Customer access required")

    try:
        row = db.execute(
            text("""
                SELECT sr.id, sr.status
                FROM public.service_requests sr
                JOIN public.customers c ON c.id = sr.customer_id
                JOIN public.users u ON u.id = c.user_id
                WHERE sr.id = :request_id
                  AND u.id = CAST(:actor_id AS uuid)
                  AND u.role = 'CUSTOMER'
                  AND u.is_active = TRUE
                  AND u.is_verified = TRUE
                FOR UPDATE OF sr
            """),
            {"request_id": request_id, "actor_id": current_user["sub"]},
        ).mappings().first()

        if row is None:
            raise HTTPException(status_code=404, detail="Service request not found")

        if row["status"] != "OPEN":
            raise HTTPException(
                status_code=409,
                detail="Only an OPEN request can have its location corrected",
            )

        previously_assigned = db.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1 FROM public.jobs
                    WHERE service_request_id = :request_id
                )
            """),
            {"request_id": request_id},
        ).scalar_one()

        if previously_assigned:
            raise HTTPException(
                status_code=409,
                detail="Location cannot change after a request has been assigned",
            )

        updated = db.execute(
            text("""
                UPDATE public.service_requests
                SET location = ST_SetSRID(
                        ST_MakePoint(:longitude, :latitude), 4326
                    )::geography,
                    updated_at = clock_timestamp()
                WHERE id = :request_id
                RETURNING id,
                          ST_Y(location::geometry) AS latitude,
                          ST_X(location::geometry) AS longitude,
                          updated_at
            """),
            {
                "request_id": request_id,
                "latitude": payload.latitude,
                "longitude": payload.longitude,
            },
        ).mappings().one()

        result = dict(updated)
        db.commit()
        return {
            "status": "success",
            "message": "Work location updated. Refresh technician matches.",
            "service_request": result,
        }

    except Exception:
        db.rollback()
        raise
