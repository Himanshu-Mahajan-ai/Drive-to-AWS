import json
import boto3
from botocore.config import Config
from typing import Optional

from .config import settings


def make_s3_client(aws_config: Optional[dict] = None):
    """
    Create an S3 client with optimized settings for maximum throughput.
    If aws_config is provided, use those credentials instead of env defaults.
    aws_config should contain: access_key_id, secret_access_key, region, endpoint_url, force_path_style
    """
    # Optimized config for maximum performance
    config = Config(
        s3={
            "addressing_style": "path" if (aws_config and aws_config.get("force_path_style", False)) or settings.s3_force_path_style else "auto"
        },
        max_pool_connections=50,  # Increase connection pool for parallel uploads
        retries={"max_attempts": 3, "mode": "adaptive"},
        tcp_keepalive=True,
    )
    
    if aws_config:
        return boto3.client(
            "s3",
            region_name=aws_config.get("region", "us-east-1"),
            aws_access_key_id=aws_config.get("access_key_id"),
            aws_secret_access_key=aws_config.get("secret_access_key"),
            endpoint_url=aws_config.get("endpoint_url") or None,
            config=config,
        )
    else:
        return boto3.client(
            "s3",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            endpoint_url=settings.s3_endpoint_url or None,
            config=config,
        )


def upload_bytes(client, bucket: str, key: str, data: bytes, mime_type: str | None = None):
    """Upload data to S3 with optimized settings."""
    extra_args = {}
    if mime_type:
        extra_args["ContentType"] = mime_type
    
    # Use multipart upload for files larger than 5MB for better performance
    if len(data) > 5 * 1024 * 1024:
        # Create multipart upload
        mpu = client.create_multipart_upload(Bucket=bucket, Key=key, **extra_args)
        upload_id = mpu["UploadId"]
        
        try:
            parts = []
            part_size = 5 * 1024 * 1024  # 5MB chunks
            part_num = 1
            
            for i in range(0, len(data), part_size):
                chunk = data[i:i + part_size]
                response = client.upload_part(
                    Bucket=bucket,
                    Key=key,
                    PartNumber=part_num,
                    UploadId=upload_id,
                    Body=chunk,
                )
                parts.append({"PartNumber": part_num, "ETag": response["ETag"]})
                part_num += 1
            
            # Complete multipart upload
            client.complete_multipart_upload(
                Bucket=bucket,
                Key=key,
                UploadId=upload_id,
                MultipartUpload={"Parts": parts},
            )
        except Exception as e:
            # Abort multipart upload on error
            client.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
            raise e
    else:
        # Standard upload for smaller files
        client.put_object(Bucket=bucket, Key=key, Body=data, **extra_args)
