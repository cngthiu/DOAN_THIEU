import uuid
from datetime import datetime

from pydantic import BaseModel


class MediaResponse(BaseModel):
    id: uuid.UUID
    original_filename: str
    media_url: str
    mime_type: str | None
    codec: str
    width: int
    height: int
    fps: float
    duration_ms: int
    size_bytes: int
    sha256: str
    created_at: datetime
