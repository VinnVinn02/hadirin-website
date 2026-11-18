# Hadirin — opsi Docker (alternatif dari setup-vps.sh)
FROM nginx:1.27-alpine

# Konfigurasi khusus container (tanpa server_name/SSL; HTTPS diurus reverse proxy di depan)
COPY deploy/nginx/docker.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/

EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
