import hashlib
import re
import shutil
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import cv2  # type: ignore[import-untyped]
from fastapi import UploadFile, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.errors import ApiError
from app.db.models.media import MediaAsset
from app.db.models.user import User
from app.features.media.schemas import MediaResponse
from app.shared.audit import AuditAction, AuditService
from app.video.probe import VideoMetadata, VideoProbeError, probe_video

UPLOAD_CHUNK_SIZE = 1024 * 1024
STREAM_CHUNK_SIZE = 1024 * 1024
SUPPORTED_MP4_FORMATS = {"mp4", "mov"}
SUPPORTED_BROWSER_CODECS = {"h264"}
FRAME_JPEG_QUALITY = 88


@dataclass(frozen=True, slots=True)
class ByteRange:
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start + 1


def sanitize_original_filename(filename: str | None) -> str:
    if not filename:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "VIDEO_FILE_REQUIRED",
            "A video file is required",
        )
    basename = filename.replace("\\", "/").rsplit("/", 1)[-1]
    sanitized = re.sub(r"[\x00-\x1f\x7f]", "", basename).strip()
    return (sanitized or "video.mp4")[:255]


def media_response(asset: MediaAsset) -> MediaResponse:
    codec = asset.codec
    width = asset.width
    height = asset.height
    fps = asset.fps
    duration_ms = asset.duration_ms
    size_bytes = asset.size_bytes
    sha256 = asset.sha256
    if (
        codec is None
        or width is None
        or height is None
        or fps is None
        or duration_ms is None
        or size_bytes is None
        or sha256 is None
        or codec not in SUPPORTED_BROWSER_CODECS
        or width <= 0
        or height <= 0
        or fps <= 0
        or duration_ms <= 0
        or size_bytes <= 0
        or len(sha256) != 64
    ):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "MEDIA_METADATA_INVALID",
            "Media metadata is incomplete or invalid",
        )
    return MediaResponse(
        id=asset.id,
        original_filename=asset.original_filename,
        media_url=f"/api/v1/media/{asset.id}/content",
        mime_type=asset.mime_type,
        codec=codec,
        width=width,
        height=height,
        fps=fps,
        duration_ms=duration_ms,
        size_bytes=size_bytes,
        sha256=sha256,
        created_at=asset.created_at,
    )


def media_or_error(db: Session, media_id: uuid.UUID) -> MediaAsset:
    asset = db.get(MediaAsset, media_id)
    if asset is None:
        raise ApiError(status.HTTP_404_NOT_FOUND, "MEDIA_NOT_FOUND", "Media was not found")
    return asset


def media_file_path(asset: MediaAsset, settings: Settings) -> Path:
    relative = PurePosixPath(asset.storage_path)
    if relative.is_absolute() or ".." in relative.parts:
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "MEDIA_PATH_INVALID",
            "Stored media path is invalid",
        )
    root = settings.upload_root.resolve()
    candidate = (root / Path(*relative.parts)).resolve()
    if not candidate.is_relative_to(root):
        raise ApiError(
            status.HTTP_409_CONFLICT,
            "MEDIA_PATH_INVALID",
            "Stored media path is invalid",
        )
    if not candidate.is_file():
        raise ApiError(
            status.HTTP_404_NOT_FOUND,
            "MEDIA_FILE_MISSING",
            "Media file is not available",
        )
    return candidate


def _validate_probe(metadata: VideoMetadata) -> None:
    if not SUPPORTED_MP4_FORMATS.intersection(metadata.format_names):
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_VIDEO_CONTAINER",
            "The uploaded file is not a supported MP4 video",
        )
    if metadata.codec not in SUPPORTED_BROWSER_CODECS:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "UNSUPPORTED_VIDEO_CODEC",
            "The uploaded MP4 must use the H.264 video codec",
            {"codec": metadata.codec},
        )


