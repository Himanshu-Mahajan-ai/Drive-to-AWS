# Drive-to-AWS - AWS EC2 Deployment Guide

## 🚀 Quick Start for AWS EC2 Deployment

This guide will help you deploy the Drive-to-AWS application on an AWS EC2 instance.

### Prerequisites

- AWS EC2 instance (Ubuntu 22.04 LTS recommended, t3.medium or larger)
- SSH access to your EC2 instance
- Domain name or EC2 public IP address
- Security group configured to allow ports 80 (HTTP) and optionally 443 (HTTPS)

### Step 1: Connect to Your EC2 Instance

```bash
ssh -i your-key.pem ubuntu@your-ec2-public-ip
```

### Step 2: Install Docker and Docker Compose

```bash
# Update package index
sudo apt-get update

# Install required packages
sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Add your user to docker group
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect
exit
# Then reconnect via SSH
```

### Step 3: Clone and Setup the Project

```bash
# Clone your repository (replace with your repo URL)
git clone https://github.com/your-username/Drive-to-AWS.git
cd Drive-to-AWS

# Create .env file from example
cp .env.example .env
```

### Step 4: Configure Environment Variables

Edit the `.env` file:

```bash
nano .env
```

**IMPORTANT:** You don't need to set AWS credentials here! They can be added via the UI.

Minimum required configuration:

```env
# Core database and broker (these are pre-configured for Docker)
DATABASE_URL=postgresql+psycopg2://postgres:postgres@postgres:5432/drive
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_BACKEND_URL=redis://redis:6379/0

# AWS / S3 - LEAVE EMPTY, add via UI Settings
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
S3_BUCKET=
S3_ENDPOINT_URL=
S3_FORCE_PATH_STYLE=false

# Google API - OPTIONAL (public folders work without this)
GOOGLE_API_KEY=
GOOGLE_SERVICE_ACCOUNT_JSON=
GOOGLE_CREDENTIALS=

# API
API_HOST=0.0.0.0
API_PORT=8000

# Frontend - Use relative path for Nginx proxy
VITE_API_BASE=/api/v1
```

### Step 5: Build and Start the Application

```bash
# Build and start all services
docker compose up -d --build

# Check if services are running
docker compose ps

# View logs
docker compose logs -f
```

### Step 6: Access Your Application

Open your browser and navigate to:
```
http://your-ec2-public-ip
```

You should see the Drive-to-AWS interface!

### Step 7: Add AWS Credentials via UI

1. Click the **⚙️ Settings** button in the top-right
2. Go to **Add AWS** tab
3. Fill in your AWS credentials:
   - **Name:** A friendly name (e.g., "My AWS Account")
   - **Access Key ID:** Your AWS access key
   - **Secret Access Key:** Your AWS secret key
   - **Region:** e.g., `us-east-1`
   - **S3 Bucket:** Your target S3 bucket name
4. Click **Add AWS Credential**
5. Click **Verify** to test the connection

### Step 8: Start Transferring Files

1. Paste a Google Drive folder URL
2. Select your AWS credential
3. Click **Start Transfer**

---

## 🔧 Advanced Configuration

### Using a Custom Domain

If you have a domain name, update your DNS to point to your EC2 public IP, then:

1. Edit `nginx.conf` and update the `server_name` directive
2. Set up SSL/TLS certificates (recommended: Let's Encrypt with Certbot)

### Production Hardening

1. **Use AWS Secrets Manager or Parameter Store** for sensitive credentials
2. **Enable HTTPS** using Let's Encrypt
3. **Set up CloudWatch** for monitoring and logs
4. **Configure automatic backups** for PostgreSQL
5. **Use an Application Load Balancer** for high availability
6. **Enable auto-scaling** for worker services

### Monitoring

View logs for specific services:

```bash
# API logs
docker compose logs -f api

# Worker logs
docker compose logs -f worker

# All logs
docker compose logs -f
```

### Stopping the Application

```bash
# Stop all services
docker compose down

# Stop and remove volumes (CAUTION: deletes all data)
docker compose down -v
```

### Updating the Application

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose up -d --build

# Or rebuild specific service
docker compose up -d --build api
```

---

## 🐛 Troubleshooting

### Application won't start

**Check logs:**
```bash
docker compose logs api
docker compose logs worker
```

**Common issues:**
- Database not ready: Wait 30 seconds and check `docker compose ps`
- Port conflicts: Ensure ports 80, 8000, 4173 are not in use
- Out of memory: Use a larger EC2 instance (t3.medium minimum)

### AWS credentials not working

1. Click **Settings → My Credentials**
2. Click **Verify** next to your credential
3. Check error message for details
4. Ensure IAM permissions include:
   - `s3:PutObject`
   - `s3:GetObject`
   - `s3:ListBucket`

### Google Drive folder not accessible

**For public folders:**
- No Google credentials needed
- Just paste the URL and start

**For private folders:**
1. Click **Settings → Add Google**
2. Add your Google API key or service account JSON
3. Select the credential before starting transfer

### Worker service keeps restarting

Check worker logs:
```bash
docker compose logs -f worker
```

If you see "AWS credentials not configured", add credentials via the UI.

---

## 📊 System Requirements

**Minimum (for testing):**
- 2 vCPUs
- 4 GB RAM
- 20 GB storage

**Recommended (for production):**
- 4 vCPUs
- 8 GB RAM
- 50+ GB storage
- AWS EC2 t3.large or similar

---

## 🔒 Security Notes

1. **Never commit .env files** with real credentials
2. **Use IAM roles** for EC2 instead of hardcoded AWS keys when possible
3. **Restrict security groups** to only necessary ports
4. **Enable encryption** for PostgreSQL and Redis in production
5. **Use HTTPS** in production
6. **Regularly update** Docker images and dependencies

---

## 🆘 Support

For issues or questions:
- Check logs: `docker compose logs`
- Review environment variables in `.env`
- Ensure all services are healthy: `docker compose ps`
- Try restarting: `docker compose restart`

---

## ✅ Success Checklist

- [ ] EC2 instance running with Docker installed
- [ ] Application accessible at http://your-ip
- [ ] AWS credentials added and verified via UI
- [ ] Test transfer with a small Google Drive folder
- [ ] Monitor logs to ensure no errors
- [ ] (Optional) Domain and HTTPS configured
- [ ] (Optional) Monitoring and backups configured

Your Drive-to-AWS application is now ready for production use! 🎉
