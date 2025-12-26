import re
import uuid
from typing import Optional, List

from celery import Celery
from sqlalchemy.orm import Session
from tenacity import retry, stop_after_attempt, wait_exponential

from shared.models import Image, ImageStatus, ImportJob, ImportStatus
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
celery_app.conf.broker_transport_options = {"visibility_timeout": 3600}


FOLDER_PATTERN = re.compile(r"/folders/([a-zA-Z0-9_-]+)")
BATCH_SIZE = 1000


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
        if job.status == ImportStatus.canceled:
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
            job.prefix = prefix
            session.commit()

        total = 0
        batch: List[Image] = []
        for file in drive.list_files(folder_id, page_size=1000):
            if max_items and total >= max_items:
                break
            if job.status == ImportStatus.canceled:
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
                if not dry_run and job.status != ImportStatus.canceled:
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
                            },
                        )
                batch.clear()

        if batch:
            session.bulk_save_objects(batch)
            session.commit()
            if not dry_run and job.status != ImportStatus.canceled:
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
                        },
                    )
            batch.clear()

        job.total_files = total  # type: ignore[assignment]
        session.commit()
    except Exception as exc:
        job = session.query(ImportJob).filter(ImportJob.id == job_id).first()
        if job:
            job.status = ImportStatus.failed  # type: ignore[assignment]
            job.last_error = str(exc)  # type: ignore[assignment]
            session.commit()
        raise
    finally:
        session.close()


@celery_app.task(name="tasks.transfer_file")
@retry(stop=stop_after_attempt(5), wait=wait_exponential(multiplier=1, min=2, max=20))
def transfer_file(image_id: str, bucket: str, prefix: Optional[str], drive_file_id: str, file_name: str, mime_type: Optional[str]):
    session: Session = SessionLocal()
    try:
        image = session.query(Image).filter(Image.id == image_id).first()
        if not image:
            return
        job = session.query(ImportJob).filter(ImportJob.id == image.job_id).first()
        if job and job.status == ImportStatus.canceled:
            image.status = ImageStatus.canceled  # type: ignore[assignment]
            session.commit()
            return
        image.status = ImageStatus.transferring  # type: ignore[assignment]
        session.commit()

        drive = DriveClient()
        data = drive.download_stream(drive_file_id)

        client = make_s3_client()
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
        image = session.query(Image).filter(Image.id == image_id).first()
        if image:
            image.status = ImageStatus.failed  # type: ignore[assignment]
            image.error = str(exc)  # type: ignore[assignment]
            session.commit()
            job = session.query(ImportJob).filter(ImportJob.id == image.job_id).first()
            if job:
                job.failed_files = (job.failed_files or 0) + 1  # type: ignore[assignment]
                if job.status != ImportStatus.canceled:
                    job.status = ImportStatus.running  # type: ignore[assignment]
                job.last_error = str(exc)  # type: ignore[assignment]
                session.commit()
        raise
    finally:
        session.close()
