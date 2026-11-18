#!/usr/bin/env bash
# Hadirin — setup VPS sekali jalan (Ubuntu 22.04/24.04 atau Debian 12)
# Jalankan DI VPS:   sudo bash setup-vps.sh domainanda.com email@anda.com
# Yang dilakukan: pasang Nginx + Certbot + UFW, salin website, pasang config,
# lalu minta sertifikat HTTPS gratis dari Let's Encrypt.

set -euo pipefail

DOMAIN="${1:-}"
EMAIL="${2:-}"
WEBROOT="/var/www/hadirin"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [[ -z "$DOMAIN" || -z "$EMAIL" ]]; then
  echo "Pemakaian: sudo bash setup-vps.sh <domain> <email>"
  echo "Contoh   : sudo bash setup-vps.sh hadirin.sch.id admin@hadirin.sch.id"
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "Jalankan dengan sudo."; exit 1
fi

echo "==> [1/6] Update paket dan pasang Nginx, Certbot, UFW"
apt-get update -y
apt-get install -y nginx certbot python3-certbot-nginx ufw rsync

echo "==> [2/6] Atur firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> [3/6] Salin file website ke $WEBROOT"
mkdir -p "$WEBROOT"
rsync -a --delete "$PROJECT_DIR/public/" "$WEBROOT/public/"
chown -R www-data:www-data "$WEBROOT"
find "$WEBROOT" -type d -exec chmod 755 {} \;
find "$WEBROOT" -type f -exec chmod 644 {} \;

echo "==> [4/6] Pasang konfigurasi Nginx untuk $DOMAIN"
sed "s/hadirin\.example\.com/$DOMAIN/g" "$SCRIPT_DIR/nginx/hadirin.conf" > /etc/nginx/sites-available/hadirin.conf
ln -sf /etc/nginx/sites-available/hadirin.conf /etc/nginx/sites-enabled/hadirin.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

echo "==> [5/6] Minta sertifikat HTTPS (Let's Encrypt)"
echo "    Pastikan DNS A record $DOMAIN dan www.$DOMAIN sudah mengarah ke IP VPS ini."
DOMAINS=(-d "$DOMAIN")
if getent hosts "www.$DOMAIN" >/dev/null 2>&1; then DOMAINS+=(-d "www.$DOMAIN"); fi
certbot --nginx "${DOMAINS[@]}" --non-interactive --agree-tos -m "$EMAIL" --redirect

echo "==> [6/6] Cek perpanjangan otomatis sertifikat"
certbot renew --dry-run

echo
echo "Selesai. Buka https://$DOMAIN"
echo "Form orang tua langsung: https://$DOMAIN/#lapor"
