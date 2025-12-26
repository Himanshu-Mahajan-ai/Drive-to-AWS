import boto3
from botocore.config import Config

from .config import settings


def make_s3_client():
    return boto3.client(
        "s3",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
        endpoint_url=settings.s3_endpoint_url or None,
        config=Config(s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"}),
    )


def upload_bytes(client, bucket: str, key: str, data: bytes, mime_type: str | None = None):
    extra = {"ContentType": mime_type} if mime_type else None
    client.put_object(Bucket=bucket, Key=key, Body=data, **({"ContentType": mime_type} if mime_type else {}))
