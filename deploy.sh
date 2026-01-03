#!/bin/bash
# ===================================================================
# Drive-to-AWS - Quick Deployment Script for AWS EC2
# ===================================================================
# This script automates the deployment process on a fresh Ubuntu EC2 instance
# 
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
# ===================================================================

set -e  # Exit on error

echo "🚀 Starting Drive-to-AWS Deployment..."
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
   echo -e "${YELLOW}⚠️  Please don't run as root. Run as regular user with sudo access.${NC}"
   exit 1
fi

# Step 1: Check if Docker is installed
echo -e "${BLUE}📦 Checking Docker installation...${NC}"
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Installing Docker..."
    
    # Update package index
    sudo apt-get update
    
    # Install prerequisites
    sudo apt-get install -y apt-transport-https ca-certificates curl software-properties-common
    
    # Add Docker's official GPG key
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    
    # Add Docker repository
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    # Install Docker
    sudo apt-get update
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
    
    # Add user to docker group
    sudo usermod -aG docker $USER
    
    echo -e "${GREEN}✓ Docker installed successfully${NC}"
    echo -e "${YELLOW}⚠️  You need to log out and back in for group changes to take effect${NC}"
    echo "After logging back in, run this script again."
    exit 0
else
    echo -e "${GREEN}✓ Docker is already installed${NC}"
fi

# Check Docker Compose
if ! docker compose version &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker Compose plugin not found${NC}"
    exit 1
fi

echo ""

# Step 2: Create .env file if it doesn't exist
echo -e "${BLUE}⚙️  Configuring environment...${NC}"
if [ ! -f .env ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo -e "${GREEN}✓ .env file created${NC}"
    echo -e "${YELLOW}📝 Note: AWS credentials can be added via the UI after deployment${NC}"
else
    echo -e "${GREEN}✓ .env file already exists${NC}"
fi

echo ""

# Step 3: Check for running containers and offer to stop them
echo -e "${BLUE}🔍 Checking for running containers...${NC}"
if docker compose ps --quiet 2>/dev/null | grep -q .; then
    echo -e "${YELLOW}⚠️  Found running containers${NC}"
    read -p "Stop existing containers before redeployment? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        docker compose down
        echo -e "${GREEN}✓ Stopped existing containers${NC}"
    fi
fi

echo ""

# Step 4: Build and start services
echo -e "${BLUE}🏗️  Building and starting services...${NC}"
echo "This may take a few minutes on first run..."
docker compose up -d --build

echo ""

# Step 5: Wait for services to be healthy
echo -e "${BLUE}⏳ Waiting for services to start...${NC}"
sleep 10

# Check service health
echo -e "${BLUE}🔍 Checking service health...${NC}"
docker compose ps

echo ""

# Step 6: Get public IP (if on EC2)
PUBLIC_IP=""
if command -v curl &> /dev/null; then
    PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "")
fi

# Display success message
echo ""
echo -e "${GREEN}✅ Deployment completed successfully!${NC}"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}📋 Next Steps:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ -n "$PUBLIC_IP" ]; then
    echo -e "1. Open your browser and go to: ${GREEN}http://$PUBLIC_IP${NC}"
else
    echo -e "1. Open your browser and go to: ${GREEN}http://YOUR_SERVER_IP${NC}"
fi

echo ""
echo "2. Click ⚙️ Settings (top-right)"
echo "3. Go to 'Add AWS' tab"
echo "4. Enter your AWS credentials:"
echo "   - Name: A friendly name"
echo "   - Access Key ID: Your AWS access key"
echo "   - Secret Access Key: Your AWS secret key"
echo "   - Region: e.g., us-east-1"
echo "   - S3 Bucket: Your target bucket"
echo "5. Click 'Add AWS Credential'"
echo "6. Click 'Verify' to test the connection"
echo "7. Start transferring files!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}📖 Useful Commands:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "View logs:          docker compose logs -f"
echo "View API logs:      docker compose logs -f api"
echo "View worker logs:   docker compose logs -f worker"
echo "Check status:       docker compose ps"
echo "Restart services:   docker compose restart"
echo "Stop services:      docker compose down"
echo "Update & rebuild:   docker compose up -d --build"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${GREEN}🎉 Enjoy using Drive-to-AWS!${NC}"
echo ""
