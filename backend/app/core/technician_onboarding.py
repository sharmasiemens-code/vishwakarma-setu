from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session


def require_technician_work_approval(
    db: Session,
    current_user: dict,
) -> None:
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Technician access required")

    row = db.execute(
        text("""
            SELECT t.id
            FROM public.technicians t
            JOIN public.users u ON u.id = t.user_id
            JOIN public.technician_kyc k ON k.technician_id = t.id
            LEFT JOIN public.technician_applications a
                ON a.technician_id = t.id
            WHERE t.id = CAST(:technician_id AS uuid)
              AND u.id = CAST(:actor_id AS uuid)
              AND u.role = 'TECHNICIAN'
              AND u.is_active = TRUE
              AND u.is_verified = TRUE
              AND t.kyc_status = 'APPROVED'
              AND k.verification_status = 'APPROVED'
              AND k.address_verified = TRUE
              AND (
                  a.id IS NULL
                  OR (
                      a.status = 'APPROVED'
                      AND u.phone_verified_at IS NOT NULL
                  )
              )
        """),
        {
            "technician_id": current_user.get("technician_id"),
            "actor_id": current_user["sub"],
        },
    ).first()

    if row is None:
        raise HTTPException(
            status_code=403,
            detail="Technician approval and verified KYC are required to go online",
        )
