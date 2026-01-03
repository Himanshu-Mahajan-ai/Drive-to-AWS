# Drive-to-AWS 🚀

Transfer images from Google Drive to AWS S3 effortlessly with a modern, production-ready web application.

## ✨ Key Features

- 🌐 **Modern Web Interface** - Beautiful React + Vite frontend with real-time progress
- 📦 **Batch Transfers** - Transfer entire Google Drive folders to S3 efficiently
- 🔐 **Secure Credential Management** - Store and manage multiple AWS/Google credentials with encryption
- 🌍 **Public Folder Support** - Works with public Google Drive folders (no credentials needed!)
- 🔄 **Real-time Progress Tracking** - 1-second live updates with detailed metadata
- ⚡ **High Performance** - Concurrent uploads using Celery workers
- 🐳 **Docker Ready** - One-command deployment with Docker Compose
- 📊 **Activity Dashboard** - Monitor all transfers, credentials, and metadata
- 💾 **Multi-format Exports** - Download results as CSV, JSON, or Excel
- 🛑 **Smart Cancellation** - Stop transfers mid-operation with proper cleanup
- 🎯 **AWS Console Links** - Direct links to S3 locations for quick verification

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         React Frontend (Vite)           │
│         http://localhost:4173           │
└────────────────┬────────────────────────┘
                 │
         ┌───────▼────────┐
         │   Nginx/Node   │
         │   Reverse Proxy│
         └───────┬────────┘
                 │
    ┌────────────┼────────────┐
    │            │            │
┌───▼────────┐ ┌▼──────────┐ │
│  FastAPI   │ │  Celery   │ │
│  Backend   │ │  Worker   │ │
└───┬────────┘ └┬──────────┘ │
    │          │             │
    └──────────┼─────────────┘
               │
    ┌──────────┼──────────┐
    │          │          │
┌───▼────────┐ ▼──────┐ ┌▼────────┐
│ PostgreSQL │ Redis │ │   AWS   │
│  Database  │Broker │ │    S3   │
└────────────┴───────┘ └─────────┘
```

### Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Frontend | React 18 + TypeScript + Vite | Beautiful, fast UI |
| Backend | FastAPI (Python 3.11+) | REST API for job management |
| Worker | Celery + Redis | Background async processing |
| Database | PostgreSQL 15 | Job, image, and credential storage |
| Message Broker | Redis 7 | Task queue for Celery |
| Proxy | Nginx | Reverse proxy for production |
| Storage | AWS S3 (or MinIO) | File destination |

## 🚀 Quick Start

### Prerequisites

- Docker and Docker Compose (installed automatically by deploy script)
- AWS account (credentials added via UI)
- (Optional) Google API key for private folders

### One-Command Deployment

```bash
# Clone the repository
git clone https://github.com/your-username/Drive-to-AWS.git
cd Drive-to-AWS

# Copy environment template
cp .env.example .env

# Make deploy script executable and run
chmod +x deploy.sh
./deploy.sh
```

The `deploy.sh` script will:
1. ✅ Check and install Docker if needed
2. ✅ Create `.env` file from template
3. ✅ Build all Docker images
4. ✅ Start services and verify health
5. ✅ Display access information

### Manual Deployment

```bash
# Create .env from template
cp .env.example .env

# Start all services (includes PostgreSQL, Redis, FastAPI, Celery worker, Frontend, Nginx)
docker compose up -d --build

# Check status
docker compose ps

# View logs
docker compose logs -f

# Access the application
# With Nginx: http://localhost
# Direct API: http://localhost:8000
# Frontend: http://localhost:4173
```

## 🔧 Configuration

### Minimal Configuration (.env)

The application is designed to work with **minimal configuration**. AWS and Google credentials are **optional** in `.env` and can be added via the UI!

```env
# Core - Already configured for Docker (no changes needed)
DATABASE_URL=postgresql+psycopg2://postgres:postgres@postgres:5432/drive
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_BACKEND_URL=redis://redis:6379/0

# Frontend API endpoint
VITE_API_BASE=/api/v1

# AWS - OPTIONAL (leave empty, add via UI)
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=

