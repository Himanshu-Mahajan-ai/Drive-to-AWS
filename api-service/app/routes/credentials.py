"""Credentials management API routes."""
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

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


class GoogleCredentialRequest(BaseModel):
    name: str
    api_key: str | None = None
    service_account_json: str | None = None


class CredentialResponse(BaseModel):
    id: str
    credential_type: str
    name: str
    created_at: str
    is_default: bool

    class Config:
        from_attributes = True


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
    ).update({"is_default": False})

    cred.is_default = True
    db.commit()
    db.refresh(cred)
    return cred
