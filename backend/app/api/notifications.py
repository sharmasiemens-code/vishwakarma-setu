from fastapi import APIRouter, Depends, HTTPException
from uuid import UUID
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.core.security import get_current_user


router = APIRouter(
    prefix="/notifications",
    tags=["Notifications"],
)


@router.get("")
def get_notifications(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication",
        )

    query = text("""
        SELECT
            id,
            title,
            message,
            notification_type,
            reference_id,
            is_read,
            created_at
        FROM notifications
        WHERE user_id = :user_id
        ORDER BY created_at DESC
    """)

    results = db.execute(
        query,
        {"user_id": user_id},
    ).mappings().all()

    return {
        "status": "success",
        "total": len(results),
        "notifications": [dict(row) for row in results],
    }


@router.get("/unread-count")
def get_unread_count(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication",
        )

    query = text("""
        SELECT COUNT(*) AS unread_count
        FROM notifications
        WHERE
            user_id = :user_id
            AND is_read = FALSE
    """)

    result = db.execute(
        query,
        {"user_id": user_id},
    ).scalar()

    return {
        "status": "success",
        "unread_count": result,
    }


@router.post("/{notification_id}/read")
def mark_notification_read(
    notification_id: UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication",
        )

    query = text("""
        UPDATE notifications
        SET is_read = TRUE
        WHERE
            id = :notification_id
            AND user_id = :user_id
        RETURNING
            id,
            title,
            message,
            notification_type,
            reference_id,
            is_read,
            created_at
    """)

    result = db.execute(
        query,
        {
            "notification_id": notification_id,
            "user_id": user_id,
        },
    ).mappings().first()

    if not result:
        raise HTTPException(
            status_code=404,
            detail="Notification not found",
        )

    db.commit()

    return {
        "status": "success",
        "message": "Notification marked as read",
        "notification": dict(result),
    }


@router.post("/read-all")
def mark_all_notifications_read(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user.get("sub")

    if not user_id:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication",
        )

    query = text("""
        UPDATE notifications
        SET is_read = TRUE
        WHERE
            user_id = :user_id
            AND is_read = FALSE
    """)

    result = db.execute(
        query,
        {"user_id": user_id},
    )

    db.commit()

    return {
        "status": "success",
        "message": "All notifications marked as read",
        "updated_count": result.rowcount,
    }
