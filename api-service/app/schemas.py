from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field
from uuid import UUID

from shared.models import ImageStatus, ImportStatus


class ImportCreateRequest(BaseModel):
    folder_url: str
    bucket: str | None = None
    prefix: str | None = None
    concurrency: int = Field(default=8, ge=1, le=64)
    dry_run: bool = False
    max_items: int | None = Field(default=None, ge=1)
    aws_credential_id: UUID | None = None
    google_credential_id: UUID | None = None


class ImportResponse(BaseModel):
    id: UUID
    status: ImportStatus
    folder_url: str
    bucket: str
    prefix: str | None
    region: str | None
    total_files: int | None
    completed_files: int
    failed_files: int
    last_error: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class ImageResponse(BaseModel):
    id: UUID
    job_id: UUID
    drive_file_id: str
    name: str
    mime_type: str | None
    size_bytes: int | None
    checksum_sha256: str | None
    s3_bucket: str | None
    s3_key: str | None
    status: ImageStatus
    error: str | None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
