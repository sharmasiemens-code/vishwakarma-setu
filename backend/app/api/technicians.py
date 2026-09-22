from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user


router = APIRouter(
    prefix="/technicians",
    tags=["Technicians"]
)


class AvailabilityUpdate(BaseModel):
    availability_status: str

@router.post("/me/availability")
def update_my_availability(
    data: AvailabilityUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Only technicians can update technician availability
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Technician access required"
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token"
        )

    allowed_statuses = {
        "ONLINE",
        "BUSY",
        "OFFLINE"
    }

    status = data.availability_status.upper()

    if status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid availability status. Use ONLINE, BUSY, or OFFLINE."
        )

    technician = db.execute(
        text("""
            SELECT id
            FROM technicians
            WHERE id = :technician_id
        """),
        {
            "technician_id": technician_id
        }
    ).mappings().first()

    if not technician:
        raise HTTPException(
            status_code=404,
            detail="Technician not found"
        )

    db.execute(
        text("""
            UPDATE technicians
            SET availability_status = :status,
                updated_at = now()
            WHERE id = :technician_id
        """),
        {
            "status": status,
            "technician_id": technician_id
        }
    )

    db.commit()

    return {
        "status": "success",
        "message": f"Your availability updated to {status}",
        "technician_id": technician_id,
        "availability_status": status
    }
@router.post("/{technician_id}/availability")
def update_availability(
    technician_id: str,
    data: AvailabilityUpdate,
    db: Session = Depends(get_db)
):
    allowed_statuses = {
        "ONLINE",
        "BUSY",
        "OFFLINE"
    }

    status = data.availability_status.upper()

    if status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail="Invalid availability status. Use ONLINE, BUSY, or OFFLINE."
        )

    technician = db.execute(
        text("""
            SELECT id, availability_status
            FROM technicians
            WHERE id = :technician_id
        """),
        {"technician_id": technician_id}
    ).mappings().first()

    if not technician:
        raise HTTPException(
            status_code=404,
            detail="Technician not found"
        )

    db.execute(
        text("""
            UPDATE technicians
            SET availability_status = :status,
                updated_at = now()
            WHERE id = :technician_id
        """),
        {
            "status": status,
            "technician_id": technician_id
        }
    )

    db.commit()

    return {
        "status": "success",
        "message": f"Technician availability updated to {status}",
        "technician_id": technician_id,
        "availability_status": status
    }
class LocationUpdate(BaseModel):
    latitude: float
    longitude: float
    accuracy_meters: float | None = None
    battery_percent: int | None = None

@router.post("/me/location")
def update_my_location(
    data: LocationUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Only technicians can update technician location
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Technician access required"
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token"
        )

    # Validate latitude
    if not -90 <= data.latitude <= 90:
        raise HTTPException(
            status_code=400,
            detail="Invalid latitude"
        )

    # Validate longitude
    if not -180 <= data.longitude <= 180:
        raise HTTPException(
            status_code=400,
            detail="Invalid longitude"
        )

    # Validate GPS accuracy
    if data.accuracy_meters is not None and data.accuracy_meters < 0:
        raise HTTPException(
            status_code=400,
            detail="Invalid GPS accuracy"
        )

    # Validate battery percentage
    if data.battery_percent is not None:
        if not 0 <= data.battery_percent <= 100:
            raise HTTPException(
                status_code=400,
                detail="Battery percentage must be between 0 and 100"
            )

    technician = db.execute(
        text("""
            SELECT id
            FROM technicians
            WHERE id = :technician_id
        """),
        {
            "technician_id": technician_id
        }
    ).mappings().first()

    if not technician:
        raise HTTPException(
            status_code=404,
            detail="Technician not found"
        )

    db.execute(
        text("""
            INSERT INTO technician_locations (
                technician_id,
                location,
                accuracy_meters,
                battery_percent,
                last_seen_at,
                updated_at
            )
            VALUES (
                :technician_id,
                ST_SetSRID(
                    ST_MakePoint(:longitude, :latitude),
                    4326
                )::geography,
                :accuracy_meters,
                :battery_percent,
                now(),
                now()
            )
            ON CONFLICT (technician_id)
            DO UPDATE SET
                location = EXCLUDED.location,
                accuracy_meters = EXCLUDED.accuracy_meters,
                battery_percent = EXCLUDED.battery_percent,
                last_seen_at = now(),
                updated_at = now()
        """),
        {
            "technician_id": technician_id,
            "latitude": data.latitude,
            "longitude": data.longitude,
            "accuracy_meters": data.accuracy_meters,
            "battery_percent": data.battery_percent
        }
    )

    db.commit()

    return {
        "status": "success",
        "message": "Your location updated successfully",
        "technician_id": technician_id,
        "latitude": data.latitude,
        "longitude": data.longitude,
        "accuracy_meters": data.accuracy_meters,
        "battery_percent": data.battery_percent
    }
