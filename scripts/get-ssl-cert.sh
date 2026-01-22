#!/bin/bash

# Script to obtain Let's Encrypt SSL certificate for automate.scorise.com
# This script should be run after nginx is started

set -e

DOMAIN="automate.scorise.com"
EMAIL="admin@scorise.com"  # Change this to your actual email

echo "Obtaining SSL certificate for $DOMAIN..."

# Run certbot to get the certificate
docker compose -f docker-compose.lite.yaml run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/html \
  --email $EMAIL \
  --agree-tos \
  --no-eff-email \
  -d $DOMAIN \
  --cert-name $DOMAIN

echo "SSL certificate obtained successfully!"
echo "Switching nginx to SSL configuration..."

# Copy SSL config to replace no-SSL config
cp nginx/nginx.conf nginx/nginx-no-ssl.conf

# Update docker-compose to expose port 443 and use SSL config
sed -i 's|nginx-no-ssl.conf|nginx.conf|g' docker-compose.lite.yaml
sed -i '/- "80:80"/a \      - "443:443"' docker-compose.lite.yaml

echo "Restarting nginx with SSL configuration..."

# Restart nginx to pick up the new configuration and certificate
docker compose -f docker-compose.lite.yaml up -d nginx

echo "Done! Your site should now be accessible at https://$DOMAIN"