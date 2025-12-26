from pydantic import field_validator
from pydantic_settings import BaseSettings
import os


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    celery_broker_url: str | None = None
    celery_backend_url: str | None = None

    aws_access_key_id: str
    aws_secret_access_key: str
    aws_region: str = "us-east-1"
    s3_endpoint_url: str | None = None
    s3_force_path_style: bool = False
    s3_bucket: str

    google_api_key: str | None = None

    api_host: str = "0.0.0.0"
    api_port: int = 8000
    
    encryption_key: str | None = None  # For credential encryption

    @field_validator("s3_endpoint_url", mode="before")
    @classmethod
    def _empty_endpoint_to_none(cls, value: str | None):
        if value is None:
            return None
        trimmed = value.strip()
        return trimmed or None

    @field_validator("encryption_key", mode="before")
    @classmethod
    def _generate_encryption_key(cls, value: str | None):
        """Generate or use provided encryption key."""
        if value:
            return value
        # Auto-generate a key if not provided (for development)
        from cryptography.fernet import Fernet
        return Fernet.generate_key().decode()

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
