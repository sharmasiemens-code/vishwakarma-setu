from uuid import uuid4

import pytest

from app.core.job_start_pin import (
    create_start_pin_verifier,
    generate_start_pin,
    get_start_pin_secret,
    matches_start_pin,
    validate_start_pin,
)


@pytest.fixture(autouse=True)
def isolated_secret(monkeypatch):
    monkeypatch.setenv(
        "START_PIN_HMAC_SECRET",
        "test-only-secret-for-start-pin-helper-123456789",
    )


def test_generated_pin_format():
    for _ in range(100):
        assert validate_start_pin(generate_start_pin())


def test_leading_zero_is_preserved():
    assert validate_start_pin("0007") == "0007"


@pytest.mark.parametrize("value", [
    None, 1234, True, "123", "12345", " 1234", "1234 ",
    "12a4", "\u0661\u0662\u0663\u0664", "1234\n",
])
def test_invalid_pin_rejected(value):
    with pytest.raises(ValueError):
        validate_start_pin(value)


def test_verifier_matches_only_correct_pin():
    job_id, nonce = uuid4(), uuid4()
    verifier = create_start_pin_verifier(job_id, 1, nonce, "0007")
    assert len(verifier) == 64
    assert matches_start_pin(job_id, 1, nonce, "0007", verifier)
    assert not matches_start_pin(job_id, 1, nonce, "0008", verifier)


def test_verifier_is_bound_to_job_generation_and_nonce():
    job_id, nonce = uuid4(), uuid4()
    verifier = create_start_pin_verifier(job_id, 1, nonce, "1234")
    assert not matches_start_pin(uuid4(), 1, nonce, "1234", verifier)
    assert not matches_start_pin(job_id, 2, nonce, "1234", verifier)
    assert not matches_start_pin(job_id, 1, uuid4(), "1234", verifier)


@pytest.mark.parametrize("generation", [0, -1, True, "1", 1.0])
def test_invalid_generation_rejected(generation):
    with pytest.raises(ValueError):
        create_start_pin_verifier(uuid4(), generation, uuid4(), "1234")


def test_dedicated_secret_is_required(monkeypatch):
    monkeypatch.delenv("START_PIN_HMAC_SECRET", raising=False)
    with pytest.raises(RuntimeError):
        get_start_pin_secret()

    monkeypatch.setenv("START_PIN_HMAC_SECRET", "too-short")
    with pytest.raises(RuntimeError):
        get_start_pin_secret()


def test_secret_change_invalidates_verifier(monkeypatch):
    job_id, nonce = uuid4(), uuid4()
    verifier = create_start_pin_verifier(job_id, 1, nonce, "1234")
    monkeypatch.setenv(
        "START_PIN_HMAC_SECRET",
        "different-test-only-start-pin-secret-123456789",
    )
    assert not matches_start_pin(job_id, 1, nonce, "1234", verifier)
