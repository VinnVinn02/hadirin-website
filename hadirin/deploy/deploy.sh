#!/usr/bin/env bash
# Hadirin — kirim update dari laptop ke VPS (dipakai setelah setup-vps.sh)
# Pemakaian:  bash deploy/deploy.sh user@IP_VPS
# Contoh   :  bash deploy/deploy.sh vinn@203.0.113.10
# Butuh rsync dan akses SSH ke VPS. User di VPS harus bisa sudo.

set -euo pipefail

TARGET="${1:-}"
if [[ -z "$TARGET" ]]; then
  echo "Pemakaian: bash deploy/deploy.sh user@IP_VPS"; exit 1
fi

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_TMP="/tmp/hadirin-upload"

echo "==> Mengunggah file ke $TARGET"
rsync -az --delete "$PROJECT_DIR/public/" "$TARGET:$REMOTE_TMP/"

echo "==> Memasang file di VPS"
ssh -t "$TARGET" "sudo rsync -a --delete $REMOTE_TMP/ /var/www/hadirin/public/ \
  && sudo chown -R www-data:www-data /var/www/hadirin \
  && rm -rf $REMOTE_TMP \
  && sudo nginx -t && sudo systemctl reload nginx"

echo "==> Selesai. Muat ulang browser (Ctrl+Shift+R) untuk melihat perubahan."
