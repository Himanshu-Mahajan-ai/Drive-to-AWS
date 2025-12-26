"""Credential encryption and decryption utilities."""
import json
from typing import Any

from cryptography.fernet import Fernet

from .config import settings


def _get_cipher() -> Fernet:
    """Get cipher with encryption key from settings."""
    if not settings.encryption_key:
        raise RuntimeError("ENCRYPTION_KEY not configured")
    return Fernet(settings.encryption_key)


def encrypt_credential(data: dict[str, Any]) -> str:
    """Encrypt credential data as JSON."""
    cipher = _get_cipher()
    json_str = json.dumps(data)
    encrypted = cipher.encrypt(json_str.encode())
    return encrypted.decode()


def decrypt_credential(encrypted_data: str) -> dict[str, Any]:
    """Decrypt credential data from encrypted string."""
    cipher = _get_cipher()
    decrypted = cipher.decrypt(encrypted_data.encode())
    return json.loads(decrypted.decode())
