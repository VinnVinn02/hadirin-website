# Hadirin — Absensi Wajah & Pelaporan Ketidakhadiran

Hadirin adalah sistem absensi siswa berbasis pengenalan wajah (CNN) dengan modul pelaporan **Sakit / Izin**.
Paket ini berisi **prototipe front-end** modul pelaporan: login Admin/TU/Guru, form lapor untuk orang tua,
antrean laporan untuk wali kelas, verifikasi surat oleh TU, rekap sekolah, dan kelola pengguna.

> **Status: prototipe.** Semua data adalah contoh dan hanya tersimpan di memori browser.
> Saat halaman di-refresh, data kembali ke kondisi awal. Lihat [Roadmap](#roadmap) untuk menuju versi produksi.

---

## Daftar isi
- [Fitur](#fitur)
- [Alur pelaporan](#alur-pelaporan)
- [Akun awal](#akun-awal)
- [Struktur folder](#struktur-folder)
- [Menjalankan di laptop](#menjalankan-di-laptop)
- [Deploy ke VPS dan domain baru](#deploy-ke-vps-dan-domain-baru)
- [Keamanan](#keamanan)
- [Roadmap](#roadmap)

---

## Fitur

### Form lapor orang tua (tanpa login)
- Dibuka dari link yang dibagikan wali kelas di grup WhatsApp: `https://domainanda/app#lapor` (link lama `https://domainanda/#lapor` tetap diteruskan otomatis)
- Tujuh langkah singkat:
  1. Nama anak
  2. 4 angka terakhir NIS
  3. Sakit atau Izin
  4. Keterangan dengan pilihan cepat
  5. Lama tidak masuk
  6. Foto surat (langsung membuka kamera di HP)
  7. Nama pelapor
- Menolak laporan ganda di hari yang sama, dan memberi peringatan jika anak sudah tercatat hadir lewat scan wajah
- Sakit lebih dari 2 hari wajib melampirkan surat dokter
- Setelah dikirim, orang tua mendapat nomor laporan (contoh `HDR-261018-123`)

### Login berbasis peran
Peran dikenali otomatis dari akun, tanpa perlu memilih peran.

| Fitur | Admin | TU | Guru |
|---|:-:|:-:|:-:|
| Melaporkan dan menerima laporan sakit/izin | ✓ | ✓ | ✓ |
| Menandai Alpa sekaligus | ✓ | ✓ | ✓ |
| Verifikasi surat izin/sakit | ✓ | ✓ | – |
| Rekap semua kelas dan pengingat ke wali kelas | ✓ | ✓ | – |
| Kelola akun dan peran | ✓ | – | – |
| Melihat login gagal di log audit | ✓ | – | – |

### Dashboard pelaporan (wali kelas)
- Antrean otomatis berisi siswa yang tidak terdeteksi kamera
- Laporan dari orang tua cukup diklik **Terima**, atau **Terima semua** sekaligus
- Form manual dengan pilihan **Sakit / Izin**, keterangan di bawahnya, template alasan, periode beberapa hari, dan lampiran
- **Tandai sisa sebagai Alpa** dalam satu klik, dengan langkah konfirmasi
- Rekap harian dengan filter, grafik mingguan, dan daftar siswa yang perlu perhatian

### Tata Usaha
- Verifikasi surat: setujui, atau tolak dengan alasan wajib diisi
- Rekap kehadiran per kelas, ditambah tombol pengingat ke wali kelas yang belum lengkap

### Administrator
- Tambah akun dengan kata sandi sementara acak (wajib diganti saat login pertama)
- Aktifkan/nonaktifkan akun, dan aturan satu wali kelas aktif per kelas
- Tabel hak akses tiap peran

### Log audit
Setiap login, laporan, verifikasi, dan perubahan akun tercatat beserta jamnya.

---

## Alur pelaporan

```
Orang tua isi form (#lapor) ──► Antrean wali kelas ──► Guru klik "Terima" ──► Tercatat Sakit/Izin
                                                                  │
                                                  ada lampiran? ──┴──► TU verifikasi surat
Tidak ada kabar sampai batas jam ──► "Tandai sisa sebagai Alpa"
```

Satu laporan cukup diisi sekali oleh orang tua. Guru hanya mengonfirmasi, dan TU hanya terlibat bila ada surat.

---

## Akun awal

Database baru dipasang dengan beberapa akun awal (ID `admin`, `tu.sari`, `guru.firman`) yang sandinya tertulis
di file migrasi publik. **Segera setelah memasang database:**

1. Login sebagai `admin`, lalu ganti sandinya lewat **Ganti sandi**.
2. Di menu **Pengguna**, tekan **Reset sandi** untuk akun lain (sandi sementara acak, wajib diganti saat login pertama),
   atau **Nonaktifkan** akun yang tidak dipakai.

Sandi tidak pernah dicantumkan di dokumentasi ini.

---

## Struktur folder

```
hadirin/
├── public/                  # Semua file yang di-upload ke server
│   ├── index.html           # Halaman depan publik (profil produk, boleh diindeks Google)
│   ├── app.html             # Aplikasi (login, form orang tua, dashboard), tidak diindeks
│   └── assets/
│       ├── css/style.css    # Tampilan (mode terang dan gelap)
│       ├── js/app.js        # Logika aplikasi
│       └── favicon.svg
├── deploy/
│   ├── setup-vps.sh         # Setup VPS sekali jalan (Nginx + HTTPS + firewall)
│   ├── deploy.sh            # Kirim update dari laptop ke VPS
│   └── nginx/
│       ├── hadirin.conf     # Config Nginx + header keamanan
│       └── docker.conf      # Config untuk container Docker
├── docs/
│   ├── DEPLOY.md            # Panduan deploy langkah demi langkah
│   └── SECURITY.md          # Catatan keamanan dan rencana hardening
├── Dockerfile               # Opsi deploy dengan Docker
├── docker-compose.yml
├── CHANGELOG.md
└── README.md
```

---

## Menjalankan di laptop

Tidak perlu instal apa pun selain Python atau Node.js. Jalankan salah satu perintah berikut:

```bash
# Python
cd hadirin/public && python3 -m http.server 8000

# atau Node.js
npx serve hadirin/public -l 8000
```

Lalu buka `http://localhost:8000` (halaman depan), `http://localhost:8000/app.html` (aplikasi), dan untuk form orang tua `http://localhost:8000/app.html#lapor`.

> Jangan membuka `app.html` dengan klik dua kali (`file://`). Fitur seperti hash kata sandi (`crypto.subtle`) hanya berjalan di `http://localhost` atau `https://`.

---

## Deploy ke VPS dan domain baru

Ringkasnya:

1. Arahkan DNS domain (A record `@` dan `www`) ke IP VPS.
2. Upload folder `hadirin` ke VPS.
3. Jalankan:
   ```bash
   sudo bash deploy/setup-vps.sh domainanda.com email@anda.com
   ```
4. Buka `https://domainanda.com` (halaman depan) dan `https://domainanda.com/app` (aplikasi).

Untuk update berikutnya, jalankan dari laptop:

```bash
bash deploy/deploy.sh user@IP_VPS
```

Panduan lengkap, opsi Docker, cara ganti domain, dan troubleshooting ada di **[docs/DEPLOY.md](docs/DEPLOY.md)**.

---

## Keamanan

Konfigurasi server sudah menyertakan:
- HTTPS otomatis (Let's Encrypt) dengan redirect HTTP → HTTPS
- Header keamanan: CSP ketat (tanpa inline script), `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`
- Firewall UFW yang hanya membuka port SSH, 80, dan 443
- Akses ke file tersembunyi (`.git`, `.env`) diblokir

Keterbatasan prototipe dan rencana perbaikannya dijelaskan di **[docs/SECURITY.md](docs/SECURITY.md)**.
Yang terpenting: login dan data saat ini masih di sisi browser, sehingga **wajib dipindah ke backend** sebelum dipakai sungguhan.

---

## Roadmap

- [ ] Backend + database (mis. Laravel/Express + PostgreSQL/MySQL, atau Supabase)
- [ ] Autentikasi server-side: hash Argon2/bcrypt, sesi via cookie `HttpOnly; Secure; SameSite`
- [ ] Gabungkan dengan modul absensi wajah (face-api.js / CNN) yang sudah ada
- [ ] Link form orang tua bertoken unik per siswa atau OTP WhatsApp (pengganti verifikasi NIS)
- [ ] Notifikasi WhatsApp/email ke orang tua dan wali kelas
- [ ] Liveness detection (anti foto/video) saat scan wajah
- [ ] Export rekap ke Excel/PDF berkop sekolah
- [ ] Backup database otomatis harian

---

**Penyusun:** M. Maulana Alpidie Deputra — Rekayasa Keamanan Siber, Politeknik Negeri Batam
