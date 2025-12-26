# GitHub Copilot Instructions for Drive-to-AWS

## Project Context
This is a multi-service application that imports Google Drive folders to AWS S3 with secure credential management, built with FastAPI, Celery, React, PostgreSQL, and Redis.

## Architecture
- **API Service** (api-service/): FastAPI REST API for job management and credential encryption
- **Worker Service** (worker-service/): Celery async worker for Drive downloads and S3 uploads
- **Frontend** (frontend/): React/Vite UI with real-time progress tracking
- **Shared** (shared/): SQLAlchemy models shared across services

## Key Technologies
- FastAPI + Pydantic for API validation
- Celery + Redis for async task processing
- SQLAlchemy + PostgreSQL for data persistence
- React + Vite for frontend
- Fernet (cryptography) for credential encryption
- boto3 for S3 operations
- Google Drive API for file access

## Code Style Guidelines

### Python
- Use type hints for all function parameters and return values
- Follow Pydantic models for request/response validation
- Use SQLAlchemy 2.0 style queries
- Keep services stateless for horizontal scaling
- Use dependency injection (Depends) for database sessions
- Encrypt sensitive data before storage

### TypeScript/React
- Use functional components with hooks
- Keep state management simple (useState, useEffect)
- Use axios for API calls via centralized api.ts
- Inline styles for UI (dark ChatGPT-style theme)
- Poll API every 1 second for real-time updates

### Docker
- Multi-stage builds for frontend
- Separate services for API, worker, frontend
- Use .env for all configuration
- Mount service_account.json as read-only volume

## Important Patterns

### Database Models
All models in `shared/shared/models.py`:
- Use UUID primary keys
- Include created_at/updated_at timestamps
- Use Enums for status fields
- Foreign keys with ondelete="CASCADE"

### Celery Tasks
- Tasks in `worker-service/app/tasks.py`
- Use tenacity for retry logic
- Check job.status before processing (for cancellation)
- Batch operations (1000 items per batch)
- Stream downloads/uploads (5MB chunks)

### API Routes
- Prefix all routes with `/api/v1`
- Use Pydantic schemas for validation
- Return proper HTTP status codes
- Handle errors with HTTPException

### Credential Security
- Encrypt credentials with Fernet before storage
- Never log or return decrypted credentials
- Only decrypt on worker when needed
- Support multiple credential sets per type

## Environment Variables
All services use .env file:
- DATABASE_URL: PostgreSQL connection
- REDIS_URL: Redis broker
- AWS_*: AWS credentials
- GOOGLE_*: Google Drive credentials
- ENCRYPTION_KEY: Auto-generated if not provided
- S3_ENDPOINT_URL: Empty for AWS, http://minio:9000 for local

## Common Tasks

### Adding New API Endpoint
1. Add Pydantic schema in `api-service/app/schemas.py`
2. Add route in `api-service/app/routes/`
3. Register router in `api-service/app/main.py`
4. Update frontend api calls in `frontend/src/api.ts`

### Adding New Celery Task
1. Define task in `worker-service/app/tasks.py`
2. Use `@celery_app.task(name="tasks.task_name")`
3. Add retry logic with tenacity
4. Check cancellation status before processing
5. Enqueue from API with `celery_app.send_task()`

### Adding Database Model
1. Add model to `shared/shared/models.py`
2. Export in `__all__`
3. Run migration or rebuild containers
4. Update schemas in API service

## Testing
- Local: `docker-compose up --build`
- Frontend: http://localhost:4173
- API: http://localhost:8000
- MinIO Console: http://localhost:9001

## Deployment
- Use RDS for PostgreSQL in production
- Use ElastiCache for Redis
- Set S3_ENDPOINT_URL to empty for AWS
- Store ENCRYPTION_KEY in AWS Secrets Manager
- Scale workers horizontally for higher concurrency
