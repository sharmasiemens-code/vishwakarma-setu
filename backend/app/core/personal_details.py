"""Private optional customer details, stored as calendar dates, never instants."""
import re
from datetime import date, datetime, timedelta, timezone


def optional_email(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError("Enter a valid email address")
    value = value.strip().lower()
    if not value:
        return None
    local = value.split("@")[0]
    if (len(value) > 254 or len(local) > 64 or local.startswith(".")
            or local.endswith(".") or ".." in local
            or re.fullmatch(
                r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
                r"(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", value) is None):
        raise ValueError("Enter a valid email address")
    return value


def optional_birth_date(value):
    if value is None or value == "":
        return None
    if not isinstance(value, str) or re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value) is None:
        raise ValueError("Use a calendar date in YYYY-MM-DD format")
    parsed = date.fromisoformat(value)
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
    if parsed > today:
        raise ValueError("Date of birth cannot be in the future")
    return parsed
