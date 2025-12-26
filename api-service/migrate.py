"""
Migration script to add user_credentials table.
Run this in the API container after deployment.
"""
from api.db import SessionLocal
from shared.models import Base, UserCredential
from api.config import settings
from sqlalchemy import text

if __name__ == "__main__":
    # Create table if not exists
    Base.metadata.create_all(bind=SessionLocal().get_bind())
    print("✓ UserCredential table created")
