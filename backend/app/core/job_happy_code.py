import hashlib
import hmac
import os
import re
import secrets
from uuid import UUID


CODE_PATTERN = re.compile(r"[0-9]{4}")


def get_happy_code_secret() -> bytes:
    value = os.getenv("HAPPY_CODE_HMAC_SECRET")
    if value is None or len(value.encode("utf-8")) < 32:
        raise RuntimeError("HAPPY_CODE_HMAC_SECRET must contain at least 32 bytes")
    return value.encode("utf-8")


def validate_happy_code(code: str) -> str:
    if not isinstance(code, str) or CODE_PATTERN.fullmatch(code) is None:
        raise ValueError("Happy Code must contain exactly four ASCII digits")
    return code


def generate_happy_code() -> str:
    return f"{secrets.randbelow(10000):04d}"


def create_happy_code_verifier(
    job_id: UUID | str,
    generation: int,
    nonce: UUID | str,
    code: str,
) -> str:
    validate_happy_code(code)

    if type(generation) is not int or generation < 1:
        raise ValueError("Invalid Happy Code generation")

    message = (
        f"vishwakarma-setu:happy-code:v1:"
        f"{UUID(str(job_id))}:{generation}:{UUID(str(nonce))}:{code}"
    ).encode("ascii")

    return hmac.new(
        get_happy_code_secret(), message, hashlib.sha256,
    ).hexdigest()


def matches_happy_code(
    job_id: UUID | str,
    generation: int,
    nonce: UUID | str,
    code: str,
    stored_verifier: str,
) -> bool:
    candidate = create_happy_code_verifier(job_id, generation, nonce, code)
    return hmac.compare_digest(candidate, stored_verifier)
