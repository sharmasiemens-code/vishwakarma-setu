from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.admin_rbac import get_admin_access, require_permission
from app.db.database import get_db
from app.core.admin_audit import write_admin_audit


router = APIRouter(
    prefix="/admin",
    tags=["Admin Access"],
)


@router.get("/access")
def get_current_admin_access(
    admin: dict = Depends(get_admin_access),
):
    """
    Return only the authenticated administrator's current access.
    A role with no permissions can still inspect its own access.
    """
    return {
        "status": "success",
        "admin": {
            "user_id": admin["sub"],
            "role": "ADMIN",
            "admin_role": admin["admin_role"],
            "admin_role_name": admin["admin_role_name"],
            "permissions": admin["permissions"],
        },
    }


@router.get("/roles")
def get_admin_roles(
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("roles.read")),
):
    """
    List administrative role definitions and explicit permissions.
    """
    rows = db.execute(
        text("""
            SELECT
                ar.code,
                ar.name,
                ar.description,
                arp.permission_code,
                ap.description AS permission_description
            FROM public.admin_roles ar
            LEFT JOIN public.admin_role_permissions arp
                ON arp.role_code = ar.code
            LEFT JOIN public.admin_permissions ap
                ON ap.code = arp.permission_code
            ORDER BY ar.code, arp.permission_code
        """)
    ).mappings().all()

    roles = {}

    for row in rows:
        role = roles.setdefault(
            row["code"],
            {
                "code": row["code"],
                "name": row["name"],
                "description": row["description"],
                "permissions": [],
            },
        )

        if row["permission_code"] is not None:
            role["permissions"].append({
                "code": row["permission_code"],
                "description": row["permission_description"],
            })

    return {
        "status": "success",
        "roles": list(roles.values()),
    }

from typing import Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel


class AdminRoleAssignment(BaseModel):
    role_code: Literal[
        "SUPER_ADMIN",
        "OPERATIONS_ADMIN",
        "KYC_VERIFIER",
        "SUPPORT_ADMIN",
        "FINANCE_ADMIN",
    ]


@router.put("/admin-users/{admin_user_id}/role")
def assign_admin_role(
    admin_user_id: UUID,
    payload: AdminRoleAssignment,
    db: Session = Depends(get_db),
    admin: dict = Depends(require_permission("roles.assign")),
):
    actor_id = UUID(admin["sub"])

    try:
        # Match the lock order used by administrator status changes.
        # Role changes and account status changes must serialize.
        users = db.execute(
            text("""
                SELECT id, is_active
                FROM public.users
                WHERE role = 'ADMIN'
                ORDER BY id
                FOR UPDATE
            """)
        ).mappings().all()

        accounts = {row["id"]: row for row in users}

        # Recheck the actor after obtaining locks. An earlier dependency
        # check alone is insufficient if another request changes access.
        actor = accounts.get(actor_id)

        if actor is None or not actor["is_active"]:
            raise HTTPException(
                status_code=403,
                detail="Active Super Admin access required",
            )

        assignments = db.execute(
            text("""
                SELECT user_id, role_code
                FROM public.admin_user_roles
                ORDER BY user_id
                FOR UPDATE
            """)
        ).mappings().all()

        roles_by_user = {
            row["user_id"]: row["role_code"]
            for row in assignments
        }

        actor_has_permission = db.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1
                    FROM public.admin_role_permissions
                    WHERE role_code = 'SUPER_ADMIN'
                      AND permission_code = 'roles.assign'
                )
            """)
        ).scalar_one()

        if (
            roles_by_user.get(actor_id) != "SUPER_ADMIN"
            or not actor_has_permission
        ):
            raise HTTPException(
                status_code=403,
                detail="Super Admin role assignment access required",
            )

        target = accounts.get(admin_user_id)

        if target is None:
            raise HTTPException(
                status_code=404,
                detail="Administrator not found",
            )

        old_role = roles_by_user.get(admin_user_id)

        if (
            admin_user_id == actor_id
            and payload.role_code != "SUPER_ADMIN"
        ):
            raise HTTPException(
                status_code=403,
                detail="You cannot demote your own Super Admin account",
            )

        active_super_admins = sum(
            1
            for user_id, account in accounts.items()
            if account["is_active"]
            and roles_by_user.get(user_id) == "SUPER_ADMIN"
        )

        if (
            old_role == "SUPER_ADMIN"
            and target["is_active"]
            and payload.role_code != "SUPER_ADMIN"
            and active_super_admins <= 1
        ):
            raise HTTPException(
                status_code=409,
                detail="Cannot demote the last active Super Admin",
            )

        role_exists = db.execute(
            text("""
                SELECT EXISTS (
                    SELECT 1
                    FROM public.admin_roles
                    WHERE code = :role_code
                )
            """),
            {"role_code": payload.role_code},
        ).scalar_one()

        if not role_exists:
            raise HTTPException(
                status_code=422,
                detail="Administrative role is not configured",
            )

        # Preserve assignment metadata when nothing changes.
        if old_role == payload.role_code:
            db.rollback()
            return {
                "status": "success",
                "message": "Administrator already has this role",
                "user_id": str(admin_user_id),
                "admin_role": old_role,
                "changed": False,
            }

        db.execute(
            text("""
                INSERT INTO public.admin_user_roles (
                    user_id,
                    role_code,
                    assigned_by
                )
                VALUES (
                    :user_id,
                    :role_code,
                    :assigned_by
                )
                ON CONFLICT (user_id)
                DO UPDATE SET
                    role_code = EXCLUDED.role_code,
                    assigned_by = EXCLUDED.assigned_by,
                    assigned_at = NOW(),
                    updated_at = NOW()
            """),
            {
                "user_id": admin_user_id,
                "role_code": payload.role_code,
                "assigned_by": actor_id,
            },
        )

        write_admin_audit(
            db=db,
            admin=admin,
            action="ADMIN_ROLE_ASSIGNED",
            target_type="USER",
            target_id=admin_user_id,
            before_values={"role_code": old_role},
            after_values={"role_code": payload.role_code},
        )

        db.commit()

        return {
            "status": "success",
            "message": "Administrator role assigned",
            "user_id": str(admin_user_id),
            "admin_role": payload.role_code,
            "changed": True,
        }

    except Exception:
        db.rollback()
        raise