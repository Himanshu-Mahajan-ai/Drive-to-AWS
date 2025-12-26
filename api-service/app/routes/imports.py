import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from shared.models import ImportJob, ImportStatus
from ..celery_client import celery_app
from ..config import settings
from ..dependencies import get_db
from ..schemas import ImportCreateRequest, ImportResponse

router = APIRouter(prefix="/imports", tags=["imports"])


def _build_s3_bucket(request_bucket: str | None) -> str:
    return request_bucket or settings.s3_bucket


@router.post("", response_model=ImportResponse)
def create_import(payload: ImportCreateRequest, db: Session = Depends(get_db)):
    job_id = uuid4()
    prefix = payload.prefix or f"google-drive/temp-{job_id}"
    bucket = _build_s3_bucket(payload.bucket)
    job = ImportJob(
        id=job_id,
        folder_url=payload.folder_url,
        bucket=bucket,
        prefix=prefix,
        status=ImportStatus.pending,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    celery_app.send_task(
        "tasks.start_import",
        args=[str(job_id)],
        kwargs={
            "folder_url": payload.folder_url,
            "bucket": bucket,
            "prefix": prefix,
            "concurrency": payload.concurrency,
            "dry_run": payload.dry_run,
            "max_items": payload.max_items,
        },
    )

    return job


@router.get("/{job_id}", response_model=ImportResponse)
def get_import(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ImportJob).filter(ImportJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    return job


@router.post("/{job_id}/cancel", response_model=ImportResponse)
def cancel_import(job_id: str, db: Session = Depends(get_db)):
    job = db.query(ImportJob).filter(ImportJob.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Import job not found")
    if job.status in {ImportStatus.completed, ImportStatus.failed, ImportStatus.canceled}:
        return job
    job.status = ImportStatus.canceled
    job.last_error = "Canceled by user"
    db.commit()
    db.refresh(job)
    # Note: already queued tasks will check job status before work.
    return job
