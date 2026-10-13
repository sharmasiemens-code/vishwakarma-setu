from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.admin_rbac import get_admin_access
from app.core.security import get_current_user
from app.db.database import get_db
from app.services.photo_storage import PhotoStorage, get_photo_storage


router = APIRouter(prefix="/disputes", tags=["Dispute Photos"])


def require_dispute_photo_access(
    db: Session,
    dispute_id: UUID,
    current_user: dict,
) -> None:
    role = current_user.get("role")
    if role == "ADMIN":
        access = get_admin_access(current_admin=current_user, db=db)
        if "disputes.read" not in access["permissions"]:
            raise HTTPException(status_code=403, detail="Dispute read permission required")
        exists = db.execute(
            text("SELECT EXISTS (SELECT 1 FROM public.job_disputes WHERE id = :id)"),
            {"id": dispute_id},
        ).scalar_one()
        if not exists:
            raise HTTPException(status_code=404, detail="Dispute not found")
        return

    if role not in {"CUSTOMER", "TECHNICIAN"}:
        raise HTTPException(status_code=403, detail="Dispute access required")

    allowed = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.job_disputes d
                JOIN public.jobs j ON j.id = d.job_id
                JOIN public.customers c ON c.id = j.customer_id
                JOIN public.technicians t ON t.id = j.technician_id
                JOIN public.users actor ON actor.id = CAST(:actor_id AS uuid)
                WHERE d.id = :id
                  AND actor.is_active = TRUE
                  AND actor.is_verified = TRUE
                  AND actor.role = :role
                  AND (
                      (actor.role = 'CUSTOMER' AND c.user_id = actor.id)
                      OR
                      (actor.role = 'TECHNICIAN' AND t.user_id = actor.id)
                  )
            )
        """),
        {"id": dispute_id, "actor_id": current_user["sub"], "role": role},
    ).scalar_one()

    if not allowed:
        raise HTTPException(status_code=404, detail="Dispute not found")


@router.get("/{dispute_id}/photos")
def list_dispute_photos(
    dispute_id: UUID,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_dispute_photo_access(db, dispute_id, current_user)
    rows = db.execute(
        text("""
            SELECT id, slot, content_type, width, height,
                   file_size_bytes, thumbnail_size_bytes, uploaded_at
            FROM public.job_dispute_photos
            WHERE dispute_id = :id
            ORDER BY slot, id
        """),
        {"id": dispute_id},
    ).mappings().all()

    photos = []
    for row in rows:
        item = dict(row)
        base = f"/disputes/{dispute_id}/photos/{row['id']}/content"
        item["image_url"] = base
        item["thumbnail_url"] = base + "?variant=thumbnail"
        photos.append(item)

    response.headers["Cache-Control"] = "no-store"
    return {"status": "success", "photos": photos, "max_photos": 5}


@router.get("/{dispute_id}/photos/{photo_id}/content")
def get_dispute_photo_content(
    dispute_id: UUID,
    photo_id: UUID,
    variant: Literal["image", "thumbnail"] = "image",
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: PhotoStorage = Depends(get_photo_storage),
):
    require_dispute_photo_access(db, dispute_id, current_user)
    row = db.execute(
        text("""
            SELECT storage_key, thumbnail_storage_key, content_type
            FROM public.job_dispute_photos
            WHERE id = :photo_id AND dispute_id = :dispute_id
        """),
        {"photo_id": photo_id, "dispute_id": dispute_id},
    ).mappings().first()
    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")

    key = row["thumbnail_storage_key"] if variant == "thumbnail" else row["storage_key"]
    try:
        content = storage.read(key)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Photo content unavailable")

    return Response(
        content=content,
        media_type=row["content_type"],
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
        },
    )


import logging
from starlette.concurrency import run_in_threadpool
from app.services.work_photos import (
    MAX_UPLOAD_BYTES,
    PhotoValidationError,
    process_photo,
)

photo_logger = logging.getLogger("tech_expert_marketplace.dispute_photos")


def require_editable_dispute(
    db: Session, dispute_id: UUID, current_user: dict,
) -> None:
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(status_code=403, detail="Customer access required")

    job = db.execute(
        text("""
            SELECT j.id, j.status
            FROM public.job_disputes d
            JOIN public.jobs j ON j.id = d.job_id
            JOIN public.customers c ON c.id = j.customer_id
            JOIN public.users u ON u.id = c.user_id
            WHERE d.id = :id
              AND u.id = CAST(:actor_id AS uuid)
              AND u.role = 'CUSTOMER'
              AND u.is_active = TRUE
              AND u.is_verified = TRUE
            FOR UPDATE OF j
        """),
        {"id": dispute_id, "actor_id": current_user["sub"]},
    ).mappings().first()
    if job is None:
        raise HTTPException(status_code=404, detail="Dispute not found")

    # Re-read dispute state after acquiring the shared job lock.
    dispute_status = db.execute(
        text("SELECT status FROM public.job_disputes WHERE id = :id FOR UPDATE"),
        {"id": dispute_id},
    ).scalar_one()
    if job["status"] != "IN_PROGRESS" or dispute_status not in {"OPEN", "UNDER_REVIEW"}:
        raise HTTPException(status_code=409, detail="Issue photo uploads are closed")


def persist_dispute_photo(
    db: Session,
    storage: PhotoStorage,
    dispute_id: UUID,
    current_user: dict,
    raw: bytes,
):
    stored = None
    commit_started = False
    try:
        require_editable_dispute(db, dispute_id, current_user)
        occupied = set(db.execute(
            text("SELECT slot FROM public.job_dispute_photos WHERE dispute_id = :id"),
            {"id": dispute_id},
        ).scalars().all())
        available = [slot for slot in range(1, 6) if slot not in occupied]
        if not available:
            raise HTTPException(status_code=409, detail="An issue can have at most five photos")

        try:
            processed = process_photo(raw)
        except PhotoValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        stored = storage.save(processed)
        row = db.execute(
            text("""
                INSERT INTO public.job_dispute_photos (
                    dispute_id, uploaded_by, slot,
                    storage_key, thumbnail_storage_key, content_type,
                    original_file_size_bytes, file_size_bytes,
                    thumbnail_size_bytes, width, height
                )
                VALUES (
                    :id, CAST(:actor_id AS uuid), :slot,
                    :image_key, :thumbnail_key, :content_type,
                    :original_size, :image_size, :thumbnail_size,
                    :width, :height
                )
                RETURNING id, slot, content_type, width, height,
                          file_size_bytes, thumbnail_size_bytes, uploaded_at
            """),
            {
                "id": dispute_id,
                "actor_id": current_user["sub"],
                "slot": available[0],
                "image_key": stored.storage_key,
                "thumbnail_key": stored.thumbnail_storage_key,
                "content_type": processed.content_type,
                "original_size": processed.original_file_size_bytes,
                "image_size": len(processed.image_bytes),
                "thumbnail_size": len(processed.thumbnail_bytes),
                "width": processed.width,
                "height": processed.height,
            },
        ).mappings().one()

        photo = dict(row)
        base = f"/disputes/{dispute_id}/photos/{row['id']}/content"
        photo["image_url"] = base
        photo["thumbnail_url"] = base + "?variant=thumbnail"
        commit_started = True
        db.commit()
        return {"status": "success", "photo": photo}

    except Exception:
        db.rollback()
        if stored is not None and not commit_started:
            for key in (stored.storage_key, stored.thumbnail_storage_key):
                try:
                    storage.delete(key)
                except Exception:
                    photo_logger.error("Issue photo cleanup requires reconciliation")
        if stored is not None and commit_started:
            photo_logger.error("Issue photo commit requires reconciliation")
        raise


@router.post("/{dispute_id}/photos")
async def upload_dispute_photo(
    dispute_id: UUID,
    request: Request,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: PhotoStorage = Depends(get_photo_storage),
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(status_code=403, detail="Customer access required")

    length = request.headers.get("content-length")
    if length is not None:
        try:
            declared_size = int(length)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid Content-Length") from exc
        if declared_size < 0:
            raise HTTPException(status_code=400, detail="Invalid Content-Length")
        if declared_size > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Each image must be no larger than 5 MiB")

    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Each image must be no larger than 5 MiB")
        raw.extend(chunk)

    response.headers["Cache-Control"] = "no-store"
    return await run_in_threadpool(
        persist_dispute_photo, db, storage, dispute_id, current_user, bytes(raw),
    )
