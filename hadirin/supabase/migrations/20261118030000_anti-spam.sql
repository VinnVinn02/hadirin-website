-- Hadirin v0.8 — perlindungan spam & banjir permintaan (anti-DDoS lapisan aplikasi)
--
-- 1. _ip() tidak bisa dipalsukan lagi.
--    Sebelumnya memakai alamat PERTAMA di X-Forwarded-For, yang bisa diisi bebas oleh pengirim,
--    sehingga semua batas per-IP (form orang tua, kunci NIS, kunci login) bisa dilewati.
--    Sekarang memakai cf-connecting-ip (diisi Cloudflare di depan Supabase), cadangannya alamat TERAKHIR XFF.
-- 2. Pembatas laju global untuk SEMUA panggilan API (PostgREST db_pre_request), per IP per menit:
--      login        : 30 / menit
--      ortu_* (form orang tua, tanpa login): 60 / menit
--      lainnya      : 1500 / menit (longgar, karena satu sekolah bisa berbagi 1 IP)
--    Lewat batas -> HTTP 429 dengan pesan bahasa Indonesia.
-- 3. Kunci NIS per SISWA (bukan hanya per IP): 10 salah dari IP mana pun -> form untuk anak itu dikunci 5 menit (berlipat, maks 15).
--    Mencegah tebak-tebakan 4 angka NIS dari banyak IP sekaligus.
-- 4. Batas total server untuk form orang tua: 300 laporan/jam dan 150 lampiran/jam,
--    supaya database (Free 500 MB) tidak bisa dipenuhi lampiran sampah.
--
-- Darurat — kalau API mendadak error semua setelah migrasi ini, matikan pembatas global:
--   alter role authenticator reset pgrst.db_pre_request; notify pgrst, 'reload config';

