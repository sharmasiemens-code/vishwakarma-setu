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

    if current_user.get("role") != "CUSTOMER":
     raise HTTPException(
         status_code=403,
         detail="Only customers can search for technicians",
        
)

    radius_meters = radius_km * 1000

    query = text("""
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

            AND t.availability_status = 'ONLINE'
	    -- Technician GPS must be updated within the last 10 minutes
AND tl.last_seen_at >= NOW() - INTERVAL '10 minutes'

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