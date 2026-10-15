# Registration foundation: identifier login
import re
from datetime import date

from app.core.personal_details import optional_email, optional_birth_date

from app.core.safe_routes import SafeRoute

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, StrictStr, model_validator
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import (
    verify_password,
    create_access_token,
    get_current_user,
)
from app.db.database import get_db


router = APIRouter(prefix="/auth", tags=["Authentication"], route_class=SafeRoute)


def normalize_login_identifier(value: str) -> tuple[str, str]:
    value = value.strip()
    if not value:
        raise ValueError("Enter your mobile number or email")

    if "@" in value:
        if any(character.isspace() for character in value):
            raise ValueError("Invalid email")
        return "email", value.lower()

    if re.fullmatch(r"[+0-9 ()-]+", value) is None:
        raise ValueError("Enter a valid Indian mobile number")

    digits = re.sub(r"[^0-9]", "", value)
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]

    if re.fullmatch(r"[6-9][0-9]{9}", digits) is None:
        raise ValueError("Enter a valid ten-digit Indian mobile number")

    return "phone", digits


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Keep email for compatibility with existing app versions.
    email: StrictStr | None = Field(default=None, max_length=255)
    identifier: StrictStr | None = Field(default=None, max_length=255)
    password: StrictStr = Field(min_length=1, max_length=128, repr=False)

    @model_validator(mode="after")
    def validate_identifier(self):
        if (self.email is None) == (self.identifier is None):
            raise ValueError("Provide either identifier or email")
        normalize_login_identifier(
            self.identifier if self.identifier is not None else self.email
        )
        return self


@router.post("/login")
def login(data: LoginRequest, db: Session = Depends(get_db)):
    supplied = data.identifier if data.identifier is not None else data.email
    kind, identifier = normalize_login_identifier(supplied)

    if kind == "email":
        condition = "LOWER(email) = :identifier"
        parameters = {"identifier": identifier}
    else:
        # Recognise common existing Indian phone formats.
        # Ambiguous matches are denied rather than selecting an account.
        condition = """
            regexp_replace(phone, '[^0-9]', '', 'g')
            IN (:local_phone, :country_phone, :prefixed_phone)
        """
        parameters = {
            "local_phone": identifier,
            "country_phone": "91" + identifier,
            "prefixed_phone": "0" + identifier,
        }

    rows = db.execute(
        text("""
            SELECT id, full_name, email, phone, password_hash,
                   role, is_active, is_verified, password_version
            FROM public.users
            WHERE """ + condition + """
            LIMIT 2
        """),
        parameters,
    ).mappings().all()

    def invalid_credentials():
        return HTTPException(
            status_code=401,
            detail="Invalid mobile number, email or password",
        )

    if len(rows) != 1:
        raise invalid_credentials()

    user = rows[0]
    if not user["password_hash"]:
        raise invalid_credentials()

    try:
        password_matches = verify_password(
            data.password, user["password_hash"]
        )
    except (ValueError, TypeError):
        password_matches = False

    if not password_matches:
        raise invalid_credentials()

    if not user["is_active"]:
        raise HTTPException(
            status_code=403,
            detail="User account is inactive",
        )

    technician_id = None
    if user["role"] == "TECHNICIAN":
        technician = db.execute(
            text("""
                SELECT id FROM public.technicians
                WHERE user_id = :user_id
            """),
            {"user_id": user["id"]},
        ).mappings().first()

        if not technician:
            raise HTTPException(
                status_code=403,
                detail="Technician profile not found",
            )
        technician_id = str(technician["id"])

    access_token = create_access_token(data={
        "sub": str(user["id"]),
        "role": user["role"],
        "technician_id": technician_id,
        "password_version": user["password_version"],
    })

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
            "technician_id": technician_id,
        },
    }


@router.get("/me")
def get_current_user_info(
    current_user: dict = Depends(get_current_user),
):
    return {
        "status": "success",
        "message": "JWT authentication is working",
        "token_data": current_user,
    }


