# Pengujian otomatis (SQL)

Skrip assertion sederhana yang bisa dijalankan langsung di **Supabase → SQL Editor**
(paste lalu **Run**). Tidak butuh ekstensi pgTAP.

| File | Isi | Syarat |
|---|---|---|
| `01_hardening_test.sql` | Validasi magic bytes lampiran, kebijakan sandi, normalisasi nomor WA | Migrasi `20261119000000_hardening.sql` sudah dijalankan |
| `02_enkripsi_test.sql` | Round-trip enkripsi descriptor wajah + cek tipe kolom | Migrasi `20261119010000_enkripsi-wajah.sql` sudah dijalankan |

Setiap blok mencetak `OK: ...` di panel *Messages*. Bila ada yang salah, blok itu melempar
`GAGAL: ...` (exception), sehingga terlihat jelas di hasil.

## Catatan

- `01_hardening_test.sql` menulis lalu menghapus satu baris uji di tabel `lampiran` (dibersihkan otomatis).
- `02_enkripsi_test.sql` hanya membaca dan tidak mengubah data.
- Pengujian fungsi yang butuh sesi login (mis. `hadir_scan`, `siswa_hapus_data`) tidak bisa dijalankan
  tanpa token; itu dicakup oleh pengujian integrasi/pemakaian manual lewat aplikasi.
