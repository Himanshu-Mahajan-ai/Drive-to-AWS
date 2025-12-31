# Drive-to-AWS Project Structure

```
drive-to-aws/
├── api-service/       # FastAPI REST API
│   ├── app/
│   │   ├── main.py           # Entry point
│   │   ├── routes/           # API endpoints (imports, images, credentials)
│   │   ├── config.py         # Settings & encryption
│   │   ├── db.py             # Database setup
│   │   └── schemas.py        # Request/response models
│   └── requirements.txt
├── worker-service/    # Celery async worker
│   ├── app/
│   │   ├── tasks.py          # Celery tasks
│   │   ├── drive_client.py   # Google Drive API
│   │   ├── storage.py        # S3 upload
│   │   └── config.py         # Worker config
│   └── requirements.txt
├── frontend/          # React/Vite UI
│   ├── src/
│   │   ├── App.tsx    # Main component
│   │   ├── api.ts     # API client
│   │   └── main.tsx   # Vite entry
│   └── package.json
├── shared/            # SQLAlchemy models
│   └── shared/
│       └── models.py  # ImportJob, Image, UserCredential
├── docker-compose.yml
└── pyrightconfig.json
```

## Quick Overview

| Service | Purpose | Tech |
|---------|---------|------|
| **API** | REST endpoints for jobs, images, credentials | FastAPI |
| **Worker** | Async tasks (Drive → S3 transfers) | Celery |
| **Frontend** | Job form, progress, exports | React/Vite |
| **Shared** | Database models | SQLAlchemy |

## Core Flow

User submits folder URL → API creates job → Worker lists Drive files → Worker transfers to S3 → Frontend shows progress → Export ready
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
