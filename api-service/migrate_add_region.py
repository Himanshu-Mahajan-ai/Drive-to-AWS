"""Add region column to import_jobs table."""
import os
import sys
from sqlalchemy import create_engine, text

# Get database URL from environment or use default
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@db:5432/drivetoaws")

print(f"Connecting to database: {DATABASE_URL}")

try:
    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    
    def migrate():
        """Add region column to import_jobs table if it doesn't exist."""
        with engine.begin() as conn:
            # Check if column exists
            result = conn.execute(text("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='import_jobs' AND column_name='region';
            """))
            
            if result.fetchone() is None:
                print("Adding region column to import_jobs table...")
                conn.execute(text("""
                    ALTER TABLE import_jobs 
                    ADD COLUMN region VARCHAR(50);
                """))
                print("✓ Region column added successfully!")
            else:
                print("✓ Region column already exists, skipping migration.")
    
    if __name__ == "__main__":
        migrate()
        print("Migration completed successfully!")
        
except Exception as e:
    print(f"❌ Migration failed: {str(e)}")
    sys.exit(1)