# Customer registration: account eligibility and phone ownership are separate.
from fastapi import Response as RegistrationResponse
from pydantic import field_validator as registration_validator
from sqlalchemy.exc import IntegrityError as RegistrationIntegrityError
from app.core.security import hash_password as registration_hash_password


class CustomerRegistration(BaseModel):
    model_config = ConfigDict(extra="forbid")

    full_name: StrictStr = Field(min_length=2, max_length=150)
    phone: StrictStr = Field(min_length=10, max_length=30)
    email: StrictStr | None = Field(default=None, max_length=254)
    date_of_birth: date | None = None

    _email = registration_validator("email", mode="before")(optional_email)
    _birth_date = registration_validator("date_of_birth", mode="before")(optional_birth_date)
    password: StrictStr = Field(
        min_length=8,
        max_length=72,
        repr=False,
        exclude=True,
    )

    @registration_validator("full_name")
    @classmethod
    def validate_name(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError("Enter your full name")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Name contains an invalid character")
        return value

    @registration_validator("phone")
    @classmethod
    def validate_phone(cls, value):
        kind, normalized = normalize_login_identifier(value)
        if kind != "phone":
            raise ValueError("Enter a valid Indian mobile number")
        return normalized

    @registration_validator("password")
    @classmethod
    def validate_password(cls, value):
        # bcrypt accepts at most 72 bytes, including multibyte characters.
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be no longer than 72 UTF-8 bytes")
        if value != value.strip():
            raise ValueError("Password must not begin or end with spaces")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Password contains an invalid character")
        if not any(character.isalpha() for character in value):
            raise ValueError("Include at least one letter in your password")
        if not any(character.isdigit() for character in value):
            raise ValueError("Include at least one number in your password")
        return value


@router.post("/register/customer", status_code=201)
def register_customer(
    data: CustomerRegistration,
    response: RegistrationResponse,
    db: Session = Depends(get_db),
):
    try:
        if data.email:
            db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:email, 0))"), {"email": data.email})
            if db.execute(text("SELECT id FROM public.users WHERE lower(email) = :email LIMIT 1"), {"email": data.email}).first():
                raise HTTPException(409, "This email is already registered. Please sign in.")
        existing = db.execute(
            text("""
                SELECT id
                FROM public.users
                WHERE public.registration_mobile_key(phone) = :phone
                LIMIT 1
            """),
            {"phone": data.phone},
        ).first()

        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail="This mobile number is already registered. Please sign in.",
            )

        password_hash = registration_hash_password(data.password)

        user = db.execute(
            text("""
                INSERT INTO public.users (
                    full_name, email, phone, password_hash,
                    role, is_active, is_verified,
                    phone_verified_at, phone_verified_by
                )
                VALUES (
                    :full_name, :email, :phone, :password_hash,
                    'CUSTOMER', TRUE, TRUE, NULL, NULL
                )
                RETURNING id, full_name, phone
            """),
            {
                "full_name": data.full_name,
                "email": data.email,
                "phone": data.phone,
                "password_hash": password_hash,
            },
        ).mappings().one()

        # is_verified is the existing marketplace eligibility flag.
        # Actual phone verification remains NULL in the dedicated columns.
        customer_id = db.execute(
            text("""
                INSERT INTO public.customers (user_id, date_of_birth)
                VALUES (:user_id, :date_of_birth)
                RETURNING id
            """),
            {"user_id": user["id"], "date_of_birth": data.date_of_birth},
        ).scalar_one()

        access_token = create_access_token(
            data={
                "sub": str(user["id"]),
                "role": "CUSTOMER",
                "technician_id": None,
            }
        )

        result = {
            "status": "success",
            "message": "Your customer account is ready.",
            "access_token": access_token,
            "token_type": "bearer",
            "user": {
                "user_id": str(user["id"]),
                "customer_id": str(customer_id),
                "full_name": user["full_name"],
                "email": data.email,
                "phone": user["phone"],
                "role": "CUSTOMER",
                "is_verified": True,
                "phone_verified": False,
                "technician_id": None,
            },
        }

        db.commit()
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"
        return result

    except RegistrationIntegrityError as exc:
        db.rollback()
        constraint = getattr(
            getattr(exc.orig, "diag", None),
            "constraint_name",
            None,
        )
        if constraint in {
            "users_phone_key",
            "users_registration_mobile_unique", "users_email_key",
        }:
            raise HTTPException(
                status_code=409,
                detail="This mobile number or email is already registered. Please sign in.",
            ) from None
        raise

    except Exception:
        db.rollback()
        raise


