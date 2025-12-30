"""Credentials management API routes."""
from datetime import datetime
from uuid import uuid4, UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
import boto3
from botocore.config import Config

from shared.models import UserCredential, CredentialType
from ..credentials import encrypt_credential, decrypt_credential
from ..dependencies import get_db

router = APIRouter(prefix="/credentials", tags=["credentials"])


class AWSCredentialRequest(BaseModel):
    name: str
    access_key_id: str
    secret_access_key: str
    region: str = "us-east-1"
    bucket: str
    endpoint_url: str | None = None
    force_path_style: bool = False


class AWSUpdateRequest(BaseModel):
    name: str
    access_key_id: str
    secret_access_key: str
    region: str = "us-east-1"
    bucket: str
    endpoint_url: str | None = None
    force_path_style: bool = False


class GoogleCredentialRequest(BaseModel):
    name: str
    api_key: str | None = None
    service_account_json: str | None = None


class CredentialResponse(BaseModel):
    id: UUID
    credential_type: str
    name: str
    created_at: datetime
    is_default: bool

    class Config:
        from_attributes = True


class CredentialVerificationResponse(BaseModel):
    valid: bool
    message: str
    bucket: str | None = None
    region: str | None = None


@router.post("/aws", response_model=CredentialResponse)
def add_aws_credential(payload: AWSCredentialRequest, db: Session = Depends(get_db)):
    """Add AWS credentials."""
    # Check if name already exists
    existing = db.query(UserCredential).filter(UserCredential.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Credential name already exists")

    # Encrypt and store
    cred_data = {
        "access_key_id": payload.access_key_id,
        "secret_access_key": payload.secret_access_key,
        "region": payload.region,
        "bucket": payload.bucket,
        "endpoint_url": payload.endpoint_url,
        "force_path_style": payload.force_path_style,
    }
    encrypted = encrypt_credential(cred_data)

    cred = UserCredential(
        id=uuid4(),
        credential_type=CredentialType.aws,
        name=payload.name,
        encrypted_data=encrypted,
        is_default=False,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return cred


@router.put("/aws/{credential_id}", response_model=CredentialResponse)
def update_aws_credential(credential_id: str, payload: AWSUpdateRequest, db: Session = Depends(get_db)):
    """Update an existing AWS credential. Requires all fields to be provided."""
    cred = db.query(UserCredential).filter(UserCredential.id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    if cred.credential_type != CredentialType.aws:  # type: ignore[comparison-overlap]
        raise HTTPException(status_code=400, detail="Credential is not AWS type")

    # Enforce unique name (allow same record)
    name_conflict = db.query(UserCredential).filter(
        UserCredential.name == payload.name,
        UserCredential.id != credential_id
    ).first()
    if name_conflict:
        raise HTTPException(status_code=400, detail="Credential name already exists")

    cred_data = {
        "access_key_id": payload.access_key_id,
        "secret_access_key": payload.secret_access_key,
        "region": payload.region,
        "bucket": payload.bucket,
        "endpoint_url": payload.endpoint_url,
        "force_path_style": payload.force_path_style,
    }
    cred.name = payload.name  # type: ignore[assignment]
    cred.encrypted_data = encrypt_credential(cred_data)  # type: ignore[assignment]
    db.commit()
    db.refresh(cred)
    return cred


@router.post("/google", response_model=CredentialResponse)
def add_google_credential(payload: GoogleCredentialRequest, db: Session = Depends(get_db)):
    """Add Google credentials."""
    if not payload.api_key and not payload.service_account_json:
        raise HTTPException(status_code=400, detail="Provide either api_key or service_account_json")

    # Check if name already exists
    existing = db.query(UserCredential).filter(UserCredential.name == payload.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Credential name already exists")

    # Encrypt and store
    cred_data = {
        "api_key": payload.api_key,
        "service_account_json": payload.service_account_json,
    }
    encrypted = encrypt_credential(cred_data)

    cred = UserCredential(
        id=uuid4(),
        credential_type=CredentialType.google,
        name=payload.name,
        encrypted_data=encrypted,
        is_default=False,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    return cred


@router.get("", response_model=list[CredentialResponse])
def list_credentials(credential_type: str | None = None, db: Session = Depends(get_db)):
    """List all stored credentials (without sensitive data)."""
    query = db.query(UserCredential)
    if credential_type:
        try:
            cred_type = CredentialType(credential_type)
            query = query.filter(UserCredential.credential_type == cred_type)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid credential type")

    creds = query.all()
    return creds


@router.delete("/{credential_id}")
def delete_credential(credential_id: str, db: Session = Depends(get_db)):
    """Delete a stored credential."""
    cred = db.query(UserCredential).filter(UserCredential.id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")

    db.delete(cred)
    db.commit()
    return {"message": "Credential deleted"}


@router.post("/{credential_id}/set-default")
def set_default_credential(credential_id: str, db: Session = Depends(get_db)):
    """Set a credential as default."""
    cred = db.query(UserCredential).filter(UserCredential.id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")

    # Remove default from others of same type
    db.query(UserCredential).filter(
        UserCredential.credential_type == cred.credential_type,
        UserCredential.id != credential_id
    ).update({"is_default": True}, synchronize_session=False)  # type: ignore[call-overload]

    cred.is_default = True  # type: ignore[assignment]
    db.commit()
    db.refresh(cred)
    return cred


@router.post("/aws/{credential_id}/verify", response_model=CredentialVerificationResponse)
def verify_aws_credential(credential_id: str, db: Session = Depends(get_db)):
    """Verify that AWS credentials are valid by testing S3 connection."""
    cred = db.query(UserCredential).filter(UserCredential.id == credential_id).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Credential not found")
    if cred.credential_type != CredentialType.aws:  # type: ignore[comparison-overlap]
        raise HTTPException(status_code=400, detail="Credential is not AWS type")

    try:
        # Decrypt credentials
        try:
            cred_data = decrypt_credential(str(cred.encrypted_data))
        except Exception as decrypt_error:
            return CredentialVerificationResponse(
                valid=False,
                message=f"Failed to decrypt credentials: {str(decrypt_error)}. The stored credential may be corrupted.",
            )
        
        # Validate required fields
        if not cred_data.get("access_key_id") or not cred_data.get("secret_access_key"):
            return CredentialVerificationResponse(
                valid=False,
                message="Credential data is missing access key ID or secret access key.",
            )
        
        bucket = cred_data.get("bucket")
        if not bucket:
            return CredentialVerificationResponse(
                valid=False,
                message="Credential data is missing bucket name.",
            )
        
        # Create S3 client with provided credentials
        try:
            s3_client = boto3.client(
                "s3",
                region_name=cred_data.get("region", "us-east-1"),
                aws_access_key_id=cred_data.get("access_key_id"),
                aws_secret_access_key=cred_data.get("secret_access_key"),
                endpoint_url=cred_data.get("endpoint_url") or None,
                config=Config(s3={"addressing_style": "path" if cred_data.get("force_path_style", False) else "auto"}),
            )
        except Exception as client_error:
            return CredentialVerificationResponse(
                valid=False,
                message=f"Failed to create S3 client: {str(client_error)}.",
            )
        
        # Test 1: Try to access the bucket
        try:
            s3_client.head_bucket(Bucket=bucket)
        except Exception as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown') if hasattr(e, 'response') else str(type(e).__name__)
            return CredentialVerificationResponse(
                valid=False,
                message=f"Cannot access bucket '{bucket}': {error_code}. Check bucket name and permissions.",
                bucket=bucket,
                region=cred_data.get("region")
            )
        
        # Test 2: Try to put an object to verify write permissions
        try:
            s3_client.put_object(
                Bucket=bucket,
                Key=".drive-to-aws-test",
                Body=b"test"
            )
            # Clean up test file
            try:
                s3_client.delete_object(Bucket=bucket, Key=".drive-to-aws-test")
            except:
                pass
        except Exception as e:
            error_code = e.response.get('Error', {}).get('Code', 'Unknown') if hasattr(e, 'response') else str(type(e).__name__)
            return CredentialVerificationResponse(
                valid=False,
                message=f"Cannot write to bucket '{bucket}': {error_code}. Check IAM permissions.",
                bucket=bucket,
                region=cred_data.get("region")
            )
        
        return CredentialVerificationResponse(
            valid=True,
            message=f"✅ Credentials verified successfully! Bucket '{bucket}' is accessible.",
            bucket=bucket,
            region=cred_data.get("region")
        )
    
    except Exception as e:
        return CredentialVerificationResponse(
            valid=False,
            message=f"Verification failed: {str(e)}",
        )
