# Panduan Deploy Hadirin ke VPS dan Domain Baru

Panduan ini untuk VPS **Ubuntu 22.04/24.04** atau **Debian 12**. Ganti `domainanda.com` dengan domain Anda, dan `IP_VPS` dengan alamat IP VPS.

## Yang perlu disiapkan
- VPS dengan akses SSH. Spesifikasi minimum 1 vCPU / 1 GB RAM sudah cukup karena situs ini statis.
- Domain yang bisa diatur DNS-nya
- Email aktif untuk sertifikat HTTPS

---

## Langkah 1 — Arahkan domain ke VPS

Di panel DNS penyedia domain, buat dua record:

| Tipe | Nama | Nilai | TTL |
|---|---|---|---|
| A | `@` | `IP_VPS` | Auto / 3600 |
| A | `www` | `IP_VPS` | Auto / 3600 |

Cek apakah sudah aktif (biasanya 5 menit sampai beberapa jam):

```bash
ping domainanda.com
# atau
nslookup domainanda.com
```

IP yang muncul harus sama dengan IP VPS.

> Jika memakai Cloudflare, set record ke **DNS only** (awan abu-abu) dulu sampai sertifikat HTTPS berhasil dibuat. Setelah itu boleh diubah ke **Proxied** dengan mode SSL **Full (strict)**.

---

## Langkah 2 — Amankan akses VPS (disarankan)

Masuk ke VPS sebagai root, lalu buat user biasa:

```bash
ssh root@IP_VPS
adduser vinn
usermod -aG sudo vinn
```

Dari laptop, salin SSH key supaya login tanpa password:

```bash
ssh-copy-id vinn@IP_VPS
```

Setelah login dengan key berhasil, matikan login root dan login dengan password:

```bash
sudo nano /etc/ssh/sshd_config
# ubah menjadi:
#   PermitRootLogin no
#   PasswordAuthentication no
sudo systemctl restart ssh
```

> Jangan tutup sesi SSH yang sedang aktif sebelum memastikan login dengan key di terminal lain berhasil.

---

## Langkah 3 — Upload proyek ke VPS

Pilih salah satu cara.

**A. Dari laptop dengan `scp`**
```bash
scp -r hadirin vinn@IP_VPS:~/
```

**B. Lewat GitHub**
```bash
# di laptop
cd hadirin
git init && git add . && git commit -m "Hadirin: prototipe pelaporan"
git remote add origin git@github.com:USERNAME/hadirin.git
git push -u origin main

# di VPS
git clone https://github.com/USERNAME/hadirin.git ~/hadirin
```

---

## Langkah 4 — Jalankan setup otomatis

Di VPS:

```bash
cd ~/hadirin
sudo bash deploy/setup-vps.sh domainanda.com email@anda.com
```

Skrip ini melakukan:
1. Memasang Nginx, Certbot, UFW, dan rsync
2. Membuka firewall hanya untuk SSH, HTTP, dan HTTPS
3. Menyalin `public/` ke `/var/www/hadirin/public`
4. Memasang config Nginx dengan domain Anda
5. Membuat sertifikat HTTPS Let's Encrypt dan redirect ke HTTPS
6. Menguji perpanjangan otomatis sertifikat

Setelah selesai, buka:
- `https://domainanda.com` halaman depan publik (profil produk, boleh diindeks mesin pencari)
- `https://domainanda.com/app` untuk login Admin/TU/Guru (tidak diindeks)
- `https://domainanda.com/app#lapor` untuk form orang tua (link ini yang dibagikan ke grup WA; link lama `/#lapor` tetap diteruskan)

> Halaman depan (`public/index.html`, `robots.txt`, `sitemap.xml`) memuat alamat `https://hadirin-three.vercel.app`. Kalau memakai domain sendiri, ganti alamat itu di ketiga file tersebut.

---

## Langkah 5 — Aktifkan HSTS (opsional, setelah HTTPS stabil)

