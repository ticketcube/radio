# Linode Deployment Guide (Cloud Supabase Version)

Deploy AzuraCast + OTW Radio Site on Linode with cloud-hosted Supabase.

## Server Requirements

**Recommended Linode Plan:** Shared 4GB ($24/month)
- 2 CPU Cores
- 4GB RAM
- 80GB Storage
- 4TB Transfer

**Minimum:** Shared 2GB ($12/month) - For testing only

## Architecture Overview

```
Linode Server
├── AzuraCast (Docker) - Ports 80, 443, 8000-8999
├── Next.js Radio Site (PM2) - Port 3000
└── Nginx (Reverse Proxy) - Routes to Next.js and AzuraCast

External Services (No Migration)
└── Supabase Cloud - Database, Auth, Storage
```

## Step 1: Initial Server Setup

```bash
# SSH into your Linode
ssh root@YOUR_SERVER_IP

# Update system
apt update && apt upgrade -y

# Install required packages
apt install -y docker.io docker-compose nginx certbot python3-certbot-nginx git curl

# Start Docker
systemctl enable docker
systemctl start docker

# Install Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt install -y nodejs

# Install PM2 globally
npm install -g pm2
```

## Step 2: Install AzuraCast

```bash
# Create directory
mkdir -p /var/azuracast
cd /var/azuracast

# Download installer
curl -fsSL https://raw.githubusercontent.com/AzuraCast/AzuraCast/main/docker.sh > docker.sh
chmod +x docker.sh

# Run installation
./docker.sh install

# SAVE THE ADMIN PASSWORD IT GENERATES!
```

AzuraCast will be available at: `http://YOUR_SERVER_IP` (port 80)

**Initial AzuraCast Setup:**
1. Visit `http://YOUR_SERVER_IP` and login with generated credentials
2. Create a station (Station ID will be 1)
3. Configure streaming settings
4. Note your API URL: `http://YOUR_SERVER_IP/api`

## Step 3: Deploy Next.js Radio Site

```bash
# Clone your repository
cd /opt
git clone https://github.com/YOUR_USERNAME/REPO_NAME.git radio-site
cd radio-site

# Install dependencies
npm install

# Create production environment file
cat > .env.local << 'EOF'
# AzuraCast Connection
NEXT_PUBLIC_AZURACAST_API_URL=http://localhost/api
NEXT_PUBLIC_AZURACAST_STATION_ID=1

# Cloud Supabase (EXISTING - NO MIGRATION)
NEXT_PUBLIC_SUPABASE_URL=YOUR_EXISTING_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_EXISTING_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_EXISTING_SERVICE_ROLE_KEY

# Site Configuration
NEXT_PUBLIC_SITE_URL=https://radio.yourdomain.com
NODE_ENV=production
EOF

# Edit .env.local with your actual values
nano .env.local

# Build production app
npm run build

# Start with PM2
pm2 start npm --name "radio-site" -- start
pm2 save
pm2 startup
# Run the command PM2 outputs to enable startup on boot

# Verify it's running
pm2 list
curl http://localhost:3000
```

## Step 4: Configure DNS

Add these A records in your DNS provider (e.g., Cloudflare, Namecheap):

```
radio.yourdomain.com    → YOUR_SERVER_IP
stream.yourdomain.com   → YOUR_SERVER_IP  (for AzuraCast if separate)
```

**Wait 5-10 minutes for DNS propagation before next step.**

## Step 5: Configure Nginx Reverse Proxy

```bash
# Remove default site
rm /etc/nginx/sites-enabled/default

# Create radio site config
cat > /etc/nginx/sites-available/radio << 'EOF'
# Main Radio Site
server {
    listen 80;
    server_name radio.yourdomain.com;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Static assets caching
    location /_next/static {
        proxy_pass http://localhost:3000;
        proxy_cache_valid 200 60m;
        add_header Cache-Control "public, max-age=3600, immutable";
    }
}
EOF

# Enable site
ln -s /etc/nginx/sites-available/radio /etc/nginx/sites-enabled/

# Test configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

**Test:** Visit `http://radio.yourdomain.com` (without SSL yet)

## Step 6: Enable SSL Certificates

```bash
# Install certificate
certbot --nginx -d radio.yourdomain.com

# Test auto-renewal
certbot renew --dry-run
```

**After SSL is installed, update AzuraCast URLs in .env.local:**

```bash
cd /opt/radio-site
nano .env.local
# Change NEXT_PUBLIC_AZURACAST_API_URL to https if AzuraCast has SSL
# Change NEXT_PUBLIC_SITE_URL to https://radio.yourdomain.com

# Rebuild and restart
npm run build
pm2 restart radio-site
```

## Step 7: Configure AzuraCast

### Update Base URL
1. SSH: `cd /var/azuracast && ./docker.sh cli`
2. Run: `azuracast settings:set SITE_BASE_URL https://stream.yourdomain.com`
3. Exit CLI: `exit`

### Enable CORS for Radio Site
1. Visit AzuraCast admin: `https://stream.yourdomain.com`
2. Go to **Administration → System Settings**
3. Under **Security**, add to **CORS Allowed Origins**:
   ```
   https://radio.yourdomain.com
   ```
4. Save changes

## Step 8: Setup Backups

