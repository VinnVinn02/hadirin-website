-- Hadirin v0.9 — pengerasan (hardening)
-- 1. Seragamkan ambang kecocokan wajah di server: hadir_scan menolak p_jarak > 0.5 (sebelumnya 0.6),
--    dan menolak nilai bukan angka (NaN). CATATAN: pencocokan deskriptor wajah masih dilakukan di browser
--    (face-api.js); p_jarak dari klien hanya diperiksa sebagai batas wajar. Verifikasi sesungguhnya baru
--    terpenuhi bila pencocokan dipindah ke server. Nilai ambang kini konsisten dengan MATCH = 0.5 di app.js.
-- 2. Validasi "magic bytes" lampiran di server, supaya isi file benar-benar sesuai jenisnya (JPG/PNG/WEBP/PDF),
--    bukan sekadar ekstensi atau MIME palsu.
-- 3. Fungsi retensi & penghapusan data (UU PDP): hapus data satu siswa, bersihkan data lama, dan
--    bersihkan lampiran yatim (lampiran tanpa laporan).

-- ---------- 1. Ambang kecocokan wajah ----------
create or replace function hadir_scan(p_token text, p_sid int, p_jarak numeric) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); x siswa; d date := _today(); n int; telat boolean := false;
begin
  x := _cek_kelas_siswa(s, p_sid);
  if not exists (select 1 from wajah where siswa_id = x.id) then raise exception 'Wajah siswa ini belum terdaftar.'; end if;
  -- p_jarak adalah jarak Euclidean; NaN tidak lolos karena NaN <> NaN = true
  if p_jarak is null or p_jarak <> p_jarak or p_jarak < 0 or p_jarak > 0.5 then
    raise exception 'Kecocokan wajah terlalu rendah.';
  end if;
  insert into hadir(siswa_id, hari) values (x.id, d) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('baru', false, 'name', x.nama); end if;
  delete from laporan where siswa_id = x.id and jenis = 'alpa' and dari = d and sampai = d;
  get diagnostics n = row_count; telat := n > 0;
  perform _log('Kamera ' || x.kelas || ': ' || x.nama || ' hadir (kecocokan ' || round((1 - p_jarak) * 100) || '%)'
               || case when telat then ', Alpa dibatalkan karena datang terlambat.' else '.' end);
  return json_build_object('baru', true, 'name', x.nama, 'telat', telat);
end $$;

-- ---------- 2. Validasi magic bytes lampiran ----------
create or replace function _magic_cocok(m text, d text) returns boolean
language plpgsql immutable set search_path = public as $$
declare b bytea;
begin
  begin
    b := decode(d, 'base64');
  exception when others then return false; end;
  if m = 'image/jpeg' then
    return length(b) >= 3 and get_byte(b, 0) = 255 and get_byte(b, 1) = 216 and get_byte(b, 2) = 255;
  elsif m = 'image/png' then
    return length(b) >= 8 and encode(substring(b, 1, 8), 'hex') = '89504e470d0a1a0a';
  elsif m = 'image/webp' then
    return length(b) >= 12 and encode(substring(b, 1, 4), 'hex') = '52494646'
         and encode(substring(b, 9, 4), 'hex') = '57454250';
  elsif m = 'application/pdf' then
    return length(b) >= 4 and encode(substring(b, 1, 4), 'hex') = '25504446';
  else
    return false;
  end if;
end $$;

create or replace function _simpan_lampiran(f json) returns uuid language plpgsql set search_path = public as $$
declare v uuid; n text; m text; d text;
begin
  if f is null or json_typeof(f) <> 'object' or coalesce(f->>'data','') = '' then return null; end if;
  n := left(regexp_replace(coalesce(f->>'name','lampiran'), '[^A-Za-z0-9._ ()-]', '_', 'g'), 80);
  m := coalesce(f->>'mime','');
  d := f->>'data';
  if m not in ('image/jpeg','image/png','image/webp','application/pdf') then
    raise exception 'Lampiran harus berupa foto (JPG/PNG/WEBP) atau PDF.';
  end if;
  if length(d) > 3000000 then raise exception 'Lampiran terlalu besar (maks ±2 MB setelah dikompres).'; end if;
  if d !~ '^[A-Za-z0-9+/=]+$' then raise exception 'Data lampiran tidak valid.'; end if;
  if not _magic_cocok(m, d) then
    raise exception 'Isi lampiran tidak sesuai dengan jenisnya. Gunakan foto asli (JPG/PNG/WEBP) atau PDF.';
  end if;
  insert into lampiran(nama, mime, data) values (n, m, d) returning id into v;
  return v;
