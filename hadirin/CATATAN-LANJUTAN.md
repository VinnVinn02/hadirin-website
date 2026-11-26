# Catatan Lanjutan — Hadirin

> Baca file ini dulu setiap mau melanjutkan proyek.
> Terakhir diperbarui: **19 November 2026 (v0.10.0)**

## 1. Ringkasnya

Hadirin adalah web absensi sekolah. Isinya:

- **Scan wajah** untuk mencatat siswa hadir.
- **Laporan sakit/izin** dari orang tua lewat form tanpa login.
- **Verifikasi surat** oleh TU.
- **Rekap sekolah**.

| Bagian | Di mana |
|---|---|
| Website online | https://hadirin-three.vercel.app |
| Halaman depan publik | https://hadirin-three.vercel.app/ (boleh diindeks Google) |
| Aplikasi (login staf) | https://hadirin-three.vercel.app/app (noindex) |
| Form orang tua | https://hadirin-three.vercel.app/app#lapor (per kelas: `#lapor?k=XI%20IPA%201`). Link lama `/#lapor` diteruskan otomatis |
| Cek status laporan | https://hadirin-three.vercel.app/app#cek |
| Hosting | Vercel, proyek **hadirin**, akun `vinn22` (login CLI sebagai vinnvinn02) |
| Database | Supabase, proyek **hadirin** (`pzhlreyseedjkgzevuun`, server Tokyo) di organisasi "VinnVinn02's OrgHadirin" (Free) |
| Folder proyek | `Downloads\hadirin\hadirin` |

## 2. Akun

Akun: `admin`, `tu.sari`, `guru.firman`, `guru.rahma`, `guru.budi`. Sandi TIDAK ditulis di sini (repo publik).
Ganti sandi admin lewat **Ganti sandi**; akun lain lewat **Pengguna → Reset sandi**. Tombol "Reset data demo"
sudah dihapus dan fungsi `reset_demo` ditolak server (v0.15), karena dulu mengembalikan sandi admin ke sandi demo.

## 3. Struktur file

```
public/                  ← kode sumber website
  index.html             ← halaman depan publik (SEO: meta, OG, JSON-LD, FAQ, kontak)
  app.html               ← aplikasi: semua tampilan (login, form ortu, dashboard, dialog)
  assets/css/landing.css, assets/js/landing.js, assets/og-image.png ← khusus halaman depan
  robots.txt, sitemap.xml
  assets/js/app.js       ← semua logika (panggil server lewat fungsi rpc())
  assets/css/style.css   ← tampilan, termasuk tema gelap
  vendor/face-api.js     ← library pengenal wajah (TensorFlow.js)
  models/                ← model CNN: detektor wajah, 68 titik wajah, pengenal ResNet (±7 MB)
supabase/
  migrations/*.sql       ← SELURUH database: tabel, keamanan, fungsi (jalankan urut nama)
  config.json            ← URL + publishable key (aman untuk browser, JANGAN isi secret key)
  config.example.json
deploy/build-single.js   ← menggabungkan semuanya ke dist/ + header keamanan Vercel
dist/                    ← hasil build yang di-upload ke Vercel (jangan diedit manual)
docs/DEPLOY.md, docs/SECURITY.md, CHANGELOG.md
```

## 4. Cara mengubah lalu meng-online-kan lagi

1. Ubah file di `public/`.
2. Build: `node deploy/build-single.js`
3. Tes lokal (opsional): `cd dist` lalu `python -m http.server 8765`, buka http://localhost:8765
4. Deploy: `cd dist` lalu `npx vercel deploy --prod --yes`

Kalau yang diubah **database**:

1. Buat file baru di `supabase/migrations/`, misalnya `20261201000000_fitur-x.sql`. Jangan mengubah file lama.
2. Buka Supabase → SQL Editor, tempel isi file baru itu, lalu klik **Run**.
3. Setiap ada fungsi RPC baru, tambahkan `grant execute on function ... to anon, authenticated;`.
   Tanpa grant, fungsi itu tidak bisa dipanggil dari website.

## 5. Cara kerja keamanan (penting kalau menambah fitur)

- **Semua tabel tertutup RLS.** Website tidak bisa membaca tabel langsung, semuanya lewat fungsi RPC di `supabase/migrations`.
- **Login staf** memanggil `login()`, yang mengembalikan token sesi. Token itu dikirim di setiap fungsi sebagai `p_token`.
  Fungsi `_auth(token, peran)` memeriksa sesi dan peran. Sesi berakhir setelah 15 menit tanpa aktivitas.
- **Kata sandi** di-hash bcrypt. Login dikunci bertahap setelah 3 kali salah.
- **Form orang tua** tidak pakai login. Pengamannya:
  - 4 angka terakhir NIS, dikunci setelah 3 kali salah.
  - Maksimal 5 laporan per 10 menit per IP.
  - Jebakan anti-bot (honeypot).
- **Data wajah** hanya berupa 128 angka per sampel, bukan foto. Menyimpannya wajib mencatat persetujuan orang tua (UU PDP).
- **Header keamanan** (CSP dan lainnya) dibuat otomatis oleh `build-single.js` ke `dist/vercel.json`.

## 6. Fitur yang sudah jalan