```bash
# Create backup directory
mkdir -p /backups/otw-radio

# Create backup script
cat > /root/backup-otw.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backups/otw-radio"
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup AzuraCast Database
docker exec azuracast_mariadb mysqldump -u azuracast -p$(docker exec azuracast bash -c 'echo $MYSQL_PASSWORD') azuracast | gzip > $BACKUP_DIR/azuracast_$DATE.sql.gz

# Backup Next.js App
tar -czf $BACKUP_DIR/radio-site_$DATE.tar.gz /opt/radio-site --exclude node_modules --exclude .next

# Keep only last 7 days
find $BACKUP_DIR -name "*.gz" -mtime +7 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +7 -delete

echo "Backup completed: $DATE"
EOF

chmod +x /root/backup-otw.sh

# Add to crontab (daily at 2 AM)
crontab -e
# Add this line:
# 0 2 * * * /root/backup-otw.sh >> /var/log/otw-backup.log 2>&1
```

## Monitoring & Maintenance

### Check Service Status

```bash
# AzuraCast
cd /var/azuracast && ./docker.sh status

# Next.js Site
pm2 status

# Nginx
systemctl status nginx

# Server resources
htop
df -h
free -h
```

### View Logs

```bash
# Next.js logs
pm2 logs radio-site

# AzuraCast logs
cd /var/azuracast && ./docker.sh logs

# Nginx access logs
tail -f /var/log/nginx/access.log

# Nginx error logs
tail -f /var/log/nginx/error.log
```

### Update Services

```bash
# Update Next.js site
cd /opt/radio-site
git pull
npm install
npm run build
pm2 restart radio-site

# Update AzuraCast
cd /var/azuracast
./docker.sh update-self
./docker.sh update

# Update system packages
apt update && apt upgrade -y
```

## Troubleshooting

### Next.js Site Not Loading

```bash
# Check PM2 status
pm2 status

# View error logs
pm2 logs radio-site --err

# Restart
pm2 restart radio-site

# If port 3000 is in use
netstat -tulpn | grep :3000
kill -9 <PID>
pm2 restart radio-site
```

### AzuraCast Issues

```bash
# Restart AzuraCast
cd /var/azuracast
./docker.sh restart

# Check Docker containers
docker ps -a

# View specific service logs
docker logs azuracast_web
docker logs azuracast_mariadb
docker logs azuracast_redis
```

### SSL Certificate Issues

```bash
# Renew certificates manually
certbot renew --force-renewal

# Check certificate status
certbot certificates

# If renewal fails, check Nginx config
nginx -t
```

### Supabase Connection Issues

Since Supabase is cloud-hosted, check:
1. Environment variables in `/opt/radio-site/.env.local`
2. Network connectivity: `curl https://YOUR_SUPABASE_URL/rest/v1/`
3. Supabase service status: https://status.supabase.com
4. API keys are correct (anon key, service role key)

## Security Hardening

```bash
# Enable UFW firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 8000:8999/tcp  # AzuraCast streaming ports
ufw enable

# Create non-root user
adduser deploy
usermod -aG sudo deploy
usermod -aG docker deploy

# Disable root SSH login (after testing with deploy user)
nano /etc/ssh/sshd_config
# Set: PermitRootLogin no
systemctl restart sshd

# Enable automatic security updates
apt install unattended-upgrades
dpkg-reconfigure -plow unattended-upgrades

# Setup fail2ban for SSH protection
apt install fail2ban
systemctl enable fail2ban
systemctl start fail2ban
```

## Cost Breakdown

- **Linode Server:** $24/month (Shared 4GB)
- **Supabase Cloud:** $0-25/month (Free tier or Pro)
- **Domain:** ~$12/year
- **Total:** ~$25-50/month

## Performance Optimization

```bash
# Enable Nginx gzip compression
nano /etc/nginx/nginx.conf
# Add in http block:
# gzip on;
# gzip_vary on;
# gzip_min_length 1024;
# gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;

# Restart Nginx
systemctl restart nginx

# PM2 cluster mode for multi-core usage
pm2 delete radio-site
pm2 start npm --name "radio-site" -i max -- start
pm2 save
```

## Access URLs (After Setup)

- **Radio Site:** https://radio.yourdomain.com
- **AzuraCast:** https://stream.yourdomain.com (or main domain)
- **Supabase Studio:** https://app.supabase.com (cloud dashboard)

## Deployment Checklist

- [ ] Linode server provisioned and accessible via SSH
- [ ] Docker and Node.js installed
- [ ] AzuraCast installed and configured
- [ ] DNS A records created and propagated
- [ ] Next.js site cloned and built
- [ ] PM2 running and configured for startup
- [ ] Nginx reverse proxy configured
- [ ] SSL certificates installed via Certbot
- [ ] Environment variables configured correctly
- [ ] AzuraCast CORS settings updated
- [ ] Backups configured and tested
- [ ] Firewall enabled and ports allowed
- [ ] Site accessible at https://radio.yourdomain.com

## Next Steps

1. Import your playlists into AzuraCast
2. Test authentication flows with cloud Supabase
3. Setup monitoring (optional: Uptime Robot, StatusCake)
4. Configure custom domain email for notifications
5. Test all features (player, schedule, auth, etc.)
6. Update any external integrations to point to new domain
7. Consider CDN (Cloudflare) for additional performance