# Google API - OPTIONAL (only for private folders)
GOOGLE_API_KEY=
```

### Production Configuration

For AWS EC2 deployment, see [DEPLOYMENT.md](DEPLOYMENT.md) for:
- Custom domain setup
- SSL/TLS with Let's Encrypt
- AWS Secrets Manager integration
- CloudWatch monitoring
- Auto-scaling configurations

## 📖 How to Use

### 1️⃣ Add AWS Credentials

1. Click **⚙️ Settings** (top-right corner)
2. Go to **Add AWS** tab
3. Fill in your AWS credentials:
   - **Name**: Friendly name (e.g., "My AWS Account")
   - **Access Key ID**: Your AWS access key
   - **Secret Access Key**: Your AWS secret key
   - **Region**: AWS region (e.g., `us-east-1`)
   - **S3 Bucket**: Target bucket name
   - **Endpoint URL** (optional): Leave empty for AWS S3
4. Click **Add AWS Credential**
5. Click **Verify** to test the connection

### 2️⃣ (Optional) Add Google Credentials

For **private Google Drive folders only**:

1. Click **⚙️ Settings** → **Add Google**
2. Provide either:
   - **API Key**: For easier setup
   - **Service Account JSON**: For more control
3. Save and select before transferring private folders

(Public folders need **NO** Google credentials!)

### 3️⃣ Start a Transfer

1. Paste a Google Drive folder URL (public or private)
2. Select your AWS credential
3. (Optional) Customize S3 bucket and prefix
4. Click **Start Transfer**
5. Monitor real-time progress

### 4️⃣ View Results

- **Progress Bar**: Live transfer status
- **Completed Files**: Detailed file list
- **Download Metadata**: Export as CSV, JSON, or Excel
- **Activity Dashboard**: View all transfers and credentials

## 🌍 AWS EC2 Deployment

### Quick EC2 Setup

For detailed instructions, see **[DEPLOYMENT.md](DEPLOYMENT.md)**

```bash
# On a fresh Ubuntu 22.04 EC2 instance:
git clone <your-repo>
cd Drive-to-AWS
chmod +x deploy.sh
./deploy.sh

# Then access at: http://your-ec2-public-ip
```

### EC2 Instance Recommendations

| Scenario | Instance Type | vCPUs | Memory | Storage |
|----------|---|-------|--------|---------|
| Testing | t3.small | 2 | 2 GB | 20 GB |
| Small-scale | t3.medium | 2 | 4 GB | 50 GB |
| Production | t3.large | 2 | 8 GB | 100 GB |
| High-volume | c6i.xlarge | 4 | 8 GB | 200+ GB |

### Security Group Configuration

Open these ports:

| Port | Protocol | Purpose |
|------|----------|---------|
| 80 | HTTP | Frontend and API |
| 443 | HTTPS | Encrypted traffic (recommended) |
| 22 | SSH | Server access |

## 🔒 Security

- ✅ **Encrypted Credentials**: Stored securely in database
- ✅ **No Hardcoded Secrets**: Add credentials via UI only
- ✅ **IAM Role Support**: Use EC2 IAM roles instead of keys
- ✅ **CORS Protection**: Configured for security
- ✅ **Health Checks**: Automatic service monitoring
- ✅ **Graceful Shutdown**: Proper cleanup on container stop
- ✅ **Secret Management**: Environment variables not logged

## 📊 Monitoring

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f api      # Backend
docker compose logs -f worker   # Celery worker
docker compose logs -f frontend # React app

# Filter logs
docker compose logs api | grep ERROR
```

### Check Health

```bash
# Service status
docker compose ps

# Database health
docker exec drive-to-aws-postgres-1 pg_isready

# API health
curl http://localhost:8000/health

# Worker status
docker compose logs worker | tail -20
```

## 🐛 Troubleshooting

### Application won't start

```bash
# Check logs
docker compose logs

# Restart specific service
docker compose restart api

# Check resource usage
docker stats
```

### AWS credentials not working

