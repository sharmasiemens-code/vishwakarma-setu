from app.core.system_settings import get_system_settings, operational_query
from app.core.admin_audit import write_admin_audit
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from uuid import UUID
from sqlalchemy.exc import IntegrityError
from app.core.security import hash_password

from app.core.admin_rbac import require_permission, require_locked_super_admin
from app.db.database import get_db


router = APIRouter(
    prefix="/admin",
    tags=["Admin"]
)


ACTIVE_JOB_STATUSES = (
    "ASSIGNED",
    "ACCEPTED",
    "ON_THE_WAY",
    "ARRIVED",
    "IN_PROGRESS",
)
class SkillCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=2000)

class ServiceSkillMappingItem(BaseModel):
    skill_id: str = Field(..., min_length=1, max_length=100)
    is_required: bool = False

class ServiceSkillMappingUpdate(BaseModel):
    skills: list[ServiceSkillMappingItem]

class ServiceToolMappingItem(BaseModel):
    tool_id: str = Field(..., min_length=1, max_length=100)
    is_required: bool = True


class ServiceToolMappingUpdate(BaseModel):
    tools: list[ServiceToolMappingItem]

class ServiceCategoryCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    icon_name: str | None = Field(default=None, max_length=100)
    sort_order: int = Field(default=0, ge=0)


class ServiceCategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    icon_name: str | None = Field(default=None, max_length=100)
    sort_order: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
class ServiceCreate(BaseModel):
    category_id: str = Field(..., min_length=1, max_length=100)
    name: str = Field(..., min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=2000)


class ServiceUpdate(BaseModel):
    category_id: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None
class SkillUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=150)
    description: str | None = Field(default=None, max_length=2000)
    is_active: bool | None = None
class ToolCreate(BaseModel):
    name: str = Field(
        ...,
        min_length=2,
        max_length=150,
    )
    description: str | None = Field(
        default=None,
        max_length=2000,
    )


class ToolUpdate(BaseModel):
    name: str | None = Field(
        default=None,
        min_length=2,
        max_length=150,
    )
    description: str | None = Field(
        default=None,
        max_length=2000,
    )
    is_active: bool | None = None
class TechnicianAccountStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(
        ...,
        min_length=3,
        max_length=500,
    )
class TechnicianKycStatusUpdate(BaseModel):
    verification_status: str = Field(
        ...,
        min_length=3,
        max_length=50,
    )

    remarks: str = Field(
        ...,
        min_length=3,
        max_length=1000,
    )
@router.get("/dashboard")
def get_admin_dashboard(
    db: Session = Depends(get_db),
    current_admin: dict = Depends(require_permission("dashboard.read")),
):
    """
    Return high-level marketplace statistics for the Admin Dashboard.
    """

    total_customers = db.execute(
        text("""
            SELECT COUNT(*)
            FROM users
            WHERE role = 'CUSTOMER'
        """)
    ).scalar_one()

    total_technicians = db.execute(
        text("""
            SELECT COUNT(*)
            FROM technicians
        """)
    ).scalar_one()

    online_technicians = db.execute(
        text("""
            SELECT COUNT(*)
            FROM technicians
            WHERE availability_status = 'ONLINE'
        """)
    ).scalar_one()

    busy_technicians = db.execute(
        text("""
            SELECT COUNT(DISTINCT technician_id)
            FROM jobs
            WHERE status IN (
                'ASSIGNED',
                'ACCEPTED',
                'ON_THE_WAY',
                'ARRIVED',
                'IN_PROGRESS'
            )
        """)
    ).scalar_one()

    pending_kyc = db.execute(
        text("""
            SELECT COUNT(*)
            FROM technicians
            WHERE kyc_status IS NULL
               OR kyc_status <> 'APPROVED'
        """)
    ).scalar_one()

    open_service_requests = db.execute(
        text("""
            SELECT COUNT(*)
            FROM service_requests
            WHERE status = 'OPEN'
        """)
    ).scalar_one()

    unmatched_service_requests = db.execute(
        text("""
            SELECT COUNT(*)
            FROM service_requests sr
            WHERE sr.status = 'OPEN'
              AND NOT EXISTS (
                  SELECT 1
                  FROM jobs j
                  WHERE j.service_request_id = sr.id
                    AND j.status IN (
                        'ASSIGNED',
                        'ACCEPTED',
                        'ON_THE_WAY',
                        'ARRIVED',
                        'IN_PROGRESS',
                        'COMPLETED'
                    )
              )
        """)
    ).scalar_one()

    active_jobs = db.execute(
        text("""
            SELECT COUNT(*)
            FROM jobs
            WHERE status IN (
                'ASSIGNED',
                'ACCEPTED',
                'ON_THE_WAY',
                'ARRIVED',
                'IN_PROGRESS'
            )
        """)
    ).scalar_one()

    completed_jobs = db.execute(
        text("""
            SELECT COUNT(*)
            FROM jobs
            WHERE status = 'COMPLETED'
        """)
    ).scalar_one()

    cancelled_jobs = db.execute(
        text("""
            SELECT COUNT(*)
            FROM jobs
            WHERE status = 'CANCELLED'
        """)
    ).scalar_one()

    return {
        "status": "success",
        "data": {
            "customers": {
                "total": total_customers,
            },
            "technicians": {
                "total": total_technicians,
                "online": online_technicians,
                "busy": busy_technicians,
                "pending_kyc": pending_kyc,
            },
            "service_requests": {
                "open": open_service_requests,
                "unmatched": unmatched_service_requests,
            },
            "jobs": {
                "active": active_jobs,
                "completed": completed_jobs,
                "cancelled": cancelled_jobs,
            },
        },
        "admin": {
            "user_id": current_admin.get("sub"),
            "role": current_admin.get("role"),
        },
    }
@router.get("/technicians")
def get_admin_technicians(
    db: Session = Depends(get_db),
    current_admin: dict = Depends(require_permission("technicians.read")),
):
    """
    Return technicians with operational information
    for the Admin Control Center.
    """

    technicians = db.execute(
        text("""
            SELECT
                t.id AS technician_id,
                t.user_id,
                u.full_name,
                u.email,
                u.phone,
                u.is_active,
                u.is_verified,

                t.business_name,
                t.experience_years,
                t.service_radius_km,
                t.kyc_status,
                t.availability_status,
                t.rating_average,
                t.total_jobs,

                tk.verification_status AS kyc_verification_status,
                tk.address_verified,
                tk.police_verification_status,
                tk.verified_at,

                tl.accuracy_meters,
                tl.battery_percent,
                tl.last_seen_at,

                (
                    SELECT COUNT(*)
                    FROM technician_skills ts
                    WHERE ts.technician_id = t.id
                ) AS skills_count,

                (
                    SELECT COUNT(*)
                    FROM technician_tools tt
                    WHERE tt.technician_id = t.id
                ) AS tools_count,

                EXISTS (
                    SELECT 1
                    FROM jobs j
                    WHERE j.technician_id = t.id
                      AND j.status IN (
                          'ASSIGNED',
                          'ACCEPTED',
                          'ON_THE_WAY',
                          'ARRIVED',
                          'IN_PROGRESS'
                      )
                ) AS is_busy

            FROM technicians t

            JOIN users u
                ON u.id = t.user_id

            LEFT JOIN technician_kyc tk
                ON tk.technician_id = t.id

            LEFT JOIN technician_locations tl
                ON tl.technician_id = t.id

            ORDER BY
                u.full_name ASC
        """)
    ).mappings().all()

    results = []

    for technician in technicians:
        results.append({
            "technician_id": str(
                technician["technician_id"]
            ),
            "user_id": str(
                technician["user_id"]
            ),
            "full_name": technician["full_name"],
            "email": technician["email"],
            "phone": technician["phone"],

            "account": {
                "is_active": technician["is_active"],
                "is_verified": technician["is_verified"],
            },

            "business_name": technician["business_name"],
            "experience_years": (
                float(technician["experience_years"])
                if technician["experience_years"] is not None
                else None
            ),
            "service_radius_km": (
                float(technician["service_radius_km"])
                if technician["service_radius_km"] is not None
                else None
            ),

            "availability_status":
                technician["availability_status"],

            "is_busy":
                technician["is_busy"],

            "kyc": {
                "status":
                    technician["kyc_status"],
                "verification_status":
                    technician["kyc_verification_status"],
                "address_verified":
                    technician["address_verified"],
                "police_verification_status":
                    technician["police_verification_status"],
                "verified_at": (
                    technician["verified_at"].isoformat()
                    if technician["verified_at"]
                    else None
                ),
            },

            "rating_average": (
                float(technician["rating_average"])
                if technician["rating_average"] is not None
                else 0
            ),

            "total_jobs":
                technician["total_jobs"] or 0,

            "skills_count":
                technician["skills_count"] or 0,

            "tools_count":
                technician["tools_count"] or 0,

            "location": {
                "accuracy_meters": (
                    float(technician["accuracy_meters"])
                    if technician["accuracy_meters"] is not None
                    else None
                ),
                "battery_percent":
                    technician["battery_percent"],
                "last_seen_at": (
                    technician["last_seen_at"].isoformat()
                    if technician["last_seen_at"]
                    else None
                ),
            },
        })

    return {
        "status": "success",
        "count": len(results),
        "technicians": results,
        "admin": {
            "user_id": current_admin.get("sub"),
            "role": current_admin.get("role"),
        },
    }
