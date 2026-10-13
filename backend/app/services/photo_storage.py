from dataclasses import dataclass
import os
from pathlib import Path
import re
from typing import Protocol
from uuid import uuid4

from app.services.work_photos import MAX_UPLOAD_BYTES, ProcessedPhoto


KEY_PATTERN = re.compile(r"[a-f0-9]{32}\.jpg")


@dataclass(frozen=True)
class StoredPhoto:
    storage_key: str
    thumbnail_storage_key: str


class PhotoStorage(Protocol):
    def save(self, photo: ProcessedPhoto) -> StoredPhoto: ...
    def read(self, key: str) -> bytes: ...
    def delete(self, key: str) -> None: ...


class LocalPhotoStorage:
    """
    Private storage. Never mount this directory with StaticFiles.
    Storage keys must come from server-generated database metadata.
    """
    def __init__(self, root: Path):
        root = Path(root)
        if root.is_symlink():
            raise ValueError("Storage root must not be a symbolic link")
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.root = root.resolve()

    def path_for(self, key: str) -> Path:
        if not isinstance(key, str) or KEY_PATTERN.fullmatch(key) is None:
            raise ValueError("Invalid photo storage key")
        path = self.root / key
        if path.is_symlink() or path.resolve().parent != self.root:
            raise ValueError("Unsafe photo storage path")
        return path

    def _write(self, key: str, content: bytes) -> None:
        if not isinstance(content, bytes) or not 0 < len(content) <= MAX_UPLOAD_BYTES:
            raise ValueError("Invalid photo storage content")
        path = self.path_for(key)
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
        flags |= getattr(os, "O_BINARY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as handle:
                descriptor = None
                handle.write(content)
        except BaseException:
            if descriptor is not None:
                os.close(descriptor)
            path.unlink(missing_ok=True)
            raise

    def save(self, photo: ProcessedPhoto) -> StoredPhoto:
        original = uuid4().hex + ".jpg"
        thumbnail = uuid4().hex + ".jpg"
        self._write(original, photo.image_bytes)
        try:
            self._write(thumbnail, photo.thumbnail_bytes)
        except BaseException:
            self.delete(original)
            raise
        return StoredPhoto(original, thumbnail)

    def read(self, key: str) -> bytes:
        path = self.path_for(key)
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0)
        flags |= getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags)
        with os.fdopen(descriptor, "rb") as handle:
            content = handle.read(MAX_UPLOAD_BYTES + 1)
        if not 0 < len(content) <= MAX_UPLOAD_BYTES:
            raise ValueError("Invalid stored photo size")
        return content

    def delete(self, key: str) -> None:
        self.path_for(key).unlink(missing_ok=True)


def get_photo_storage() -> PhotoStorage:
    configured = os.getenv("PRIVATE_PHOTO_STORAGE_DIR")
    default = Path(__file__).resolve().parents[2] / "private_storage" / "work_photos"
    return LocalPhotoStorage(Path(configured) if configured else default)
