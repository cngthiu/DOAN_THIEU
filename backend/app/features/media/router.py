import uuid
from typing import Annotated

from fastapi import APIRouter, File, Header, Query, Response, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse

from app.core.errors import ApiError, error_payload
from app.features.auth.dependencies import (
    ApplicationSettings,
    DatabaseSession,
    MediaReader,
    MediaReaderWithCookie,
    MediaUploader,
)
from app.features.media.schemas import MediaResponse
from app.features.media.service import (
    create_video,
    extract_video_frame,
    media_file_path,
    media_or_error,
    media_response,
    parse_range_header,
    stream_file,
)

router = APIRouter(prefix="/media", tags=["media"])


@router.post("/videos", response_model=MediaResponse, status_code=status.HTTP_201_CREATED)
async def post_video(
    actor: MediaUploader,
    db: DatabaseSession,
    settings: ApplicationSettings,
    file: Annotated[UploadFile, File()],
) -> MediaResponse:
    return media_response(await create_video(db, file, actor, settings))


@router.get("/{media_id}", response_model=MediaResponse)
def get_media(
    media_id: uuid.UUID,
    _: MediaReader,
    db: DatabaseSession,
) -> MediaResponse:
    return media_response(media_or_error(db, media_id))


@router.get("/{media_id}/frame", response_model=None)
def get_media_frame(
    media_id: uuid.UUID,
    _: MediaReader,
    db: DatabaseSession,
    settings: ApplicationSettings,
    timestamp_ms: int = Query(default=5000, ge=0),
) -> Response:
    asset = media_or_error(db, media_id)
    metadata = media_response(asset)
    if timestamp_ms >= metadata.duration_ms:
        raise ApiError(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "VIDEO_FRAME_TIMESTAMP_INVALID",
            "Calibration frame timestamp must be inside the video duration",
            {"duration_ms": metadata.duration_ms},
        )
    content = extract_video_frame(media_file_path(asset, settings), timestamp_ms)
    return Response(
        content=content,
        media_type="image/jpeg",
        headers={"Cache-Control": "private, no-store"},
    )


@router.get("/{media_id}/content", response_model=None)
def get_media_content(
    media_id: uuid.UUID,
    _: MediaReaderWithCookie,
    db: DatabaseSession,
    settings: ApplicationSettings,
    range_header: str | None = Header(default=None, alias="Range"),
) -> StreamingResponse | JSONResponse:
    asset = media_or_error(db, media_id)
    media_response(asset)
    path = media_file_path(asset, settings)
    file_size = path.stat().st_size
    try:
        requested_range = parse_range_header(range_header, file_size)
    except ValueError:
        error = ApiError(
            status.HTTP_416_RANGE_NOT_SATISFIABLE,
            "INVALID_MEDIA_RANGE",
            "Requested media range is not satisfiable",
        )
        return JSONResponse(
            status_code=error.status_code,
            content=error_payload(error),
            headers={"Content-Range": f"bytes */{file_size}", "Accept-Ranges": "bytes"},
        )

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(requested_range.length if requested_range else file_size),
        # Media assets are immutable and addressed by UUID. Let the browser
        # reuse buffered ranges while keeping authenticated video out of shared
        # caches; this avoids re-reading the MP4 after every timeline seek.
        "Cache-Control": "private, max-age=3600",
        "ETag": f'"{asset.sha256}"',
    }
    response_status = status.HTTP_200_OK
    if requested_range is not None:
        response_status = status.HTTP_206_PARTIAL_CONTENT
        headers["Content-Range"] = (
            f"bytes {requested_range.start}-{requested_range.end}/{file_size}"
        )
    return StreamingResponse(
        stream_file(path, requested_range),
        status_code=response_status,
        media_type="video/mp4",
        headers=headers,
    )
