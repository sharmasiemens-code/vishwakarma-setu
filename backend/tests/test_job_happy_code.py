from uuid import uuid4

import pytest

from app.core.job_happy_code import (
    create_happy_code_verifier,
    generate_happy_code,
    get_happy_code_secret,
    matches_happy_code,
    validate_happy_code,
)
from app.core.job_start_pin import create_start_pin_verifier


@pytest.fixture(autouse=True)
def isolated_secrets(monkeypatch):
    secret = "test-only-code-helper-secret-12345678901234567890"
    monkeypatch.setenv("HAPPY_CODE_HMAC_SECRET", secret)
    monkeypatch.setenv("START_PIN_HMAC_SECRET", secret)


def test_generated_code_format():
    for _ in range(100):
        assert validate_happy_code(generate_happy_code())


def test_leading_zero_preserved():
    assert validate_happy_code("0007") == "0007"


@pytest.mark.parametrize("value", [
    None, 1234, True, "123", "12345", " 1234", "1234 ",
    "12a4", "\u0661\u0662\u0663\u0664", "1234\n",
])
def test_invalid_code_rejected(value):
    with pytest.raises(ValueError):
        validate_happy_code(value)


def test_matching_and_binding():
    job_id, nonce = uuid4(), uuid4()
    verifier = create_happy_code_verifier(job_id, 1, nonce, "0007")
    assert len(verifier) == 64
    assert matches_happy_code(job_id, 1, nonce, "0007", verifier)
    assert not matches_happy_code(job_id, 1, nonce, "0008", verifier)
    assert not matches_happy_code(uuid4(), 1, nonce, "0007", verifier)
    assert not matches_happy_code(job_id, 2, nonce, "0007", verifier)
    assert not matches_happy_code(job_id, 1, uuid4(), "0007", verifier)


def test_start_pin_verifier_cannot_be_reused():
    job_id, nonce = uuid4(), uuid4()
    start_verifier = create_start_pin_verifier(job_id, 1, nonce, "1234")
    assert not matches_happy_code(
        job_id, 1, nonce, "1234", start_verifier,
    )


@pytest.mark.parametrize("generation", [0, -1, True, "1", 1.0])
def test_invalid_generation_rejected(generation):
    with pytest.raises(ValueError):
        create_happy_code_verifier(uuid4(), generation, uuid4(), "1234")


def test_dedicated_secret_required(monkeypatch):
    monkeypatch.delenv("HAPPY_CODE_HMAC_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        get_happy_code_secret()

    monkeypatch.setenv("HAPPY_CODE_HMAC_SECRET", "too-short")
    with pytest.raises(RuntimeError):
        get_happy_code_secret()
