from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import require_admin
from app.db.database import get_db


def get_admin_access(
    current_admin: dict = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict:
    """
    Resolve current administrative access from the database.

    Existing JWT authentication remains handled by require_admin.
    Administrative roles and permissions are never trusted from
    frontend input or JWT permission claims.
    """
    assignment = db.execute(
        text("""
            SELECT
                ar.code AS admin_role,
                ar.name AS admin_role_name
            FROM public.users u
            JOIN public.admin_user_roles aur
                ON aur.user_id = u.id
            JOIN public.admin_roles ar
                ON ar.code = aur.role_code
            WHERE u.id = :user_id
              AND u.role = 'ADMIN'
              AND u.is_active = TRUE
        """),
        {"user_id": current_admin["sub"]},
    ).mappings().first()

    if assignment is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="No administrative role is assigned to this account",
        )

    permissions = db.execute(
        text("""
            SELECT permission_code
            FROM public.admin_role_permissions
            WHERE role_code = :role_code
            ORDER BY permission_code
        """),
        {"role_code": assignment["admin_role"]},
    ).scalars().all()

    return {
        **current_admin,
        "admin_role": assignment["admin_role"],
        "admin_role_name": assignment["admin_role_name"],
        "permissions": list(permissions),
    }


def require_permission(permission_code: str):
    """
    Build a FastAPI dependency for one explicit permission.

    Missing permissions are denied, including for Super Admin.
    Super Admin grants are maintained through database migrations.
    """
    if not isinstance(permission_code, str) or not permission_code.strip():
        raise ValueError("A permission code is required")

    def check_permission(
        admin_access: dict = Depends(get_admin_access),
    ) -> dict:
        if permission_code not in admin_access["permissions"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have permission to perform this action",
            )

        return admin_access

    return check_permission


def require_locked_super_admin(
    db: Session,
    admin: dict,
    permission_code: str,
) -> None:
    """
    Serialize administrator mutations with role/status changes
    and recheck the actor's current privileges.

    Caller must commit or roll back the transaction afterward.
    """
    db.execute(
        text("""
            SELECT id
            FROM public.users
            WHERE role = 'ADMIN'
            ORDER BY id
            FOR UPDATE
        """)
    ).all()

    allowed = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.users u
                JOIN public.admin_user_roles aur
                    ON aur.user_id = u.id
                JOIN public.admin_role_permissions arp
                    ON arp.role_code = aur.role_code
                WHERE u.id = :user_id
                  AND u.role = 'ADMIN'
                  AND u.is_active = TRUE
                  AND aur.role_code = 'SUPER_ADMIN'
                  AND arp.permission_code = :permission_code
            )
        """),
        {
            "user_id": admin["sub"],
            "permission_code": permission_code,
        },
    ).scalar_one()

    if not allowed:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Active Super Admin permission required",
        )
