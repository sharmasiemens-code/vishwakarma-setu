import hashlib
import hmac
import os
import re
import secrets
from uuid import UUID


PIN_PATTERN = re.compile(r"[0-9]{4}")


def get_start_pin_secret() -> bytes:
    """
    Use a dedicated secret, separate from JWT authentication.
    Never include its value in errors or logs.
    """
    value = os.getenv("START_PIN_HMAC_SECRET")
    if value is None or len(value.encode("utf-8")) < 32:
        raise RuntimeError("START_PIN_HMAC_SECRET must contain at least 32 bytes")
    return value.encode("utf-8")


def validate_start_pin(pin: str) -> str:
    if not isinstance(pin, str) or PIN_PATTERN.fullmatch(pin) is None:
        raise ValueError("Start PIN must contain exactly four ASCII digits")
    return pin


def generate_start_pin() -> str:
    return f"{secrets.randbelow(10000):04d}"


def create_start_pin_verifier(
    job_id: UUID | str,
    generation: int,
    nonce: UUID | str,
    pin: str,
) -> str:
    validate_start_pin(pin)

    if type(generation) is not int or generation < 1:
        raise ValueError("Invalid Start PIN generation")

    message = (
        f"vishwakarma-setu:start-pin:v1:"
        f"{UUID(str(job_id))}:{generation}:{UUID(str(nonce))}:{pin}"
    ).encode("ascii")

    return hmac.new(
        get_start_pin_secret(),
        message,
        hashlib.sha256,
    ).hexdigest()


def matches_start_pin(
    job_id: UUID | str,
    generation: int,
    nonce: UUID | str,
    pin: str,
    stored_verifier: str,
) -> bool:
    candidate = create_start_pin_verifier(job_id, generation, nonce, pin)
    return hmac.compare_digest(candidate, stored_verifier)
