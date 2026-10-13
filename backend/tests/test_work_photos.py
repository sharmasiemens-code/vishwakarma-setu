from io import BytesIO

import pytest
from PIL import Image, PngImagePlugin, features

from app.services.work_photos import (
    MAX_UPLOAD_BYTES,
    PhotoValidationError,
    process_photo,
)


def image_bytes(format="PNG", size=(64, 48), **options):
    with Image.new("RGB", size, "blue") as image:
        output = BytesIO()
        image.save(output, format=format, **options)
        return output.getvalue()


@pytest.mark.parametrize("format", ["JPEG", "PNG", "WEBP"])
def test_supported_content(format):
    if format == "WEBP" and not features.check("webp"):
        pytest.fail("Installed Pillow lacks required WebP support")
    result = process_photo(image_bytes(format))
    assert result.content_type == "image/jpeg"
    assert result.original_file_size_bytes > 0
    for data in (result.image_bytes, result.thumbnail_bytes):
        with Image.open(BytesIO(data)) as image:
            assert image.format == "JPEG"
            image.load()


@pytest.mark.parametrize("raw", [
    b"",
    b"<script>alert(1)</script>",
    b"%PDF-1.7 fake image",
    b"\xff\xd8\xff truncated jpeg",
])
def test_invalid_content(raw):
    with pytest.raises(PhotoValidationError):
        process_photo(raw)


def test_oversized_upload():
    with pytest.raises(PhotoValidationError):
        process_photo(b"x" * (MAX_UPLOAD_BYTES + 1))


def test_unsupported_image_format():
    with pytest.raises(PhotoValidationError):
        process_photo(image_bytes("BMP"))


def test_animation_rejected():
    with Image.new("RGB", (32, 32), "red") as first:
        with Image.new("RGB", (32, 32), "blue") as second:
            output = BytesIO()
            first.save(
                output, format="PNG", save_all=True,
                append_images=[second], duration=100, loop=0,
            )
    with pytest.raises(PhotoValidationError):
        process_photo(output.getvalue())


def test_pixel_limit():
    with pytest.raises(PhotoValidationError):
        process_photo(image_bytes(size=(4500, 4500)))


def test_resize_and_thumbnail():
    result = process_photo(image_bytes(size=(2400, 1200)))
    assert (result.width, result.height) == (1600, 800)
    with Image.open(BytesIO(result.thumbnail_bytes)) as thumb:
        assert thumb.size == (320, 160)


def test_exif_orientation_and_removal():
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "Private customer metadata"
    raw = image_bytes("JPEG", size=(80, 40), exif=exif)
    result = process_photo(raw)
    assert (result.width, result.height) == (40, 80)
    for data in (result.image_bytes, result.thumbnail_bytes):
        with Image.open(BytesIO(data)) as image:
            assert not image.getexif()
            assert "icc_profile" not in image.info
            assert "xmp" not in image.info


def test_png_text_removed():
    metadata = PngImagePlugin.PngInfo()
    metadata.add_text("Private", "Customer metadata")
    result = process_photo(image_bytes(pnginfo=metadata))
    assert b"Customer metadata" not in result.image_bytes
    assert b"Customer metadata" not in result.thumbnail_bytes


def test_transparency_composited_on_white():
    with Image.new("RGBA", (32, 32), (255, 0, 0, 0)) as image:
        output = BytesIO()
        image.save(output, format="PNG")
    result = process_photo(output.getvalue())
    with Image.open(BytesIO(result.image_bytes)) as image:
        assert all(channel >= 250 for channel in image.getpixel((16, 16)))
