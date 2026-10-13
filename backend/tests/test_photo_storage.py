from io import BytesIO
import os

from PIL import Image
import pytest

from app.services.photo_storage import LocalPhotoStorage
from app.services.work_photos import process_photo


def photo():
    with Image.new("RGB", (64, 48), "blue") as image:
        output = BytesIO()
        image.save(output, format="PNG")
    return process_photo(output.getvalue())


def test_save_read_delete(tmp_path):
    storage = LocalPhotoStorage(tmp_path / "private")
    processed = photo()
    stored = storage.save(processed)
    assert stored.storage_key != stored.thumbnail_storage_key
    assert storage.read(stored.storage_key) == processed.image_bytes
    assert storage.read(stored.thumbnail_storage_key) == processed.thumbnail_bytes
    storage.delete(stored.storage_key)
    storage.delete(stored.thumbnail_storage_key)
    storage.delete(stored.storage_key)
    assert list(storage.root.iterdir()) == []


@pytest.mark.parametrize("key", [
    "../secret.jpg", "/etc/passwd", "C:\\secret.jpg",
    "a" * 32 + ".jpg/../secret", "A" * 32 + ".jpg",
    "a" * 32 + ".png", "", None,
])
def test_invalid_keys(tmp_path, key):
    storage = LocalPhotoStorage(tmp_path)
    for operation in (storage.path_for, storage.read, storage.delete):
        with pytest.raises(ValueError):
            operation(key)


def test_existing_file_not_overwritten(tmp_path):
    storage = LocalPhotoStorage(tmp_path)
    key = "a" * 32 + ".jpg"
    storage._write(key, b"existing")
    with pytest.raises(FileExistsError):
        storage._write(key, b"replacement")
    assert storage.read(key) == b"existing"


def test_partial_save_cleanup(tmp_path, monkeypatch):
    storage = LocalPhotoStorage(tmp_path)
    original_write = storage._write
    calls = 0

    def fail_second_write(key, content):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise OSError("Simulated thumbnail storage failure")
        original_write(key, content)

    monkeypatch.setattr(storage, "_write", fail_second_write)
    with pytest.raises(OSError):
        storage.save(photo())
    assert list(tmp_path.iterdir()) == []


def test_missing_photo(tmp_path):
    storage = LocalPhotoStorage(tmp_path)
    with pytest.raises(FileNotFoundError):
        storage.read("a" * 32 + ".jpg")


def test_symlink_rejected(tmp_path):
    storage = LocalPhotoStorage(tmp_path / "private")
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"private outside data")
    link = storage.root / ("a" * 32 + ".jpg")
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("Creating symlinks is unavailable on this Windows account")
    for operation in (storage.read, storage.delete):
        with pytest.raises(ValueError):
            operation(link.name)
    assert outside.read_bytes() == b"private outside data"


def test_file_permissions_on_posix(tmp_path):
    if os.name != "posix":
        pytest.skip("Windows access is controlled by directory ACLs")
    storage = LocalPhotoStorage(tmp_path / "private")
    stored = storage.save(photo())
    assert storage.path_for(stored.storage_key).stat().st_mode & 0o777 == 0o600
