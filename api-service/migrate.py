"""
Migration script to add user_credentials table and update schema.
Run this in the API container after deployment.
"""
import sys
import os
sys.path.insert(0, '/app')

from app.db import SessionLocal
from shared.models import Base, UserCredential
from app.config import settings
from sqlalchemy import text

if __name__ == "__main__":
    # Create all tables
    Base.metadata.create_all(bind=SessionLocal().get_bind())
    print("✓ All tables created/updated")
    
    # Add missing columns to import_jobs if they don't exist
    db = SessionLocal()
    try:
        # Check if columns exist, if not add them
        db.execute(text("""
            ALTER TABLE import_jobs
            ADD COLUMN IF NOT EXISTS aws_credential_id UUID,
            ADD COLUMN IF NOT EXISTS google_credential_id UUID
        """))
        db.commit()
        print("✓ Credential columns added to import_jobs")
    except Exception as e:
        print(f"! Columns may already exist: {e}")
    finally:
        db.close()