from datetime import date as RegistrationDate
from datetime import datetime as RegistrationDatetime
from datetime import timedelta as RegistrationTimedelta
from datetime import timezone as RegistrationTimezone
from decimal import Decimal as RegistrationDecimal
from typing import Literal as RegistrationLiteral
from uuid import UUID as RegistrationUUID


class TechnicianDetails(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: StrictStr = Field(min_length=5, max_length=254)
    date_of_birth: RegistrationDate
    gender: RegistrationLiteral["MALE", "FEMALE", "OTHER"]
    address_line1: StrictStr = Field(min_length=3, max_length=300)
    address_line2: StrictStr | None = Field(default=None, max_length=300)
    city: StrictStr = Field(min_length=2, max_length=100)
    state: StrictStr = Field(min_length=2, max_length=100)
    pincode: StrictStr = Field(min_length=6, max_length=6)
    work_area: StrictStr = Field(min_length=3, max_length=300)
    experience_years: StrictStr = Field(max_length=4)
    service_radius_km: StrictStr = Field(max_length=6)
    service_ids: list[RegistrationUUID] = Field(min_length=1, max_length=20)
    skill_ids: list[RegistrationUUID] = Field(min_length=1, max_length=50)
    tool_ids: list[RegistrationUUID] = Field(min_length=1, max_length=50)

    @registration_validator("email")
    @classmethod
    def validate_email(cls, value):
        value = value.strip().lower()
        if re.fullmatch(
            r"[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?"
            r"(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+",
            value,
        ) is None:
            raise ValueError("Enter a valid email address")
        if ".." in value.split("@")[0]:
            raise ValueError("Enter a valid email address")
        if value.split("@")[0].startswith(".") or value.split("@")[0].endswith("."):
            raise ValueError("Enter a valid email address")
        return value

    @registration_validator("date_of_birth", mode="before")
    @classmethod
    def validate_birth_date(cls, value):
        if not isinstance(value, str) or re.fullmatch(
            r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value
        ) is None:
            raise ValueError("Provide your actual date of birth as YYYY-MM-DD")
        return value

    @registration_validator("address_line1", "city", "state", "work_area")
    @classmethod
    def clean_required_text(cls, value, info):
        value = value.strip()
        minimum = 2 if info.field_name in {"city", "state"} else 3
        if len(value) < minimum:
            raise ValueError("Enter a complete value")
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Value contains an invalid character")
        return value

    @registration_validator("address_line2")
    @classmethod
    def clean_optional_address(cls, value):
        if value is None:
            return None
        value = value.strip()
        if any(ord(character) < 32 or ord(character) == 127 for character in value):
            raise ValueError("Address contains an invalid character")
        return value or None

    @registration_validator("pincode")
    @classmethod
    def validate_pincode(cls, value):
        if re.fullmatch(r"[1-9][0-9]{5}", value) is None:
            raise ValueError("Enter a valid six-digit pincode")
        return value

    @registration_validator("experience_years", "service_radius_km")
    @classmethod
    def validate_decimal(cls, value, info):
        if re.fullmatch(r"(0|[1-9][0-9]{0,2})(\.[0-9]{1,2})?", value) is None:
            raise ValueError("Enter a valid decimal value")
        number = RegistrationDecimal(value)
        if info.field_name == "experience_years":
            if number > 80 or number.as_tuple().exponent < -1:
                raise ValueError("Experience must be 0 to 80 years with at most one decimal place")
        elif not 1 <= number <= 100:
            raise ValueError("Service radius must be 1 to 100 kilometres")
        return value

    @registration_validator("service_ids", "skill_ids", "tool_ids")
    @classmethod
    def validate_unique_choices(cls, value):
        if len(set(value)) != len(value):
            raise ValueError("Remove duplicate selections")
        return value

    @model_validator(mode="after")
    def validate_adult(self):
        today = RegistrationDatetime.now(
            RegistrationTimezone(RegistrationTimedelta(hours=5, minutes=30))
        ).date()
        age = today.year - self.date_of_birth.year - (
            (today.month, today.day)
            < (self.date_of_birth.month, self.date_of_birth.day)
        )
        if self.date_of_birth < RegistrationDate(1900, 1, 1) or age < 18:
            raise ValueError("Technician registration requires age 18 or above")
        return self


class TechnicianRegistration(CustomerRegistration, TechnicianDetails):
    # Preserve the original all-at-once endpoint's required verification fields.
    email: StrictStr = Field(min_length=5, max_length=254)
    date_of_birth: RegistrationDate = Field(...)

    @registration_validator("date_of_birth", mode="before")
    @classmethod
    def _birth_date(cls, value):
        return TechnicianDetails.validate_birth_date(value)


@router.post("/register/technician", status_code=201)
def register_technician(
    data: TechnicianRegistration,
    response: RegistrationResponse,
    db: Session = Depends(get_db),
):
    try:
        # Serialize registrations using the same normalized email.
        db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:email, 0))"),
            {"email": data.email},
        )

        duplicate = db.execute(
            text("""
                SELECT id FROM public.users
                WHERE public.registration_mobile_key(phone) = :phone
                   OR lower(email) = :email
                LIMIT 1
            """),
            {"phone": data.phone, "email": data.email},
        ).first()
        if duplicate is not None:
            raise HTTPException(
                status_code=409,
                detail="This mobile number or email is already registered. Please sign in.",
            )

        validate_technician_choices(db, data)

        user_id = db.execute(
            text("""
                INSERT INTO public.users (
                    full_name, email, phone, password_hash,
                    role, is_active, is_verified
                )
                VALUES (
                    :name, :email, :phone, :password_hash,
                    'TECHNICIAN', TRUE, FALSE
                )
                RETURNING id
            """),
            {
                "name": data.full_name,
                "email": data.email,
                "phone": data.phone,
                "password_hash": registration_hash_password(data.password),
            },
        ).scalar_one()

        technician_id = db.execute(
            text("""
                INSERT INTO public.technicians (
                    user_id, experience_years, service_radius_km,
                    kyc_status, availability_status
                )
                VALUES (:user_id, :experience, :radius, 'SUBMITTED', 'OFFLINE')
                RETURNING id
            """),
            {
                "user_id": user_id,
                "experience": RegistrationDecimal(data.experience_years),
                "radius": RegistrationDecimal(data.service_radius_km),
            },
        ).scalar_one()

        db.execute(
            text("""
                INSERT INTO public.technician_kyc (
                    technician_id, verification_status, address_verified
                )
                VALUES (:id, 'SUBMITTED', FALSE)
            """),
            {"id": technician_id},
        )

        application_id = save_technician_application(db, data, technician_id)

        token = create_access_token(data={
            "sub": str(user_id),
            "role": "TECHNICIAN",
            "technician_id": str(technician_id),
        })
        db.commit()
        response.headers["Cache-Control"] = "no-store"
        response.headers["Pragma"] = "no-cache"

        return {
            "status": "success",
            "message": (
                "Your application has been received. "
                "Our representative will contact you for phone verification and KYC."
            ),
            "application_id": str(application_id),
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "user_id": str(user_id),
                "full_name": data.full_name,
                "email": data.email,
                "phone": data.phone,
                "role": "TECHNICIAN",
                "technician_id": str(technician_id),
                "is_verified": False,
                "phone_verified": False,
            },
        }
    except RegistrationIntegrityError as exc:
        db.rollback()
        constraint = getattr(
            getattr(exc.orig, "diag", None), "constraint_name", None,
        )
        if constraint in {
            "users_phone_key", "users_registration_mobile_unique", "users_email_key",
        }:
            raise HTTPException(
                status_code=409,
                detail="This mobile number or email is already registered. Please sign in.",
            ) from None
        raise
    except Exception:
        db.rollback()
        raise


