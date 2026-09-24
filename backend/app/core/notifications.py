from sqlalchemy import text
from sqlalchemy.orm import Session


def create_notification(
    db: Session,
    user_id: str,
    title: str,
    message: str,
    notification_type: str | None = None,
    reference_id: str | None = None,
):
    query = text("""
        INSERT INTO notifications (
            user_id,
            title,
            message,
            notification_type,
            reference_id
        )
        VALUES (
            :user_id,
            :title,
            :message,
            :notification_type,
            :reference_id
        )
        RETURNING
            id,
            user_id,
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
            "user_id": user_id,
            "title": title,
            "message": message,
            "notification_type": notification_type,
            "reference_id": reference_id,
        },
    )

    return result.mappings().first()
