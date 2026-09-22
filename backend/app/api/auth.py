from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import (
    verify_password,
    create_access_token,
    get_current_user
)
from app.db.database import get_db


router = APIRouter(
    prefix="/auth",
    tags=["Authentication"]
)


class LoginRequest(BaseModel):
    email: str
    password: str

@router.post("/login")
def login(
    data: LoginRequest,
    db: Session = Depends(get_db)
):
    user = db.execute(
        text("""
            SELECT
                id,
                full_name,
                email,
                phone,
                password_hash,
                role,
                is_active,
                is_verified
            FROM users
            WHERE LOWER(email) = LOWER(:email)
        """),
        {
            "email": data.email
        }
    ).mappings().first()

    # Do not reveal whether email exists
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    if not user["is_active"]:
        raise HTTPException(
            status_code=403,
            detail="User account is inactive"
        )

    if not verify_password(
        data.password,
        user["password_hash"]
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    technician_id = None

    if user["role"] == "TECHNICIAN":
        technician = db.execute(
            text("""
                SELECT id
                FROM technicians
                WHERE user_id = :user_id
            """),
            {
                "user_id": user["id"]
            }
        ).mappings().first()

        if not technician:
            raise HTTPException(
                status_code=403,
                detail="Technician profile not found"
            )

        technician_id = str(technician["id"])

    access_token = create_access_token(
        data={
            "sub": str(user["id"]),
            "role": user["role"],
            "technician_id": technician_id
        }
    )

    return {
        "status": "success",
        "message": "Login successful",
        "access_token": access_token,
        "token_type": "bearer",
        "user": {
            "user_id": str(user["id"]),
            "full_name": user["full_name"],
            "email": user["email"],
            "phone": user["phone"],
            "role": user["role"],
            "is_verified": user["is_verified"],
            "technician_id": technician_id
        }
    }
from app.core.security import get_current_user
from fastapi import Depends


@router.get("/me")
def get_current_user_info(
    current_user: dict = Depends(get_current_user)
):
    return {
        "status": "success",
        "message": "JWT authentication is working",
        "token_data": current_user
    }