@router.get("/technicians/{technician_id}")
def get_admin_technician_detail(
    technician_id: str,
    db: Session = Depends(get_db),
    current_admin: dict = Depends(require_permission("technicians.read")),
):
    """
    Return detailed technician information for Admin.
    """

    technician = db.execute(
        text("""
            SELECT
                t.id AS technician_id,
                t.user_id,
                u.full_name,
                u.email,
                u.phone,
                u.is_active,
                u.is_verified,
                u.created_at AS user_created_at,

                t.business_name,
                t.experience_years,
                t.bio,
                t.service_radius_km,
                t.kyc_status,
                t.availability_status,
                t.rating_average,
                t.total_jobs,
                t.created_at AS technician_created_at,
                t.updated_at AS technician_updated_at,

                tk.verification_status,
                tk.address_verified,
                tk.identity_document_type,
                tk.identity_document_reference,
                tk.address_document_reference,
                tk.police_verification_status,
                tk.verified_by,
                tk.verified_at,
                tk.rejection_reason,

                tl.accuracy_meters,
                tl.battery_percent,
                tl.last_seen_at,
                tl.updated_at AS location_updated_at,

                EXISTS (
                    SELECT 1
                    FROM jobs j
                    WHERE j.technician_id = t.id
                      AND j.status IN (
                          'ASSIGNED',
                          'ACCEPTED',
                          'ON_THE_WAY',
                          'ARRIVED',
                          'IN_PROGRESS'
                      )
                ) AS is_busy

            FROM technicians t

            JOIN users u
                ON u.id = t.user_id

            LEFT JOIN technician_kyc tk
                ON tk.technician_id = t.id

            LEFT JOIN technician_locations tl
                ON tl.technician_id = t.id

            WHERE t.id = CAST(:technician_id AS uuid)
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().first()

    if technician is None:
        return {
            "status": "error",
            "message": "Technician not found",
        }

    skills = db.execute(
        text("""
            SELECT
                s.id,
                s.name,
                s.description,
                s.is_active,
                ts.experience_years
            FROM technician_skills ts
            JOIN skills s
                ON s.id = ts.skill_id
            WHERE ts.technician_id =
                CAST(:technician_id AS uuid)
            ORDER BY s.name
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().all()

    tools = db.execute(
        text("""
            SELECT
                tl.id,
                tl.name,
                tl.description,
                tl.is_active,
                tt.quantity
            FROM technician_tools tt
            JOIN tools tl
                ON tl.id = tt.tool_id
            WHERE tt.technician_id =
                CAST(:technician_id AS uuid)
            ORDER BY tl.name
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().all()

    job_stats = db.execute(
        text("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE status = 'COMPLETED'
                ) AS completed,
                COUNT(*) FILTER (
                    WHERE status = 'CANCELLED'
                ) AS cancelled,
                COUNT(*) FILTER (
                    WHERE status IN (
                        'ASSIGNED',
                        'ACCEPTED',
                        'ON_THE_WAY',
                        'ARRIVED',
                        'IN_PROGRESS'
                    )
                ) AS active
            FROM jobs
            WHERE technician_id =
                CAST(:technician_id AS uuid)
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().first()

    rating_stats = db.execute(
        text("""
            SELECT
                COUNT(*) AS total_ratings,
                AVG(rating) AS average_rating
            FROM ratings
            WHERE technician_id =
                CAST(:technician_id AS uuid)
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().first()

    recent_reviews = db.execute(
        text("""
            SELECT
                r.id,
                r.job_id,
                r.customer_id,
                r.rating,
                r.review,
                r.created_at
            FROM ratings r
            WHERE r.technician_id =
                CAST(:technician_id AS uuid)
            ORDER BY r.created_at DESC
            LIMIT 10
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().all()

    response = {
        "status": "success",

        "technician": {
            "technician_id": str(
                technician["technician_id"]
            ),
            "user_id": str(
                technician["user_id"]
            ),

            "full_name": technician["full_name"],
            "email": technician["email"],
            "phone": technician["phone"],
            "business_name":
                technician["business_name"],

            "experience_years": (
                float(technician["experience_years"])
                if technician["experience_years"] is not None
                else None
            ),

            "bio": technician["bio"],

            "service_radius_km": (
                float(technician["service_radius_km"])
                if technician["service_radius_km"] is not None
                else None
            ),

            "availability_status":
                technician["availability_status"],

            "is_busy":
                technician["is_busy"],

            "account": {
                "is_active":
                    technician["is_active"],
                "is_verified":
                    technician["is_verified"],
                "created_at": (
                    technician["user_created_at"].isoformat()
                    if technician["user_created_at"]
                    else None
                ),
            },

            "kyc": {
                "status":
                    technician["kyc_status"],
                "verification_status":
                    technician["verification_status"],
                "address_verified":
                    technician["address_verified"],
                "identity_document_type":
                    technician["identity_document_type"],
                "identity_document_reference":
                    technician["identity_document_reference"],
                "address_document_reference":
                    technician["address_document_reference"],
                "police_verification_status":
                    technician["police_verification_status"],
                "verified_by": (
                    str(technician["verified_by"])
                    if technician["verified_by"]
                    else None
                ),
                "verified_at": (
                    technician["verified_at"].isoformat()
                    if technician["verified_at"]
                    else None
                ),
                "rejection_reason":
                    technician["rejection_reason"],
            },

            "location": {
                "accuracy_meters": (
                    float(technician["accuracy_meters"])
                    if technician["accuracy_meters"] is not None
                    else None
                ),
                "battery_percent":
                    technician["battery_percent"],
                "last_seen_at": (
                    technician["last_seen_at"].isoformat()
                    if technician["last_seen_at"]
                    else None
                ),
                "updated_at": (
                    technician["location_updated_at"].isoformat()
                    if technician["location_updated_at"]
                    else None
                ),
            },

            "marketplace": {
                "rating_average": (
                    float(technician["rating_average"])
                    if technician["rating_average"] is not None
                    else 0
                ),
                "total_jobs":
                    technician["total_jobs"] or 0,
            },

            "job_statistics": {
                "total":
                    job_stats["total"] or 0,
                "active":
                    job_stats["active"] or 0,
                "completed":
                    job_stats["completed"] or 0,
                "cancelled":
                    job_stats["cancelled"] or 0,
            },

            "rating_statistics": {
                "total_ratings":
                    rating_stats["total_ratings"] or 0,
                "average_rating": (
                    float(rating_stats["average_rating"])
                    if rating_stats["average_rating"] is not None
                    else 0
                ),
            },

            "skills": [
                {
                    "id": str(skill["id"]),
                    "name": skill["name"],
                    "description":
                        skill["description"],
                    "is_active":
                        skill["is_active"],
                    "experience_years": (
                        float(skill["experience_years"])
                        if skill["experience_years"] is not None
                        else None
                    ),
                }
                for skill in skills
            ],

            "tools": [
                {
                    "id": str(tool["id"]),
                    "name": tool["name"],
                    "description":
                        tool["description"],
                    "is_active":
                        tool["is_active"],
                    "quantity":
                        tool["quantity"],
                }
                for tool in tools
            ],

            "recent_reviews": [
                {
                    "id": str(review["id"]),
                    "job_id": str(review["job_id"]),
                    "customer_id":
                        str(review["customer_id"]),
                    "rating":
                        review["rating"],
                    "review":
                        review["review"],
                    "created_at": (
                        review["created_at"].isoformat()
                        if review["created_at"]
                        else None
                    ),
                }
                for review in recent_reviews
            ],
        },

        "admin": {
            "user_id":
                current_admin.get("sub"),
            "role":
                current_admin.get("role"),
        },
    }

    if "kyc.read" not in current_admin.get("permissions", []):
        kyc = response["technician"]["kyc"]

        for field in (
            "address_verified",
            "identity_document_type",
            "identity_document_reference",
            "address_document_reference",
            "police_verification_status",
            "verified_by",
            "verified_at",
            "rejection_reason",
        ):
            kyc[field] = None

        kyc["restricted"] = True
    else:
        response["technician"]["kyc"]["restricted"] = False

    return response
@router.patch(
    "/technicians/{technician_id}/account-status"
)
def update_technician_account_status(
    technician_id: str,
    payload: TechnicianAccountStatusUpdate,
    db: Session = Depends(get_db),
    current_admin: dict = Depends(require_permission("technicians.account_status.write")),
):
    """
    Enable or disable a technician user account.

    This changes users.is_active only.
    It does not delete the technician or alter historical
    jobs, ratings, skills, tools, or KYC records.
    """

    technician = db.execute(
        text("""
            SELECT
                t.id AS technician_id,
                t.user_id,
                u.full_name,
                u.is_active
            FROM technicians t
            JOIN users u
                ON u.id = t.user_id
            WHERE t.id = CAST(:technician_id AS uuid)
            FOR UPDATE OF u
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().first()

    if technician is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Technician not found",
        )

    old_status = technician["is_active"]

    if old_status == payload.is_active:
        return {
            "status": "success",
            "message": (
                "Technician account is already "
                + (
                    "active"
                    if payload.is_active
                    else "disabled"
                )
            ),
            "changed": False,
            "technician": {
                "technician_id": str(
                    technician["technician_id"]
                ),
                "user_id": str(
                    technician["user_id"]
                ),
                "full_name": technician["full_name"],
                "is_active": old_status,
            },
            "reason": payload.reason,
            "admin": {
                "user_id": current_admin.get("sub"),
                "role": current_admin.get("role"),
            },
        }

    db.execute(
        text("""
            UPDATE users
            SET
                is_active = :is_active,
                updated_at = NOW()
            WHERE id = :user_id
        """),
        {
            "is_active": payload.is_active,
            "user_id": technician["user_id"],
        },
    )

    try:
        write_admin_audit(
            db=db,
            admin=current_admin,
            action="TECHNICIAN_ACCOUNT_STATUS_CHANGED",
            target_type="TECHNICIAN",
            target_id=technician["technician_id"],
            before_values={"is_active": old_status},
            after_values={"is_active": payload.is_active},
            reason=payload.reason,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "success",
        "message": (
            "Technician account enabled successfully"
            if payload.is_active
            else "Technician account disabled successfully"
        ),
        "changed": True,
        "technician": {
            "technician_id": str(
                technician["technician_id"]
            ),
            "user_id": str(
                technician["user_id"]
            ),
            "full_name": technician["full_name"],
            "old_is_active": old_status,
            "is_active": payload.is_active,
        },
        "reason": payload.reason,
        "admin": {
            "user_id": current_admin.get("sub"),
            "role": current_admin.get("role"),
        },
    }
@router.get("/kyc")
def get_admin_kyc_list(
    db: Session = Depends(get_db),
    current_admin: dict = Depends(require_permission("kyc.read")),
):
    """
    Return technician KYC records for the Admin Panel.

    Read-only endpoint.
    """

    rows = db.execute(
        text("""
            SELECT
                t.id AS technician_id,
                t.user_id,

                u.full_name,
                u.email,
                u.phone,
                u.is_active AS account_active,

                t.business_name,
                t.kyc_status AS technician_kyc_status,

                tk.id AS kyc_id,
                tk.verification_status,
                tk.address_verified,
                tk.identity_document_type,
                tk.identity_document_reference,
                tk.address_document_reference,
                tk.police_verification_status,
                tk.verified_by,
                tk.verified_at,
                tk.rejection_reason,
                tk.created_at,
                tk.updated_at

            FROM technicians t

            JOIN users u
                ON u.id = t.user_id

            LEFT JOIN technician_kyc tk
                ON tk.technician_id = t.id

            ORDER BY
                CASE
                    WHEN tk.verification_status = 'PENDING'
                        THEN 1
                    WHEN tk.verification_status = 'UNDER_REVIEW'
                        THEN 2
                    WHEN tk.verification_status =
                        'RESUBMISSION_REQUIRED'
                        THEN 3
                    WHEN tk.verification_status = 'REJECTED'
                        THEN 4
                    WHEN tk.verification_status = 'APPROVED'
                        THEN 5
                    ELSE 6
                END,
                tk.updated_at DESC NULLS LAST,
                u.full_name
        """)
    ).mappings().all()

    technicians = []

    for row in rows:
        technicians.append(
            {
                "technician_id": str(
                    row["technician_id"]
                ),
                "user_id": str(row["user_id"]),
                "full_name": row["full_name"],
                "email": row["email"],
                "phone": row["phone"],
                "business_name": row["business_name"],

                "account": {
                    "is_active": row[
                        "account_active"
                    ],
                },

                "kyc": {
                    "kyc_id": (
                        str(row["kyc_id"])
                        if row["kyc_id"]
                        else None
                    ),
                    "technician_status": row[
                        "technician_kyc_status"
                    ],
                    "verification_status": row[
                        "verification_status"
                    ],
                    "address_verified": row[
                        "address_verified"
                    ],
                    "identity_document_type": row[
                        "identity_document_type"
                    ],
                    "identity_document_reference": row[
                        "identity_document_reference"
                    ],
                    "address_document_reference": row[
                        "address_document_reference"
                    ],
                    "police_verification_status": row[
                        "police_verification_status"
                    ],
                    "verified_by": (
                        str(row["verified_by"])
                        if row["verified_by"]
                        else None
                    ),
                    "verified_at": (
                        row["verified_at"].isoformat()
                        if row["verified_at"]
                        else None
                    ),
                    "rejection_reason": row[
                        "rejection_reason"
                    ],
                    "created_at": (
                        row["created_at"].isoformat()
                        if row["created_at"]
                        else None
                    ),
                    "updated_at": (
                        row["updated_at"].isoformat()
                        if row["updated_at"]
                        else None
                    ),
                },
            }
        )

    summary = {
        "total": len(technicians),
        "pending": 0,
        "under_review": 0,
        "approved": 0,
        "rejected": 0,
        "resubmission_required": 0,
        "missing_record": 0,
    }

    for technician in technicians:
        verification_status = technician[
            "kyc"
        ]["verification_status"]

        if verification_status == "PENDING":
            summary["pending"] += 1
        elif verification_status == "UNDER_REVIEW":
            summary["under_review"] += 1
        elif verification_status == "APPROVED":
            summary["approved"] += 1
        elif verification_status == "REJECTED":
            summary["rejected"] += 1
        elif (
            verification_status
            == "RESUBMISSION_REQUIRED"
        ):
            summary["resubmission_required"] += 1
        elif verification_status is None:
            summary["missing_record"] += 1

    return {
        "status": "success",
        "summary": summary,
        "technicians": technicians,
        "admin": {
            "user_id": current_admin.get("sub"),
            "role": current_admin.get("role"),
        },
    }
@router.get("/kyc/{technician_id}")
def get_admin_kyc_detail(
    technician_id: str,
    db: Session = Depends(get_db),
    current_admin: dict = Depends(require_permission("kyc.read")),
):
    """
    Return complete KYC information for one technician.

    Read-only Admin endpoint.
    """

    row = db.execute(
        text("""
            SELECT
                t.id AS technician_id,
                t.user_id,
                t.business_name,
                t.experience_years,
                t.service_radius_km,
                t.kyc_status AS technician_kyc_status,
                t.availability_status,

                u.full_name,
                u.email,
                u.phone,
                u.is_active AS account_active,
                u.is_verified AS account_verified,

                tk.id AS kyc_id,
                tk.verification_status,
                tk.address_verified,
                tk.identity_document_type,
                tk.identity_document_reference,
                tk.address_document_reference,
                tk.police_verification_status,
                tk.verified_by,
                tk.verified_at,
                tk.rejection_reason,
                tk.created_at AS kyc_created_at,
                tk.updated_at AS kyc_updated_at,

                reviewer.full_name AS verified_by_name,
                reviewer.email AS verified_by_email

            FROM technicians t

            JOIN users u
                ON u.id = t.user_id

            LEFT JOIN technician_kyc tk
                ON tk.technician_id = t.id

            LEFT JOIN users reviewer
                ON reviewer.id = tk.verified_by

            WHERE t.id = CAST(:technician_id AS uuid)
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().first()

    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Technician not found",
        )

    return {
        "status": "success",

        "technician": {
            "technician_id": str(
                row["technician_id"]
            ),
            "user_id": str(row["user_id"]),
            "full_name": row["full_name"],
            "email": row["email"],
            "phone": row["phone"],
            "business_name": row["business_name"],
            "experience_years": (
                float(row["experience_years"])
                if row["experience_years"] is not None
                else None
            ),
            "service_radius_km": (
                float(row["service_radius_km"])
                if row["service_radius_km"] is not None
                else None
            ),
            "availability_status": row[
                "availability_status"
            ],
            "account": {
                "is_active": row[
                    "account_active"
                ],
                "is_verified": row[
                    "account_verified"
                ],
            },
        },

        "kyc": {
            "exists": row["kyc_id"] is not None,

            "kyc_id": (
                str(row["kyc_id"])
                if row["kyc_id"]
                else None
            ),

            "technician_status": row[
                "technician_kyc_status"
            ],

            "verification_status": row[
                "verification_status"
            ],

            "address_verified": row[
                "address_verified"
            ],

            "identity_document": {
                "type": row[
                    "identity_document_type"
                ],
                "reference": row[
                    "identity_document_reference"
                ],
            },

            "address_document": {
                "reference": row[
                    "address_document_reference"
                ],
            },

            "police_verification_status": row[
                "police_verification_status"
            ],

            "rejection_reason": row[
                "rejection_reason"
            ],

            "verified_at": (
                row["verified_at"].isoformat()
                if row["verified_at"]
                else None
            ),

            "reviewer": {
                "user_id": (
                    str(row["verified_by"])
                    if row["verified_by"]
                    else None
                ),
                "full_name": row[
                    "verified_by_name"
                ],
                "email": row[
                    "verified_by_email"
                ],
            },

            "created_at": (
                row["kyc_created_at"].isoformat()
                if row["kyc_created_at"]
                else None
            ),

            "updated_at": (
                row["kyc_updated_at"].isoformat()
                if row["kyc_updated_at"]
                else None
            ),
        },

        "admin": {
            "user_id": current_admin.get("sub"),
            "role": current_admin.get("role"),
        },
    }
@router.patch("/kyc/{technician_id}/status")
def update_admin_kyc_status(
    technician_id: str,
    payload: TechnicianKycStatusUpdate,
    db: Session = Depends(get_db),
    current_admin: dict = Depends(require_permission("kyc.write")),
):
    """
    Update a technician's KYC verification status.

    Allowed statuses:
    UNDER_REVIEW
    APPROVED
    REJECTED
    RESUBMISSION_REQUIRED
    """

    allowed_statuses = {
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "RESUBMISSION_REQUIRED",
    }

    new_status = (
        payload.verification_status
        .strip()
        .upper()
    )

    remarks = payload.remarks.strip()

    if new_status not in allowed_statuses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Invalid KYC status. Allowed values: "
                "UNDER_REVIEW, APPROVED, REJECTED, "
                "RESUBMISSION_REQUIRED"
            ),
        )

    kyc = db.execute(
        text("""
            SELECT
                tk.id AS kyc_id,
                tk.technician_id,
                tk.verification_status,
                t.kyc_status,
                u.full_name
            FROM technician_kyc tk

            JOIN technicians t
                ON t.id = tk.technician_id

            JOIN users u
                ON u.id = t.user_id

            WHERE tk.technician_id =
                CAST(:technician_id AS uuid)
            FOR UPDATE OF t, tk
        """),
        {
            "technician_id": technician_id,
        },
    ).mappings().first()

    if kyc is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Technician KYC record not found",
        )

    old_status = kyc["verification_status"]

    if old_status == new_status:
        return {
            "status": "success",
            "message": (
                f"KYC is already {new_status}"
            ),
            "changed": False,
            "technician": {
                "technician_id": str(
                    kyc["technician_id"]
                ),
                "full_name": kyc["full_name"],
            },
            "kyc": {
                "verification_status": old_status,
                "technician_status": kyc[
                    "kyc_status"
                ],
            },
            "remarks": remarks,
            "admin": {
                "user_id": current_admin.get("sub"),
                "role": current_admin.get("role"),
            },
        }

    admin_user_id = current_admin.get("sub")

    if new_status == "APPROVED":
        db.execute(
            text("""
                UPDATE technician_kyc
                SET
                    verification_status = :status,
                    verified_by =
                        CAST(:admin_user_id AS uuid),
                    verified_at = NOW(),
                    rejection_reason = NULL,
                    updated_at = NOW()
                WHERE technician_id =
                    CAST(:technician_id AS uuid)
            """),
            {
                "status": new_status,
                "admin_user_id": admin_user_id,
                "technician_id": technician_id,
            },
        )

    elif new_status in {
        "REJECTED",
        "RESUBMISSION_REQUIRED",
    }:
        db.execute(
            text("""
                UPDATE technician_kyc
                SET
                    verification_status = :status,
                    verified_by =
                        CAST(:admin_user_id AS uuid),
                    verified_at = NOW(),
                    rejection_reason = :remarks,
                    updated_at = NOW()
                WHERE technician_id =
                    CAST(:technician_id AS uuid)
            """),
            {
                "status": new_status,
                "admin_user_id": admin_user_id,
                "remarks": remarks,
                "technician_id": technician_id,
            },
        )

    else:
        db.execute(
            text("""
                UPDATE technician_kyc
                SET
                    verification_status = :status,
                    verified_by =
                        CAST(:admin_user_id AS uuid),
                    verified_at = NULL,
                    rejection_reason = NULL,
                    updated_at = NOW()
                WHERE technician_id =
                    CAST(:technician_id AS uuid)
            """),
            {
                "status": new_status,
                "admin_user_id": admin_user_id,
                "technician_id": technician_id,
            },
        )

    db.execute(
        text("""
            UPDATE technicians
            SET
                kyc_status = :status,
                updated_at = NOW()
            WHERE id = CAST(:technician_id AS uuid)
        """),
        {
            "status": new_status,
            "technician_id": technician_id,
        },
    )

    try:
        write_admin_audit(
            db=db,
            admin=current_admin,
            action="TECHNICIAN_KYC_STATUS_CHANGED",
            target_type="TECHNICIAN_KYC",
            target_id=kyc["kyc_id"],
            before_values={
                "verification_status": old_status,
                "kyc_status": kyc["kyc_status"],
            },
            after_values={
                "verification_status": new_status,
                "kyc_status": new_status,
            },
            reason=remarks,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "success",
        "message": (
            f"KYC status changed from "
            f"{old_status} to {new_status}"
        ),
        "changed": True,
        "technician": {
            "technician_id": str(
                kyc["technician_id"]
            ),
            "full_name": kyc["full_name"],
        },
        "kyc": {
            "old_status": old_status,
            "verification_status": new_status,
            "technician_status": new_status,
        },
        "remarks": remarks,
        "admin": {
            "user_id": admin_user_id,
            "role": current_admin.get("role"),
        },
    }
@router.get("/skills")
def get_admin_skills(
    db: Session = Depends(get_db),
    admin=Depends(require_permission("skills.read")),
):
    rows = db.execute(
        text("""
            SELECT
                s.id,
                s.name,
                s.description,
                s.is_active,
                s.created_at,

                (
                    SELECT COUNT(*)
                    FROM technician_skills ts
                    WHERE ts.skill_id = s.id
                ) AS technicians_count,

                (
                    SELECT COUNT(*)
                    FROM service_skills ss
                    WHERE ss.skill_id = s.id
                ) AS services_count,

                (
                    SELECT COUNT(*)
                    FROM service_skills ss
                    WHERE ss.skill_id = s.id
                      AND ss.is_required = TRUE
                ) AS required_services_count

            FROM skills s
            ORDER BY
                s.is_active DESC,
                LOWER(s.name),
                s.created_at
        """)
    ).mappings().all()

    active_count = sum(
        1 for row in rows if row["is_active"]
    )

    inactive_count = len(rows) - active_count

    mapped_count = sum(
        1
        for row in rows
        if (
            (row["technicians_count"] or 0) > 0
            or (row["services_count"] or 0) > 0
        )
    )

    return {
        "status": "success",
        "summary": {
            "total": len(rows),
            "active": active_count,
            "inactive": inactive_count,
            "mapped": mapped_count,
        },
        "skills": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "is_active": row["is_active"],
                "usage": {
                    "technicians":
                        row["technicians_count"] or 0,
                    "services":
                        row["services_count"] or 0,
                    "required_services":
                        row["required_services_count"] or 0,
                },
                "created_at":
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None,
            }
            for row in rows
        ],
"admin": {
    "user_id": str(admin.get("sub")),
    "role": admin.get("role"),
},
}
@router.post("/skills", status_code=status.HTTP_201_CREATED)
def create_admin_skill(
    payload: SkillCreate,
    db: Session = Depends(get_db),
    admin=Depends(require_permission("skills.write")),
):
    name = payload.name.strip()
    description = (
        payload.description.strip()
        if payload.description and payload.description.strip()
        else None
    )

    existing = db.execute(
        text("""
            SELECT id
            FROM skills
            WHERE LOWER(name) = LOWER(:name)
            LIMIT 1
        """),
        {"name": name},
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A skill with this name already exists",
        )

    skill = db.execute(
        text("""
            INSERT INTO skills (
                name,
                description,
                is_active
            )
            VALUES (
                :name,
                :description,
                TRUE
            )
            RETURNING
                id,
                name,
                description,
                is_active,
                created_at
        """),
        {
            "name": name,
            "description": description,
        },
    ).mappings().one()

    db.commit()

    return {
        "status": "success",
        "message": "Skill created successfully",
        "skill": {
            "id": str(skill["id"]),
            "name": skill["name"],
            "description": skill["description"],
            "is_active": skill["is_active"],
            "created_at": (
                skill["created_at"].isoformat()
                if skill["created_at"]
                else None
            ),
        },
    }


@router.patch("/skills/{skill_id}")
def update_admin_skill(
    skill_id: str,
    payload: SkillUpdate,
    db: Session = Depends(get_db),
    admin=Depends(require_permission("skills.write")),
):
    skill = db.execute(
        text("""
            SELECT
                id,
                name,
                description,
                is_active
            FROM skills
            WHERE id::text = :skill_id
            LIMIT 1
        """),
        {"skill_id": skill_id},
    ).mappings().first()

    if not skill:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Skill not found",
        )

    new_name = skill["name"]
    new_description = skill["description"]
    new_is_active = skill["is_active"]

    if payload.name is not None:
        new_name = payload.name.strip()

        duplicate = db.execute(
            text("""
                SELECT id
                FROM skills
                WHERE LOWER(name) = LOWER(:name)
                  AND id <> :skill_id
                LIMIT 1
            """),
            {
                "name": new_name,
                "skill_id": skill["id"],
            },
        ).first()

        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A skill with this name already exists",
            )

    if payload.description is not None:
        cleaned_description = payload.description.strip()
        new_description = cleaned_description or None

    if payload.is_active is not None:
        new_is_active = payload.is_active

    updated = db.execute(
        text("""
            UPDATE skills
            SET
                name = :name,
                description = :description,
                is_active = :is_active
            WHERE id = :skill_id
            RETURNING
                id,
                name,
                description,
                is_active,
                created_at
        """),
        {
            "skill_id": skill["id"],
            "name": new_name,
            "description": new_description,
            "is_active": new_is_active,
        },
    ).mappings().one()

    db.commit()

    return {
        "status": "success",
        "message": "Skill updated successfully",
        "skill": {
            "id": str(updated["id"]),
            "name": updated["name"],
            "description": updated["description"],
            "is_active": updated["is_active"],
            "created_at": (
                updated["created_at"].isoformat()
                if updated["created_at"]
                else None
            ),
        },
    }
@router.get("/tools")
def get_admin_tools(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("tools.read")),
):
    rows = db.execute(
        text("""
            SELECT
                tl.id,
                tl.name,
                tl.description,
                tl.is_active,
                tl.created_at,

                (
                    SELECT COUNT(DISTINCT tt.technician_id)
                    FROM technician_tools tt
                    WHERE tt.tool_id = tl.id
                ) AS technicians_count,

                (
                    SELECT COUNT(DISTINCT st.service_id)
                    FROM service_tools st
                    WHERE st.tool_id = tl.id
                ) AS services_count,

                (
                    SELECT COUNT(DISTINCT st.service_id)
                    FROM service_tools st
                    WHERE st.tool_id = tl.id
                      AND st.is_required = TRUE
                ) AS required_services_count

            FROM tools tl
            ORDER BY LOWER(tl.name), tl.name
        """)
    ).mappings().all()

    active_count = sum(
        1 for row in rows
        if row["is_active"]
    )

    inactive_count = len(rows) - active_count

    mapped_count = sum(
        1
        for row in rows
        if (
            (row["technicians_count"] or 0) > 0
            or (row["services_count"] or 0) > 0
        )
    )

    return {
        "status": "success",
        "summary": {
            "total": len(rows),
            "active": active_count,
            "inactive": inactive_count,
            "mapped": mapped_count,
        },
        "tools": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "is_active": row["is_active"],
                "usage": {
                    "technicians":
                        row["technicians_count"] or 0,
                    "services":
                        row["services_count"] or 0,
                    "required_services":
                        row["required_services_count"] or 0,
                },
                "created_at":
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None,
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }


@router.post("/tools")
def create_admin_tool(
    payload: ToolCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("tools.write")),
):
    name = payload.name.strip()
    description = (
        payload.description.strip()
        if payload.description
        else None
    )

    existing = db.execute(
        text("""
            SELECT id
            FROM tools
            WHERE LOWER(name) = LOWER(:name)
            LIMIT 1
        """),
        {"name": name},
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A tool with this name already exists",
        )

    row = db.execute(
        text("""
            INSERT INTO tools (
                name,
                description,
                is_active
            )
            VALUES (
                :name,
                :description,
                TRUE
            )
            RETURNING
                id,
                name,
                description,
                is_active,
                created_at
        """),
        {
            "name": name,
            "description": description,
        },
    ).mappings().one()

    db.commit()

    return {
        "status": "success",
        "message": "Tool created successfully",
        "tool": {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "is_active": row["is_active"],
            "created_at":
                row["created_at"].isoformat()
                if row["created_at"]
                else None,
        },
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }


@router.patch("/tools/{tool_id}")
def update_admin_tool(
    tool_id: str,
    payload: ToolUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("tools.write")),
):
    existing = db.execute(
        text("""
            SELECT
                id,
                name,
                description,
                is_active,
                created_at
            FROM tools
            WHERE id::text = :tool_id
            LIMIT 1
        """),
        {"tool_id": tool_id},
    ).mappings().first()

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Tool not found",
        )

    updates = payload.model_dump(
        exclude_unset=True,
    )

    if not updates:
        return {
            "status": "success",
            "message": "No changes requested",
            "changed": False,
            "tool": {
                "id": str(existing["id"]),
                "name": existing["name"],
                "description":
                    existing["description"],
                "is_active":
                    existing["is_active"],
                "created_at":
                    existing["created_at"].isoformat()
                    if existing["created_at"]
                    else None,
            },
        }

    name = existing["name"]
    description = existing["description"]
    is_active = existing["is_active"]

    if "name" in updates:
        name = updates["name"].strip()

        duplicate = db.execute(
            text("""
                SELECT id
                FROM tools
                WHERE LOWER(name) = LOWER(:name)
                  AND id <> :tool_id
                LIMIT 1
            """),
            {
                "name": name,
                "tool_id": existing["id"],
            },
        ).first()

        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "A tool with this name "
                    "already exists"
                ),
            )

    if "description" in updates:
        description = (
            updates["description"].strip()
            if updates["description"]
            else None
        )

    if "is_active" in updates:
        is_active = updates["is_active"]

    row = db.execute(
        text("""
            UPDATE tools
            SET
                name = :name,
                description = :description,
                is_active = :is_active
            WHERE id = :tool_id
            RETURNING
                id,
                name,
                description,
                is_active,
                created_at
        """),
        {
            "name": name,
            "description": description,
            "is_active": is_active,
            "tool_id": existing["id"],
        },
    ).mappings().one()

    db.commit()

    return {
        "status": "success",
        "message": "Tool updated successfully",
        "changed": True,
        "tool": {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "is_active": row["is_active"],
            "created_at":
                row["created_at"].isoformat()
                if row["created_at"]
                else None,
        },
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }

@router.get("/service-categories")
def get_admin_service_categories(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("categories.read")),
):
    rows = db.execute(
        text("""
            SELECT
                c.id,
                c.name,
                c.description,
                c.icon_name,
                c.is_active,
                c.sort_order,
                c.created_at,

                COUNT(s.id) AS services_count,

                COUNT(s.id) FILTER (
                    WHERE s.is_active = TRUE
                ) AS active_services_count

            FROM service_categories c

            LEFT JOIN services s
                ON s.category_id = c.id

            GROUP BY
                c.id,
                c.name,
                c.description,
                c.icon_name,
                c.is_active,
                c.sort_order,
                c.created_at

            ORDER BY
                c.sort_order,
                LOWER(c.name),
                c.name
        """)
    ).mappings().all()

    active_count = sum(
        1 for row in rows if row["is_active"]
    )

    inactive_count = len(rows) - active_count

    return {
        "status": "success",
        "summary": {
            "total": len(rows),
            "active": active_count,
            "inactive": inactive_count,
        },
        "categories": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "icon_name": row["icon_name"],
                "is_active": row["is_active"],
                "sort_order": row["sort_order"],
                "services": {
                    "total": row["services_count"] or 0,
                    "active": row["active_services_count"] or 0,
                },
                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                ),
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.post(
    "/service-categories",
    status_code=status.HTTP_201_CREATED,
)
def create_admin_service_category(
    payload: ServiceCategoryCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("categories.write")),
):
    name = payload.name.strip()

    description = (
        payload.description.strip()
        if payload.description
        else None
    )

    icon_name = (
        payload.icon_name.strip()
        if payload.icon_name
        else None
    )

    existing = db.execute(
        text("""
            SELECT id
            FROM service_categories
            WHERE LOWER(name) = LOWER(:name)
            LIMIT 1
        """),
        {"name": name},
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A service category with this name already exists",
        )

    row = db.execute(
        text("""
            INSERT INTO service_categories (
                name,
                description,
                icon_name,
                is_active,
                sort_order
            )
            VALUES (
                :name,
                :description,
                :icon_name,
                TRUE,
                :sort_order
            )
            RETURNING
                id,
                name,
                description,
                icon_name,
                is_active,
                sort_order,
                created_at
        """),
        {
            "name": name,
            "description": description,
            "icon_name": icon_name,
            "sort_order": payload.sort_order,
        },
    ).mappings().one()

    db.commit()

    return {
        "status": "success",
        "message": "Service category created successfully",
        "category": {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "icon_name": row["icon_name"],
            "is_active": row["is_active"],
            "sort_order": row["sort_order"],
            "created_at": (
                row["created_at"].isoformat()
                if row["created_at"]
                else None
            ),
        },
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.patch("/service-categories/{category_id}")
def update_admin_service_category(
    category_id: str,
    payload: ServiceCategoryUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("categories.write")),
):
    existing = db.execute(
        text("""
            SELECT
                id,
                name,
                description,
                icon_name,
                is_active,
                sort_order,
                created_at
            FROM service_categories
            WHERE id::text = :category_id
            LIMIT 1
        """),
        {"category_id": category_id},
    ).mappings().first()

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service category not found",
        )

    updates = payload.model_dump(exclude_unset=True)

    if not updates:
        return {
            "status": "success",
            "message": "No changes requested",
            "changed": False,
        }

    name = existing["name"]
    description = existing["description"]
    icon_name = existing["icon_name"]
    is_active = existing["is_active"]
    sort_order = existing["sort_order"]

    if "name" in updates:
        name = updates["name"].strip()

        duplicate = db.execute(
            text("""
                SELECT id
                FROM service_categories
                WHERE LOWER(name) = LOWER(:name)
                  AND id <> :category_id
                LIMIT 1
            """),
            {
                "name": name,
                "category_id": existing["id"],
            },
        ).first()

        if duplicate:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "A service category with this name "
                    "already exists"
                ),
            )

    if "description" in updates:
        description = (
            updates["description"].strip()
            if updates["description"]
            else None
        )

    if "icon_name" in updates:
        icon_name = (
            updates["icon_name"].strip()
            if updates["icon_name"]
            else None
        )

    if "sort_order" in updates:
        sort_order = updates["sort_order"]

    if "is_active" in updates:
        is_active = updates["is_active"]

    row = db.execute(
        text("""
            UPDATE service_categories
            SET
                name = :name,
                description = :description,
                icon_name = :icon_name,
                is_active = :is_active,
                sort_order = :sort_order
            WHERE id = :category_id
            RETURNING
                id,
                name,
                description,
                icon_name,
                is_active,
                sort_order,
                created_at
        """),
        {
            "name": name,
            "description": description,
            "icon_name": icon_name,
            "is_active": is_active,
            "sort_order": sort_order,
            "category_id": existing["id"],
        },
    ).mappings().one()

    db.commit()

    return {
        "status": "success",
        "message": "Service category updated successfully",
        "changed": True,
        "category": {
            "id": str(row["id"]),
            "name": row["name"],
            "description": row["description"],
            "icon_name": row["icon_name"],
            "is_active": row["is_active"],
            "sort_order": row["sort_order"],
            "created_at": (
                row["created_at"].isoformat()
                if row["created_at"]
                else None
            ),
        },
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.get("/services")
def get_admin_services(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("services.read")),
):
    rows = db.execute(
        text("""
            SELECT
                s.id,
                s.category_id,
                c.name AS category_name,
                c.is_active AS category_is_active,
                c.sort_order AS category_sort_order,
                s.name,
                s.description,
                s.is_active,
                s.created_at,

                (
                    SELECT COUNT(*)
                    FROM service_skills ss
                    WHERE ss.service_id = s.id
                ) AS skills_count,

                (
                    SELECT COUNT(*)
                    FROM service_tools st
                    WHERE st.service_id = s.id
                ) AS tools_count

            FROM services s

            JOIN service_categories c
                ON c.id = s.category_id

            ORDER BY
                c.sort_order,
                LOWER(s.name),
                s.name
        """)
    ).mappings().all()

    active_count = sum(
        1 for row in rows if row["is_active"]
    )

    inactive_count = len(rows) - active_count

    mapped_skills_count = sum(
        1 for row in rows if row["skills_count"] > 0
    )

    mapped_tools_count = sum(
        1 for row in rows if row["tools_count"] > 0
    )

    return {
        "status": "success",
        "summary": {
            "total": len(rows),
            "active": active_count,
            "inactive": inactive_count,
            "with_skills": mapped_skills_count,
            "with_tools": mapped_tools_count,
        },
        "services": [
            {
                "id": str(row["id"]),
                "category_id": str(row["category_id"]),
                "category_name": row["category_name"],
                "category_is_active": row["category_is_active"],
                "category_sort_order": row["category_sort_order"],
                "name": row["name"],
                "description": row["description"],
                "is_active": row["is_active"],
                "skills_count": row["skills_count"] or 0,
                "tools_count": row["tools_count"] or 0,
                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                ),
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.post(
    "/services",
    status_code=status.HTTP_201_CREATED,
)
def create_admin_service(
    payload: ServiceCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("services.write")),
):
    name = payload.name.strip()

    description = (
        payload.description.strip()
        if payload.description
        else None
    )

    category = db.execute(
        text("""
            SELECT
                id,
                name,
                is_active
            FROM service_categories
            WHERE id::text = :category_id
            LIMIT 1
        """),
        {"category_id": payload.category_id},
    ).mappings().first()

    if not category:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service category not found",
        )

    if not category["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot create a service under an inactive category",
        )

    duplicate = db.execute(
        text("""
            SELECT id
            FROM services
            WHERE category_id = :category_id
              AND LOWER(name) = LOWER(:name)
            LIMIT 1
        """),
        {
            "category_id": category["id"],
            "name": name,
        },
    ).first()

    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A service with this name already exists "
                "in the selected category"
            ),
        )

    row = db.execute(
        text("""
            INSERT INTO services (
                category_id,
                name,
                description,
                is_active
            )
            VALUES (
                :category_id,
                :name,
                :description,
                TRUE
            )
            RETURNING
                id,
                category_id,
                name,
                description,
                is_active,
                created_at
        """),
        {
            "category_id": category["id"],
            "name": name,
            "description": description,
        },
    ).mappings().one()

    db.commit()

    return {
        "status": "success",
        "message": "Service created successfully",
        "service": {
            "id": str(row["id"]),
            "category_id": str(row["category_id"]),
            "category_name": category["name"],
            "name": row["name"],
            "description": row["description"],
            "is_active": row["is_active"],
            "skills_count": 0,
            "tools_count": 0,
            "created_at": (
                row["created_at"].isoformat()
                if row["created_at"]
                else None
            ),
        },
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.patch("/services/{service_id}")
def update_admin_service(
    service_id: str,
    payload: ServiceUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("services.write")),
):
    existing = db.execute(
        text("""
            SELECT
                s.id,
                s.category_id,
                s.name,
                s.description,
                s.is_active,
                s.created_at,
                c.name AS category_name,
                c.is_active AS category_is_active
            FROM services s
            JOIN service_categories c
                ON c.id = s.category_id
            WHERE s.id::text = :service_id
            LIMIT 1
        """),
        {"service_id": service_id},
    ).mappings().first()

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service not found",
        )

    updates = payload.model_dump(exclude_unset=True)

    if not updates:
        return {
            "status": "success",
            "message": "No changes requested",
            "changed": False,
        }

    category_id = existing["category_id"]
    category_name = existing["category_name"]
    name = existing["name"]
    description = existing["description"]
    is_active = existing["is_active"]

    if "category_id" in updates:
        category = db.execute(
            text("""
                SELECT
                    id,
                    name,
                    is_active
                FROM service_categories
                WHERE id::text = :category_id
                LIMIT 1
            """),
            {"category_id": updates["category_id"]},
        ).mappings().first()

        if not category:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Service category not found",
            )

        if not category["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot move a service to an inactive category",
            )

        category_id = category["id"]
        category_name = category["name"]

    if "name" in updates:
        name = updates["name"].strip()

    if "description" in updates:
        description = (
            updates["description"].strip()
            if updates["description"]
            else None
        )

    if "is_active" in updates:
        is_active = updates["is_active"]

    duplicate = db.execute(
        text("""
            SELECT id
            FROM services
            WHERE category_id = :category_id
              AND LOWER(name) = LOWER(:name)
              AND id <> :service_id
            LIMIT 1
        """),
        {
            "category_id": category_id,
            "name": name,
            "service_id": existing["id"],
        },
    ).first()

    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "A service with this name already exists "
                "in the selected category"
            ),
        )

    row = db.execute(
        text("""
            UPDATE services
            SET
                category_id = :category_id,
                name = :name,
                description = :description,
                is_active = :is_active
            WHERE id = :service_id
            RETURNING
                id,
                category_id,
                name,
                description,
                is_active,
                created_at
        """),
        {
            "category_id": category_id,
            "name": name,
            "description": description,
            "is_active": is_active,
            "service_id": existing["id"],
        },
    ).mappings().one()

    db.commit()

    mapping_counts = db.execute(
        text("""
            SELECT
                (
                    SELECT COUNT(*)
                    FROM service_skills
                    WHERE service_id = :service_id
                ) AS skills_count,
                (
                    SELECT COUNT(*)
                    FROM service_tools
                    WHERE service_id = :service_id
                ) AS tools_count
        """),
        {"service_id": row["id"]},
    ).mappings().one()

    return {
        "status": "success",
        "message": "Service updated successfully",
        "changed": True,
        "service": {
            "id": str(row["id"]),
            "category_id": str(row["category_id"]),
            "category_name": category_name,
            "name": row["name"],
            "description": row["description"],
            "is_active": row["is_active"],
            "skills_count": mapping_counts["skills_count"] or 0,
            "tools_count": mapping_counts["tools_count"] or 0,
            "created_at": (
                row["created_at"].isoformat()
                if row["created_at"]
                else None
            ),
        },
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }

@router.get("/service-skills/{service_id}")
def get_admin_service_skills(
    service_id: str,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("service_skills.read")),
):
    service = db.execute(
        text("""
            SELECT
                s.id,
                s.name,
                s.is_active,
                s.category_id,
                c.name AS category_name
            FROM services s
            JOIN service_categories c
                ON c.id = s.category_id
            WHERE s.id::text = :service_id
            LIMIT 1
        """),
        {"service_id": service_id},
    ).mappings().first()

    if not service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service not found",
        )

    rows = db.execute(
        text("""
            SELECT
                sk.id,
                sk.name,
                sk.description,
                sk.is_active,
                CASE
                    WHEN ss.skill_id IS NOT NULL THEN TRUE
                    ELSE FALSE
                END AS is_mapped,
                COALESCE(ss.is_required, FALSE) AS is_required
            FROM skills sk
            LEFT JOIN service_skills ss
                ON ss.skill_id = sk.id
               AND ss.service_id = :service_id
            ORDER BY
                CASE
                    WHEN ss.skill_id IS NOT NULL THEN 0
                    ELSE 1
                END,
                LOWER(sk.name),
                sk.name
        """),
        {"service_id": service["id"]},
    ).mappings().all()

    mapped_count = sum(
        1 for row in rows if row["is_mapped"]
    )

    required_count = sum(
        1
        for row in rows
        if row["is_mapped"] and row["is_required"]
    )

    optional_count = mapped_count - required_count

    return {
        "status": "success",
        "service": {
            "id": str(service["id"]),
            "name": service["name"],
            "is_active": service["is_active"],
            "category_id": str(service["category_id"]),
            "category_name": service["category_name"],
        },
        "summary": {
            "available_skills": len(rows),
            "mapped": mapped_count,
            "required": required_count,
            "optional": optional_count,
        },
        "skills": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "is_active": row["is_active"],
                "is_mapped": row["is_mapped"],
                "is_required": row["is_required"],
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.put("/service-skills/{service_id}")
def update_admin_service_skills(
    service_id: str,
    payload: ServiceSkillMappingUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("service_skills.write")),
):
    service = db.execute(
        text("""
            SELECT
                s.id,
                s.name,
                s.is_active,
                s.category_id,
                c.name AS category_name
            FROM services s
            JOIN service_categories c
                ON c.id = s.category_id
            WHERE s.id::text = :service_id
            LIMIT 1
        """),
        {"service_id": service_id},
    ).mappings().first()

    if not service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service not found",
        )

    skill_ids = [
        item.skill_id
        for item in payload.skills
    ]

    if len(skill_ids) != len(set(skill_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Duplicate skill IDs are not allowed",
        )

    validated_skills = {}

    for item in payload.skills:
        skill = db.execute(
            text("""
                SELECT
                    id,
                    name,
                    is_active
                FROM skills
                WHERE id::text = :skill_id
                LIMIT 1
            """),
            {"skill_id": item.skill_id},
        ).mappings().first()

        if not skill:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Skill not found: {item.skill_id}",
            )

        if not skill["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f'Inactive skill cannot be mapped: '
                    f'{skill["name"]}'
                ),
            )

        validated_skills[item.skill_id] = skill

    try:
        db.execute(
            text("""
                DELETE FROM service_skills
                WHERE service_id = :service_id
            """),
            {"service_id": service["id"]},
        )

        for item in payload.skills:
            skill = validated_skills[item.skill_id]

            db.execute(
                text("""
                    INSERT INTO service_skills (
                        service_id,
                        skill_id,
                        is_required
                    )
                    VALUES (
                        :service_id,
                        :skill_id,
                        :is_required
                    )
                """),
                {
                    "service_id": service["id"],
                    "skill_id": skill["id"],
                    "is_required": item.is_required,
                },
            )

        db.commit()

    except Exception:
        db.rollback()
        raise

    rows = db.execute(
        text("""
            SELECT
                sk.id,
                sk.name,
                sk.description,
                sk.is_active,
                ss.is_required
            FROM service_skills ss
            JOIN skills sk
                ON sk.id = ss.skill_id
            WHERE ss.service_id = :service_id
            ORDER BY
                ss.is_required DESC,
                LOWER(sk.name),
                sk.name
        """),
        {"service_id": service["id"]},
    ).mappings().all()

    required_count = sum(
        1 for row in rows if row["is_required"]
    )

    return {
        "status": "success",
        "message": "Service skill mappings updated successfully",
        "service": {
            "id": str(service["id"]),
            "name": service["name"],
            "category_id": str(service["category_id"]),
            "category_name": service["category_name"],
        },
        "summary": {
            "mapped": len(rows),
            "required": required_count,
            "optional": len(rows) - required_count,
        },
        "skills": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "is_active": row["is_active"],
                "is_required": row["is_required"],
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }

@router.get("/service-tools/{service_id}")
def get_admin_service_tools(
    service_id: str,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("service_tools.read")),
):
    service = db.execute(
        text("""
            SELECT
                s.id,
                s.name,
                s.is_active,
                s.category_id,
                c.name AS category_name
            FROM services s
            JOIN service_categories c
                ON c.id = s.category_id
            WHERE s.id::text = :service_id
            LIMIT 1
        """),
        {"service_id": service_id},
    ).mappings().first()

    if not service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service not found",
        )

    rows = db.execute(
        text("""
            SELECT
                t.id,
                t.name,
                t.description,
                t.is_active,
                CASE
                    WHEN st.tool_id IS NOT NULL THEN TRUE
                    ELSE FALSE
                END AS is_mapped,
                COALESCE(st.is_required, FALSE) AS is_required
            FROM tools t
            LEFT JOIN service_tools st
                ON st.tool_id = t.id
               AND st.service_id = :service_id
            ORDER BY
                CASE
                    WHEN st.tool_id IS NOT NULL THEN 0
                    ELSE 1
                END,
                LOWER(t.name),
                t.name
        """),
        {"service_id": service["id"]},
    ).mappings().all()

    mapped_count = sum(
        1 for row in rows if row["is_mapped"]
    )

    required_count = sum(
        1
        for row in rows
        if row["is_mapped"] and row["is_required"]
    )

    optional_count = mapped_count - required_count

    return {
        "status": "success",
        "service": {
            "id": str(service["id"]),
            "name": service["name"],
            "is_active": service["is_active"],
            "category_id": str(service["category_id"]),
            "category_name": service["category_name"],
        },
        "summary": {
            "available_tools": len(rows),
            "mapped": mapped_count,
            "required": required_count,
            "optional": optional_count,
        },
        "tools": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "is_active": row["is_active"],
                "is_mapped": row["is_mapped"],
                "is_required": row["is_required"],
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.put("/service-tools/{service_id}")
def update_admin_service_tools(
    service_id: str,
    payload: ServiceToolMappingUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("service_tools.write")),
):
    service = db.execute(
        text("""
            SELECT
                s.id,
                s.name,
                s.is_active,
                s.category_id,
                c.name AS category_name
            FROM services s
            JOIN service_categories c
                ON c.id = s.category_id
            WHERE s.id::text = :service_id
            LIMIT 1
        """),
        {"service_id": service_id},
    ).mappings().first()

    if not service:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Service not found",
        )

    tool_ids = [item.tool_id for item in payload.tools]

    if len(tool_ids) != len(set(tool_ids)):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Duplicate tool IDs are not allowed",
        )

    validated_tools = {}

    for item in payload.tools:
        tool = db.execute(
            text("""
                SELECT
                    id,
                    name,
                    is_active
                FROM tools
                WHERE id::text = :tool_id
                LIMIT 1
            """),
            {"tool_id": item.tool_id},
        ).mappings().first()

        if not tool:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Tool not found: {item.tool_id}",
            )

        if not tool["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f'Inactive tool cannot be mapped: {tool["name"]}',
            )

        validated_tools[item.tool_id] = tool

    try:
        db.execute(
            text("""
                DELETE FROM service_tools
                WHERE service_id = :service_id
            """),
            {"service_id": service["id"]},
        )

        for item in payload.tools:
            tool = validated_tools[item.tool_id]

            db.execute(
                text("""
                    INSERT INTO service_tools (
                        service_id,
                        tool_id,
                        is_required
                    )
                    VALUES (
                        :service_id,
                        :tool_id,
                        :is_required
                    )
                """),
                {
                    "service_id": service["id"],
                    "tool_id": tool["id"],
                    "is_required": item.is_required,
                },
            )

        db.commit()

    except Exception:
        db.rollback()
        raise

    rows = db.execute(
        text("""
            SELECT
                t.id,
                t.name,
                t.description,
                t.is_active,
                st.is_required
            FROM service_tools st
            JOIN tools t
                ON t.id = st.tool_id
            WHERE st.service_id = :service_id
            ORDER BY
                st.is_required DESC,
                LOWER(t.name),
                t.name
        """),
        {"service_id": service["id"]},
    ).mappings().all()

    required_count = sum(
        1 for row in rows if row["is_required"]
    )

    return {
        "status": "success",
        "message": "Service tool mappings updated successfully",
        "service": {
            "id": str(service["id"]),
            "name": service["name"],
            "category_id": str(service["category_id"]),
            "category_name": service["category_name"],
        },
        "summary": {
            "mapped": len(rows),
            "required": required_count,
            "optional": len(rows) - required_count,
        },
        "tools": [
            {
                "id": str(row["id"]),
                "name": row["name"],
                "description": row["description"],
                "is_active": row["is_active"],
                "is_required": row["is_required"],
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }

@router.get("/technician-locations")
def get_admin_technician_locations(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("locations.read")),
):
    settings = get_system_settings(db)
    rows = db.execute(
        operational_query(settings, """
            SELECT
                t.id AS technician_id,
                u.full_name,
                u.phone,
                u.email,
                u.is_active,
                t.availability_status AS availability,

                ST_Y(tl.location::geometry) AS latitude,
                ST_X(tl.location::geometry) AS longitude,

                tl.accuracy_meters,
                tl.battery_percent,
                tl.last_seen_at,
                tl.updated_at,

                CASE
                    WHEN tl.technician_id IS NULL THEN 'MISSING'
                    WHEN tl.last_seen_at >= NOW() - (:gps_timeout_minutes * INTERVAL '1 minute')
                        THEN 'LIVE'
                    ELSE 'STALE'
                END AS gps_status,

                CASE
                    WHEN tl.last_seen_at IS NULL THEN NULL
                    ELSE EXTRACT(
                        EPOCH FROM (NOW() - tl.last_seen_at)
                    )::BIGINT
                END AS age_seconds

            FROM technicians t

            JOIN users u
                ON u.id = t.user_id

            LEFT JOIN technician_locations tl
                ON tl.technician_id = t.id

            ORDER BY
                CASE
                    WHEN tl.technician_id IS NULL THEN 2
                    WHEN tl.last_seen_at >= NOW() - (:gps_timeout_minutes * INTERVAL '1 minute')
                        THEN 0
                    ELSE 1
                END,
                LOWER(u.full_name),
                u.full_name
        """)
    ).mappings().all()

    live_count = sum(
        1 for row in rows if row["gps_status"] == "LIVE"
    )

    stale_count = sum(
        1 for row in rows if row["gps_status"] == "STALE"
    )

    missing_count = sum(
        1 for row in rows if row["gps_status"] == "MISSING"
    )

    return {
        "status": "success",
        "gps_timeout_minutes": settings["gps_timeout_minutes"],
        "summary": {
            "technicians": len(rows),
            "live": live_count,
            "stale": stale_count,
            "missing": missing_count,
        },
        "locations": [
            {
                "technician_id": str(row["technician_id"]),
                "full_name": row["full_name"],
                "phone": row["phone"],
                "email": row["email"],
                "is_active": row["is_active"],
                "availability": row["availability"],
                "gps_status": row["gps_status"],
                "latitude": (
                    float(row["latitude"])
                    if row["latitude"] is not None
                    else None
                ),
                "longitude": (
                    float(row["longitude"])
                    if row["longitude"] is not None
                    else None
                ),
                "accuracy_meters": (
                    float(row["accuracy_meters"])
                    if row["accuracy_meters"] is not None
                    else None
                ),
                "battery_percent": row["battery_percent"],
                "last_seen_at": (
                    row["last_seen_at"].isoformat()
                    if row["last_seen_at"]
                    else None
                ),
                "updated_at": (
                    row["updated_at"].isoformat()
                    if row["updated_at"]
                    else None
                ),
                "age_seconds": (
                    int(row["age_seconds"])
                    if row["age_seconds"] is not None
                    else None
                ),
            }
            for row in rows
        ],
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }


@router.get("/availability")
def get_admin_availability(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("availability.read")),
):
    settings = get_system_settings(db)
    rows = db.execute(
        operational_query(settings, """
            SELECT
                t.id AS technician_id,
                u.full_name,
                u.phone,
                u.email,
                u.is_active AS account_active,

                t.availability_status,
                t.kyc_status,

                tl.last_seen_at,

                CASE
                    WHEN tl.technician_id IS NULL THEN 'MISSING'
                    WHEN tl.last_seen_at >= NOW() - (:gps_timeout_minutes * INTERVAL '1 minute')
                        THEN 'LIVE'
                    ELSE 'STALE'
                END AS gps_status,

                COUNT(j.id) FILTER (
                    WHERE j.status IN (
                        'ASSIGNED',
                        'ACCEPTED',
                        'ON_THE_WAY',
                        'ARRIVED',
                        'IN_PROGRESS'
                    )
                ) AS active_jobs,

                MAX(j.updated_at) FILTER (
                    WHERE j.status IN (
                        'ASSIGNED',
                        'ACCEPTED',
                        'ON_THE_WAY',
                        'ARRIVED',
                        'IN_PROGRESS'
                    )
                ) AS active_job_updated_at

            FROM technicians t

            JOIN users u
                ON u.id = t.user_id

            LEFT JOIN technician_locations tl
                ON tl.technician_id = t.id

            LEFT JOIN jobs j
                ON j.technician_id = t.id

            GROUP BY
                t.id,
                u.full_name,
                u.phone,
                u.email,
                u.is_active,
                t.availability_status,
                t.kyc_status,
                tl.technician_id,
                tl.last_seen_at

            ORDER BY
                LOWER(u.full_name),
                u.full_name
        """)
    ).mappings().all()

    technicians = []

    for row in rows:
        active_jobs = int(row["active_jobs"] or 0)
        declared_status = row["availability_status"]
        gps_status = row["gps_status"]

        issues = []

        if active_jobs > 0 and declared_status != "BUSY":
            issues.append("ACTIVE_JOB_NOT_BUSY")

        if active_jobs == 0 and declared_status == "BUSY":
            issues.append("BUSY_WITHOUT_ACTIVE_JOB")

        if declared_status == "ONLINE" and gps_status != "LIVE":
            issues.append("ONLINE_WITHOUT_LIVE_GPS")

        if declared_status == "ONLINE" and not row["account_active"]:
            issues.append("ONLINE_ACCOUNT_DISABLED")

        if declared_status == "ONLINE" and row["kyc_status"] != "APPROVED":
            issues.append("ONLINE_KYC_NOT_APPROVED")

        technicians.append(
            {
                "technician_id": str(row["technician_id"]),
                "full_name": row["full_name"],
                "phone": row["phone"],
                "email": row["email"],
                "account_active": row["account_active"],
                "availability_status": declared_status,
                "kyc_status": row["kyc_status"],
                "gps_status": gps_status,
                "last_seen_at": (
                    row["last_seen_at"].isoformat()
                    if row["last_seen_at"]
                    else None
                ),
                "active_jobs": active_jobs,
                "is_busy": active_jobs > 0,
                "issues": issues,
                "has_issue": bool(issues),
                "active_job_updated_at": (
                    row["active_job_updated_at"].isoformat()
                    if row["active_job_updated_at"]
                    else None
                ),
            }
        )

    return {
        "status": "success",
        "gps_timeout_minutes": settings["gps_timeout_minutes"],
        "summary": {
            "technicians": len(technicians),
            "online": sum(
                1
                for item in technicians
                if item["availability_status"] == "ONLINE"
            ),
            "offline": sum(
                1
                for item in technicians
                if item["availability_status"] == "OFFLINE"
            ),
            "declared_busy": sum(
                1
                for item in technicians
                if item["availability_status"] == "BUSY"
            ),
            "actual_busy": sum(
                1
                for item in technicians
                if item["is_busy"]
            ),
            "issues": sum(
                1
                for item in technicians
                if item["has_issue"]
            ),
        },
        "technicians": technicians,
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.get("/notifications")
def get_admin_notifications(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("notifications.read")),
):
    summary_row = db.execute(
        text("""
            SELECT
                COUNT(*) AS total,
                COUNT(*) FILTER (
                    WHERE n.is_read = FALSE
                ) AS unread,
                COUNT(*) FILTER (
                    WHERE n.is_read = TRUE
                ) AS read,
                COUNT(*) FILTER (
                    WHERE u.role = 'CUSTOMER'
                ) AS customer_notifications,
                COUNT(*) FILTER (
                    WHERE u.role = 'TECHNICIAN'
                ) AS technician_notifications
            FROM notifications n
            JOIN users u
                ON u.id = n.user_id
        """)
    ).mappings().first()

    type_rows = db.execute(
        text("""
            SELECT
                notification_type,
                COUNT(*) AS total
            FROM notifications
            GROUP BY notification_type
            ORDER BY
                COUNT(*) DESC,
                notification_type
        """)
    ).mappings().all()

    rows = db.execute(
        text("""
            SELECT
                n.id,
                n.user_id,
                u.full_name AS recipient_name,
                u.phone AS recipient_phone,
                u.email AS recipient_email,
                u.role AS recipient_role,
                n.title,
                n.message,
                n.notification_type,
                n.reference_id,
                n.is_read,
                n.created_at
            FROM notifications n
            JOIN users u
                ON u.id = n.user_id
            ORDER BY n.created_at DESC
        """)
    ).mappings().all()

    notifications = []

    for row in rows:
        notifications.append(
            {
                "id": str(row["id"]),
                "user_id": str(row["user_id"]),
                "recipient_name": row["recipient_name"],
                "recipient_phone": row["recipient_phone"],
                "recipient_email": row["recipient_email"],
                "recipient_role": row["recipient_role"],
                "title": row["title"],
                "message": row["message"],
                "notification_type": row["notification_type"],
                "reference_id": (
                    str(row["reference_id"])
                    if row["reference_id"]
                    else None
                ),
                "is_read": row["is_read"],
                "created_at": (
                    row["created_at"].isoformat()
                    if row["created_at"]
                    else None
                ),
            }
        )

    return {
        "status": "success",
        "summary": {
            "total": int(summary_row["total"] or 0),
            "unread": int(summary_row["unread"] or 0),
            "read": int(summary_row["read"] or 0),
            "customer_notifications": int(
                summary_row["customer_notifications"] or 0
            ),
            "technician_notifications": int(
                summary_row["technician_notifications"] or 0
            ),
        },
        "types": [
            {
                "notification_type": row["notification_type"],
                "total": int(row["total"] or 0),
            }
            for row in type_rows
        ],
        "notifications": notifications,
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
@router.get("/exceptions")
def get_admin_exceptions(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("exceptions.read")),
):
    settings = get_system_settings(db)
    exceptions = []

    # 1. OPEN requests with no job after the configured warning period
    unmatched_rows = db.execute(
        operational_query(settings, """
            SELECT
                sr.id AS service_request_id,
                sr.title,
                sr.status,
                sr.created_at,
                sr.updated_at,
                u.full_name AS customer_name,
                u.phone AS customer_phone,
                s.name AS service_name,
                EXTRACT(
                    EPOCH FROM (NOW() - sr.created_at)
                )::bigint AS age_seconds
            FROM service_requests sr
            JOIN customers c
                ON c.id = sr.customer_id
            JOIN users u
                ON u.id = c.user_id
            JOIN services s
                ON s.id = sr.service_id
            WHERE
                sr.status = 'OPEN'
                AND sr.created_at <
                    NOW() - (:unmatched_request_minutes * INTERVAL '1 minute')
                AND NOT EXISTS (
                    SELECT 1
                    FROM jobs j
                    WHERE j.service_request_id = sr.id
                )
            ORDER BY sr.created_at
        """)
    ).mappings().all()

    for row in unmatched_rows:
        exceptions.append(
            {
                "type": "UNMATCHED_REQUEST",
                "severity": "WARNING",
                "reference_id": str(row["service_request_id"]),
                "title": row["title"] or row["service_name"],
                "description": (
                    "Open service request has no job assignment."
                ),
                "customer_name": row["customer_name"],
                "customer_phone": row["customer_phone"],
                "service_name": row["service_name"],
                "technician_name": None,
                "job_status": None,
                "availability_status": None,
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
                "age_seconds": int(row["age_seconds"] or 0),
            }
        )

    # 2. OPEN requests that already have one or more jobs
    open_with_job_rows = db.execute(
        text("""
            SELECT
                sr.id AS service_request_id,
                sr.title,
                sr.created_at,
                sr.updated_at,
                u.full_name AS customer_name,
                u.phone AS customer_phone,
                s.name AS service_name,
                COUNT(j.id) AS job_count,
                EXTRACT(
                    EPOCH FROM (NOW() - sr.updated_at)
                )::bigint AS age_seconds
            FROM service_requests sr
            JOIN customers c
                ON c.id = sr.customer_id
            JOIN users u
                ON u.id = c.user_id
            JOIN services s
                ON s.id = sr.service_id
            JOIN jobs j
                ON j.service_request_id = sr.id
            WHERE sr.status = 'OPEN'
            GROUP BY
                sr.id,
                sr.title,
                sr.created_at,
                sr.updated_at,
                u.full_name,
                u.phone,
                s.name
            ORDER BY sr.created_at
        """)
    ).mappings().all()

    for row in open_with_job_rows:
        exceptions.append(
            {
                "type": "OPEN_WITH_JOB",
                "severity": "ERROR",
                "reference_id": str(row["service_request_id"]),
                "title": row["title"] or row["service_name"],
                "description": (
                    f"Service request is OPEN but already has "
                    f"{row['job_count']} job record(s)."
                ),
                "customer_name": row["customer_name"],
                "customer_phone": row["customer_phone"],
                "service_name": row["service_name"],
                "technician_name": None,
                "job_status": None,
                "availability_status": None,
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
                "age_seconds": int(row["age_seconds"] or 0),
            }
        )

    # 3. Active jobs with no update past the configured threshold
    stuck_job_rows = db.execute(
        operational_query(settings, """
            SELECT
                j.id AS job_id,
                j.status AS job_status,
                j.created_at,
                j.updated_at,
                cu.full_name AS customer_name,
                tu.full_name AS technician_name,
                t.availability_status,
                s.name AS service_name,
                EXTRACT(
                    EPOCH FROM (NOW() - j.updated_at)
                )::bigint AS age_seconds
            FROM jobs j
            JOIN customers c
                ON c.id = j.customer_id
            JOIN users cu
                ON cu.id = c.user_id
            JOIN technicians t
                ON t.id = j.technician_id
            JOIN users tu
                ON tu.id = t.user_id
            JOIN service_requests sr
                ON sr.id = j.service_request_id
            JOIN services s
                ON s.id = sr.service_id
            WHERE
                j.status IN (
                    'ASSIGNED',
                    'ACCEPTED',
                    'ON_THE_WAY',
                    'ARRIVED',
                    'IN_PROGRESS'
                )
                AND j.updated_at <
                    NOW() - (:stuck_active_job_hours * INTERVAL '1 hour')
            ORDER BY j.updated_at
        """)
    ).mappings().all()

    for row in stuck_job_rows:
        exceptions.append(
            {
                "type": "STUCK_ACTIVE_JOB",
                "severity": "CRITICAL",
                "reference_id": str(row["job_id"]),
                "title": row["service_name"],
                "description": (
                    "Active job has had no status update "
                    f"for more than {settings['stuck_active_job_hours']} hours."
                ),
                "customer_name": row["customer_name"],
                "customer_phone": None,
                "service_name": row["service_name"],
                "technician_name": row["technician_name"],
                "job_status": row["job_status"],
                "availability_status": row["availability_status"],
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
                "age_seconds": int(row["age_seconds"] or 0),
            }
        )

    # 4A. Active job but technician not marked BUSY
    active_not_busy_rows = db.execute(
        text("""
            SELECT
                j.id AS job_id,
                j.status AS job_status,
                j.created_at,
                j.updated_at,
                tu.full_name AS technician_name,
                t.availability_status
            FROM jobs j
            JOIN technicians t
                ON t.id = j.technician_id
            JOIN users tu
                ON tu.id = t.user_id
            WHERE
                j.status IN (
                    'ASSIGNED',
                    'ACCEPTED',
                    'ON_THE_WAY',
                    'ARRIVED',
                    'IN_PROGRESS'
                )
                AND t.availability_status <> 'BUSY'
            ORDER BY j.updated_at
        """)
    ).mappings().all()

    for row in active_not_busy_rows:
        exceptions.append(
            {
                "type": "TECHNICIAN_STATE_MISMATCH",
                "severity": "ERROR",
                "reference_id": str(row["job_id"]),
                "title": row["technician_name"],
                "description": (
                    "Technician has an active job but is not "
                    "marked BUSY."
                ),
                "customer_name": None,
                "customer_phone": None,
                "service_name": None,
                "technician_name": row["technician_name"],
                "job_status": row["job_status"],
                "availability_status": row["availability_status"],
                "created_at": row["created_at"].isoformat(),
                "updated_at": row["updated_at"].isoformat(),
                "age_seconds": None,
            }
        )

    # 4B. BUSY technician without an active job
    busy_without_job_rows = db.execute(
        text("""
            SELECT
                t.id AS technician_id,
                u.full_name AS technician_name,
                t.availability_status,
                t.updated_at
            FROM technicians t
            JOIN users u
                ON u.id = t.user_id
            WHERE
                t.availability_status = 'BUSY'
                AND NOT EXISTS (
                    SELECT 1
                    FROM jobs j
                    WHERE
                        j.technician_id = t.id
                        AND j.status IN (
                            'ASSIGNED',
                            'ACCEPTED',
                            'ON_THE_WAY',
                            'ARRIVED',
                            'IN_PROGRESS'
                        )
                )
            ORDER BY t.updated_at
        """)
    ).mappings().all()

    for row in busy_without_job_rows:
        exceptions.append(
            {
                "type": "TECHNICIAN_STATE_MISMATCH",
                "severity": "ERROR",
                "reference_id": str(row["technician_id"]),
                "title": row["technician_name"],
                "description": (
                    "Technician is marked BUSY but has "
                    "no active job."
                ),
                "customer_name": None,
                "customer_phone": None,
                "service_name": None,
                "technician_name": row["technician_name"],
                "job_status": None,
                "availability_status": row["availability_status"],
                "created_at": None,
                "updated_at": row["updated_at"].isoformat(),
                "age_seconds": None,
            }
        )

    severity_order = {
        "CRITICAL": 0,
        "ERROR": 1,
        "WARNING": 2,
    }

    exceptions.sort(
        key=lambda item: (
            severity_order.get(item["severity"], 99),
            -(item["age_seconds"] or 0),
        )
    )

    return {
        "status": "success",
        "summary": {
            "total": len(exceptions),
            "critical": sum(
                1
                for item in exceptions
                if item["severity"] == "CRITICAL"
            ),
            "errors": sum(
                1
                for item in exceptions
                if item["severity"] == "ERROR"
            ),
            "warnings": sum(
                1
                for item in exceptions
                if item["severity"] == "WARNING"
            ),
            "unmatched_requests": sum(
                1
                for item in exceptions
                if item["type"] == "UNMATCHED_REQUEST"
            ),
            "open_with_job": sum(
                1
                for item in exceptions
                if item["type"] == "OPEN_WITH_JOB"
            ),
            "stuck_jobs": sum(
                1
                for item in exceptions
                if item["type"] == "STUCK_ACTIVE_JOB"
            ),
            "technician_mismatches": sum(
                1
                for item in exceptions
                if item["type"] == "TECHNICIAN_STATE_MISMATCH"
            ),
        },
        "exceptions": exceptions,
        "thresholds": {
            "unmatched_request_minutes": settings["unmatched_request_minutes"],
            "stuck_active_job_hours": settings["stuck_active_job_hours"],
        },
        "admin": {
            "user_id": str(admin.get("sub")),
            "role": admin.get("role"),
        },
    }
# ============================================================
# C29 - ADMIN USERS MANAGEMENT
# ============================================================

class AdminUserCreate(BaseModel):
    full_name: str = Field(..., min_length=2, max_length=150)
    email: str = Field(..., min_length=5, max_length=255)
    phone: str = Field(..., min_length=10, max_length=20)
    password: str = Field(..., min_length=12, max_length=128)


class AdminUserStatusUpdate(BaseModel):
    is_active: bool
    reason: str = Field(..., min_length=3, max_length=500)


@router.get("/admin-users")
def get_admin_users(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("admin_users.read")),
):
    rows = db.execute(
        text("""
            SELECT
                id,
                full_name,
                email,
                phone,
                role,
                is_active,
                is_verified,
                created_at,
                updated_at
            FROM users
            WHERE role = 'ADMIN'
            ORDER BY created_at
        """)
    ).mappings().all()

    users = [dict(row) for row in rows]

    assignments = db.execute(
        text("""
            SELECT
                aur.user_id,
                ar.code AS admin_role,
                ar.name AS admin_role_name
            FROM public.admin_user_roles aur
            JOIN public.admin_roles ar
                ON ar.code = aur.role_code
            JOIN public.users u
                ON u.id = aur.user_id
            WHERE u.role = 'ADMIN'
        """)
    ).mappings().all()

    assignments_by_user = {
        row["user_id"]: row
        for row in assignments
    }

    for user in users:
        assignment = assignments_by_user.get(user["id"])
        user["admin_role"] = (
            assignment["admin_role"] if assignment else None
        )
        user["admin_role_name"] = (
            assignment["admin_role_name"] if assignment else None
        )


    return {
        "status": "success",
        "summary": {
            "total": len(users),
            "active": sum(1 for u in users if u["is_active"]),
            "inactive": sum(1 for u in users if not u["is_active"]),
        },
        "users": users,
        "admin": {
            "user_id": admin.get("sub"),
            "role": admin.get("role"),
        },
    }


@router.post(
    "/admin-users",
    status_code=status.HTTP_201_CREATED,
)
def create_admin_user(
    payload: AdminUserCreate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("admin_users.create")),
):
    require_locked_super_admin(db, admin, "admin_users.create")

    name = payload.full_name.strip()
    email = payload.email.strip().lower()
    phone = payload.phone.strip()

    if not name or "@" not in email or not phone.isdigit():
        raise HTTPException(
            status_code=422,
            detail="Invalid administrator details",
        )

    existing = db.execute(
        text("""
            SELECT id
            FROM users
            WHERE LOWER(email) = :email
               OR phone = :phone
        """),
        {"email": email, "phone": phone},
    ).first()

    if existing:
        raise HTTPException(
            status_code=409,
            detail="Email or phone already registered",
        )

    password_hash = hash_password(payload.password)

    try:
        row = db.execute(
            text("""
                INSERT INTO users (
                    full_name,
                    email,
                    phone,
                    password_hash,
                    role,
                    is_active,
                    is_verified
                )
                VALUES (
                    :name,
                    :email,
                    :phone,
                    :password_hash,
                    'ADMIN',
                    TRUE,
                    TRUE
                )
                RETURNING
                    id,
                    full_name,
                    email,
                    phone,
                    role,
                    is_active,
                    is_verified,
                    created_at,
                    updated_at
            """),
            {
                "name": name,
                "email": email,
                "phone": phone,
                "password_hash": password_hash,
            },
        ).mappings().one()


    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Email or phone already registered",
        )

    except Exception:
        db.rollback()
        raise

    try:
        write_admin_audit(
            db=db,
            admin=admin,
            action="ADMIN_USER_CREATED",
            target_type="USER",
            target_id=row["id"],
            before_values={},
            after_values={
                "role": row["role"],
                "is_active": row["is_active"],
                "is_verified": row["is_verified"],
            },
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "success",
        "message": "Administrator created successfully",
        "user": dict(row),
    }


@router.patch("/admin-users/{admin_user_id}/status")
def update_admin_user_status(
    admin_user_id: UUID,
    payload: AdminUserStatusUpdate,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("admin_users.status.write")),
):
    require_locked_super_admin(db, admin, "admin_users.status.write")

    current_admin_id = str(admin.get("sub"))

    # Prevent an administrator disabling their own account.
    if (
        str(admin_user_id) == current_admin_id
        and payload.is_active is False
    ):
        raise HTTPException(
            status_code=403,
            detail="You cannot disable your own administrator account",
        )

    # Lock the administrator rows to serialize status changes.
    rows = db.execute(
        text("""
            SELECT
                id,
                is_active,
                EXISTS (
                    SELECT 1
                    FROM public.admin_user_roles aur
                    WHERE aur.user_id = users.id
                      AND aur.role_code = 'SUPER_ADMIN'
                ) AS is_super_admin
            FROM users
            WHERE role = 'ADMIN'
            ORDER BY id
            FOR UPDATE
        """)
    ).mappings().all()

    target = next(
        (row for row in rows if row["id"] == admin_user_id),
        None,
    )

    if target is None:
        raise HTTPException(
            status_code=404,
            detail="Administrator not found",
        )

    active_count = sum(
        1 for row in rows if row["is_active"] and row["is_super_admin"]
    )

    if (
        not payload.is_active
        and target["is_active"]
        and target["is_super_admin"]
        and active_count <= 1
    ):
        raise HTTPException(
            status_code=409,
            detail="Cannot disable the last active Super Admin",
        )

    updated = db.execute(
        text("""
            UPDATE users
            SET
                is_active = :is_active,
                updated_at = NOW()
            WHERE id = :user_id
              AND role = 'ADMIN'
            RETURNING
                id,
                full_name,
                email,
                phone,
                role,
                is_active,
                is_verified,
                created_at,
                updated_at
        """),
        {
            "is_active": payload.is_active,
            "user_id": admin_user_id,
        },
    ).mappings().one()

    try:
        write_admin_audit(
            db=db,
            admin=admin,
            action="ADMIN_USER_STATUS_CHANGED",
            target_type="USER",
            target_id=admin_user_id,
            before_values={"is_active": target["is_active"]},
            after_values={"is_active": updated["is_active"]},
            reason=payload.reason,
        )
        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "success",
        "message": "Administrator status updated",
        "user": dict(updated),
    }

from fastapi import Query as CustomerQuery, Response as CustomerResponse


@router.get("/customers")
def list_admin_customers(
    response: CustomerResponse,
    page: int = CustomerQuery(default=1, ge=1, le=10000),
    page_size: int = CustomerQuery(default=25, ge=1, le=100),
    search: str = CustomerQuery(default="", max_length=150),
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("customers.read")),
):
    parameters = {
        "search": search.strip().lower(),
        "limit": page_size + 1,
        "offset": (page - 1) * page_size,
    }

    rows = db.execute(
        text("""
            SELECT c.id AS customer_id, u.full_name, u.phone, u.email,
                   u.is_active, u.created_at AS registered_at,
                   u.phone_verified_at IS NOT NULL AS phone_verified,
                   c.city, c.state,
                   (
                       SELECT count(*) FROM public.service_requests sr
                       WHERE sr.customer_id = c.id
                   ) AS request_count,
                   (
                       SELECT count(*) FROM public.jobs j
                       WHERE j.customer_id = c.id
                   ) AS job_count,
                   (
                       SELECT count(*) FROM public.jobs j
                       WHERE j.customer_id = c.id AND j.status = 'COMPLETED'
                   ) AS completed_job_count
            FROM public.customers c
            JOIN public.users u ON u.id = c.user_id
            WHERE u.role = 'CUSTOMER'
              AND (
                  :search = ''
                  OR strpos(
                      lower(concat_ws(' ', u.full_name, u.phone, u.email)),
                      :search
                  ) > 0
              )
            ORDER BY u.created_at DESC, c.id DESC
            LIMIT :limit OFFSET :offset
        """),
        parameters,
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "success",
        "customers": [dict(row) for row in rows[:page_size]],
        "pagination": {
            "page": page,
            "page_size": page_size,
            "has_more": len(rows) > page_size,
        },
    }


from typing import Literal as OnboardingLiteral
from fastapi import Query as OnboardingQuery, Response as OnboardingResponse
from pydantic import (
    ConfigDict as OnboardingConfigDict,
    StrictBool as OnboardingStrictBool,
    StrictInt as OnboardingStrictInt,
    StrictStr as OnboardingStrictStr,
    field_validator as onboarding_validator,
)
from app.core.notifications import create_notification as onboarding_notification


class TechnicianApplicationReview(BaseModel):
    model_config = OnboardingConfigDict(extra="forbid")
    action: OnboardingLiteral[
        "VERIFY_PHONE", "VERIFY_ADDRESS", "START_REVIEW",
        "APPROVE", "REJECT", "REQUEST_CORRECTIONS",
    ]
    expected_version: OnboardingStrictInt = Field(ge=1)
    reason: OnboardingStrictStr = Field(min_length=3, max_length=1000)
    confirm_check: OnboardingStrictBool = False

    @onboarding_validator("reason")
    @classmethod
    def clean_reason(cls, value):
        value = value.strip()
        if len(value) < 3:
            raise ValueError("Provide meaningful review remarks")
        return value


def onboarding_snapshot(row):
    return {
        "status": row["status"],
        "version": row["version"],
        "phone_verified": row["phone_verified_at"] is not None,
        "address_verified": row["address_verified"] is True,
        "is_verified": row["is_verified"] is True,
    }


@router.get("/technician-applications")
def list_technician_applications(
    response: OnboardingResponse,
    page: int = OnboardingQuery(default=1, ge=1, le=10000),
    page_size: int = OnboardingQuery(default=25, ge=1, le=100),
    search: str = OnboardingQuery(default="", max_length=150),
    application_status: OnboardingLiteral[
        "SUBMITTED", "UNDER_REVIEW", "APPROVED",
        "REJECTED", "RESUBMISSION_REQUIRED",
    ] | None = None,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("technician_applications.read")),
):
    rows = db.execute(
        text("""
            SELECT a.id, a.technician_id, a.status, a.version,
                   a.city, a.work_area, a.created_at,
                   u.full_name, u.phone, u.email, u.is_active,
                   u.phone_verified_at IS NOT NULL AS phone_verified,
                   t.kyc_status, k.address_verified
            FROM public.technician_applications a
            JOIN public.technicians t ON t.id = a.technician_id
            JOIN public.users u ON u.id = t.user_id
            LEFT JOIN public.technician_kyc k ON k.technician_id = t.id
            WHERE (
                CAST(:application_status AS text) IS NULL
                OR a.status = :application_status
            )
              AND (
                  :search = ''
                  OR strpos(
                      lower(concat_ws(' ', u.full_name, u.phone, u.email)),
                      :search
                  ) > 0
              )
            ORDER BY a.created_at DESC, a.id DESC
            LIMIT :limit OFFSET :offset
        """),
        {
            "application_status": application_status,
            "search": search.strip().lower(),
            "limit": page_size + 1,
            "offset": (page - 1) * page_size,
        },
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "success",
        "applications": [dict(row) for row in rows[:page_size]],
        "pagination": {
            "page": page, "page_size": page_size,
            "has_more": len(rows) > page_size,
        },
    }


@router.get("/technician-applications/{application_id}")
def get_technician_application(
    application_id: UUID,
    response: OnboardingResponse,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("technician_applications.read")),
):
    row = db.execute(
        text("""
            SELECT a.id, a.technician_id, a.status, a.version,
                   a.date_of_birth, a.gender, a.address_line1, a.address_line2,
                   a.city, a.state, a.pincode, a.work_area,
                   a.review_reason, a.created_at, a.updated_at,
                   u.full_name, u.phone, u.email, u.is_active, u.is_verified,
                   u.phone_verified_at IS NOT NULL AS phone_verified,
                   t.experience_years, t.service_radius_km, t.kyc_status,
                   k.verification_status AS detailed_kyc_status,
                   k.address_verified
            FROM public.technician_applications a
            JOIN public.technicians t ON t.id = a.technician_id
            JOIN public.users u ON u.id = t.user_id
            LEFT JOIN public.technician_kyc k ON k.technician_id = t.id
            WHERE a.id = :id
        """),
        {"id": application_id},
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Application not found")

    services = db.execute(
        text("""
            SELECT s.id, s.name, c.name AS category,
                   s.is_active, c.is_active AS category_active
            FROM public.technician_application_services tas
            JOIN public.services s ON s.id = tas.service_id
            JOIN public.service_categories c ON c.id = s.category_id
            WHERE tas.application_id = :id
            ORDER BY c.name, s.name
        """),
        {"id": application_id},
    ).mappings().all()

    skills = db.execute(
        text("""
            SELECT s.id, s.name, s.is_active
            FROM public.technician_skills ts
            JOIN public.skills s ON s.id = ts.skill_id
            WHERE ts.technician_id = :id ORDER BY s.name
        """),
        {"id": row["technician_id"]},
    ).mappings().all()

    tools = db.execute(
        text("""
            SELECT t.id, t.name, t.is_active
            FROM public.technician_tools tt
            JOIN public.tools t ON t.id = tt.tool_id
            WHERE tt.technician_id = :id ORDER BY t.name
        """),
        {"id": row["technician_id"]},
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "success",
        "application": dict(row),
        "services": [dict(item) for item in services],
        "skills": [dict(item) for item in skills],
        "tools": [dict(item) for item in tools],
    }


@router.put("/technician-applications/{application_id}/review")
def review_technician_application(
    application_id: UUID,
    payload: TechnicianApplicationReview,
    response: OnboardingResponse,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("technician_applications.review")),
):
    try:
        require_locked_super_admin(
            db, admin, "technician_applications.review",
        )
        if payload.action == "VERIFY_ADDRESS":
            require_locked_super_admin(db, admin, "kyc.write")

        reference = db.execute(
            text("""
                SELECT a.technician_id, t.user_id
                FROM public.technician_applications a
                JOIN public.technicians t ON t.id = a.technician_id
                WHERE a.id = :id
            """),
            {"id": application_id},
        ).mappings().first()
        if reference is None:
            raise HTTPException(status_code=404, detail="Application not found")

        user = db.execute(
            text("""
                SELECT id, is_active, is_verified, phone_verified_at
                FROM public.users WHERE id = :id AND role = 'TECHNICIAN'
                FOR UPDATE
            """),
            {"id": reference["user_id"]},
        ).mappings().first()

        technician = db.execute(
            text("""
                SELECT id, kyc_status FROM public.technicians
                WHERE id = :id FOR UPDATE
            """),
            {"id": reference["technician_id"]},
        ).mappings().first()

        kyc = db.execute(
            text("""
                SELECT verification_status, address_verified
                FROM public.technician_kyc
                WHERE technician_id = :id FOR UPDATE
            """),
            {"id": reference["technician_id"]},
        ).mappings().first()

        application = db.execute(
            text("""
                SELECT id, status, version
                FROM public.technician_applications
                WHERE id = :id FOR UPDATE
            """),
            {"id": application_id},
        ).mappings().first()

        if user is None or technician is None or kyc is None:
            raise HTTPException(status_code=409, detail="Technician or KYC record is incomplete")
        if not user["is_active"]:
            raise HTTPException(status_code=409, detail="The technician account is inactive")
        if application["version"] != payload.expected_version:
            raise HTTPException(status_code=409, detail="Application changed. Refresh before reviewing.")

        before = onboarding_snapshot({
            **dict(application), **dict(user), **dict(kyc),
        })
        after = dict(before)
        action = payload.action

        if action in {"VERIFY_PHONE", "VERIFY_ADDRESS"}:
            if not payload.confirm_check:
                raise HTTPException(
                    status_code=422,
                    detail="Confirm that you personally completed this verification",
                )
            if before["status"] not in {
                "SUBMITTED", "UNDER_REVIEW", "RESUBMISSION_REQUIRED",
            }:
                raise HTTPException(status_code=409, detail="This application cannot be verified")

            field = "phone_verified" if action == "VERIFY_PHONE" else "address_verified"
            if before[field]:
                db.rollback()
                response.headers["Cache-Control"] = "no-store"
                return {"status": "success", "changed": False, "message": "Already verified"}

            after[field] = True
            audit_action = (
                "TECHNICIAN_PHONE_VERIFIED"
                if action == "VERIFY_PHONE"
                else "TECHNICIAN_ADDRESS_VERIFIED"
            )
        else:
            requested_status = {
                "START_REVIEW": "UNDER_REVIEW",
                "APPROVE": "APPROVED",
                "REJECT": "REJECTED",
                "REQUEST_CORRECTIONS": "RESUBMISSION_REQUIRED",
            }[action]
            if before["status"] == requested_status:
                db.rollback()
                response.headers["Cache-Control"] = "no-store"
                return {"status": "success", "changed": False, "message": "Status is unchanged"}

            transitions = {
                "SUBMITTED": {"UNDER_REVIEW", "REJECTED", "RESUBMISSION_REQUIRED"},
                "UNDER_REVIEW": {"APPROVED", "REJECTED", "RESUBMISSION_REQUIRED"},
                "RESUBMISSION_REQUIRED": {"UNDER_REVIEW", "REJECTED"},
            }
            if requested_status not in transitions.get(before["status"], set()):
                raise HTTPException(status_code=409, detail="Start review before approving onboarding")

            if requested_status == "APPROVED":
                if not (
                    before["phone_verified"] and before["address_verified"]
                    and technician["kyc_status"] == "APPROVED"
                    and kyc["verification_status"] == "APPROVED"
                ):
                    raise HTTPException(
                        status_code=409,
                        detail="Phone verification, address verification and approved KYC are required",
                    )

                compatible = db.execute(
                    text("""
                        SELECT EXISTS (
                            SELECT 1
                            FROM public.technician_application_services tas
                            JOIN public.services s ON s.id = tas.service_id
                            JOIN public.service_categories c ON c.id = s.category_id
                            WHERE tas.application_id = :application_id
                              AND s.is_active = TRUE AND c.is_active = TRUE
                              AND EXISTS (
                                  SELECT 1 FROM public.service_skills ss
                                  JOIN public.technician_skills ts
                                    ON ts.skill_id = ss.skill_id
                                  JOIN public.skills sk ON sk.id = ts.skill_id
                                  WHERE ss.service_id = s.id
                                    AND ss.is_required = TRUE
                                    AND ts.technician_id = :technician_id
                                    AND sk.is_active = TRUE
                              )
                              AND NOT EXISTS (
                                  SELECT 1 FROM public.service_tools st
                                  WHERE st.service_id = s.id AND st.is_required = TRUE
                                    AND NOT EXISTS (
                                        SELECT 1 FROM public.technician_tools tt
                                        JOIN public.tools tl ON tl.id = tt.tool_id
                                        WHERE tt.technician_id = :technician_id
                                          AND tt.tool_id = st.tool_id
                                          AND tl.is_active = TRUE
                                    )
                              )
                        )
                    """),
                    {
                        "application_id": application_id,
                        "technician_id": reference["technician_id"],
                    },
                ).scalar_one()
                if not compatible:
                    raise HTTPException(
                        status_code=409,
                        detail="At least one selected service must have valid matching skills and tools",
                    )

            after["status"] = requested_status
            after["is_verified"] = requested_status == "APPROVED"
            audit_action = "TECHNICIAN_APPLICATION_STATUS_CHANGED"

        after["version"] += 1

        if action == "VERIFY_PHONE":
            db.execute(
                text("""
                    UPDATE public.users
                    SET phone_verified_at = clock_timestamp(),
                        phone_verified_by = CAST(:admin_id AS uuid),
                        updated_at = clock_timestamp()
                    WHERE id = :id
                """),
                {"id": reference["user_id"], "admin_id": admin["sub"]},
            )
        elif action == "VERIFY_ADDRESS":
            db.execute(
                text("""
                    UPDATE public.technician_kyc
                    SET address_verified = TRUE, updated_at = clock_timestamp()
                    WHERE technician_id = :id
                """),
                {"id": reference["technician_id"]},
            )
        else:
            db.execute(
                text("""
                    UPDATE public.users
                    SET is_verified = :verified, updated_at = clock_timestamp()
                    WHERE id = :id
                """),
                {"id": reference["user_id"], "verified": after["is_verified"]},
            )
            db.execute(
                text("""
                    UPDATE public.technicians
                    SET availability_status = 'OFFLINE', updated_at = clock_timestamp()
                    WHERE id = :id
                """),
                {"id": reference["technician_id"]},
            )

        db.execute(
            text("""
                UPDATE public.technician_applications
                SET version = :version, updated_at = clock_timestamp()
                WHERE id = :id
            """),
            {"id": application_id, "version": after["version"]},
        )
        if action not in {"VERIFY_PHONE", "VERIFY_ADDRESS"}:
            db.execute(
                text("""
                    UPDATE public.technician_applications
                    SET status = :status, review_reason = :reason,
                        reviewed_by = CAST(:admin_id AS uuid),
                        reviewed_at = clock_timestamp()
                    WHERE id = :id
                """),
                {
                    "id": application_id,
                    "status": after["status"],
                    "reason": payload.reason,
                    "admin_id": admin["sub"],
                },
            )

        write_admin_audit(
            db=db, admin=admin, action=audit_action,
            target_type="TECHNICIAN_APPLICATION",
            target_id=application_id,
            before_values=before, after_values=after,
            reason=payload.reason,
        )

        onboarding_notification(
            db=db,
            user_id=str(reference["user_id"]),
            title="Technician Application Updated",
            message=(
                "Your onboarding application has been approved. "
                "Refresh your application status to open your dashboard."
                if action == "APPROVE" else
                "Your onboarding checks were updated. Refresh your application status."
            ),
            notification_type="TECHNICIAN_APPLICATION_UPDATED",
            reference_id=str(application_id),
        )

        db.commit()
        response.headers["Cache-Control"] = "no-store"
        return {
            "status": "success",
            "changed": True,
            "message": (
                "Onboarding approved. Technician can open the dashboard and go online after updating GPS."
                if action == "APPROVE" else "Application review updated."
            ),
            "application_status": after["status"],
            "version": after["version"],
        }
    except Exception:
        db.rollback()
        raise
