from sqlalchemy import text

from app.db.database import SessionLocal


GPS_TIMEOUT_MINUTES = 10


def synchronize_technician_presence():
    """
    Synchronize technician availability with GPS heartbeat.

    Rule:
    - ONLINE + GPS stale > 10 minutes + no active job -> OFFLINE
    - ONLINE + GPS stale > 10 minutes + active job -> unchanged
    - Fresh GPS -> unchanged
    """

    db = SessionLocal()

    try:
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
                "timeout_minutes": GPS_TIMEOUT_MINUTES
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