1. Go to **Settings** → **My Credentials**
2. Click **Verify** next to your credential
3. Check error message
4. Verify AWS IAM policy includes:
   ```json
   {
       "Effect": "Allow",
       "Action": [
           "s3:PutObject",
           "s3:GetObject",
           "s3:ListBucket",
           "s3:HeadBucket"
       ],
       "Resource": ["arn:aws:s3:::your-bucket/*", "arn:aws:s3:::your-bucket"]
   }
   ```

### Google Drive folder not accessible

- **Public folders**: No credentials needed, just paste the URL
- **Private folders**: Add Google API key or service account credentials
- **Shared drives**: Use service account with appropriate permissions

### Worker keeps restarting

```bash
# Check worker logs
docker compose logs -f worker

# Common issues:
# 1. Missing AWS credentials - add via Settings UI
# 2. Database not ready - wait 30 seconds
# 3. Out of memory - use larger EC2 instance
```

### Database connection errors

```bash
# Check PostgreSQL
docker compose logs postgres

# Reset database (CAUTION: deletes all data)
docker compose down -v
docker compose up -d postgres
docker compose up -d  # restart all services
```

## 🛠️ Development

### Local Development Setup

```bash
# Backend
cd api-service
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload

# Worker (new terminal)
cd worker-service
pip install -r requirements.txt
celery -A app.tasks worker --loglevel=info

# Frontend (new terminal)
cd frontend
npm install
npm run dev
```

### Project Structure

```
Drive-to-AWS/
├── api-service/              # FastAPI backend
│   ├── app/
│   │   ├── routes/
│   │   │   ├── credentials.py  # Credential management
│   │   │   ├── imports.py      # Job creation
│   │   │   └── images.py       # Image metadata
│   │   ├── config.py           # Configuration
│   │   ├── main.py             # FastAPI app
│   │   └── schemas.py          # Pydantic models
│   └── Dockerfile
├── worker-service/           # Celery workers
│   ├── app/
│   │   ├── tasks.py          # Background tasks
│   │   ├── drive_client.py    # Google Drive API
│   │   ├── storage.py         # S3 upload
│   │   └── config.py
│   └── Dockerfile
├── frontend/                 # React + Vite
│   ├── src/
│   │   ├── App.tsx           # Main component
│   │   └── api.ts            # API client
│   └── Dockerfile
├── shared/                   # Shared models
│   └── shared/
│       └── models.py         # SQLAlchemy ORM
├── docker-compose.yml        # Docker setup
├── nginx.conf                # Reverse proxy
├── deploy.sh                 # Deploy script
├── DEPLOYMENT.md             # AWS guide
└── README.md                 # This file
```

## 📚 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| POST | `/api/v1/credentials/aws` | Add AWS credential |
| POST | `/api/v1/credentials/aws/{id}/verify` | Verify credential |
| PUT | `/api/v1/credentials/aws/{id}` | Update credential |
| DELETE | `/api/v1/credentials/{id}` | Delete credential |
| GET | `/api/v1/credentials` | List credentials |
| POST | `/api/v1/credentials/{id}/set-default` | Set default credential |
| POST | `/api/v1/imports` | Create import job |
| GET | `/api/v1/imports/{job_id}` | Get job status |
| POST | `/api/v1/imports/{job_id}/cancel` | Cancel job |
| GET | `/api/v1/images` | List transferred images |

## 🔄 CI/CD Integration

For GitHub Actions, GitLab CI, or other platforms, push Docker images to your registry:

```bash
docker build -t my-registry/drive-to-aws:latest .
docker push my-registry/drive-to-aws:latest
```

## 📄 License

MIT License - see LICENSE file for details

## 🙏 Acknowledgments

- **FastAPI** - Modern Python web framework
- **React & Vite** - Lightning-fast frontend
- **Celery** - Distributed task queue
- **SQLAlchemy** - ORM excellence
- **Docker** - Containerization
- **AWS** - Cloud infrastructure

---

**🎉 Ready to transfer? Start with `./deploy.sh` or see [DEPLOYMENT.md](DEPLOYMENT.md) for detailed instructions.**

For issues, questions, or contributions, please open an issue or pull request on GitHub!
