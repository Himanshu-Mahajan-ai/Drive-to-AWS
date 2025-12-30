import re
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from shared.models import ImportJob, ImportStatus, UserCredential, CredentialType
from ..credentials import decrypt_credential
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

    bucket: str | None = payload.bucket
    aws_cred_id = payload.aws_credential_id
    region: str | None = None

    # If bucket not provided but an AWS credential id is, derive bucket and region from that credential
    if not bucket and aws_cred_id:
        cred = db.query(UserCredential).filter(UserCredential.id == aws_cred_id).first()
        if not cred:
            raise HTTPException(status_code=404, detail="AWS credential not found")
        if cred.credential_type != CredentialType.aws:  # type: ignore[comparison-overlap]
            raise HTTPException(status_code=400, detail="Provided credential is not AWS type")
        data = decrypt_credential(str(cred.encrypted_data))
        bucket = data.get("bucket") or None
        region = data.get("region") or "us-east-1"
    elif aws_cred_id:
        # If bucket provided but credential id also provided, get region from credential
        cred = db.query(UserCredential).filter(UserCredential.id == aws_cred_id).first()
        if cred and cred.credential_type == CredentialType.aws:  # type: ignore[comparison-overlap]
            data = decrypt_credential(str(cred.encrypted_data))
            region = data.get("region") or "us-east-1"

    bucket = _build_s3_bucket(bucket)
    job = ImportJob(
        id=job_id,
        folder_url=payload.folder_url,
        bucket=bucket,
        prefix=prefix,
        region=region,
        status=ImportStatus.pending,
        aws_credential_id=aws_cred_id,
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
    job.status = ImportStatus.canceled  # type: ignore[assignment]
    job.last_error = "Canceled by user"  # type: ignore[assignment]
    db.commit()
    db.refresh(job)
    # Note: already queued tasks will check job status before work.
    return job
