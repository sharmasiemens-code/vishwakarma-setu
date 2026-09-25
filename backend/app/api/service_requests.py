from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user


router = APIRouter(
    prefix="/service-requests",
    tags=["Service Requests"],
)


class ServiceRequestCreate(BaseModel):
    service_id: str

    title: str = Field(..., min_length=3, max_length=200)
    description: str | None = None

    address_line1: str
    address_line2: str | None = None
    city: str
    state: str
    pincode: str | None = None

    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)

    preferred_date: str | None = None
    preferred_time_start: str | None = None
    preferred_time_end: str | None = None


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

        LEFT JOIN jobs j
            ON j.service_request_id = sr.id

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

        LEFT JOIN jobs j
            ON j.service_request_id = sr.id

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