end $$;

-- ---------- 3. Retensi & penghapusan data (UU PDP) ----------
-- Hapus seluruh data sensitif satu siswa (wajah, laporan, lampiran, kehadiran) — mis. permintaan hapus orang tua.
-- Identitas siswa (nama/NIS/kelas) dipertahankan supaya absensi tetap berjalan; hapus lewat admin bila siswa keluar.
create function siswa_hapus_data(p_token text, p_sid int) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']); x siswa; n_lap int; n_wajah int;
begin
  select * into x from siswa where id = p_sid;
  if not found then raise exception 'Siswa tidak ditemukan.'; end if;
  delete from lampiran where id in (select lampiran_id from laporan where siswa_id = x.id and lampiran_id is not null);
  delete from wajah where siswa_id = x.id; get diagnostics n_wajah = row_count;
  delete from laporan where siswa_id = x.id; get diagnostics n_lap = row_count;
  delete from hadir where siswa_id = x.id;
  perform _log(_pendek(s.nama) || ' menghapus data ' || x.nama || ' (laporan: ' || n_lap || ', wajah: ' || n_wajah || ') — penghapusan data (UU PDP).', 'admin');
  return json_build_object('ok', true, 'laporan', n_lap, 'wajah', n_wajah);
end $$;

-- Bersihkan data lebih tua dari N hari (default 730 = 2 tahun). Wajah tidak dihapus otomatis;
-- data biometrik dihapus manual lewat siswa_hapus_data saat siswa lulus/keluar.
create function retensi_bersihkan(p_token text, p_hari int default 730) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']); cutoff date := _today() - p_hari;
  n_lap int; n_lamp int; n_hadir int; n_log int;
begin
  if p_hari < 30 then raise exception 'Masa simpan minimal 30 hari.'; end if;
  delete from lampiran where id in (select lampiran_id from laporan where laporan.sampai < cutoff and lampiran_id is not null);
  get diagnostics n_lamp = row_count;
  delete from laporan where sampai < cutoff; get diagnostics n_lap = row_count;
  delete from hadir where hari < cutoff; get diagnostics n_hadir = row_count;
  delete from log_audit where at < now() - make_interval(days => p_hari); get diagnostics n_log = row_count;
  perform _log(_pendek(s.nama) || ' membersihkan data > ' || p_hari || ' hari (laporan: ' || n_lap || ', lampiran: ' || n_lamp || ', hadir: ' || n_hadir || ', log: ' || n_log || ').', 'admin');
  return json_build_object('ok', true, 'laporan', n_lap, 'lampiran', n_lamp, 'hadir', n_hadir, 'log', n_log);
end $$;

-- Hapus lampiran yang sudah tidak dirujuk laporan mana pun (mencegah kuota database penuh).
create function hapus_lampiran_yatim(p_token text) returns int
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']); n int;
begin
  delete from lampiran where id not in (select lampiran_id from laporan where lampiran_id is not null);
  get diagnostics n = row_count;
  if n > 0 then perform _log(_pendek(s.nama) || ' menghapus ' || n || ' lampiran yatim.', 'admin'); end if;
  return n;
end $$;

-- hak akses: helper internal ditutup, fungsi admin dibuka untuk anon/authenticated (token tetap diperiksa di dalam)
revoke execute on function _magic_cocok(text, text) from public, anon, authenticated;
grant execute on function
  siswa_hapus_data(text, int), retensi_bersihkan(text, int), hapus_lampiran_yatim(text)
to anon, authenticated;

notify pgrst, 'reload schema';
