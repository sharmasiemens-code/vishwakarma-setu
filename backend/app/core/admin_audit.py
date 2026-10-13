import json
from uuid import UUID

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.system_settings import validate_setting_value


ADMIN_ROLES = {
    "SUPER_ADMIN",
    "OPERATIONS_ADMIN",
    "KYC_VERIFIER",
    "SUPPORT_ADMIN",
    "FINANCE_ADMIN",
}

EVENT_RULES = {
    "USER_PASSWORD_RESET": {
        "target_type": "USER",
        "fields": {"password_version": int},
    },
    "TECHNICIAN_PHONE_VERIFIED": {
        "target_type": "TECHNICIAN_APPLICATION",
        "fields": {
            "status": str,
            "version": int,
            "phone_verified": bool,
            "address_verified": bool,
            "is_verified": bool,
        },
    },
    "TECHNICIAN_ADDRESS_VERIFIED": {
        "target_type": "TECHNICIAN_APPLICATION",
        "fields": {
            "status": str,
            "version": int,
            "phone_verified": bool,
            "address_verified": bool,
            "is_verified": bool,
        },
    },
    "TECHNICIAN_APPLICATION_STATUS_CHANGED": {
        "target_type": "TECHNICIAN_APPLICATION",
        "fields": {
            "status": str,
            "version": int,
            "phone_verified": bool,
            "address_verified": bool,
            "is_verified": bool,
        },
    },
    "JOB_DISPUTE_REVIEW_STARTED": {
        "target_type": "JOB_DISPUTE",
        "fields": {"status": str, "version": int, "resolution_code": str},
    },
    "JOB_DISPUTE_RESOLVED": {
        "target_type": "JOB_DISPUTE",
        "fields": {"status": str, "version": int, "resolution_code": str},
    },
    "SYSTEM_SETTING_CHANGED": {
        "target_type": "SYSTEM_SETTING",
        "fields": {"key": str, "value": int, "version": int},
    },
    "ADMIN_ROLE_ASSIGNED": {
        "target_type": "USER",
        "fields": {"role_code": str},
    },
    "ADMIN_USER_CREATED": {
        "target_type": "USER",
        "fields": {
            "role": str,
            "is_active": bool,
            "is_verified": bool,
        },
    },
    "ADMIN_USER_STATUS_CHANGED": {
        "target_type": "USER",
        "fields": {"is_active": bool},
    },
    "TECHNICIAN_ACCOUNT_STATUS_CHANGED": {
        "target_type": "TECHNICIAN",
        "fields": {
            "is_active": bool,
            "availability_status": str,
        },
    },
    "TECHNICIAN_KYC_STATUS_CHANGED": {
        "target_type": "TECHNICIAN_KYC",
        "fields": {
            "verification_status": str,
            "kyc_status": str,
        },
    },
}


def validate_snapshot(values: dict, fields: dict) -> dict:
    if not isinstance(values, dict):
        raise ValueError("Audit snapshots must be dictionaries")

    if set(values) - set(fields):
        raise ValueError("Audit snapshot contains an unapproved field")

    validated = {}

    for key, value in values.items():
        expected_type = fields[key]

        if value is not None and type(value) is not expected_type:
            raise ValueError("Audit snapshot contains an invalid value type")

        if isinstance(value, str) and len(value) > 100:
            raise ValueError("Audit snapshot value is too long")

        validated[key] = value

    return validated


