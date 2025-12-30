from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, Enum, ForeignKey, Integer, String, Text, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class ImportStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    completed = "completed"
    failed = "failed"
    canceled = "canceled"


class ImageStatus(str, enum.Enum):
    pending = "pending"
    transferring = "transferring"
    completed = "completed"
    failed = "failed"
    canceled = "canceled"


class CredentialType(str, enum.Enum):
    aws = "aws"
    google = "google"


class UserCredential(Base):
    __tablename__ = "user_credentials"

    id = Column(UUID(as_uuid=True), primary_key=True)
    credential_type = Column(Enum(CredentialType, native_enum=False), nullable=False)  # 'aws' or 'google'
    name = Column(String(255), nullable=False, unique=True)  # User-friendly name
    encrypted_data = Column(Text, nullable=False)  # Encrypted JSON of credentials
    is_default = Column(Boolean, nullable=False, default=False)  # Mark as default
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)


class ImportJob(Base):
    __tablename__ = "import_jobs"

    id = Column(UUID(as_uuid=True), primary_key=True)
    folder_url = Column(Text, nullable=False)
    bucket = Column(String(255), nullable=False)
    prefix = Column(String(255), nullable=True)
    region = Column(String(50), nullable=True)  # AWS region
    status = Column(Enum(ImportStatus, native_enum=False), nullable=False, default=ImportStatus.pending)
    total_files = Column(Integer, nullable=True)
    completed_files = Column(Integer, nullable=False, default=0)
    failed_files = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_error = Column(Text, nullable=True)
    aws_credential_id = Column(UUID(as_uuid=True), nullable=True)  # Reference to user's AWS credential
    google_credential_id = Column(UUID(as_uuid=True), nullable=True)  # Reference to user's Google credential

    images = relationship("Image", back_populates="job", cascade="all, delete-orphan")


class Image(Base):
    __tablename__ = "images"

    id = Column(UUID(as_uuid=True), primary_key=True)
    job_id = Column(UUID(as_uuid=True), ForeignKey("import_jobs.id", ondelete="CASCADE"), nullable=False, index=True)
    drive_file_id = Column(String(128), nullable=False, index=True)
    name = Column(String(512), nullable=False)
    mime_type = Column(String(128), nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    checksum_sha256 = Column(String(128), nullable=True)
    s3_bucket = Column(String(255), nullable=True)
    s3_key = Column(String(1024), nullable=True)
    status = Column(Enum(ImageStatus, native_enum=False), nullable=False, default=ImageStatus.pending)
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)

    job = relationship("ImportJob", back_populates="images")


__all__ = [
    "Base",
    "ImportStatus",
    "ImageStatus",
    "CredentialType",
    "UserCredential",
    "ImportJob",
    "Image",
]
