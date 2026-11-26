# Changelog

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/).

## [0.15.0] — 2026-11-26
### Keamanan
- Daftar akun demo (ID + sandi) dihapus dari halaman login, begitu juga banner "Prototipe dengan data contoh".
- Tombol **Reset data demo** dihapus, dan fungsi `reset_demo` ditolak di server
  (migrasi `20261126030000_matikan-reset-demo.sql`). Fungsi itu dulu mengembalikan sandi admin ke sandi demo.
- Sandi demo dihapus dari README dan catatan proyek.

## [0.14.0] — 2026-11-26
### Ditambahkan
- **Ubah kelas akun guru** (Admin, menu Pengguna): pilih kelas langsung di tabel, atau "Tanpa kelas" untuk melepas.
  Satu kelas tetap hanya boleh punya satu wali kelas aktif; nama wali kelas yang masih kosong diisi otomatis;
  akun yang diubah diminta login ulang. Migrasi `20261126020000_ubah-kelas-guru.sql` (RPC `user_kelas_set`).

### Diubah
- Data contoh di database produksi dihapus (siswa, kelas, laporan, kehadiran, wajah, log); data contoh harian dimatikan.
  Akun login dipertahankan.

## [0.13.0] — 2026-11-26
### Ditambahkan
- **🔍 Cari siswa** (tombol di header, semua peran; guru hanya kelasnya sendiri): cari dengan NIS atau nama.
- **Detail siswa**: data diri, status data wajah (tanggal & persetujuan), rekap 30 hari (hadir/sakit/izin/alpa),
  kalender kehadiran, galeri foto surat/lampiran, dan riwayat laporan. Bisa juga dibuka dengan klik nama di menu Data siswa.
- Setiap pembukaan detail siswa dicatat di log audit (khusus admin) — data pribadi, UU PDP.
- Migrasi `20261126010000_detail-siswa.sql`: RPC `siswa_cari`, `siswa_detail`.
- Catatan: Hadirin tetap tidak menyimpan foto wajah; "foto" di detail siswa adalah lampiran surat.

## [0.12.0] — 2026-11-26
### Ditambahkan
- **Menu Data siswa** (Admin + TU): tambah, ubah, hapus siswa (NIS, nama, kelas, no. WA ortu), cari per kelas,
  status pendaftaran wajah.
- **Impor dari Excel (CSV)**: template unduhan, pemisah `;`/`,` dideteksi otomatis, NIS yang sudah ada diperbarui (tidak dobel),
  opsi membuat kelas baru otomatis, baris yang salah dilewati dan dilaporkan.
- **Kelola kelas**: tambah kelas, ubah nama wali kelas, hapus kelas kosong. Pilihan kelas di form akun guru kini diambil dari database.
- **Saklar data contoh harian** (Admin): matikan supaya kehadiran tidak lagi diisi otomatis, dengan opsi mengosongkan kehadiran hari ini.
- **Pratinjau lampiran** di dalam halaman: foto surat langsung tampil, PDF bisa dibuka/diunduh.
  Lampiran data contoh ditandai "contoh, tanpa file".
- Migrasi `20261126000000_data-siswa.sql`: RPC `siswa_list`, `siswa_simpan`, `siswa_hapus`, `siswa_impor`,
  `kelas_simpan`, `kelas_hapus`, `data_contoh_set`; tabel `pengaturan`.

## [0.11.0] — 2026-11-26
### Ditambahkan
- **Halaman depan publik** di `/` (`public/index.html`): satu H1, meta description, canonical, Open Graph + Twitter Card,
  gambar pratinjau 1200×630 (`assets/og-image.png`, dibuat ulang dengan `node deploy/make-og.js`),
  JSON-LD (Organization, WebSite, SoftwareApplication, FAQPage), bagian cara kerja, fitur, keamanan data, tanya jawab, dan kontak.
- `robots.txt` dan `sitemap.xml`.
- Build menolak jalan selama halaman depan masih berisi `GANTI:` (tes lokal: `HADIRIN_DRAFT=1`).
  Bagian kontak sementara diganti tombol "Mulai memakai Hadirin" sampai data kontak asli tersedia.

