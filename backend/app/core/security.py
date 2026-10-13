from fastapi import Request as OnboardingRequest
from datetime import datetime, timedelta, timezone
import os
from uuid import uuid4

from dotenv import load_dotenv
from jose import JWTError, jwt
from passlib.context import CryptContext

load_dotenv()


# Password hashing configuration
pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto"
)


# JWT configuration
SECRET_KEY = os.getenv("JWT_SECRET_KEY")

if not SECRET_KEY:
    raise RuntimeError(
        "JWT_SECRET_KEY is not configured in the environment."
    )

ALGORITHM = "HS256"

ACCESS_TOKEN_EXPIRE_MINUTES = 60


def hash_password(password: str) -> str:
    """
    Hash a plain-text password.
    """
    return pwd_context.hash(password)


def verify_password(
    plain_password: str,
    hashed_password: str
) -> bool:
    """
    Verify plain password against stored hash.
    """
    return pwd_context.verify(
        plain_password,
        hashed_password
    )


def create_access_token(
    data: dict,
    expires_delta: timedelta | None = None
) -> str:
    """
    Create JWT access token.
    """
    to_encode = data.copy()

    issued_at = datetime.now(timezone.utc)

    if expires_delta:
        expire = issued_at + expires_delta
    else:
        expire = issued_at + timedelta(
            minutes=ACCESS_TOKEN_EXPIRE_MINUTES
        )

    to_encode.update({
        "iat": issued_at,
        "exp": expire,
        "jti": str(uuid4()),
    })

    return jwt.encode(
        to_encode,
        SECRET_KEY,
        algorithm=ALGORITHM
    )


def decode_access_token(token: str) -> dict:
    """
    Decode and validate JWT access token.
    """
    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM]
        )
        return payload

    except JWTError:
        return {}
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import SessionLocal


security = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: OnboardingRequest = None,
) -> dict:
    """
    Validate JWT access token and verify that the user account
    is still active.
    """

    token = credentials.credentials

    payload = decode_access_token(token)

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired access token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id = payload.get("sub")
    role = payload.get("role")
    technician_id = payload.get("technician_id")

    if not user_id or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Customers must never carry a technician identity.
    if role == "CUSTOMER" and technician_id is not None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid access token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    db: Session = SessionLocal()

    try:
        user = db.execute(
            text("""
                SELECT
                    id,
                    role,
                    is_active,
                    is_verified
                FROM users
                WHERE id = :user_id
            """),
            {
                "user_id": user_id
            }
        ).mappings().first()

        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User account not found",
                headers={"WWW-Authenticate": "Bearer"},
            )

        if not user["is_active"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="User account is inactive",
            )

        if user["role"] != role:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid access token",
                headers={"WWW-Authenticate": "Bearer"},
            )

        # Technician identity in the JWT must belong to the
        # authenticated user represented by the "sub" claim.
        if role == "TECHNICIAN":
            technician = db.execute(
                text("""
                    SELECT id
                    FROM technicians
                    WHERE id = :technician_id
                      AND user_id = :user_id
                """),
                {
                    "technician_id": technician_id,
                    "user_id": user_id,
                }
            ).mappings().first()

            if not technician:
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Invalid access token",
                    headers={"WWW-Authenticate": "Bearer"},
                )

        if role == "TECHNICIAN":
            onboarding_application = db.execute(
                text("""
                    SELECT a.id, a.status,
                           u.is_verified, u.phone_verified_at,
                           t.kyc_status,
                           k.verification_status,
                           k.address_verified
                    FROM public.technicians t
                    JOIN public.users u ON u.id = t.user_id
                    JOIN public.technician_applications a
                        ON a.technician_id = t.id
                    LEFT JOIN public.technician_kyc k
                        ON k.technician_id = t.id
                    WHERE t.id = CAST(:technician_id AS uuid)
                      AND u.id = CAST(:user_id AS uuid)
                """),
                {
                    "technician_id": technician_id,
                    "user_id": user_id,
                },
            ).mappings().first()

            if onboarding_application is not None:
                ready = (
                    onboarding_application["status"] == "APPROVED"
                    and onboarding_application["is_verified"] is True
                    and onboarding_application["phone_verified_at"] is not None
                    and onboarding_application["kyc_status"] == "APPROVED"
                    and onboarding_application["verification_status"] == "APPROVED"
                    and onboarding_application["address_verified"] is True
                )
                status_access = (
                    request is not None
                    and request.method == "GET"
                    and request.url.path.rstrip("/") in {
                        "/auth/me",
                        "/auth/technician/application",
                    }
                )
                if not ready and not status_access:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail=(
                            "Technician onboarding is pending. "
                            "Application approval, manual phone verification "
                            "and approved KYC are required."
                        ),
                    )

        return payload

    finally:
        db.close()
def require_admin(
    current_user: dict = Depends(get_current_user)
) -> dict:
    """
    Allow access only to authenticated ADMIN users.
    """

    if current_user.get("role") != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Administrator access required",
        )

    return current_user