@router.post("/{technician_id}/location")
def update_location(
    technician_id: str,
    data: LocationUpdate,
    db: Session = Depends(get_db)
):
    if not -90 <= data.latitude <= 90:
        raise HTTPException(
            status_code=400,
            detail="Invalid latitude"
        )

    if not -180 <= data.longitude <= 180:
        raise HTTPException(
            status_code=400,
            detail="Invalid longitude"
        )

    if data.accuracy_meters is not None and data.accuracy_meters < 0:
        raise HTTPException(
            status_code=400,
            detail="Invalid GPS accuracy"
        )

    if data.battery_percent is not None:
        if not 0 <= data.battery_percent <= 100:
            raise HTTPException(
                status_code=400,
                detail="Battery percentage must be between 0 and 100"
            )

    technician = db.execute(
        text("""
            SELECT id
            FROM technicians
            WHERE id = :technician_id
        """),
        {"technician_id": technician_id}
    ).mappings().first()

    if not technician:
        raise HTTPException(
            status_code=404,
            detail="Technician not found"
        )

    db.execute(
        text("""
            INSERT INTO technician_locations (
                technician_id,
                location,
                accuracy_meters,
                battery_percent,
                last_seen_at,
                updated_at
            )
            VALUES (
                :technician_id,
                ST_SetSRID(
                    ST_MakePoint(:longitude, :latitude),
                    4326
                )::geography,
                :accuracy_meters,
                :battery_percent,
                now(),
                now()
            )
            ON CONFLICT (technician_id)
            DO UPDATE SET
                location = EXCLUDED.location,
                accuracy_meters = EXCLUDED.accuracy_meters,
                battery_percent = EXCLUDED.battery_percent,
                last_seen_at = now(),
                updated_at = now()
        """),
        {
            "technician_id": technician_id,
            "latitude": data.latitude,
            "longitude": data.longitude,
            "accuracy_meters": data.accuracy_meters,
            "battery_percent": data.battery_percent
        }
    )

    db.commit()

    return {
        "status": "success",
        "message": "Technician location updated successfully",
        "technician_id": technician_id,
        "latitude": data.latitude,
        "longitude": data.longitude,
        "accuracy_meters": data.accuracy_meters,
        "battery_percent": data.battery_percent
    }
@router.get("/{technician_id}/location")
def get_location(
    technician_id: str,
    db: Session = Depends(get_db)
):
    query = text("""
        SELECT
            technician_id,
            ST_Y(location::geometry) AS latitude,
            ST_X(location::geometry) AS longitude,
            accuracy_meters,
            battery_percent,
            last_seen_at,
            updated_at
        FROM technician_locations
        WHERE technician_id = :technician_id
    """)

    result = db.execute(
        query,
        {"technician_id": technician_id}
    ).mappings().first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Technician location not found"
        )

    return {
        "status": "success",
        "location": dict(result)
    }