- **Kamera kelas:** setiap siswa yang tercatat hadir memunculkan pemberitahuan besar di atas video, misalnya "✓ Bima Saputra hadir" (±3 detik).
  Nama siswa di daftar "Hadir lewat kamera" ditebalkan.
  Siswa yang sudah tercatat hadir hari ini juga diberi tahu ("✓ Bima · sudah tercatat hadir hari ini"), maksimal sekali per 8 detik.

### Diperbaiki
- Teks "Belum ada yang tercatat di sesi ini" di panel kamera tidak lagi terpotong satu kata per baris.

### Diubah
- Aplikasi pindah ke `/app` (`public/app.html`). Link lama `/#lapor`, `/#lapor?k=…`, dan `/#cek` diteruskan otomatis ke `/app`.
- `X-Robots-Tag: noindex` sekarang hanya untuk `/app`, `/models`, dan `/vendor`; halaman depan boleh diindeks (Vercel dan Nginx).

## [0.10.0] — 2026-11-19
### Ditambahkan
- Enkripsi descriptor wajah saat disimpan: AES-256 (pgcrypto) dengan kunci di Supabase Vault.
  Enkripsi/dekripsi terjadi di server, sehingga kode front-end tidak berubah.

## [0.9.0] — 2026-11-19
### Diubah
- Ambang kecocokan wajah diseragamkan: server menolak jarak > 0.5 (sebelumnya 0.6) dan nilai NaN.

### Ditambahkan
- Validasi *magic bytes* lampiran di server — isi file harus benar-benar JPG/PNG/WEBP/PDF, bukan sekadar MIME/ekstensi palsu.
- Fungsi retensi & penghapusan data (UU PDP): `siswa_hapus_data`, `retensi_bersihkan`, `hapus_lampiran_yatim`.
- Pengujian SQL di `supabase/tests/` (`01_hardening_test.sql`, `02_enkripsi_test.sql`).

## [0.7.0] — 2026-11-18
### Ditambahkan
- Tombol **💬 WA ortu** (lewat `wa.me`): membuka WhatsApp di perangkat guru dengan pesan yang sudah terisi, guru tinggal menekan Kirim
  - Ada di form laporan (saat siswa dipilih dari antrean), tabel laporan hari ini, dan daftar "Perlu perhatian"
  - Pesan menyesuaikan keadaan: belum ada kabar (plus link form orang tua), Alpa, konfirmasi Sakit/Izin, dan rekap kehadiran
  - Pesan menyertakan total **hari** tidak masuk dalam 30 hari terakhir (minimal 2 hari)
- Nomor WA orang tua per siswa (`siswa.hp_ortu`), diisi lewat tombol **＋ No. WA**. Guru hanya bisa melihat dan mengubah nomor siswa di kelasnya sendiri
- Setiap pembukaan WA dan perubahan nomor dicatat di log audit
- Migrasi `20261118020000_wa-ortu.sql`: RPC `kontak_ortu`, `hp_ortu_set`, `wa_catat`

## [0.6.1] — 2026-11-18
### Diubah
- Pendaftaran wajah: cukup 1 klik "Ambil sampel otomatis", 3 sampel diambil sendiri dalam ±3 detik (sebelumnya 5 klik)
- Catatan lanjutan proyek di `CATATAN-LANJUTAN.md`

## [0.6.0] — 2026-11-18
### Ditambahkan
- Menu **Kamera kelas**: absensi scan wajah sungguhan dengan model CNN (face-api.js / TensorFlow.js) yang berjalan di browser
  - Deteksi wajah TinyFaceDetector, 68 titik wajah, pengenal ResNet-34 (descriptor 128 angka), cocok bila jarak < 0,5 di 3 frame
  - Cek "hidup": harus berkedip sebelum tercatat hadir, supaya foto di HP tidak bisa dipakai
  - Siswa yang datang setelah ditandai Alpa otomatis dibatalkan Alpa-nya
- Pendaftaran wajah 3–5 sampel per siswa dengan catatan persetujuan orang tua (UU PDP); yang disimpan hanya angka ciri wajah, bukan foto
- Hapus data wajah per siswa, dan reset demo ikut menghapus semua data wajah

