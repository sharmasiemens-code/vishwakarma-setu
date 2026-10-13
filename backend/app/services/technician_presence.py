from app.core.system_settings import get_system_settings
from sqlalchemy import text

from app.db.database import SessionLocal


def synchronize_technician_presence():
    """
    Synchronize technician availability with GPS heartbeat.

    Rule:
    - ONLINE + GPS older than the configured timeout + no active job -> OFFLINE
    - ONLINE + GPS older than the configured timeout + active job -> unchanged
    - Fresh GPS -> unchanged
    """

    db = SessionLocal()

    try:
        settings = get_system_settings(db)
        result = db.execute(
            text("""
                UPDATE technicians t
                SET
                    availability_status = 'OFFLINE',
                    updated_at = now()
                WHERE
                    t.availability_status = 'ONLINE'
                    AND NOT EXISTS (
                        SELECT 1
                        FROM technician_locations tl
                        WHERE
                            tl.technician_id = t.id
                            AND tl.last_seen_at >= now() - (
                                :timeout_minutes * INTERVAL '1 minute'
                            )
                    )
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
                RETURNING t.id
            """),
            {
                "timeout_minutes": settings["gps_timeout_minutes"]
            }
        )

        changed_ids = [row[0] for row in result.fetchall()]

        db.commit()

        return {
            "checked": True,
            "offline_count": len(changed_ids),
            "technician_ids": changed_ids,
        }

    except Exception:
        db.rollback()
        raise

    finally:
        db.close()
