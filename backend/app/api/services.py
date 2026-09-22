from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.database import get_db


router = APIRouter(
    prefix="/services",
    tags=["Services"],
)


@router.get("/categories")
def get_service_categories(db: Session = Depends(get_db)):
    query = text("""
        SELECT
            id,
            name,
            description,
            icon_name,
            sort_order
        FROM service_categories
        WHERE is_active = TRUE
        ORDER BY sort_order, name;
    """)

    result = db.execute(query)

    categories = [
        dict(row._mapping)
        for row in result
    ]

    return {
        "status": "success",
        "total_categories": len(categories),
        "categories": categories,
    }


@router.get("")
def get_services(db: Session = Depends(get_db)):
    query = text("""
        SELECT
            s.id,
            s.category_id,
            c.name AS category_name,
            s.name,
            s.description
        FROM services s
        JOIN service_categories c
            ON c.id = s.category_id
        WHERE
            s.is_active = TRUE
            AND c.is_active = TRUE
        ORDER BY
            c.sort_order,
            s.name;
    """)

    result = db.execute(query)

    services = [
        dict(row._mapping)
        for row in result
    ]

    return {
        "status": "success",
        "total_services": len(services),
        "services": services,
    }


@router.get("/{service_id}")
def get_service(
    service_id: str,
    db: Session = Depends(get_db),
):
    service_query = text("""
        SELECT
            s.id,
            s.category_id,
            c.name AS category_name,
            s.name,
            s.description
        FROM services s
        JOIN service_categories c
            ON c.id = s.category_id
        WHERE
            s.id = :service_id
            AND s.is_active = TRUE
            AND c.is_active = TRUE;
    """)

    service_result = db.execute(
        service_query,
        {"service_id": service_id},
    ).fetchone()

    if not service_result:
        raise HTTPException(
            status_code=404,
            detail="Service not found",
        )

    skills_query = text("""
        SELECT
            sk.id,
            sk.name,
            ss.is_required
        FROM service_skills ss
        JOIN skills sk
            ON sk.id = ss.skill_id
        WHERE
            ss.service_id = :service_id
        ORDER BY
            ss.is_required DESC,
            sk.name;
    """)

    skills_result = db.execute(
        skills_query,
        {"service_id": service_id},
    )

    skills = [
        dict(row._mapping)
        for row in skills_result
    ]

    tools_query = text("""
        SELECT
            tl.id,
            tl.name,
            st.is_required
        FROM service_tools st
        JOIN tools tl
            ON tl.id = st.tool_id
        WHERE
            st.service_id = :service_id
        ORDER BY
            st.is_required DESC,
            tl.name;
    """)

    tools_result = db.execute(
        tools_query,
        {"service_id": service_id},
    )

    tools = [
        dict(row._mapping)
        for row in tools_result
    ]

    return {
        "status": "success",
        "service": dict(service_result._mapping),
        "required_skills": skills,
        "required_tools": tools,
    }