def write_admin_audit(
    db: Session,
    admin: dict,
    action: str,
    target_type: str,
    target_id: UUID | str,
    before_values: dict,
    after_values: dict,
    reason: str | None = None,
) -> str | None:
    """
    Insert an allowlisted audit event in the caller's transaction.

    This function never commits or rolls back.
    Do not pass complete user records, request bodies, credentials
    or KYC document data.
    """
    rules = EVENT_RULES.get(action)

    if rules is None or target_type != rules["target_type"]:
        raise ValueError("Unsupported audit action or target type")

    actor_role = admin.get("admin_role")

    if admin.get("role") != "ADMIN" or actor_role not in ADMIN_ROLES:
        raise ValueError("Validated administrative context is required")

    actor_id = UUID(str(admin["sub"]))
    target_uuid = UUID(str(target_id))

    before = validate_snapshot(before_values, rules["fields"])
    after = validate_snapshot(after_values, rules["fields"])

    if not after:
        raise ValueError("An audit event requires after values")

    if action in {"JOB_DISPUTE_REVIEW_STARTED", "JOB_DISPUTE_RESOLVED"}:
        required = {"status", "version", "resolution_code"}
        if set(before) != required or set(after) != required:
            raise ValueError("Complete dispute snapshots are required")

        for snapshot in (before, after):
            if type(snapshot["version"]) is not int or snapshot["version"] < 1:
                raise ValueError("Invalid audited dispute version")

        if after["version"] != before["version"] + 1:
            raise ValueError("Dispute version must increment by one")

        if before["resolution_code"] is not None:
            raise ValueError("Resolved disputes cannot be changed")

        if action == "JOB_DISPUTE_REVIEW_STARTED":
            if (
                before["status"] != "OPEN"
                or after["status"] != "UNDER_REVIEW"
                or after["resolution_code"] is not None
            ):
                raise ValueError("Invalid dispute review transition")
        else:
            if (
                before["status"] not in {"OPEN", "UNDER_REVIEW"}
                or after["status"] != "RESOLVED"
                or after["resolution_code"] != "RETURN_TO_WORK"
            ):
                raise ValueError("Invalid dispute resolution transition")

        if not isinstance(reason, str) or len(reason.strip()) < 3:
            raise ValueError("Dispute audit requires a meaningful reason")

    if action in {
        "TECHNICIAN_PHONE_VERIFIED",
        "TECHNICIAN_ADDRESS_VERIFIED",
        "TECHNICIAN_APPLICATION_STATUS_CHANGED",
    }:
        required = {
            "status", "version", "phone_verified",
            "address_verified", "is_verified",
        }
        if set(before) != required or set(after) != required:
            raise ValueError("Complete onboarding snapshots are required")

        valid_statuses = {
            "SUBMITTED", "UNDER_REVIEW", "APPROVED",
            "REJECTED", "RESUBMISSION_REQUIRED",
        }
        for snapshot in (before, after):
            if snapshot["status"] not in valid_statuses:
                raise ValueError("Invalid audited application status")
            if type(snapshot["version"]) is not int or snapshot["version"] < 1:
                raise ValueError("Invalid audited application version")
            for key in ("phone_verified", "address_verified", "is_verified"):
                if type(snapshot[key]) is not bool:
                    raise ValueError("Complete verification flags are required")

        if after["version"] != before["version"] + 1:
            raise ValueError("Application version must increment by one")

        if not isinstance(reason, str) or not 3 <= len(reason.strip()) <= 1000:
            raise ValueError("Onboarding action requires a meaningful reason")

        if action in {"TECHNICIAN_PHONE_VERIFIED", "TECHNICIAN_ADDRESS_VERIFIED"}:
            field = (
                "phone_verified"
                if action == "TECHNICIAN_PHONE_VERIFIED"
                else "address_verified"
            )
            if before["status"] not in {
                "SUBMITTED", "UNDER_REVIEW", "RESUBMISSION_REQUIRED",
            }:
                raise ValueError("Verification requires an application under review")
            if before[field] is not False or after[field] is not True:
                raise ValueError("Verification must change from unverified to verified")
            for key in required - {field, "version"}:
                if before[key] != after[key]:
                    raise ValueError("Verification cannot change unrelated approval fields")
        else:
            transitions = {
                "SUBMITTED": {
                    "UNDER_REVIEW", "REJECTED", "RESUBMISSION_REQUIRED",
                },
                "UNDER_REVIEW": {
                    "APPROVED", "REJECTED", "RESUBMISSION_REQUIRED",
                },
                "RESUBMISSION_REQUIRED": {
                    "UNDER_REVIEW", "REJECTED",
                },
            }
            if after["status"] not in transitions.get(before["status"], set()):
                raise ValueError("Invalid application review transition")

            for key in ("phone_verified", "address_verified"):
                if before[key] != after[key]:
                    raise ValueError("Application decisions cannot silently verify contact or address")

            if after["status"] == "APPROVED":
                if not (
                    after["phone_verified"]
                    and after["address_verified"]
                    and after["is_verified"]
                ):
                    raise ValueError("Approval requires completed verification")
            elif after["is_verified"] is not False:
                raise ValueError("An unapproved application cannot enable work access")

    if action == "SYSTEM_SETTING_CHANGED":
        required = {"key", "value", "version"}
        if set(before) != required or set(after) != required:
            raise ValueError("Complete setting snapshots are required")

        if before["key"] != after["key"]:
            raise ValueError("Audit setting keys must match")

        for snapshot in (before, after):
            validate_setting_value(snapshot["key"], snapshot["value"])
            if type(snapshot["version"]) is not int or snapshot["version"] < 1:
                raise ValueError("Invalid audited setting version")

        if before != after:
            if before["value"] == after["value"]:
                raise ValueError("Setting event requires a value change")
            if after["version"] != before["version"] + 1:
                raise ValueError("Setting version must increment by one")

    if action == "ADMIN_ROLE_ASSIGNED":
        if after.get("role_code") not in ADMIN_ROLES:
            raise ValueError("Invalid audited administrative role")

    if action == "ADMIN_USER_CREATED":
        if after.get("role") != "ADMIN":
            raise ValueError("Invalid audited account role")

    if reason is not None:
        if not isinstance(reason, str) or len(reason) > 1000:
            raise ValueError("Invalid audit reason")
        reason = reason.strip() or None

    # No event for an unchanged state.
    if before == after:
        return None

    audit_id = db.execute(
        text("""
            INSERT INTO public.admin_audit_logs (
                actor_user_id,
                actor_role_code,
                action,
                target_type,
                target_id,
                before_values,
                after_values,
                reason
            )
            VALUES (
                :actor_id,
                :actor_role,
                :action,
                :target_type,
                :target_id,
                CAST(:before_values AS jsonb),
                CAST(:after_values AS jsonb),
                :reason
            )
            RETURNING id
        """),
        {
            "actor_id": actor_id,
            "actor_role": actor_role,
            "action": action,
            "target_type": target_type,
            "target_id": target_uuid,
            "before_values": json.dumps(before),
            "after_values": json.dumps(after),
            "reason": reason,
        },
    ).scalar_one()

    return str(audit_id)