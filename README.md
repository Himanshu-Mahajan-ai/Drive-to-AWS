# Drive-to-AWS 

Imports public Google Drive folder images into S3-compatible storage with FastAPI, Celery workers, Postgres metadata, and a React frontend. Features secure credential management, real-time progress tracking, and multi-format exports.

## Features
- 🔐 **Secure Credential Management**: Store AWS and Google API credentials encrypted in the database
- ⚡ **Real-time Progress**: 1-second polling for instant updates on transfer status
- 📊 **Multi-format Exports**: Download metadata as CSV, JSON, or Excel
- 📁 **Smart Folder Naming**: Automatically names S3 folders by Drive folder name
- 🎯 **Smart Batching**: 1000-file batches with 5MB chunked downloads for 10k+ images
- 🛑 **Cancel Support**: Stop transfers mid-operation; already-queued tasks aware of status
- 🪣 **AWS S3 Links**: Direct links to S3 locations in AWS console on completion

## Services
- **api**: FastAPI REST for starting imports, managing credentials, and querying images
- **worker**: Celery worker to list Drive files and stream uploads to S3/MinIO
- **frontend**: Vite + React UI with settings for credential management
- **redis**: broker/back-end for Celery
- **postgres**: metadata store (jobs, images, credentials)
- **minio**: local S3-compatible storage (swap for AWS S3 in production)

## Quickstart (local compose)
1) Copy `.env.example` to `.env` and fill basic secrets (minimal Google API key, minimal AWS region)
2) `docker compose up --build` (uses local MinIO; UI on http://localhost:4173, API on http://localhost:8000)
3) Click **⚙️ Settings** in the top-right to add your AWS and Google credentials
4) Submit a public Drive folder URL; credentials auto-select from defaults
5) Monitor progress in real-time; download exports on completion

## Credential Management

### Adding Credentials
1. Click **Settings** (⚙️) button in the top-right of the UI
2. Select **Add AWS** or **Add Google** tab
3. Fill in your credentials (securely encrypted and stored)
4. Mark as default to use automatically for new jobs

### AWS Credentials Form
- **Credential Name**: Human-friendly label (e.g., "Production")
- **Access Key ID**: AWS IAM access key
- **Secret Access Key**: AWS IAM secret key
- **S3 Bucket**: Target bucket name
- **Region**: AWS region (default: us-east-1)
- **Endpoint URL** (optional): For MinIO or S3-compatible services

### Google Credentials Form
- **Credential Name**: Human-friendly label (e.g., "Personal Account")
- **API Key** (optional): For public Drive folders
- **Service Account JSON** (optional): For shared drives or private folders

### Security
- All credentials encrypted with Fernet (AES-128)
- Encryption key auto-generated or from `ENCRYPTION_KEY` env var
- Credentials never transmitted in plain text; only decrypted on worker
- Default credentials marked for quick selection in job creation

## API

### Import Management
- `POST /api/v1/imports` body: `folder_url`, optional `bucket`, `prefix`, `concurrency`, `dry_run`, `max_items`
- `GET /api/v1/imports/{job_id}`: job status, file counts, S3 location
- `POST /api/v1/imports/{job_id}/cancel`: stop transfer and mark job as canceled
- `GET /api/v1/images?job_id=...&limit=500&offset=0`: list images with S3 keys

### Credential Management
- `POST /api/v1/credentials/aws`: add AWS credentials
- `POST /api/v1/credentials/google`: add Google credentials
- `GET /api/v1/credentials?credential_type=aws|google`: list stored credentials (no secrets)
- `DELETE /api/v1/credentials/{id}`: delete credential
- `POST /api/v1/credentials/{id}/set-default`: mark credential as default

### Health
- `GET /health`: API status

## Environment Variables

### Database & Broker
- `DATABASE_URL`: PostgreSQL connection string
- `REDIS_URL`: Redis connection string
- `CELERY_BROKER_URL`: Redis broker (defaults to REDIS_URL)
- `CELERY_BACKEND_URL`: Redis backend (defaults to REDIS_URL)

### AWS / S3
- `AWS_ACCESS_KEY_ID`: Default AWS access key (can be overridden via credentials)
- `AWS_SECRET_ACCESS_KEY`: Default AWS secret key (can be overridden via credentials)
- `AWS_REGION`: Default AWS region (can be overridden via credentials)
- `S3_BUCKET`: Default S3 bucket (can be overridden via credentials)
- `S3_ENDPOINT_URL`: S3 endpoint URL (empty for AWS; set to http://minio:9000 for local MinIO)
- `S3_FORCE_PATH_STYLE`: Use path-style URLs (false for AWS; true for MinIO)

### Google API
- `GOOGLE_API_KEY`: Default Google API key (can be overridden via credentials)
- `GOOGLE_CREDENTIALS`: Path to service account JSON file (can be overridden via credentials)

### Security
- `ENCRYPTION_KEY`: Base64-encoded Fernet key for credential encryption (auto-generated if not provided)

## Deployment

### Local Development
```bash
docker compose up --build
# UI: http://localhost:4173
# API: http://localhost:8000
# MinIO Console: http://localhost:9001 (admin/minioadmin)
```

### AWS / Production
1. Set `S3_ENDPOINT_URL` to empty (uses AWS S3)
2. Provide AWS credentials via environment or credentials management UI
3. Use RDS for PostgreSQL, ElastiCache for Redis
4. Deploy API and worker to ECS/Fargate or K8s
5. Host frontend on CloudFront + S3 or container registry

### Docker Compose (MinIO)
```bash
docker compose up --build
# Create bucket: minio console → Buckets → Create → "drive-bucket"
# Or set S3_BUCKET=drive-bucket in .env
```

## Architecture Notes
- **Idempotent transfers**: Each file identified by `drive_file_id` + `job_id`; safe to retry
- **Horizontal scaling**: Add more workers by running additional `docker compose up worker` services
- **Job cancellation**: Status checked before each transfer; queued tasks exit gracefully
- **Credential isolation**: Each job stores credential ID references; credentials decrypted only on worker
- **Smart folder naming**: Drive folder name fetched on first run; stored in job prefix for human readability

## Notes
- Swap MinIO for AWS S3 by leaving `S3_ENDPOINT_URL` empty and providing AWS credentials
- For 10k+ images, batching (1000) and chunking (5MB) ensures reliable transfers
- All credentials encrypted; support both API key and service account for Google
- Frontend settings modal supports add/select/delete/default-mark credentials
- Export metadata as CSV/JSON/Excel for downstream analysis
