"""Upload validation for Detective photos (stdlib only, no Pillow).

Checks, in order: declared content type, byte size, and magic-byte sniffing
so a renamed non-image cannot pass. PNG/GIF/JPEG dimensions are parsed
best-effort for the response; unknown layouts yield ``None`` dimensions
rather than an error.
"""

import struct

from fastapi import UploadFile

from app import config


class PhotoValidationError(Exception):
    """Caller maps this to a 400 response with a clear message."""

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


_SIGNATURES: dict[bytes, str] = {
    b"\xff\xd8\xff": "image/jpeg",
    b"\x89PNG\r\n\x1a\n": "image/png",
    b"GIF87a": "image/gif",
    b"GIF89a": "image/gif",
}


def sniff_content_type(data: bytes) -> str | None:
    for signature, content_type in _SIGNATURES.items():
        if data.startswith(signature):
            return content_type
    if (
        len(data) >= 12
        and data[0:4] == b"RIFF"
        and data[8:12] == b"WEBP"
    ):
        return "image/webp"
    return None


def png_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 26 or data[12:16] != b"IHDR":
        return None
    width, height = struct.unpack(">II", data[16:24])
    if width == 0 or height == 0 or width > 30000 or height > 30000:
        return None
    return (width, height)


def gif_dimensions(data: bytes) -> tuple[int, int] | None:
    if len(data) < 10:
        return None
    width, height = struct.unpack("<HH", data[6:10])
    if width == 0 or height == 0:
        return None
    return (width, height)


def jpeg_dimensions(data: bytes) -> tuple[int, int] | None:
    pos = 2
    end = len(data) - 9
    try:
        while pos < end:
            if data[pos] != 0xFF:
                pos += 1
                continue
            marker = data[pos + 1]
            if marker in (0xC0, 0xC1, 0xC2):
                height, width = struct.unpack(">HH", data[pos + 5 : pos + 9])
                if width and height:
                    return (width, height)
                return None
            if marker == 0xD8 or (0xD0 <= marker <= 0xD9):
                pos += 2
                continue
            (length,) = struct.unpack(">H", data[pos + 2 : pos + 4])
            if length < 2:
                return None
            pos += 2 + length
    except (IndexError, struct.error):
        return None
    return None


def dimensions_for(content_type: str, data: bytes) -> tuple[int, int] | None:
    if content_type == "image/png":
        return png_dimensions(data)
    if content_type == "image/gif":
        return gif_dimensions(data)
    if content_type == "image/jpeg":
        return jpeg_dimensions(data)
    return None


async def read_validated_photo(
    photo: UploadFile,
) -> tuple[bytes, str, tuple[int, int] | None]:
    """Read and validate an upload. Returns (bytes, content_type, dimensions)."""
    declared = (photo.content_type or "").lower()
    if declared not in config.DETECTIVE_ALLOWED_PHOTO_TYPES:
        raise PhotoValidationError(
            "Unsupported photo type. Use JPEG, PNG, WebP, or GIF."
        )
    data = await photo.read()
    if len(data) > config.DETECTIVE_MAX_PHOTO_BYTES:
        limit_mb = config.DETECTIVE_MAX_PHOTO_BYTES / (1024 * 1024)
        raise PhotoValidationError(
            f"Photo is too large. Maximum size is {limit_mb:g} MB."
        )
    if not data:
        raise PhotoValidationError("Photo file is empty.")
    sniffed = sniff_content_type(data)
    if sniffed is None:
        raise PhotoValidationError(
            "File contents are not a recognized photo. Use JPEG, PNG, WebP, or GIF."
        )
    if sniffed != declared:
        raise PhotoValidationError(
            f"File contents look like {sniffed}, not {declared}. Upload the original file."
        )
    return (data, sniffed, dimensions_for(sniffed, data))