## [0.5.0] — 2026-11-18
### Ditambahkan
- Database server Supabase (`supabase/migrations/`): laporan, akun, lampiran, dan log tersimpan di server dan sama di semua perangkat
- Semua kelas punya data siswa sendiri; wali kelas hanya melihat kelasnya, Admin/TU bisa memilih kelas
- Form orang tua: pilih kelas dulu, link per kelas (`#lapor?k=XI%20IPA%201`)
- Lampiran tersimpan di server dan bisa dibuka oleh wali kelas/TU (foto otomatis dikecilkan sebelum dikirim)
- Grafik mingguan dan daftar "perlu perhatian" dihitung dari data nyata 30 hari terakhir
- Indikator koneksi server, data diperbarui otomatis tiap 20 detik

### Diubah
- Login, penguncian, hak akses peran, batas kiriman, dan cek NIS sekarang diperiksa di server (fungsi RPC + RLS), bukan di browser
- Kata sandi di-hash bcrypt di server; token sesi acak 256-bit, kedaluwarsa 15 menit tanpa aktivitas, sesi lain diputus saat ganti sandi
- Nomor laporan lebih sulit ditebak (`HDR-YYMMDD-ABCDE`), cek status menyamarkan nama anak dan dibatasi 30 pencarian/10 menit

## [0.4.0] — 2026-11-17
### Ditambahkan
- Data tersimpan di browser (localStorage): tidak hilang saat refresh, antrean harian dikosongkan saat ganti hari, sinkron antar-tab
- Sesi login bertahan saat refresh dan berakhir otomatis setelah 15 menit tanpa aktivitas
- Ganti kata sandi untuk semua akun, wajib ganti saat memakai kata sandi sementara, indikator kekuatan sandi
- Admin bisa reset kata sandi pengguna, ekspor log audit, dan reset data demo
- Orang tua bisa cek status laporan dengan nomor laporan (`#cek`)
- Pencarian siswa di antrean dan laporan, ekspor CSV (Excel) laporan harian dan rekap sekolah, cetak/PDF rekap
- Pratinjau foto surat, tombol tema terang/gelap/otomatis
- Build satu file (`node deploy/build-single.js`) dengan CSP berbasis hash + `vercel.json` header keamanan

### Diubah
- Hash kata sandi: SHA-256 statis → PBKDF2-SHA256 150.000 iterasi dengan salt per akun, perbandingan waktu-konstan
- Penguncian login bertahap (30 dtk, 60, 120, … maks 15 menit) dan tetap berlaku setelah refresh
- Form orang tua: status anak baru tampil setelah NIS cocok, honeypot anti-bot, maks 5 laporan/10 menit per perangkat, periode maks 14 hari
- Lampiran dibatasi JPG/PNG/WEBP/HEIC/PDF maks 5 MB, nama file disanitasi
- Tampilan login baru (dua kolom), kartu ringkasan berwarna, animasi halus, dialog, mobile lebih rapi

### Diperbaiki
- Form tidak dikosongkan setelah logout; wali kelas lama bisa diaktifkan lagi padahal kelas sudah punya wali aktif
- Link `#lapor` tidak terbuka bila ditempel di tab yang sudah terbuka

## [0.3.0] — 2026-10-18
### Ditambahkan
- Form lapor sakit/izin untuk orang tua tanpa login (`/#lapor`), dioptimalkan untuk HP
- Verifikasi 4 digit terakhir NIS, dengan penguncian 60 detik setelah 3 kali salah
- Nomor laporan untuk orang tua dan pencegahan laporan ganda
- Antrean "Kabar orang tua" dengan tombol Terima, Terima semua, dan Periksa
- Paket deploy: config Nginx dengan header keamanan, `setup-vps.sh`, `deploy.sh`, dan Docker

### Diubah
- Login tidak lagi meminta pilihan peran. Peran dikenali otomatis dari akun
- Kode dipisah menjadi `index.html`, `style.css`, dan `app.js` supaya CSP bisa ketat

## [0.2.0] — 2026-10-18
### Ditambahkan
- Login Admin, TU, dan Guru dengan menu sesuai peran
- Hash kata sandi, penguncian login, dan log audit
- Verifikasi surat oleh TU dan rekap kehadiran semua kelas
- Kelola pengguna dengan kata sandi sementara acak

## [0.1.0] — 2026-10-18
### Ditambahkan
- Dashboard pelaporan ketidakhadiran dengan pilihan Sakit/Izin dan keterangan
- Template keterangan, periode beberapa hari, lampiran surat, dan tandai Alpa sekaligus
- Grafik mingguan dan daftar siswa yang perlu perhatian
