from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.security import get_current_user
from app.db.database import get_db
from app.services.photo_storage import PhotoStorage, get_photo_storage


router = APIRouter(
    prefix="/service-requests",
    tags=["Request Photos"],
)


def require_photo_access(
    db: Session,
    request_id: UUID,
    current_user: dict,
) -> None:
    """
    Allow the customer owner or a technician with a non-cancelled
    assignment. No general administrator access is granted.
    """
    role = current_user.get("role")

    if role not in {"CUSTOMER", "TECHNICIAN"}:
        raise HTTPException(
            status_code=403,
            detail="Customer or assigned technician access required",
        )

    allowed = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1
                FROM public.service_requests sr
                JOIN public.customers c ON c.id = sr.customer_id
                JOIN public.users actor ON actor.id = :actor_id
                WHERE sr.id = :request_id
                  AND actor.is_active = TRUE
                  AND actor.role = :actor_role
                  AND (
                      (
                          actor.role = 'CUSTOMER'
                          AND c.user_id = actor.id
                      )
                      OR
                      (
                          actor.role = 'TECHNICIAN'
                          AND EXISTS (
                              SELECT 1
                              FROM public.jobs j
                              JOIN public.technicians t
                                ON t.id = j.technician_id
                              WHERE j.service_request_id = sr.id
                                AND t.user_id = actor.id
                                AND j.status IN (
                                    'ASSIGNED',
                                    'ACCEPTED',
                                    'ON_THE_WAY',
                                    'ARRIVED',
                                    'IN_PROGRESS',
                                    'COMPLETED'
                                )
                          )
                      )
                  )
            )
        """),
        {
            "request_id": request_id,
            "actor_id": current_user["sub"],
            "actor_role": role,
        },
    ).scalar_one()

    if not allowed:
        raise HTTPException(
            status_code=404,
            detail="Service request not found",
        )


@router.get("/{request_id}/photos")
def list_request_photos(
    request_id: UUID,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    require_photo_access(db, request_id, current_user)

    rows = db.execute(
        text("""
            SELECT id, slot, content_type, width, height,
                   file_size_bytes, thumbnail_size_bytes, uploaded_at
            FROM public.service_request_photos
            WHERE service_request_id = :request_id
            ORDER BY slot, id
        """),
        {"request_id": request_id},
    ).mappings().all()

    response.headers["Cache-Control"] = "no-store"

    photos = []
    for row in rows:
        item = dict(row)
        base = f"/service-requests/{request_id}/photos/{row['id']}/content"
        item["image_url"] = base
        item["thumbnail_url"] = base + "?variant=thumbnail"
        photos.append(item)

    return {
        "status": "success",
        "service_request_id": str(request_id),
        "photos": photos,
        "max_photos": 5,
    }


@router.get("/{request_id}/photos/{photo_id}/content")
def get_request_photo_content(
    request_id: UUID,
    photo_id: UUID,
    variant: Literal["image", "thumbnail"] = "image",
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: PhotoStorage = Depends(get_photo_storage),
):
    require_photo_access(db, request_id, current_user)

    row = db.execute(
        text("""
            SELECT storage_key, thumbnail_storage_key, content_type
            FROM public.service_request_photos
            WHERE id = :photo_id
              AND service_request_id = :request_id
        """),
        {"photo_id": photo_id, "request_id": request_id},
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Photo not found")

    key = (
        row["thumbnail_storage_key"]
        if variant == "thumbnail"
        else row["storage_key"]
    )

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


from starlette.concurrency import run_in_threadpool
import logging

from app.services.work_photos import (
    MAX_UPLOAD_BYTES,
    PhotoValidationError,
    process_photo,
)


photo_logger = logging.getLogger("tech_expert_marketplace.photos")


def require_editable_photo_request(
    db: Session,
    request_id: UUID,
    current_user: dict,
):
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can change request photos",
        )

    row = db.execute(
        text("""
            SELECT sr.id, sr.status
            FROM public.service_requests sr
            JOIN public.customers c ON c.id = sr.customer_id
            JOIN public.users u ON u.id = c.user_id
            WHERE sr.id = :request_id
              AND c.user_id = :actor_id
              AND u.role = 'CUSTOMER'
              AND u.is_active = TRUE
              AND u.is_verified = TRUE
            FOR UPDATE OF sr
        """),
        {"request_id": request_id, "actor_id": current_user["sub"]},
    ).mappings().first()

    if row is None:
        raise HTTPException(status_code=404, detail="Service request not found")

    if row["status"] != "OPEN":
        raise HTTPException(
            status_code=409,
            detail="Photos can only be changed while the request is OPEN",
        )

    assigned_before = db.execute(
        text("""
            SELECT EXISTS (
                SELECT 1 FROM public.jobs
                WHERE service_request_id = :request_id
            )
        """),
        {"request_id": request_id},
    ).scalar_one()

    if assigned_before:
        raise HTTPException(
            status_code=409,
            detail="Photos cannot be changed after job assignment",
        )

    return row


def persist_request_photo(
    db: Session,
    storage: PhotoStorage,
    request_id: UUID,
    current_user: dict,
    raw: bytes,
):
    stored = None
    commit_started = False

    try:
        require_editable_photo_request(db, request_id, current_user)

        occupied = set(db.execute(
            text("""
                SELECT slot FROM public.service_request_photos
                WHERE service_request_id = :request_id
            """),
            {"request_id": request_id},
        ).scalars().all())

        available = [slot for slot in range(1, 6) if slot not in occupied]
        if not available:
            raise HTTPException(
                status_code=409,
                detail="A service request can have at most five photos",
            )

        try:
            processed = process_photo(raw)
        except PhotoValidationError as exc:
            raise HTTPException(status_code=422, detail=str(exc))

        stored = storage.save(processed)

        row = db.execute(
            text("""
                INSERT INTO public.service_request_photos (
                    service_request_id, uploaded_by, slot,
                    storage_key, thumbnail_storage_key, content_type,
                    original_file_size_bytes, file_size_bytes,
                    thumbnail_size_bytes, width, height
                )
                VALUES (
                    :request_id, CAST(:actor_id AS uuid), :slot,
                    :image_key, :thumbnail_key, :content_type,
                    :original_size, :image_size, :thumbnail_size,
                    :width, :height
                )
                RETURNING id, slot, content_type, width, height,
                          file_size_bytes, thumbnail_size_bytes, uploaded_at
            """),
            {
                "request_id": request_id,
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
        base = f"/service-requests/{request_id}/photos/{row['id']}/content"
        photo["image_url"] = base
        photo["thumbnail_url"] = base + "?variant=thumbnail"

        commit_started = True
        db.commit()

        return {"status": "success", "photo": photo}

    except Exception:
        db.rollback()

        # Before commit, the metadata cannot have been committed.
        # If commit itself failed, its outcome may be uncertain:
        # retain files for reconciliation rather than risk deleting
        # an image referenced by a committed database record.
        if stored is not None and not commit_started:
            for key in (stored.storage_key, stored.thumbnail_storage_key):
                try:
                    storage.delete(key)
                except Exception:
                    photo_logger.error("Photo upload cleanup requires reconciliation")

        if stored is not None and commit_started:
            photo_logger.error("Photo upload commit requires reconciliation")

        raise


@router.post("/{request_id}/photos", status_code=201)
async def upload_request_photo(
    request_id: UUID,
    request: Request,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: PhotoStorage = Depends(get_photo_storage),
):
    """
    Upload one image as the raw request body, not multipart form data.
    The frontend sends its selected File directly as the body.
    """
    if current_user.get("role") != "CUSTOMER":
        raise HTTPException(
            status_code=403,
            detail="Only customers can upload request photos",
        )

    length = request.headers.get("content-length")
    if length is not None:
        try:
            declared_size = int(length)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid Content-Length")
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
        persist_request_photo,
        db,
        storage,
        request_id,
        current_user,
        bytes(raw),
    )


@router.delete("/{request_id}/photos/{photo_id}")
def delete_request_photo(
    request_id: UUID,
    photo_id: UUID,
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
    storage: PhotoStorage = Depends(get_photo_storage),
):
    try:
        require_editable_photo_request(db, request_id, current_user)

        photo = db.execute(
            text("""
                SELECT storage_key, thumbnail_storage_key
                FROM public.service_request_photos
                WHERE id = :photo_id
                  AND service_request_id = :request_id
                FOR UPDATE
            """),
            {"photo_id": photo_id, "request_id": request_id},
        ).mappings().first()

        if photo is None:
            raise HTTPException(status_code=404, detail="Photo not found")

        keys = (photo["storage_key"], photo["thumbnail_storage_key"])

        db.execute(
            text("""
                DELETE FROM public.service_request_photos
                WHERE id = :photo_id
                  AND service_request_id = :request_id
            """),
            {"photo_id": photo_id, "request_id": request_id},
        )

        db.commit()

    except Exception:
        db.rollback()
        raise

    # Metadata deletion must commit before removing either file.
    # Failed file cleanup leaves an inaccessible orphan for reconciliation.
    for key in keys:
        try:
            storage.delete(key)
        except Exception:
            photo_logger.error("Deleted photo file requires reconciliation")

    response.headers["Cache-Control"] = "no-store"

    return {
        "status": "success",
        "message": "Photo removed",
        "photo_id": str(photo_id),
    }