- [x] Login Admin / TU / Guru dengan menu sesuai peran
- [x] Ganti sandi, sandi sementara wajib diganti, admin bisa reset sandi
- [x] Antrean siswa belum hadir, laporan sakit/izin, tandai Alpa sekaligus
- [x] Form orang tua, nomor laporan, cek status (nama anak disamarkan)
- [x] Lampiran foto/PDF tersimpan di server, foto otomatis dikecilkan
- [x] Verifikasi surat oleh TU (setujui/tolak dengan alasan)
- [x] Rekap sekolah, ekspor CSV, cetak/PDF, log audit
- [x] **Scan wajah CNN**: daftar wajah (3 sampel otomatis, 1 klik) dan absensi dengan cek kedip.
      Siswa yang datang terlambat setelah ditandai Alpa, Alpa-nya otomatis dibatalkan.
- [x] Data sinkron antar perangkat (diperbarui tiap 20 detik), tema terang/gelap, tampilan HP

## 7. Yang BELUM / ide lanjutan (urut prioritas)

1. **Siapkan untuk pemakaian sungguhan**
   - Hapus daftar akun demo dari halaman login: variabel `demo` di `app.js` dan `<details>` di `app.html`.
   - Ganti semua sandi demo.
   - Ganti nama sekolah "SMA Harapan Bangsa" di `app.html`.
2. ~~**Import data siswa asli dari Excel/CSV**~~ — selesai v0.12 (menu Data siswa). Sekarang siswa dan kelas masih data contoh dari `_seed_dasar()` di SQL.
   Perlu menu admin: unggah CSV berisi kolom NIS, nama, kelas.
3. ~~**Kelola kelas & wali kelas**~~ — selesai v0.12 (menu Data siswa → Daftar kelas). Sekarang daftar kelas masih tertulis di kode (`classList` di `app.js` dan tabel `kelas`).
4. ~~**Matikan data contoh harian**~~ — sekarang lewat saklar di menu Data siswa (Admin), tanpa ubah SQL. `_seed_hari()` otomatis mengisi kehadiran dan laporan contoh setiap hari.
   Untuk pemakaian sungguhan, hapus pemanggilan `perform _seed_hari(...)` di fungsi `data_harian` dan `rekap`.
5. **Notifikasi WhatsApp ke orang tua**. Tombol "Kirim konfirmasi" dan "Ingatkan wali kelas" sekarang hanya mencatat ke log.
   Butuh layanan seperti Fonnte atau WhatsApp Cloud API, lewat Supabase Edge Function supaya API key tidak ada di browser.
6. **Riwayat & laporan bulanan** per siswa dan per kelas, karena rekap sekarang hanya untuk hari ini.
7. **Scan wajah**:
   - Mode "kiosk" di gerbang sekolah yang mengenali semua kelas sekaligus. Sekarang per kelas.
   - Pengaturan ambang kecocokan (sekarang 0,5 di `MATCH`).
   - Laporan siswa yang belum didaftarkan wajahnya.
8. **Jam batas lapor** (09.00) masih hanya tulisan. Alpa otomatis setelah jam itu belum ada (perlu cron Supabase).
9. Ganti nama organisasi Supabase menjadi "Hadirin" (Settings → General).

## 8. Hal yang perlu diingat

- **Tombol "Reset data demo"** (menu Pengguna) menghapus SEMUA laporan, wajah, akun buatan, dan log di server.
- **Paket gratis Supabase** menjeda proyek kalau tidak ada aktivitas selama ±7 hari.
  Buka dashboard Supabase lalu klik "Restore" kalau website tiba-tiba gagal terhubung.
- **Kamera** hanya jalan lewat HTTPS (Vercel sudah HTTPS) atau `localhost`, dan browser harus diberi izin kamera.
- **Kata sandi database Supabase** dibuat otomatis saat proyek dibuat dan tidak disimpan di sini.
  Tidak dibutuhkan website. Kalau perlu, reset di Supabase → Settings → Database.
- **Login Supabase CLI** di terminal sempat macet. Untuk mengubah database, pakai SQL Editor di dashboard saja.

## 9. Pembaruan keamanan (19 November 2026)

Dua migrasi baru + pengujian sudah ditambahkan. **Jalankan berurutan di Supabase → SQL Editor:**

1. `supabase/migrations/20261119000000_hardening.sql`
   - Ambang kecocokan wajah diseragamkan di server (tolak jarak > 0.5 dan NaN).
   - Validasi *magic bytes* lampiran (isi file harus JPG/PNG/WEBP/PDF asli).
   - Fungsi baru: `siswa_hapus_data` (hapus data siswa, UU PDP), `retensi_bersihkan` (bersihkan data lama),
     `hapus_lampiran_yatim` (bersihkan lampiran tanpa laporan).
2. `supabase/migrations/20261119010000_enkripsi-wajah.sql`
   - Descriptor wajah kini terenkripsi AES-256, kunci di **Supabase Vault** (dibuat otomatis: `hadirin_wajah_key`).
   - Front-end (`app.js`) **tidak berubah** — enkripsi/dekripsi transparan di server.

Pengujian (opsional, jalankan di SQL Editor): `supabase/tests/01_hardening_test.sql` lalu
`supabase/tests/02_enkripsi_test.sql` (lihat `supabase/tests/README.md`).

Catatan: bila `enkripsi-wajah.sql` gagal dengan *"permission denied ... decrypted_secrets"*,
pastikan fitur **Vault** aktif di Supabase (Database → Vault). Belum ada tombol UI untuk fungsi retensi
yang baru; untuk sementara dipanggil langsung lewat SQL atau ditambahkan ke menu admin belakangan.
