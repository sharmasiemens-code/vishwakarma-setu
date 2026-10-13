from sqlalchemy import text
from sqlalchemy.orm import Session


SETTING_DEFINITIONS = {
    "gps_timeout_minutes": {
        "name": "GPS timeout",
        "unit": "minutes",
        "default": 10,
        "minimum": 5,
        "maximum": 60,
        "description": (
            "Set an ONLINE technician OFFLINE after stale GPS, "
            "only when there is no active job."
        ),
    },
    "unmatched_request_minutes": {
        "name": "Unmatched request warning",
        "unit": "minutes",
        "default": 30,
        "minimum": 5,
        "maximum": 1440,
        "description": (
            "Show a warning for an OPEN request with no job "
            "after this period."
        ),
    },
    "stuck_active_job_hours": {
        "name": "Stuck active job warning",
        "unit": "hours",
        "default": 2,
        "minimum": 1,
        "maximum": 168,
        "description": (
            "Show an exception when an active job has had "
            "no update for this period."
        ),
    },
}


def validate_setting_value(key: str, value: int) -> int:
    definition = SETTING_DEFINITIONS.get(key)
    if definition is None:
        raise ValueError("Unknown system setting")

    # Reject booleans, floats and strings rather than coercing them.
    if type(value) is not int:
        raise ValueError("Setting value must be an integer")

    if not definition["minimum"] <= value <= definition["maximum"]:
        raise ValueError(
            f"Setting value must be between "
            f"{definition['minimum']} and {definition['maximum']}"
        )

    return value


def get_system_settings(db: Session) -> dict[str, int]:
    """
    Read the three operational settings in one query.

    No cache: committed changes are visible to subsequent reads.
    Missing or invalid configuration raises an error.
    This helper never commits or rolls back.
    """
    rows = db.execute(
        text("""
            SELECT key, value
            FROM public.system_settings
            ORDER BY key
        """)
    ).mappings().all()

    values = {}
    for row in rows:
        values[row["key"]] = validate_setting_value(
            row["key"], row["value"]
        )

    if set(values) != set(SETTING_DEFINITIONS):
        raise RuntimeError("Operational system settings are incomplete")

    return values
