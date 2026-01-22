# Dittofeed Lite with Domain and SSL Setup

This directory contains the nginx configuration for running Dittofeed Lite with a custom domain and SSL certificates.

## Setup Instructions

### 1. DNS Configuration

Point your domain `automate.scorise.com` to your server's IP address by adding an A record:

```
Type: A
Name: automate.scorise.com
Value: YOUR_SERVER_IP_ADDRESS
TTL: 300 (5 minutes)
```

Replace `YOUR_SERVER_IP_ADDRESS` with the actual IP address of your server.

### 2. Start the Services

Start all services including the new nginx reverse proxy:

```bash
docker compose -f docker-compose.lite.yaml up -d
```

### 3. Obtain SSL Certificate

Once nginx is running and the DNS is configured, obtain the Let's Encrypt SSL certificate:

```bash
./scripts/get-ssl-cert.sh
```

**Note:** Make sure the domain `automate.scorise.com` is accessible from the internet before running this script.

### 4. Verify Setup

After obtaining the certificate, your Dittofeed Lite instance should be accessible at:

- **HTTPS:** https://automate.scorise.com
- **HTTP:** http://automate.scorise.com (redirects to HTTPS)

## Configuration Files

- `nginx.conf` - Main nginx configuration with SSL and reverse proxy setup
- `ssl/dummy.crt` and `ssl/dummy.key` - Dummy SSL certificates for the default server block

## Troubleshooting

### Certificate Issues

If certificate generation fails:

1. Check that the domain DNS is properly configured and propagated
2. Ensure ports 80 and 443 are open on your firewall
3. Check nginx logs: `docker compose -f docker-compose.lite.yaml logs nginx`

### ACME Challenge Issues

The ACME challenge files are stored in the `acme-challenge/` directory and served by nginx at `/.well-known/acme-challenge/`.

## Security Features

- HTTP to HTTPS redirect
- SSL/TLS encryption with modern ciphers
- Security headers (HSTS, X-Frame-Options, etc.)
- Rate limiting on API endpoints
- Gzip compression

## Automatic Certificate Renewal

The certbot service runs automatically every 12 hours to renew certificates. Nginx will automatically reload when certificates are renewed.