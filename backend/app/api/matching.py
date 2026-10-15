from app.core.system_settings import get_system_settings, operational_query
from fastapi import APIRouter, Depends, HTTPException, Query
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user

router = APIRouter(
    prefix="/matching",
    tags=["Technician Matching"],
)


@router.get("/technicians")
def find_matching_technicians(
    service_id: UUID = Query(..., description="Service UUID"),
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(10, gt=0, le=50),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Find verified and online technicians who:
    - provide the selected service
    - have the required skill
    - have ALL required tools
    - have approved KYC
    - have verified address
    - are active and verified
    - are within the requested radius
    """
    settings = get_system_settings(db)

    if current_user.get("role") != "CUSTOMER":
     raise HTTPException(
         status_code=403,
         detail="Only customers can search for technicians",
        
)

    radius_meters = radius_km * 1000

    query = operational_query(settings, """
        SELECT
            t.id AS technician_id,
            u.full_name,
            t.business_name,
            t.experience_years,
            (SELECT ROUND(AVG(r.rating)::numeric, 2) FROM ratings r WHERE r.technician_id = t.id) AS rating_average,
            (SELECT COUNT(*) FROM jobs done WHERE done.technician_id = t.id AND done.status = 'COMPLETED') AS total_jobs,
            t.availability_status,
            TRUE AS verification_approved,
            (SELECT COUNT(*) FROM ratings r WHERE r.technician_id = t.id) AS review_count,

            ROUND(
                (
                    ST_Distance(
                        tl.location,
                        ST_SetSRID(
                            ST_MakePoint(:longitude, :latitude),
                            4326
                        )::geography
                    ) / 1000
                )::numeric,
                2
            ) AS distance_km

        FROM technicians t

        JOIN users u
            ON u.id = t.user_id

        JOIN technician_kyc k
            ON k.technician_id = t.id

        JOIN technician_locations tl
            ON tl.technician_id = t.id

        JOIN services sv
            ON sv.id = :service_id

        WHERE
            sv.is_active = TRUE

            AND u.is_active = TRUE
            AND u.is_verified = TRUE

            AND t.kyc_status = 'APPROVED'
            AND k.verification_status = 'APPROVED'
            AND k.address_verified = TRUE
            AND NOT EXISTS (
                SELECT 1 FROM public.technician_applications a
                WHERE a.technician_id = t.id
                  AND (a.status <> 'APPROVED' OR u.phone_verified_at IS NULL)
            )

            AND t.availability_status = 'ONLINE'

            AND NOT EXISTS (
                SELECT 1
                FROM jobs active_job
                WHERE active_job.technician_id = t.id
                  AND active_job.status IN (
                      'ASSIGNED',
                      'ACCEPTED',
                      'ON_THE_WAY',
                      'ARRIVED',
                      'IN_PROGRESS'
                  )
            )
	    -- Technician GPS must be fresh within the configured timeout
AND tl.last_seen_at >= NOW() - (:gps_timeout_minutes * INTERVAL '1 minute')

            -- Technician must have the required service skill
            AND EXISTS (
                SELECT 1
                FROM service_skills ss
                JOIN technician_skills ts
                    ON ts.skill_id = ss.skill_id
                   AND ts.technician_id = t.id
                WHERE ss.service_id = sv.id
                  AND ss.is_required = TRUE
            )

            -- Technician must have ALL required tools
            AND NOT EXISTS (
                SELECT 1
                FROM service_tools st
                WHERE st.service_id = sv.id
                  AND st.is_required = TRUE
                  AND NOT EXISTS (
                      SELECT 1
                      FROM technician_tools tt
                      WHERE tt.technician_id = t.id
                        AND tt.tool_id = st.tool_id
                  )
            )

            -- Technician must be within requested radius
            AND ST_DWithin(
                tl.location,
                ST_SetSRID(
                    ST_MakePoint(:longitude, :latitude),
                    4326
                )::geography,
                LEAST(
                    :radius_meters,
                    t.service_radius_km * 1000
                )
            )

        ORDER BY
            ST_Distance(
                tl.location,
                ST_SetSRID(
                    ST_MakePoint(:longitude, :latitude),
                    4326
                )::geography
            ) ASC;
    """)

    try:
        result = db.execute(
            query,
            {
                "service_id": service_id,
                "latitude": latitude,
                "longitude": longitude,
                "radius_meters": radius_meters,
            },
        )

        technicians = [
            dict(row._mapping)
            for row in result
        ]

        return {
            "status": "success",
            "service_id": service_id,
            "customer_location": {
                "latitude": latitude,
                "longitude": longitude,
            },
            "radius_km": radius_km,
            "total_matches": len(technicians),
            "technicians": technicians,
        }

    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="Matching query failed",
        )