async def create_video(
    db: Session,
    upload: UploadFile,
    actor: User,
    settings: Settings,
) -> MediaAsset:
    try:
        original_filename = sanitize_original_filename(upload.filename)
    except ApiError:
        await upload.close()
        raise
    if Path(original_filename).suffix.lower() != ".mp4":
        await upload.close()
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "INVALID_VIDEO_EXTENSION",
            "Only MP4 files are accepted",
        )

    media_id = uuid.uuid4()
    root = settings.upload_root.resolve()
    temporary_root = root / ".tmp"
    temporary_path = temporary_root / f"{media_id}.upload"
    media_directory = root / str(media_id)
    final_path = media_directory / "source.mp4"
    digest = hashlib.sha256()
    size_bytes = 0
    finalized = False
    committed = False

    try:
        root.mkdir(parents=True, exist_ok=True)
        temporary_root.mkdir(parents=True, exist_ok=True)
        with temporary_path.open("xb") as destination:
            while chunk := await upload.read(UPLOAD_CHUNK_SIZE):
                size_bytes += len(chunk)
                if size_bytes > settings.max_upload_bytes:
                    raise ApiError(
                        status.HTTP_413_CONTENT_TOO_LARGE,
                        "VIDEO_TOO_LARGE",
                        "Video exceeds the configured upload size limit",
                        {"max_upload_bytes": settings.max_upload_bytes},
                    )
                digest.update(chunk)
                destination.write(chunk)
        if size_bytes == 0:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "VIDEO_EMPTY",
                "Uploaded video is empty",
            )
        try:
            metadata = probe_video(
                temporary_path,
                timeout_seconds=settings.ffprobe_timeout_seconds,
            )
        except VideoProbeError as error:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "INVALID_VIDEO",
                "The uploaded file could not be read as a video",
            ) from error
        _validate_probe(metadata)

        asset = MediaAsset(
            id=media_id,
            original_filename=original_filename,
            stored_filename="source.mp4",
            storage_path=f"{media_id}/source.mp4",
            mime_type="video/mp4",
            codec=metadata.codec,
            width=metadata.width,
            height=metadata.height,
            fps=metadata.fps,
            duration_ms=metadata.duration_ms,
            size_bytes=size_bytes,
            sha256=digest.hexdigest(),
            created_by=actor.id,
        )
        db.add(asset)
        db.flush()
        media_directory.mkdir(parents=False, exist_ok=False)
        temporary_path.replace(final_path)
        finalized = True
        AuditService.record(
            db,
            actor=actor,
            action=AuditAction.MEDIA_VIDEO_UPLOADED,
            entity_type="MEDIA_ASSET",
            entity_id=asset.id,
            metadata={
                "original_filename": asset.original_filename,
                "size_bytes": size_bytes,
                "sha256": asset.sha256,
            },
        )
        db.commit()
        committed = True
        db.refresh(asset)
        return asset
    except ApiError:
        db.rollback()
        raise
    except (OSError, SQLAlchemyError) as error:
        db.rollback()
        raise ApiError(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "MEDIA_SAVE_FAILED",
            "Video could not be stored",
        ) from error
    finally:
        await upload.close()
        temporary_path.unlink(missing_ok=True)
        if finalized and not committed:
            final_path.unlink(missing_ok=True)
            shutil.rmtree(media_directory, ignore_errors=True)


def parse_range_header(header: str | None, file_size: int) -> ByteRange | None:
    if header is None:
        return None
    if file_size <= 0 or not header.startswith("bytes=") or "," in header:
        raise ValueError("Invalid byte range")
    specification = header[6:].strip()
    if "-" not in specification:
        raise ValueError("Invalid byte range")
    start_text, end_text = specification.split("-", 1)
    try:
        if not start_text:
            suffix = int(end_text)
            if suffix <= 0:
                raise ValueError("Invalid byte range")
            start = max(file_size - suffix, 0)
            end = file_size - 1
        else:
            start = int(start_text)
            end = file_size - 1 if not end_text else min(int(end_text), file_size - 1)
    except ValueError as error:
        raise ValueError("Invalid byte range") from error
    if start < 0 or start >= file_size or end < start:
        raise ValueError("Invalid byte range")
    return ByteRange(start=start, end=end)


def stream_file(path: Path, byte_range: ByteRange | None) -> Iterator[bytes]:
    start = byte_range.start if byte_range else 0
    remaining = byte_range.length if byte_range else path.stat().st_size
    with path.open("rb") as source:
        source.seek(start)
        while remaining > 0:
            chunk = source.read(min(STREAM_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def extract_video_frame(path: Path, timestamp_ms: int) -> bytes:
    """Decode one reusable calibration frame; this is not a streaming endpoint."""
    capture = cv2.VideoCapture(str(path))
    try:
        if not capture.isOpened():
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "VIDEO_FRAME_UNAVAILABLE",
                "A calibration frame could not be decoded from this video",
            )
        capture.set(cv2.CAP_PROP_POS_MSEC, float(timestamp_ms))
        ok, frame = capture.read()
        if not ok or frame is None:
            raise ApiError(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                "VIDEO_FRAME_UNAVAILABLE",
                "A calibration frame could not be decoded from this video",
            )
        encoded, buffer = cv2.imencode(
            ".jpg",
            frame,
            [int(cv2.IMWRITE_JPEG_QUALITY), FRAME_JPEG_QUALITY],
        )
        if not encoded:
            raise ApiError(
                status.HTTP_500_INTERNAL_SERVER_ERROR,
                "VIDEO_FRAME_ENCODING_FAILED",
                "The calibration frame could not be encoded",
            )
        return bytes(buffer)
    finally:
        capture.release()