-- ---------- 1. IP yang tidak bisa dipalsukan ----------
create or replace function _ip() returns text language sql stable as $$
  select coalesce(
    nullif(trim(current_setting('request.headers', true)::json->>'cf-connecting-ip'), ''),
    nullif(trim(regexp_replace(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for', ''), '^.*,', '')), ''),
    'tanpa-ip') $$;

-- ---------- 2. Pembatas laju global ----------
create table if not exists laju (
  kunci text        not null,
  menit timestamptz not null,
  n     int         not null default 0,
  primary key (kunci, menit)
);
alter table laju enable row level security;
revoke all on laju from anon, authenticated;

create or replace function cek_laju() returns void
language plpgsql security definer set search_path = public as $$
declare
  p text := coalesce(current_setting('request.path', true), '');
  fn text; grp text; batas int; n int; ip text;
begin
  -- permintaan baca-saja (GET) tidak boleh menulis; aplikasi selalu memakai POST
  if current_setting('transaction_read_only', true) = 'on' then return; end if;
  fn := case when p ~ '/rpc/' then regexp_replace(p, '^.*/rpc/', '') else '' end;
  if fn = 'login' then grp := 'login'; batas := 30;
  elsif fn like 'ortu\_%' then grp := 'ortu'; batas := 60;
  else grp := 'umum'; batas := 1500;
  end if;
  ip := _ip();
  insert into laju(kunci, menit, n) values (grp || ':' || ip, date_trunc('minute', now()), 1)
    on conflict (kunci, menit) do update set n = laju.n + 1
    returning laju.n into n;
  if random() < 0.01 then delete from laju where menit < now() - interval '10 minutes'; end if;
  if n > batas then
    raise sqlstate 'PGRST' using
      message = json_build_object('code', '429',
        'message', 'Terlalu banyak permintaan dari jaringan ini. Tunggu 1 menit, lalu coba lagi.')::text,
      detail  = json_build_object('status', 429, 'headers', json_build_object('Retry-After', '60'))::text;
  end if;
end $$;
grant execute on function cek_laju() to anon, authenticated, service_role;

alter role authenticator set pgrst.db_pre_request = 'public.cek_laju';

-- ---------- 3. Kunci NIS per siswa ----------
create or replace function _ortu_nis(p_sid int, p_nis text) returns json language plpgsql set search_path = public as $$
declare x siswa; w int; r json; k text := 'nis:' || _ip(); ks text := 'nissiswa:' || p_sid;
begin
  w := greatest(_terkunci(k), _terkunci(ks));
  if w > 0 then return json_build_object('ok', false, 'msg', 'NIS salah terlalu sering. Coba lagi dalam ' || w || ' detik.'); end if;
  select * into x from siswa where id = p_sid;
  if not found then return json_build_object('ok', false, 'msg', 'Pilih nama anak.'); end if;
  if coalesce(p_nis,'') !~ '^\d{4}$' then return json_build_object('ok', false, 'msg', 'Isi 4 angka terakhir NIS anak.'); end if;
  if right(x.nis, 4) <> p_nis then
    insert into log_audit(msg, scope) values ('Form orang tua: NIS tidak cocok untuk ' || x.nama || '.', 'admin');
    perform _gagal(ks, 10, 300);
    r := _gagal(k, 3, 60);
    if r->>'wait' is not null then
      return json_build_object('ok', false, 'msg', 'NIS salah 3 kali. Form dikunci ' || (r->>'wait') || ' detik. Hubungi wali kelas jika lupa NIS.');
    end if;
    return json_build_object('ok', false, 'msg', '4 angka NIS tidak cocok dengan nama anak. Cek kartu pelajar.');
  end if;
  delete from percobaan where kunci = k;
  return json_build_object('ok', true);
end $$;

-- ---------- 4. Batas total form orang tua ----------
create or replace function ortu_kirim(p json) returns json
language plpgsql security definer set search_path = public as $$
declare
  r json; x siswa; d date := _today(); ip text := _ip();
  v_jenis text := p->>'jenis'; v_ket text := trim(coalesce(p->>'ket',''));
  v_dari date := (p->>'dari')::date; v_sampai date := (p->>'sampai')::date;
  v_nama text := left(regexp_replace(trim(coalesce(p->>'nama','')), '\s+', ' ', 'g'), 60);
  v_rel text := left(coalesce(p->>'rel','Orang tua'), 20);
  v_lamp uuid; v_file text; v_no text;
begin
  -- honeypot: bot mendapat jawaban palsu, tidak ada yang disimpan
  if coalesce(p->>'web','') <> '' then return json_build_object('ok', true, 'no', 'HDR-000000-00000'); end if;
  if not _boleh('kirim:' || ip, 5, 600) then
    return json_build_object('ok', false, 'msg', 'Terlalu banyak laporan dari perangkat ini. Coba lagi beberapa menit lagi atau hubungi wali kelas.');
  end if;
  if not _boleh('kirim:semua', 300, 3600) then
    perform _log('Form orang tua menolak kiriman: batas 300 laporan per jam tercapai (kemungkinan spam).', 'admin');
    return json_build_object('ok', false, 'msg', 'Server sedang menerima terlalu banyak laporan. Coba lagi nanti atau hubungi wali kelas.');
  end if;
  r := _ortu_nis((p->>'sid')::int, p->>'nis');
  if not (r->>'ok')::boolean then return r; end if;
  select * into x from siswa where id = (p->>'sid')::int;
  if _ada_laporan(x.id, d) then return json_build_object('ok', false, 'msg', 'Laporan untuk anak ini hari ini sudah ada di sekolah.'); end if;
  if v_jenis not in ('sakit','izin') then return json_build_object('ok', false, 'msg', 'Pilih Sakit atau Izin.'); end if;
  if length(v_ket) < 5 or length(v_ket) > 300 then return json_build_object('ok', false, 'msg', 'Tulis keterangan 5–300 karakter.'); end if;
  if v_dari is null or v_sampai is null or v_sampai < v_dari then return json_build_object('ok', false, 'msg', 'Periksa tanggal mulai dan selesai.'); end if;
  if v_dari < d - 7 or v_dari > d + 30 then return json_build_object('ok', false, 'msg', 'Tanggal mulai di luar rentang yang diizinkan.'); end if;
  if v_sampai - v_dari + 1 > 14 then return json_build_object('ok', false, 'msg', 'Periode maksimal 14 hari. Untuk izin lebih lama, hubungi sekolah langsung.'); end if;
  if length(v_nama) < 2 then return json_build_object('ok', false, 'msg', 'Isi nama Anda sebagai pelapor.'); end if;
  if v_rel not in ('Ibu','Ayah','Wali') then v_rel := 'Wali'; end if;
  if v_jenis = 'sakit' and v_sampai - v_dari + 1 > 2 and coalesce(p->'file'->>'data','') = '' then
    return json_build_object('ok', false, 'msg', 'Sakit lebih dari 2 hari wajib melampirkan foto surat dokter.');
  end if;
  if coalesce(p->'file'->>'data','') <> '' and not _boleh('lampiran:semua', 150, 3600) then
    perform _log('Form orang tua menolak lampiran: batas 150 lampiran per jam tercapai (kemungkinan spam).', 'admin');
    return json_build_object('ok', false, 'msg', 'Server sedang menerima terlalu banyak lampiran. Coba lagi nanti atau kirim surat lewat wali kelas.');
  end if;
  v_lamp := _simpan_lampiran(p->'file');
  if v_lamp is not null then select nama into v_file from lampiran where id = v_lamp; end if;
  v_no := _no_baru();
  insert into laporan(no, siswa_id, kelas, jenis, ket, dari, sampai, pelapor, sumber, status, file_nama, lampiran_id)
  values (v_no, x.id, x.kelas, v_jenis, v_ket, v_dari, v_sampai,
          v_rel || ' ' || split_part(x.nama, ' ', 1) || ' (' || v_nama || ') · form orang tua', 'ortu', 'masuk', v_file, v_lamp);
  perform _log('Laporan ' || initcap(v_jenis) || ' untuk ' || x.nama || ' masuk dari form orang tua (' || v_no || ').');
  return json_build_object('ok', true, 'no', v_no, 'file', v_file);
end $$;

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
