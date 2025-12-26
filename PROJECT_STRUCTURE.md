# Project Structure

## Directory Overview

```
drive-to-aws/
├── api-service/       # FastAPI REST API
├── worker-service/    # Celery async worker
├── frontend/          # React/Vite UI
├── shared/            # Shared SQLAlchemy models
├── docker-compose.yml # Service orchestration
└── .env              # Environment variables
```

---

## Services Explained

### API Service (`api-service/`)
**FastAPI REST API** for:
- Import job management (create, get, cancel)
- Image metadata queries
- Credential management (add, list, delete, set default)

**Key Files**:
- `config.py` - Settings & encryption key
- `credentials.py` - Fernet encryption/decryption
- `routes/imports.py` - Job endpoints
- `routes/images.py` - Image endpoints
- `routes/credentials.py` - Credential endpoints

### Worker Service (`worker-service/`)
**Celery async worker** for:
- Listing files from Google Drive
- Downloading from Drive (5MB chunks)
- Uploading to S3 (with retries)
- Updating job/image status

**Key Files**:
- `tasks.py` - Celery tasks (start_import, transfer_file)
- `drive_client.py` - Google Drive API wrapper
- `storage.py` - S3 upload utilities

### Frontend (`frontend/`)
**React/Vite UI** with:
- Import job form
- Real-time progress bar (1-sec polling)
- Settings modal for credential management
- CSV/JSON/Excel export
- Dark ChatGPT-style theme

**Key File**:
- `App.tsx` - Main component with all features

### Shared (`shared/`)
**SQLAlchemy ORM models**:
- `ImportJob` - Import job records
- `Image` - File metadata
- `UserCredential` - Encrypted credentials
- Status & Type enums

---

## Data Flow

```
1. User submits folder URL
2. API creates ImportJob (status=pending)
3. API enqueues start_import task
4. Worker lists files from Drive, inserts to DB
5. Worker enqueues transfer_file tasks (parallel)
6. Each task: downloads from Drive → uploads to S3
7. Frontend polls every 1s to show progress
8. When done: shows S3 link, enables exports
```

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `import_jobs` | Job records (status, counts, S3 location) |
| `images` | Files to transfer (Drive ID, S3 location, status) |
| `user_credentials` | Encrypted AWS & Google credentials |

---

## Environment Variables

### Critical
- `DATABASE_URL` - PostgreSQL connection
- `REDIS_URL` - Redis broker
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` - AWS credentials
- `S3_BUCKET` - Target bucket
- `GOOGLE_CREDENTIALS` - Path to service account JSON
- `ENCRYPTION_KEY` - Auto-generated if not provided

### Optional
- `S3_ENDPOINT_URL` - Leave empty for AWS; set to `http://minio:9000` for local
- `AWS_REGION` - Default: us-east-1

---

## Key Features

✅ **Secure Credentials** - Encrypted with Fernet, stored in DB  
✅ **Real-time Progress** - 1-second polling from frontend  
✅ **Multi-format Export** - CSV, JSON, Excel  
✅ **Smart Folder Naming** - Uses actual Drive folder name in S3 prefix  
✅ **Batch Processing** - 1000 files per batch  
✅ **Chunked Downloads** - 5MB chunks from Drive  
✅ **Cancellation Support** - Stop mid-transfer  
✅ **Retry Logic** - Exponential backoff on failures  

---

## Quick Start

```bash
# Local development
docker-compose up --build

# Access
- Frontend: http://localhost:4173
- API: http://localhost:8000
- MinIO: http://localhost:9001 (admin/minioadmin)
```

---

## Technology Stack

| Component | Tech |
|-----------|------|
| API | FastAPI, Pydantic |
| Worker | Celery, Tenacity |
| Frontend | React, Vite, Axios |
| Database | PostgreSQL |
| Broker | Redis |
| Storage | S3 / MinIO |
| Encryption | Fernet |
| Orchestration | Docker Compose |

---

## Deployment

**Local**: `docker-compose up --build`  
**AWS**: RDS PostgreSQL + ElastiCache Redis + ECS/Fargate for services + S3 for storage

Set `S3_ENDPOINT_URL=""` (empty) for AWS production.
