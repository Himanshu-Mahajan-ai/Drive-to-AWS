from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    celery_broker_url: str | None = None
    celery_backend_url: str | None = None

    # AWS credentials are OPTIONAL - retrieved per-job from DB or fallback to these
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    aws_region: str = "us-east-1"
    s3_endpoint_url: str | None = None
    s3_force_path_style: bool = False
    s3_bucket: str | None = None  # Optional fallback bucket

    # Google credentials are OPTIONAL - public folders work without them
    google_api_key: str | None = None
    google_service_account_json: str | None = None
    google_credentials: str | None = None  # file path to service account JSON

    encryption_key: str | None = None  # For credential encryption (same as API service)

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