@router.get("/me/services")
def get_my_technician_services(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Only technicians can access this endpoint
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Technician access required"
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token"
        )

    query = text("""
        SELECT
            sv.id AS service_id,
            sv.name AS service_name,
            sv.description AS service_description,
            sc.id AS category_id,
            sc.name AS category_name
        FROM services sv
        JOIN service_categories sc
            ON sc.id = sv.category_id

        WHERE sv.is_active = true

        -- Service must have at least one required skill
        AND EXISTS (
            SELECT 1
            FROM service_skills ss
            WHERE ss.service_id = sv.id
              AND ss.is_required = true
        )

        -- Technician must have ALL required skills
        AND NOT EXISTS (
            SELECT 1
            FROM service_skills ss
            WHERE ss.service_id = sv.id
              AND ss.is_required = true
              AND NOT EXISTS (
                  SELECT 1
                  FROM technician_skills ts
                  WHERE ts.technician_id = :technician_id
                    AND ts.skill_id = ss.skill_id
              )
        )

        -- Service must have at least one required tool
        AND EXISTS (
            SELECT 1
            FROM service_tools st
            WHERE st.service_id = sv.id
              AND st.is_required = true
        )

        -- Technician must have ALL required tools
        AND NOT EXISTS (
            SELECT 1
            FROM service_tools st
            WHERE st.service_id = sv.id
              AND st.is_required = true
              AND NOT EXISTS (
                  SELECT 1
                  FROM technician_tools tt
                  WHERE tt.technician_id = :technician_id
                    AND tt.tool_id = st.tool_id
              )
        )

        ORDER BY
            sc.sort_order,
            sv.name
    """)

    results = db.execute(
        query,
        {
            "technician_id": technician_id
        }
    ).mappings().all()

    return {
        "status": "success",
        "technician_id": technician_id,
        "total": len(results),
        "services": [dict(row) for row in results]
    }
@router.get("/{technician_id}/services")
def get_technician_services(
    technician_id: str,
    db: Session = Depends(get_db)
):
    # Verify technician exists
    technician = db.execute(text("""
        SELECT id
        FROM technicians
        WHERE id = :technician_id
    """), {
        "technician_id": technician_id
    }).mappings().first()

    if not technician:
        raise HTTPException(
            status_code=404,
            detail="Technician not found"
        )

    query = text("""
        SELECT
            sv.id AS service_id,
            sv.name AS service_name,
            sc.id AS category_id,
            sc.name AS category_name
        FROM services sv
        JOIN service_categories sc
            ON sc.id = sv.category_id

        WHERE sv.is_active = true

        -- Service must have required skills
        AND EXISTS (
            SELECT 1
            FROM service_skills ss
            WHERE ss.service_id = sv.id
              AND ss.is_required = true
        )

        -- Technician must have ALL required skills
        AND NOT EXISTS (
            SELECT 1
            FROM service_skills ss
            WHERE ss.service_id = sv.id
              AND ss.is_required = true
              AND NOT EXISTS (
                  SELECT 1
                  FROM technician_skills ts
                  WHERE ts.technician_id = :technician_id
                    AND ts.skill_id = ss.skill_id
              )
        )

        -- Service must have required tools
        AND EXISTS (
            SELECT 1
            FROM service_tools st
            WHERE st.service_id = sv.id
              AND st.is_required = true
        )

        -- Technician must have ALL required tools
        AND NOT EXISTS (
            SELECT 1
            FROM service_tools st
            WHERE st.service_id = sv.id
              AND st.is_required = true
              AND NOT EXISTS (
                  SELECT 1
                  FROM technician_tools tt
                  WHERE tt.technician_id = :technician_id
                    AND tt.tool_id = st.tool_id
              )
        )

        ORDER BY
            sc.sort_order,
            sv.name
    """)

    results = db.execute(
        query,
        {"technician_id": technician_id}
    ).mappings().all()

    return {
        "status": "success",
        "technician_id": technician_id,
        "total": len(results),
        "services": [dict(row) for row in results]
    }
@router.get("/me")
def get_my_technician_profile(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Only technicians can access this endpoint
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Technician access required"
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token"
        )

    query = text("""
        SELECT
            t.id AS technician_id,
            u.id AS user_id,
            u.full_name,
            u.email,
            u.phone,
            t.business_name,
            t.experience_years,
            t.bio,
            t.service_radius_km,
            t.kyc_status,
            t.availability_status,
            t.rating_average,
            t.total_jobs,
            k.verification_status AS kyc_verification_status,
            k.address_verified,
            tl.accuracy_meters,
            tl.battery_percent,
            tl.last_seen_at,
            tl.updated_at,
            ST_Y(tl.location::geometry) AS latitude,
            ST_X(tl.location::geometry) AS longitude
        FROM technicians t
        JOIN users u
            ON u.id = t.user_id
        LEFT JOIN technician_kyc k
            ON k.technician_id = t.id
        LEFT JOIN technician_locations tl
            ON tl.technician_id = t.id
        WHERE t.id = :technician_id
    """)

    result = db.execute(
        query,
        {"technician_id": technician_id}
    ).mappings().first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Technician profile not found"
        )

    return {
        "status": "success",
        "technician": dict(result)
    }