@router.get("/technician/application")
def get_my_technician_application(
    response: RegistrationResponse,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "TECHNICIAN":
        raise HTTPException(status_code=403, detail="Technician access required")

    row = db.execute(
        text("""
            SELECT u.full_name, u.email, u.phone, u.is_verified,
                   u.phone_verified_at IS NOT NULL AS phone_verified,
                   t.kyc_status, k.verification_status, k.address_verified,
                   a.id AS application_id, a.status AS application_status,
                   a.version, a.review_reason, a.created_at,
                   a.date_of_birth, a.gender, a.address_line1, a.address_line2,
                   a.city, a.state, a.pincode, a.work_area,
                   EXISTS (SELECT 1 FROM public.technician_onboarding_drafts d
                           WHERE d.technician_id = t.id) AS onboarding_required
            FROM public.technicians t
            JOIN public.users u ON u.id = t.user_id
            LEFT JOIN public.technician_kyc k ON k.technician_id = t.id
            LEFT JOIN public.technician_applications a ON a.technician_id = t.id
            WHERE t.id = CAST(:technician_id AS uuid)
              AND u.id = CAST(:actor_id AS uuid)
              AND u.role = 'TECHNICIAN' AND u.is_active = TRUE
        """),
        {
            "technician_id": current_user.get("technician_id"),
            "actor_id": current_user["sub"],
        },
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Technician profile not found")

    can_work = (
        row["is_verified"] is True
        and row["kyc_status"] == "APPROVED"
        and row["verification_status"] == "APPROVED"
        and row["address_verified"] is True
        and (
            row["application_id"] is None
            or (
                row["application_status"] == "APPROVED"
                and row["phone_verified"] is True
            )
        )
    )
    result = dict(row)
    result["can_work"] = can_work
    response.headers["Cache-Control"] = "no-store"
    return {"status": "success", "application": result}


@router.get("/technician/registration-options")
def get_technician_registration_options(
    response: RegistrationResponse,
    db: Session = Depends(get_db),
):
    categories = db.execute(
        text("""
            SELECT id, name FROM public.service_categories
            WHERE is_active = TRUE ORDER BY sort_order, name, id
        """)
    ).mappings().all()

    services = db.execute(
        text("""
            SELECT s.id, s.category_id, s.name
            FROM public.services s
            JOIN public.service_categories c ON c.id = s.category_id
            WHERE s.is_active = TRUE AND c.is_active = TRUE
              AND EXISTS (
                  SELECT 1 FROM public.service_skills ss
                  JOIN public.skills sk ON sk.id = ss.skill_id
                  WHERE ss.service_id = s.id
                    AND ss.is_required = TRUE AND sk.is_active = TRUE
              )
              AND NOT EXISTS (
                  SELECT 1 FROM public.service_tools st
                  LEFT JOIN public.tools tl ON tl.id = st.tool_id
                  WHERE st.service_id = s.id AND st.is_required = TRUE
                    AND (tl.id IS NULL OR tl.is_active IS NOT TRUE)
              )
            ORDER BY s.name, s.id
        """)
    ).mappings().all()

    skills = db.execute(
        text("SELECT id, name FROM public.skills WHERE is_active = TRUE ORDER BY name, id")
    ).mappings().all()
    tools = db.execute(
        text("SELECT id, name FROM public.tools WHERE is_active = TRUE ORDER BY name, id")
    ).mappings().all()

    service_ids = [str(row["id"]) for row in services]
    required_skills = db.execute(
        text("""
            SELECT service_id, skill_id
            FROM public.service_skills
            WHERE service_id = ANY(CAST(:ids AS uuid[]))
              AND is_required = TRUE
              AND skill_id IN (SELECT id FROM public.skills WHERE is_active = TRUE)
            ORDER BY service_id, skill_id
        """),
        {"ids": service_ids},
    ).mappings().all()
    required_tools = db.execute(
        text("""
            SELECT service_id, tool_id
            FROM public.service_tools
            WHERE service_id = ANY(CAST(:ids AS uuid[]))
              AND is_required = TRUE
            ORDER BY service_id, tool_id
        """),
        {"ids": service_ids},
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"
    return {
        "status": "success",
        "categories": [dict(row) for row in categories],
        "services": [dict(row) for row in services],
        "skills": [dict(row) for row in skills],
        "tools": [dict(row) for row in tools],
        "required_skills": [dict(row) for row in required_skills],
        "required_tools": [dict(row) for row in required_tools],
    }


def validate_technician_choices(db, data):
    choices = {
        "services": [str(value) for value in data.service_ids],
        "skills": [str(value) for value in data.skill_ids],
        "tools": [str(value) for value in data.tool_ids],
    }

    services = db.execute(
        text("""
            SELECT s.id
            FROM public.services s
            JOIN public.service_categories c ON c.id = s.category_id
            WHERE s.id = ANY(CAST(:ids AS uuid[]))
              AND s.is_active = TRUE AND c.is_active = TRUE
        """),
        {"ids": choices["services"]},
    ).scalars().all()
    if len(services) != len(data.service_ids):
        raise HTTPException(status_code=422, detail="Select active services and categories")

    for table, selected in (
        ("skills", data.skill_ids),
        ("tools", data.tool_ids),
    ):
        # Table names are fixed server-side allowlisted values.
        found = db.execute(
            text(
                "SELECT id FROM public." + table
                + " WHERE id = ANY(CAST(:ids AS uuid[])) AND is_active = TRUE"
            ),
            {"ids": choices[table]},
        ).scalars().all()
        if len(found) != len(selected):
            raise HTTPException(
                status_code=422,
                detail="Select valid active " + table,
            )

    incompatible = db.execute(
        text("""
            SELECT s.name
            FROM public.services s
            WHERE s.id = ANY(CAST(:services AS uuid[]))
              AND (
                  NOT EXISTS (
                      SELECT 1 FROM public.service_skills ss
                      WHERE ss.service_id = s.id AND ss.is_required = TRUE
                        AND ss.skill_id = ANY(CAST(:skills AS uuid[]))
                  )
                  OR EXISTS (
                      SELECT 1 FROM public.service_tools st
                      WHERE st.service_id = s.id AND st.is_required = TRUE
                        AND NOT (
                            st.tool_id = ANY(CAST(:tools AS uuid[]))
                        )
                  )
              )
            LIMIT 1
        """),
        choices,
    ).scalar_one_or_none()
    if incompatible is not None:
        raise HTTPException(
            status_code=422,
            detail=(
                "Required skill or tools are missing for " + incompatible
                + ". Select only services you are equipped to perform."
            ),
        )



def save_technician_application(db, data, technician_id):
    application_id = db.execute(
        text("""
            INSERT INTO public.technician_applications (
                technician_id, date_of_birth, gender,
                address_line1, address_line2, city, state, pincode, work_area
            )
            VALUES (
                :technician_id, :dob, :gender,
                :address1, :address2, :city, :state, :pincode, :work_area
            )
            RETURNING id
        """),
        {
            "technician_id": technician_id,
            "dob": data.date_of_birth,
            "gender": data.gender,
            "address1": data.address_line1,
            "address2": data.address_line2,
            "city": data.city,
            "state": data.state,
            "pincode": data.pincode,
            "work_area": data.work_area,
        },
    ).scalar_one()

    db.execute(
        text("""
            INSERT INTO public.technician_application_services (
                application_id, service_id
            )
            VALUES (:application_id, :service_id)
        """),
        [
            {"application_id": application_id, "service_id": value}
            for value in data.service_ids
        ],
    )
    db.execute(
        text("""
            INSERT INTO public.technician_skills (technician_id, skill_id)
            VALUES (:technician_id, :skill_id)
        """),
        [
            {"technician_id": technician_id, "skill_id": value}
            for value in data.skill_ids
        ],
    )
    db.execute(
        text("""
            INSERT INTO public.technician_tools (technician_id, tool_id)
            VALUES (:technician_id, :tool_id)
        """),
        [
            {"technician_id": technician_id, "tool_id": value}
            for value in data.tool_ids
        ],
    )

    return application_id