```bash
sudo nano /etc/nginx/sites-available/hadirin.conf
# hapus tanda # di depan baris: add_header Strict-Transport-Security ...
sudo nginx -t && sudo systemctl reload nginx
```

Cek skor keamanan header di https://securityheaders.com dan sertifikat di https://www.ssllabs.com/ssltest/.

---

## Update website

Setelah mengubah file di laptop, jalankan:

```bash
bash deploy/deploy.sh vinn@IP_VPS
```

Jika memakai GitHub, cukup jalankan di VPS:

```bash
cd ~/hadirin && git pull
sudo rsync -a --delete public/ /var/www/hadirin/public/
```

---

## Ganti domain di kemudian hari

1. Arahkan DNS domain baru ke IP VPS (Langkah 1).
2. Jalankan ulang setup dengan domain baru:
   ```bash
   sudo bash deploy/setup-vps.sh domainbaru.com email@anda.com
   ```
3. Hapus sertifikat domain lama jika tidak dipakai lagi:
   ```bash
   sudo certbot certificates
   sudo certbot delete --cert-name domainlama.com
   ```
4. Perbarui link form orang tua yang sudah dibagikan.

---

## Opsi: Deploy dengan Docker

Jika VPS sudah memakai Docker:

```bash
cd ~/hadirin
docker compose up -d --build
```

Container berjalan di `127.0.0.1:8080`, hanya bisa diakses dari VPS sendiri. Arahkan reverse proxy (Nginx host, Caddy, atau Nginx Proxy Manager) yang menangani HTTPS ke port tersebut.

Contoh dengan Caddy, yang mengurus HTTPS otomatis:

```
domainanda.com {
    reverse_proxy 127.0.0.1:8080
}
```

---

## Troubleshooting

| Masalah | Penyebab umum | Solusi |
|---|---|---|
| Certbot gagal: *DNS problem / unauthorized* | DNS belum mengarah ke VPS, atau Cloudflare masih Proxied | Cek `nslookup domainanda.com`, tunggu propagasi, set Cloudflare ke DNS only |
| Situs tidak bisa dibuka sama sekali | Firewall dari penyedia VPS menutup port 80/443 | Buka port 80 dan 443 di panel penyedia (Security Group/Firewall) |
| `nginx -t` gagal | Salah ketik di config | Baca pesan error, perbaiki `/etc/nginx/sites-available/hadirin.conf` |
| Tampilan berantakan atau font tidak muncul | Cache browser lama | Tekan Ctrl+Shift+R |
| Login demo gagal di HTTP biasa | `crypto.subtle` hanya berjalan di HTTPS/localhost | Pastikan sudah memakai `https://` |
| 403 Forbidden | Izin folder salah | `sudo chown -R www-data:www-data /var/www/hadirin` |

Log Nginx:

```bash
sudo tail -f /var/log/nginx/hadirin.error.log
sudo tail -f /var/log/nginx/hadirin.access.log
```

## Database Supabase + Vercel (v0.5+)

1. Buat proyek di supabase.com (paket Free cukup).
2. SQL Editor → tempel isi semua file `supabase/migrations/*.sql` (urut nama) → Run.
3. Settings → API Keys → salin **publishable key** (aman untuk browser).
4. Salin `supabase/config.example.json` menjadi `supabase/config.json`, isi `url` dan `key`.
   JANGAN pernah memakai secret / service_role key di sini.
5. `node deploy/build-single.js` lalu `cd dist && npx vercel deploy --prod --yes`.

Proyek saat ini: `https://pzhlreyseedjkgzevuun.supabase.co` (org "VinnVinn02's OrgHadirin").
Akses data hanya lewat fungsi RPC; tabel tertutup RLS dan tidak bisa dibaca langsung.
Scan wajah memakai `public/vendor/face-api.js` + `public/models/` (model CNN, disalin ke `dist/` saat build).