@router.get("/{technician_id}")
def get_technician(
    technician_id: str,
    db: Session = Depends(get_db)
):
    query = text("""
        SELECT
            t.id AS technician_id,
            u.id AS user_id,
            u.full_name,
            u.email,
            u.phone,

            t.business_name,
            t.experience_years,
            t.bio,
            t.service_radius_km,
            t.kyc_status,
            t.availability_status,
            t.rating_average,
            t.total_jobs,

            k.verification_status AS kyc_verification_status,
            k.address_verified,

            tl.accuracy_meters,
            tl.battery_percent,
            tl.last_seen_at,
            tl.updated_at,

            ST_Y(tl.location::geometry) AS latitude,
            ST_X(tl.location::geometry) AS longitude

        FROM technicians t

        JOIN users u
            ON u.id = t.user_id

        LEFT JOIN technician_kyc k
            ON k.technician_id = t.id

        LEFT JOIN technician_locations tl
            ON tl.technician_id = t.id

        WHERE t.id = :technician_id
    """)

    result = db.execute(
        query,
        {"technician_id": technician_id}
    ).mappings().first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Technician not found"
        )

    return {
        "status": "success",
        "technician": dict(result)
    }

@router.get("/me/skills")
def get_my_technician_skills(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Only technicians can access this endpoint
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Technician access required"
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token"
        )

    query = text("""
        SELECT
            s.id AS skill_id,
            s.name AS skill_name,
            ts.experience_years
        FROM technician_skills ts
        JOIN skills s
            ON s.id = ts.skill_id
        WHERE ts.technician_id = :technician_id
        ORDER BY s.name
    """)

    results = db.execute(
        query,
        {
            "technician_id": technician_id
        }
    ).mappings().all()

    return {
        "status": "success",
        "technician_id": technician_id,
        "total": len(results),
        "skills": [dict(row) for row in results]
    }
@router.get("/{technician_id}/skills")
def get_technician_skills(
    technician_id: str,
    db: Session = Depends(get_db)
):
    query = text("""
        SELECT
            s.id AS skill_id,
            s.name AS skill_name,
            ts.experience_years
        FROM technician_skills ts
        JOIN skills s
            ON s.id = ts.skill_id
        WHERE ts.technician_id = :technician_id
        ORDER BY s.name
    """)

    results = db.execute(
        query,
        {"technician_id": technician_id}
    ).mappings().all()

    return {
        "status": "success",
        "technician_id": technician_id,
        "total": len(results),
        "skills": [dict(row) for row in results]
    }

@router.get("/me/tools")
def get_my_technician_tools(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    # Only technicians can access this endpoint
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(
            status_code=403,
            detail="Technician access required"
        )

    technician_id = current_user.get("technician_id")

    if not technician_id:
        raise HTTPException(
            status_code=403,
            detail="Technician profile not found in access token"
        )

    query = text("""
        SELECT
            tl.id AS tool_id,
            tl.name AS tool_name,
            tt.quantity
        FROM technician_tools tt
        JOIN tools tl
            ON tl.id = tt.tool_id
        WHERE tt.technician_id = :technician_id
        ORDER BY tl.name
    """)

    results = db.execute(
        query,
        {
            "technician_id": technician_id
        }
    ).mappings().all()

    return {
        "status": "success",
        "technician_id": technician_id,
        "total": len(results),
        "tools": [dict(row) for row in results]
    }
@router.get("/{technician_id}/tools")
def get_technician_tools(
    technician_id: str,
    db: Session = Depends(get_db)
):
    query = text("""
        SELECT
            tl.id AS tool_id,
            tl.name AS tool_name,
            tt.quantity
        FROM technician_tools tt
        JOIN tools tl
            ON tl.id = tt.tool_id
        WHERE tt.technician_id = :technician_id
        ORDER BY tl.name
    """)

    results = db.execute(
        query,
        {"technician_id": technician_id}
    ).mappings().all()

    return {
        "status": "success",
        "technician_id": technician_id,
        "total": len(results),
        "tools": [dict(row) for row in results]
    }