import re
import uuid
import json
from typing import Optional, List, cast
from uuid import UUID

from celery import Celery
from sqlalchemy.orm import Session
from cryptography.fernet import Fernet

from shared.models import Image, ImageStatus, ImportJob, ImportStatus, UserCredential
from .config import settings
from .db import SessionLocal
from .drive_client import DriveClient
from .storage import make_s3_client, upload_bytes

celery_app = Celery(
    "worker-service",
    broker=settings.celery_broker_url or settings.redis_url,
    backend=settings.celery_backend_url or settings.redis_url,
)
celery_app.conf.task_default_queue = "imports"
celery_app.conf.task_acks_late = True
celery_app.conf.worker_prefetch_multiplier = 8  # Aggressive prefetch to keep 16 workers busy (128 in-flight)
celery_app.conf.broker_transport_options = {"visibility_timeout": 3600}
celery_app.conf.broker_pool_limit = 30  # Larger Redis pool for multiple workers


def decrypt_credential(encrypted_data: str) -> dict:
    """Decrypt encrypted credential data using Fernet."""
    key = settings.encryption_key
    if not key:
        raise RuntimeError("ENCRYPTION_KEY not configured")
    cipher = Fernet(key.encode() if isinstance(key, str) else key)
    decrypted = cipher.decrypt(encrypted_data.encode() if isinstance(encrypted_data, str) else encrypted_data)
    return json.loads(decrypted.decode())


FOLDER_PATTERN = re.compile(r"/folders/([a-zA-Z0-9_-]+)")
BATCH_SIZE = 100  # Smaller batches = faster initial enqueuing


def _parse_folder_id(folder_url: str) -> str:
    match = FOLDER_PATTERN.search(folder_url)
    if not match:
        raise ValueError("Invalid folder URL")
    return match.group(1)


@celery_app.task(name="tasks.start_import")
def start_import(job_id: str, folder_url: str, bucket: str, prefix: Optional[str] = None, concurrency: int = 8, dry_run: bool = False, max_items: Optional[int] = None):
    session: Session = SessionLocal()
    try:
        job = session.query(ImportJob).filter(ImportJob.id == job_id).first()
        if not job:
            return
        if cast(ImportStatus, job.status) == ImportStatus.canceled:
            return
        job.status = ImportStatus.running  # type: ignore[assignment]
        session.commit()

        drive = DriveClient()
        folder_id = _parse_folder_id(folder_url)
        
        # Fetch actual folder name from Google Drive
        folder_name = drive.get_folder_name(folder_id)
        # Update job prefix with actual folder name (always update if it contains temp or job_id)
        if not prefix or prefix.startswith("google-drive/temp-") or f"google-drive/{folder_id}" in prefix:
            prefix = f"google-drive/{folder_name}"
            job.prefix = prefix  # type: ignore[assignment]
            session.commit()

        total = 0
        batch: List[Image] = []
        for file in drive.list_files(folder_id, page_size=100):  # Smaller pages = faster start
            if max_items and total >= max_items:
                break
            if cast(ImportStatus, job.status) == ImportStatus.canceled:
                break
            total += 1
            img = Image(
                id=uuid.uuid4(),
                job_id=job.id,
                drive_file_id=file.id,
                name=file.name,
                mime_type=file.mime_type,
                size_bytes=file.size_bytes,
                status=ImageStatus.pending,
            )
            batch.append(img)
            if len(batch) >= BATCH_SIZE:
                session.bulk_save_objects(batch)
                session.commit()
                if not dry_run and cast(ImportStatus, job.status) != ImportStatus.canceled:
                    for saved in batch:
                        celery_app.send_task(
                            "tasks.transfer_file",
                            args=[str(saved.id)],
                            kwargs={
                                "bucket": bucket,
                                "prefix": prefix,
                                "drive_file_id": saved.drive_file_id,
                                "file_name": saved.name,
                                "mime_type": saved.mime_type,
                                "aws_credential_id": str(job.aws_credential_id) if job.aws_credential_id is not None else None,
                            },
                        )
                batch.clear()

        if batch:
            session.bulk_save_objects(batch)
            session.commit()
            if not dry_run and cast(ImportStatus, job.status) != ImportStatus.canceled:
                for saved in batch:
                    celery_app.send_task(
                        "tasks.transfer_file",
                        args=[str(saved.id)],
                        kwargs={
                            "bucket": bucket,
                            "prefix": prefix,
                            "drive_file_id": saved.drive_file_id,
                            "file_name": saved.name,
                            "mime_type": saved.mime_type,
                            "aws_credential_id": str(job.aws_credential_id) if job.aws_credential_id is not None else None,
                        },
                    )
            batch.clear()

        job.total_files = total  # type: ignore[assignment]
        session.commit()

        # Finalize status in case all transfers finished before total_files was set
        try:
            job = session.query(ImportJob).filter(ImportJob.id == job_id).first()
            if job and cast(ImportStatus, job.status) != ImportStatus.canceled:
                total_processed = (job.completed_files or 0) + (job.failed_files or 0)
                if job.total_files and total_processed >= job.total_files:  # type: ignore[truthy-bool]
                    job.status = ImportStatus.completed  # type: ignore[assignment]
                    session.commit()
        except Exception:
            # If any issue occurs here, ignore to not break the task
            pass
    except Exception as exc:
        job = session.query(ImportJob).filter(ImportJob.id == job_id).first()
        if job:
            job.status = ImportStatus.failed  # type: ignore[assignment]
            job.last_error = str(exc)  # type: ignore[assignment]
            session.commit()
        raise
    finally:
        session.close()


