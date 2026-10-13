from dataclasses import dataclass
from io import BytesIO
import warnings

from PIL import Image, ImageOps, UnidentifiedImageError


MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_INPUT_PIXELS = 20_000_000
MAX_INPUT_SIDE = 12_000
OUTPUT_SIDE = 1600
THUMBNAIL_SIDE = 320
ALLOWED_FORMATS = ("JPEG", "PNG", "WEBP")


class PhotoValidationError(ValueError):
    pass


@dataclass(frozen=True)
class ProcessedPhoto:
    image_bytes: bytes
    thumbnail_bytes: bytes
    original_file_size_bytes: int
    width: int
    height: int
    content_type: str = "image/jpeg"
    extension: str = "jpg"


def check_image(image):
    width, height = image.size
    if (
        width < 1 or height < 1
        or max(width, height) > MAX_INPUT_SIDE
        or width * height > MAX_INPUT_PIXELS
    ):
        raise PhotoValidationError("Image dimensions are too large")

    if image.format not in ALLOWED_FORMATS:
        raise PhotoValidationError("Only JPEG, PNG and WebP images are allowed")

    if getattr(image, "n_frames", 1) != 1:
        raise PhotoValidationError("Animated or multi-frame images are not allowed")


def encode_jpeg(image, side, quality):
    resized = image.copy()
    try:
        resized.thumbnail((side, side), Image.Resampling.LANCZOS)
        output = BytesIO()
        resized.save(
            output,
            format="JPEG",
            quality=quality,
            optimize=True,
            exif=b"",
        )
        return output.getvalue(), resized.size
    finally:
        resized.close()


def process_photo(raw: bytes) -> ProcessedPhoto:
    """
    Validate content, decode, orient, strip metadata and resize.
    Original upload bytes are never returned for storage.
    """
    if not isinstance(raw, bytes) or not raw:
        raise PhotoValidationError("Image is empty")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise PhotoValidationError("Each image must be no larger than 5 MiB")

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)

            with Image.open(BytesIO(raw), formats=ALLOWED_FORMATS) as image:
                check_image(image)
                image.verify()

            with Image.open(BytesIO(raw), formats=ALLOWED_FORMATS) as image:
                check_image(image)
                image.load()
                oriented = ImageOps.exif_transpose(image)
                try:
                    # Composite transparency onto white, then copy pixels
                    # into a fresh image without EXIF, ICC, XMP or text metadata.
                    rgba = oriented.convert("RGBA")
                    try:
                        clean = Image.new("RGB", rgba.size, "white")
                        try:
                            clean.paste(rgba, mask=rgba.getchannel("A"))
                            image_bytes, size = encode_jpeg(clean, OUTPUT_SIDE, 82)
                            thumbnail_bytes, _ = encode_jpeg(
                                clean, THUMBNAIL_SIDE, 75
                            )
                        finally:
                            clean.close()
                    finally:
                        rgba.close()
                finally:
                    oriented.close()

        if (
            len(image_bytes) > MAX_UPLOAD_BYTES
            or len(thumbnail_bytes) > 1024 * 1024
        ):
            raise PhotoValidationError("Processed image exceeds storage limits")

        return ProcessedPhoto(
            image_bytes=image_bytes,
            thumbnail_bytes=thumbnail_bytes,
            original_file_size_bytes=len(raw),
            width=size[0],
            height=size[1],
        )

    except PhotoValidationError:
        raise
    except (
        UnidentifiedImageError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
        OSError,
        ValueError,
        SyntaxError,
        EOFError,
    ) as exc:
        raise PhotoValidationError("Invalid or damaged image") from exc
