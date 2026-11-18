# Catatan Keamanan Hadirin

Dokumen ini mencatat kontrol keamanan yang sudah ada, keterbatasan prototipe, dan rencana hardening.
Isinya bisa dipakai sebagai bahan bab analisis keamanan dalam skripsi.

## 1. Kontrol yang sudah ada

### Aplikasi (front-end)
| Kontrol | Implementasi |
|---|---|
| Hash kata sandi | SHA-256 dengan prefix (`hadirin:` + sandi), dibandingkan dengan hash tersimpan |
| Pembatasan percobaan login | 3 kali gagal → login dikunci 30 detik |
| Pembatasan verifikasi NIS (form orang tua) | 3 kali salah → form dikunci 60 detik |
| Role-based access control | Menu dan tampilan dibatasi per peran (Admin, TU, Guru) |
| Akun nonaktif | Akun yang dinonaktifkan admin tidak bisa login |
| Kata sandi sementara | Dibuat acak dengan `crypto.getRandomValues`, ditandai wajib ganti |
| Log audit | Login, login gagal, laporan, verifikasi, dan perubahan akun dicatat |
| Pencegahan XSS | Semua input pengguna di-escape sebelum ditampilkan |
| Validasi input | Panjang keterangan, format ID, rentang tanggal, dan lampiran wajib |

### Server (Nginx)
| Kontrol | Implementasi |
|---|---|
| Enkripsi transport | HTTPS Let's Encrypt, redirect HTTP → HTTPS, HSTS (opsional) |
| Content Security Policy | `script-src 'self'` (tanpa inline script), font hanya dari Google Fonts |
| Anti-clickjacking | `X-Frame-Options: DENY` dan `frame-ancestors 'none'` |
| Anti MIME sniffing | `X-Content-Type-Options: nosniff` |
| Pembatasan fitur browser | `Permissions-Policy`: kamera hanya untuk situs sendiri, mikrofon dan lokasi dimatikan |
| Menyembunyikan informasi server | `server_tokens off` |
| Proteksi file sensitif | Akses ke `/.git`, `/.env`, dan file tersembunyi lain ditolak |
| Firewall | UFW hanya membuka SSH, 80, dan 443 |
| Container (opsi Docker) | Filesystem read-only, `no-new-privileges`, port hanya di localhost |

## 2. Keterbatasan prototipe (WAJIB diperbaiki sebelum produksi)

| # | Masalah | Risiko | Perbaikan |
|---|---|---|---|
| 1 | Autentikasi dan pengecekan peran terjadi di browser | Siapa pun bisa membaca hash di `app.js` atau mengubah peran lewat DevTools | Pindahkan autentikasi dan otorisasi ke server. Peran dicek di setiap request API |
| 2 | SHA-256 tanpa salt unik dan tanpa key stretching | Hash sandi lemah mudah ditebak dengan brute force | Gunakan Argon2id atau bcrypt di server, dengan salt unik per pengguna |
| 3 | Lockout login hanya di memori browser | Bisa dilewati dengan refresh halaman | Rate limiting di server per IP dan per akun (mis. `limit_req` Nginx dan logika aplikasi) |
| 4 | Data hanya di memori, tidak tersimpan | Data hilang saat refresh | Database + backup terenkripsi |
| 5 | Verifikasi orang tua hanya dengan 4 digit NIS | NIS mudah diketahui teman sekelas | Link bertoken unik per siswa (dapat dicabut) atau OTP WhatsApp |
| 6 | Lampiran belum diunggah ke server | – | Saat dibuat: batasi tipe dan ukuran file, cek magic bytes, simpan di luar web root, beri nama acak |
| 7 | Log audit bisa diubah di browser | Jejak bisa dihapus | Log ditulis di server, append-only, dengan stempel waktu server |

## 3. Data pribadi dan UU PDP

Hadirin mengolah **data biometrik wajah** dan **data kesehatan** (alasan sakit). Keduanya termasuk *data pribadi yang bersifat spesifik* menurut UU No. 27 Tahun 2022 tentang Pelindungan Data Pribadi. Konsekuensinya:

- Minta persetujuan tertulis orang tua sebelum mendaftarkan wajah siswa
- Simpan descriptor wajah secara terenkripsi. Jangan simpan foto asli jika tidak diperlukan
- Batasi akses keterangan sakit hanya untuk wali kelas, TU, dan admin
- Tetapkan masa simpan, misalnya data dihapus setelah siswa lulus
- Sediakan cara bagi orang tua untuk meminta data anaknya dihapus

## 4. Checklist sebelum go-live

- [ ] Backend dengan autentikasi server-side sudah jalan
- [ ] Akun demo (`admin`, `tu.sari`, `guru.firman`) dihapus dari kode
- [ ] Kata sandi admin kuat dan unik, plus 2FA jika tersedia
- [ ] HTTPS aktif, HSTS diaktifkan, skor securityheaders.com minimal A
- [ ] Login SSH root dan login dengan password dimatikan di VPS
- [ ] `unattended-upgrades` aktif untuk update keamanan otomatis
- [ ] Backup database harian, dan proses restore sudah pernah diuji
- [ ] Persetujuan orang tua untuk data biometrik sudah dikumpulkan