@celery_app.task(name="tasks.transfer_file", bind=True, max_retries=3, autoretry_for=(Exception,), retry_backoff=True, retry_backoff_max=60, retry_jitter=True)
def transfer_file(self, image_id: str, bucket: str, prefix: Optional[str], drive_file_id: str, file_name: str, mime_type: Optional[str], aws_credential_id: Optional[str] = None):
    session: Session = SessionLocal()
    try:
        image = session.query(Image).filter(Image.id == image_id).first()
        if not image:
            return
        job = session.query(ImportJob).filter(ImportJob.id == image.job_id).first()
        if job and cast(ImportStatus, job.status) == ImportStatus.canceled:
            image.status = ImageStatus.canceled  # type: ignore[assignment]
            session.commit()
            return
        image.status = ImageStatus.transferring  # type: ignore[assignment]
        session.commit()

        drive = DriveClient()
        data = drive.download_stream(drive_file_id)

        # Use custom AWS credentials if provided, otherwise use defaults
        aws_config = None
        if aws_credential_id:
            # Convert string UUID to UUID object for query
            cred_uuid = UUID(aws_credential_id) if isinstance(aws_credential_id, str) else aws_credential_id
            cred = session.query(UserCredential).filter(UserCredential.id == cred_uuid).first()
            if cred:
                aws_config = decrypt_credential(str(cred.encrypted_data))
        
        client = make_s3_client(aws_config)
        key = f"{prefix}/{file_name}" if prefix else file_name
        upload_bytes(client, bucket, key, data, mime_type)

        image.status = ImageStatus.completed  # type: ignore[assignment]
        image.s3_bucket = bucket  # type: ignore[assignment]
        image.s3_key = key  # type: ignore[assignment]
        session.commit()

        job = job or session.query(ImportJob).filter(ImportJob.id == image.job_id).first()
        if job:
            job.completed_files = (job.completed_files or 0) + 1  # type: ignore[assignment]
            total_processed = (job.completed_files or 0) + (job.failed_files or 0)
            if job.total_files and total_processed >= job.total_files:  # type: ignore[truthy-bool]
                job.status = ImportStatus.completed  # type: ignore[assignment]
            session.commit()
    except Exception as exc:
        session.rollback()
        
        # Check if we've exhausted retries
        if self.request.retries >= self.max_retries:
            # Final failure after all retries - mark as failed
            image = session.query(Image).filter(Image.id == image_id).first()
            if image:
                image.status = ImageStatus.failed  # type: ignore[assignment]
                image.error = f"Failed after {self.max_retries + 1} attempts: {str(exc)}"  # type: ignore[assignment]
                session.commit()
                job = session.query(ImportJob).filter(ImportJob.id == image.job_id).first()
                if job:
                    job.failed_files = (job.failed_files or 0) + 1  # type: ignore[assignment]
                    if cast(ImportStatus, job.status) != ImportStatus.canceled:
                        job.status = ImportStatus.running  # type: ignore[assignment]
                    job.last_error = f"Transfer failed for {file_name}: {str(exc)}"  # type: ignore[assignment]
                    session.commit()
            raise  # Don't retry anymore
        else:
            # Still have retries left - will retry automatically
            raise
    finally:
        session.close()
