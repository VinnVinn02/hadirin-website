-- Hadirin v0.5 — database Supabase
-- Prinsip keamanan:
--   * Semua tabel memakai RLS tanpa policy  -> tidak bisa dibaca/ditulis langsung lewat REST.
--   * Akses HANYA lewat fungsi RPC (SECURITY DEFINER) yang memeriksa sesi + peran di server.
--   * Kata sandi di-hash bcrypt (pgcrypto), token sesi disimpan sebagai SHA-256.
--   * Penguncian login, batas kiriman form orang tua, dan cek NIS dilakukan di server.

create extension if not exists pgcrypto with schema extensions;

-- ======================= TABEL =======================
create table kelas (
  id   text primary key,
  wali text not null default '',
  urut int  not null default 0
);

create table siswa (
  id    serial primary key,
  nis   text unique not null,
  nama  text not null,
  kelas text not null references kelas(id)
);
create index on siswa(kelas);

create table staff (
  uid         text primary key check (uid ~ '^[a-z0-9._]{3,30}$'),
  nama        text not null,
  role        text not null check (role in ('admin','tu','guru')),
  kelas       text references kelas(id),
  pw_hash     text,
  active      boolean not null default true,
  must_change boolean not null default false,
  last_login  timestamptz,
  created_at  timestamptz not null default now()
);
-- satu kelas hanya boleh punya satu wali kelas aktif
create unique index staff_satu_wali on staff(kelas) where active and role = 'guru';

create table sesi (
  token_hash text primary key,
  uid        text not null references staff(uid) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table hadir (
  siswa_id int  not null references siswa(id) on delete cascade,
  hari     date not null,
  primary key (siswa_id, hari)
);

create table lampiran (
  id         uuid primary key default gen_random_uuid(),
  nama       text not null,
  mime       text not null,
  data       text not null,           -- base64
  created_at timestamptz not null default now()
);

create table laporan (
  id          uuid primary key default gen_random_uuid(),
  no          text unique,
  siswa_id    int  not null references siswa(id) on delete cascade,
  kelas       text not null references kelas(id),
  jenis       text not null check (jenis in ('sakit','izin','alpa')),
  ket         text not null default '',
  dari        date not null,
  sampai      date not null,
  pelapor     text not null default '',
  sumber      text not null check (sumber in ('ortu','sekolah')),
  status      text not null check (status in ('masuk','diterima')),
  verif       text check (verif in ('menunggu','disetujui','ditolak')),
  alasan      text,
  file_nama   text,
  lampiran_id uuid references lampiran(id) on delete set null,
  oleh        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (sampai >= dari)
);
create index on laporan(kelas, dari, sampai);
create index on laporan(siswa_id);

create table log_audit (
  id    bigserial primary key,
  at    timestamptz not null default now(),
  msg   text not null,
  scope text not null default 'all' check (scope in ('all','admin'))
);

-- penghitung percobaan gagal (login, NIS) dan jejak kiriman (batas laju)
create table percobaan (
  kunci      text primary key,
  fails      int not null default 0,
  level      int not null default 0,
  lock_until timestamptz
);
create table jejak (
  kunci text not null,
  at    timestamptz not null default now()
);
create index on jejak(kunci, at);

create table hari_demo (hari date primary key);

alter table kelas     enable row level security;
alter table siswa     enable row level security;
alter table staff     enable row level security;
alter table sesi      enable row level security;
alter table hadir     enable row level security;
alter table lampiran  enable row level security;
alter table laporan   enable row level security;
alter table log_audit enable row level security;
alter table percobaan enable row level security;
alter table jejak     enable row level security;
alter table hari_demo enable row level security;
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ======================= UTILITAS =======================
create function _today() returns date language sql stable as
$$ select (now() at time zone 'Asia/Jakarta')::date $$;

create function _jam(t timestamptz) returns text language sql stable as $$
  select case when (t at time zone 'Asia/Jakarta')::date = _today()
              then to_char(t at time zone 'Asia/Jakarta','HH24.MI')
              else to_char(t at time zone 'Asia/Jakarta','DD/MM HH24.MI') end $$;

create function _ip() returns text language sql stable as $$
  select coalesce(nullif(trim(split_part(coalesce(
    current_setting('request.headers', true)::json->>'x-forwarded-for',''), ',', 1)),''), 'tanpa-ip') $$;

create function _log(p_msg text, p_scope text default 'all') returns void
language sql security definer set search_path = public as
$$ insert into log_audit(msg, scope) values (left(p_msg, 300), p_scope) $$;

create function _pendek(n text) returns text language sql immutable as
$$ select regexp_replace(n, ',.*$', '') $$;

create function _rand(p_chars text, p_len int) returns text
language sql volatile set search_path = public, extensions as $$
  select string_agg(substr(p_chars, 1 + (get_byte(b, i) % length(p_chars)), 1), '' order by i)
  from (select gen_random_bytes(p_len) b) x, generate_series(0, p_len - 1) i $$;

create function _temp_pw() returns text language sql volatile as
$$ select _rand('ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789', 12) $$;

create function _no_baru() returns text language plpgsql volatile set search_path = public as $$
declare v text;
begin
  loop
    v := 'HDR-' || to_char(_today(), 'YYMMDD') || '-' || _rand('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 5);
    exit when not exists (select 1 from laporan where no = v);
  end loop;
  return v;
end $$;

create function _hash(p text) returns text language sql immutable set search_path = public, extensions as
$$ select encode(digest(coalesce(p,''), 'sha256'), 'hex') $$;

create function _pw_problem(p_pw text, p_uid text) returns text language sql immutable as $$
  select case
    when length(p_pw) < 8   then 'Kata sandi minimal 8 karakter.'
    when length(p_pw) > 128 then 'Kata sandi terlalu panjang.'
    when p_pw !~ '[A-Za-z]' or p_pw !~ '[0-9]' then 'Kata sandi harus berisi huruf dan angka.'
    when position(lower(p_uid) in lower(p_pw)) > 0 then 'Jangan memakai ID pengguna di dalam kata sandi.'
    when p_pw ~* '^(password|12345678|qwerty|hadirin)' then 'Kata sandi terlalu mudah ditebak.'
  end $$;

-- Percobaan gagal: setelah p_batas kali, kunci p_dasar detik (berlipat tiap kali, maks 15 menit)
create function _gagal(p_kunci text, p_batas int, p_dasar int) returns json
language plpgsql set search_path = public as $$
declare a percobaan;
begin
  insert into percobaan(kunci) values (p_kunci) on conflict do nothing;
  update percobaan set fails = fails + 1 where kunci = p_kunci returning * into a;
  if a.fails >= p_batas then
    update percobaan set fails = 0, level = level + 1,
      lock_until = now() + make_interval(secs => least(p_dasar * power(2, a.level), 900))
      where kunci = p_kunci returning * into a;
    return json_build_object('wait', ceil(extract(epoch from a.lock_until - now())));
  end if;
  return json_build_object('sisa', p_batas - a.fails);
end $$;

create function _terkunci(p_kunci text) returns int language sql stable set search_path = public as $$
  select coalesce((select ceil(extract(epoch from lock_until - now()))::int
                   from percobaan where kunci = p_kunci and lock_until > now()), 0) $$;

-- Batas laju: true bila masih boleh (dan mencatat jejak)
create function _boleh(p_kunci text, p_maks int, p_detik int) returns boolean
language plpgsql set search_path = public as $$
begin
  if (select count(*) from jejak where kunci = p_kunci and at > now() - make_interval(secs => p_detik)) >= p_maks then
    return false;
  end if;
  insert into jejak(kunci) values (p_kunci);
  return true;
end $$;

-- Periksa sesi. Memperpanjang masa aktif 15 menit setiap dipakai.
create function _auth(p_token text, p_roles text[] default null, p_allow_temp boolean default false)
returns staff language plpgsql security definer set search_path = public as $$
declare s staff;
begin
  select st.* into s from sesi se join staff st on st.uid = se.uid
   where se.token_hash = _hash(p_token) and se.expires_at > now() and st.active;
  if not found then raise exception 'SESI_HABIS'; end if;
  update sesi set expires_at = now() + interval '15 minutes' where token_hash = _hash(p_token);
  if s.must_change and not p_allow_temp then raise exception 'Ganti kata sandi sementara terlebih dahulu.'; end if;
  if p_roles is not null and not (s.role = any(p_roles)) then raise exception 'Anda tidak punya akses untuk tindakan ini.'; end if;
  return s;
end $$;

create function _user_json(s staff) returns json language sql stable as $$
  select json_build_object('u', s.uid, 'name', s.nama, 'role', s.role, 'kelas', coalesce(s.kelas,''),
                           'temp', s.must_change) $$;

create function _lap_json(l laporan) returns json language sql stable set search_path = public as $$
  select json_build_object('id', l.id, 'no', l.no, 'sid', l.siswa_id, 'kelas', l.kelas, 'jenis', l.jenis,
    'ket', l.ket, 'dari', l.dari, 'sampai', l.sampai, 'pelapor', l.pelapor, 'sumber', l.sumber,
    'status', l.status, 'verif', coalesce(l.verif,''), 'alasan', l.alasan, 'file', coalesce(l.file_nama,''),
    'lampiran', l.lampiran_id is not null, 'jam', _jam(l.created_at), 'oleh', coalesce(l.oleh,'')) $$;

-- laporan yang menutupi hari d (diterima atau masih menunggu) untuk seorang siswa
create function _ada_laporan(p_sid int, d date, p_kecuali uuid default null) returns boolean
language sql stable set search_path = public as $$
  select exists (select 1 from laporan where siswa_id = p_sid and d between dari and sampai
                 and (p_kecuali is null or id <> p_kecuali)) $$;

create function _simpan_lampiran(f json) returns uuid language plpgsql set search_path = public as $$
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
  insert into lampiran(nama, mime, data) values (n, m, d) returning id into v;
  return v;
end $$;

-- ======================= DATA CONTOH =======================
create function _seed_dasar() returns void language plpgsql set search_path = public, extensions as $$
begin
  insert into kelas(id, wali, urut) values
    ('X-1','Dewi Lestari, S.Pd.',1), ('X-3','Hendra Gunawan, S.Pd.',2), ('XI IPA 1','M. Firmansyah, S.Pd.',3),
    ('XI IPA 2','Rahma Yuliani, S.Pd.',4), ('XI IPS 1','Budi Santoso, M.Pd.',5),
    ('XII IPA 1','Nur Aini, S.Si.',6), ('XII IPS 2','Agus Salim, S.Pd.',7)
  on conflict (id) do nothing;

  insert into siswa(nis, nama, kelas) values
    ('2301101','Alya Putri','XI IPA 1'),('2301102','Bima Pratama','XI IPA 1'),('2301103','Citra Lestari','XI IPA 1'),
    ('2301104','Dimas Saputra','XI IPA 1'),('2301105','Eka Ramadhani','XI IPA 1'),('2301106','Fajar Nugroho','XI IPA 1'),
    ('2301107','Gita Maharani','XI IPA 1'),('2301108','Hafiz Akbar','XI IPA 1'),('2301109','Intan Sari','XI IPA 1'),
    ('2301110','Joko Wibowo','XI IPA 1'),('2301111','Kirana Ayu','XI IPA 1'),('2301112','Lutfi Hakim','XI IPA 1'),
    ('2301113','Maya Anggraini','XI IPA 1'),('2301114','Naufal Rizky','XI IPA 1'),('2301115','Oktavia Dewi','XI IPA 1'),
    ('2301116','Putra Wijaya','XI IPA 1')
  on conflict (nis) do nothing;

  -- siswa kelas lain (nama dibuat dari kombinasi)
  insert into siswa(nis, nama, kelas)
  select k.kode || lpad(g::text, 2, '0'),
         a.fn[1 + ((g * 7 + k.urut * 5) % array_length(a.fn, 1))] || ' ' || a.ln[1 + ((g * 3 + k.urut * 11) % array_length(a.ln, 1))],
         k.id
  from (values ('X-1','25011',1),('X-3','25013',2),('XI IPA 2','24012',4),('XI IPS 1','24021',5),
               ('XII IPA 1','22011',6),('XII IPS 2','22022',7)) k(id, kode, urut),
       generate_series(1, 16) g,
       (select array['Adit','Bella','Cahya','Daffa','Elsa','Farhan','Gilang','Hana','Ilham','Jihan','Kevin','Laras',
                     'Mutia','Nadia','Rafi','Salsa','Tiara','Umar','Vina','Wahyu','Yoga','Zahra','Rizal','Nabila'] fn,
               array['Pratama','Lestari','Saputra','Wulandari','Hidayat','Permata','Kusuma','Ramadhan','Setiawan',
                     'Anggraini','Nugraha','Puspita','Firmansyah','Maharani','Santoso','Fadillah'] ln) a
  on conflict (nis) do nothing;

  insert into staff(uid, nama, role, kelas, pw_hash, active, must_change) values
    ('admin','Administrator Sistem','admin',null, crypt('admin123', gen_salt('bf',10)), true, false),
    ('tu.sari','Sari Wulandari','tu',null, crypt('tu123', gen_salt('bf',10)), true, false),
    ('guru.firman','M. Firmansyah, S.Pd.','guru','XI IPA 1', crypt('guru123', gen_salt('bf',10)), true, false),
    ('guru.rahma','Rahma Yuliani, S.Pd.','guru','XI IPA 2', null, true, false),
    ('guru.budi','Budi Santoso, M.Pd.','guru','XI IPS 1', null, false, false)
  on conflict (uid) do update set nama = excluded.nama, role = excluded.role, kelas = excluded.kelas,
    pw_hash = excluded.pw_hash, active = excluded.active, must_change = false;
end $$;

-- Isi data harian contoh (kehadiran kamera + beberapa laporan) sekali per hari
create function _seed_hari(d date) returns void language plpgsql set search_path = public as $$
declare
  ket_s text[] := array['Demam sejak semalam.','Flu dan batuk, istirahat di rumah.','Sakit perut, sudah ke klinik.','Kontrol ke dokter gigi.'];
  ket_i text[] := array['Acara keluarga di luar kota.','Mengikuti lomba mewakili sekolah.','Keperluan mendesak keluarga.','Mengurus administrasi KTP.'];
begin
  if exists (select 1 from hari_demo where hari = d) then return; end if;
  insert into hari_demo values (d);

  -- bersihkan jejak lama
  delete from jejak where at < now() - interval '1 day';
  delete from sesi where expires_at < now() - interval '1 day';
  delete from percobaan where lock_until < now() - interval '1 day' and fails = 0;

  -- kehadiran lewat scan wajah (contoh)
  insert into hadir(siswa_id, hari)
  select id, d from siswa
  where (kelas = 'XI IPA 1' and nis in ('2301101','2301102','2301103','2301105','2301106','2301108','2301111','2301113','2301115','2301116'))
     or (kelas <> 'XI IPA 1' and (id * 3 + extract(doy from d)::int) % 7 <> 0)
  on conflict do nothing;

  -- XI IPA 1: satu laporan sudah diterima, dua kabar orang tua menunggu
  insert into laporan(siswa_id, kelas, jenis, ket, dari, sampai, pelapor, sumber, status, verif, file_nama, oleh, created_at)
  select id, kelas, 'sakit', 'Demam sejak semalam, sudah ke puskesmas. Surat dokter menyusul.', d, d,
         'Orang tua / wali (via WhatsApp)', 'sekolah', 'diterima', 'menunggu', 'surat-dokter-intan.jpg', 'M. Firmansyah',
         (d + time '06:42') at time zone 'Asia/Jakarta'
  from siswa where nis = '2301109' and not _ada_laporan(id, d);

  insert into laporan(no, siswa_id, kelas, jenis, ket, dari, sampai, pelapor, sumber, status, file_nama, created_at)
  select _no_baru(), s.id, s.kelas, v.jenis, v.ket, d, d, v.pelapor, 'ortu', 'masuk', v.file,
         (d + v.jam) at time zone 'Asia/Jakarta'
  from (values ('2301104','izin','Mengikuti lomba pidato tingkat kota, ada surat tugas dari pembina.','Ibu Dimas (form orang tua)','surat-tugas-lomba.pdf', time '06:20'),
               ('2301107','sakit','Flu dan batuk sejak kemarin, istirahat di rumah.','Ayah Gita (form orang tua)', null, time '06:48')) v(nis, jenis, ket, pelapor, file, jam)
  join siswa s on s.nis = v.nis
  where not _ada_laporan(s.id, d);

  -- kelas lain: 2 siswa yang tidak hadir sudah punya laporan
  insert into laporan(siswa_id, kelas, jenis, ket, dari, sampai, pelapor, sumber, status, verif, file_nama, oleh, created_at)
  select t.id, t.kelas, case when t.rn = 1 then 'sakit' else 'izin' end,
         case when t.rn = 1 then ket_s[1 + t.id % 4] else ket_i[1 + t.id % 4] end, d, d,
         'Orang tua / wali (via WhatsApp)', 'sekolah', 'diterima',
         case when t.rn = 1 then 'menunggu' end,
         case when t.rn = 1 then 'surat-' || lower(split_part(t.nama,' ',1)) || '.jpg' end,
         _pendek(k.wali), (d + time '06:30' + make_interval(mins => t.id % 25)) at time zone 'Asia/Jakarta'
  from (select s.*, row_number() over (partition by s.kelas order by s.id) rn
        from siswa s where s.kelas <> 'XI IPA 1'
          and not exists (select 1 from hadir h where h.siswa_id = s.id and h.hari = d)) t
  join kelas k on k.id = t.kelas
  where t.rn <= 2 and not _ada_laporan(t.id, d);

  insert into log_audit(msg, at) values
    ('Kamera absensi aktif. Kehadiran hari ini mulai tercatat.', (d + time '06:30') at time zone 'Asia/Jakarta');
end $$;

select _seed_dasar();
insert into log_audit(msg, scope) values ('Database Hadirin dipasang.', 'all');

-- ======================= LOGIN & SESI =======================
create function login(p_uid text, p_pw text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s staff; ok boolean; w int; r json; tok text; ip text := _ip();
begin
  p_uid := lower(trim(coalesce(p_uid,'')));
  p_pw := coalesce(p_pw,'');
  if p_uid = '' or p_pw = '' then return json_build_object('ok',false,'msg','Isi ID pengguna dan kata sandi.'); end if;
  if length(p_uid) > 40 or length(p_pw) > 128 then return json_build_object('ok',false,'msg','ID atau kata sandi terlalu panjang.'); end if;

  w := greatest(_terkunci('login:' || p_uid), _terkunci('loginip:' || ip));
  if w > 0 then return json_build_object('ok',false,'wait',w); end if;

  select * into s from staff where uid = p_uid;
  if s.uid is not null and s.pw_hash is not null then
    ok := crypt(p_pw, s.pw_hash) = s.pw_hash;
  else
    perform crypt(p_pw, gen_salt('bf',10));  -- samakan waktu respons walau ID tidak ada
    ok := false;
  end if;

  if not ok then
    insert into log_audit(msg, scope) values ('Percobaan login gagal untuk ID "' || left(p_uid,40) || '".', 'admin');
    perform _gagal('loginip:' || ip, 10, 60);
    r := _gagal('login:' || p_uid, 3, 30);
    if r->>'wait' is not null then return json_build_object('ok',false,'wait',(r->>'wait')::int); end if;
    return json_build_object('ok',false,'msg','ID atau kata sandi salah. Sisa ' || (r->>'sisa') || ' percobaan sebelum dikunci sementara.');
  end if;
  if not s.active then return json_build_object('ok',false,'msg','Akun ini sedang dinonaktifkan. Hubungi admin sekolah.'); end if;

  delete from percobaan where kunci = 'login:' || p_uid;
  tok := encode(gen_random_bytes(32), 'hex');
  insert into sesi(token_hash, uid, expires_at) values (_hash(tok), s.uid, now() + interval '15 minutes');
  update staff set last_login = now() where uid = s.uid;
  insert into log_audit(msg) values (s.nama || ' masuk sebagai ' || upper(s.role) || '.');
  return json_build_object('ok', true, 'token', tok, 'user', _user_json(s));
end $$;

create function sesi_cek(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, null, true);
begin return _user_json(s); end $$;

create function logout(p_token text, p_kedaluwarsa boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid text; v_nama text;
begin
  delete from sesi where token_hash = _hash(p_token) returning uid into v_uid;
  if v_uid is not null then
    select nama into v_nama from staff where uid = v_uid;
    perform _log(v_nama || ' keluar' || case when p_kedaluwarsa then ' (sesi kedaluwarsa).' else '.' end);
  end if;
end $$;

create function ganti_sandi(p_token text, p_lama text, p_baru text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := _auth(p_token, null, true); masalah text;
begin
  if s.pw_hash is null or crypt(coalesce(p_lama,''), s.pw_hash) <> s.pw_hash then
    raise exception 'Kata sandi lama salah.';
  end if;
  masalah := _pw_problem(coalesce(p_baru,''), s.uid);
  if masalah is not null then raise exception '%', masalah; end if;
  if p_baru = p_lama then raise exception 'Kata sandi baru harus berbeda dari yang lama.'; end if;
  update staff set pw_hash = crypt(p_baru, gen_salt('bf',10)), must_change = false where uid = s.uid;
  -- sesi lain milik akun ini diputus
  delete from sesi where uid = s.uid and token_hash <> _hash(p_token);
  perform _log(s.nama || ' mengganti kata sandi.');
  select * into s from staff where uid = s.uid;
  return _user_json(s);
end $$;

-- ======================= PELAPORAN (GURU/TU/ADMIN) =======================
create function _kelas_untuk(s staff, p_kelas text) returns text language plpgsql stable set search_path = public as $$
begin
  if s.role = 'guru' then
    if s.kelas is null then raise exception 'Akun guru ini belum terhubung ke kelas.'; end if;
    return s.kelas;
  end if;
  if p_kelas is null or not exists (select 1 from kelas where id = p_kelas) then
    return (select id from kelas order by (id = 'XI IPA 1') desc, urut limit 1);
  end if;
  return p_kelas;
end $$;

create function data_harian(p_token text, p_kelas text default null) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); k text; d date := _today(); senin date;
begin
  perform _seed_hari(d);
  k := _kelas_untuk(s, p_kelas);
  senin := date_trunc('week', d)::date;
  return json_build_object(
    'hari', d, 'kelas', k,
    'wali', (select wali from kelas where id = k),
    'kelasList', (select json_agg(id order by urut) from kelas),
    'siswa', (select coalesce(json_agg(json_build_object('id', id, 'name', nama, 'nis', nis) order by nama), '[]') from siswa where kelas = k),
    'hadir', (select coalesce(json_agg(h.siswa_id), '[]') from hadir h join siswa x on x.id = h.siswa_id where x.kelas = k and h.hari = d),
    'reports', (select coalesce(json_agg(_lap_json(l) order by l.created_at), '[]') from laporan l
                where l.kelas = k and l.status = 'diterima' and d between l.dari and l.sampai),
    'incoming', (select coalesce(json_agg(_lap_json(l) order by l.created_at), '[]') from laporan l
                where l.kelas = k and l.status = 'masuk' and l.sampai >= d),
    'chart', (select json_agg(json_build_object('d', g::date,
                 'sakit', (select count(*) from laporan l where l.kelas = k and l.status='diterima' and l.jenis='sakit' and g::date between l.dari and l.sampai),
                 'izin',  (select count(*) from laporan l where l.kelas = k and l.status='diterima' and l.jenis='izin'  and g::date between l.dari and l.sampai),
                 'alpa',  (select count(*) from laporan l where l.kelas = k and l.status='diterima' and l.jenis='alpa'  and g::date between l.dari and l.sampai)
               ) order by g) from generate_series(senin::timestamp, (senin + 4)::timestamp, interval '1 day') g),
    'watch', (select coalesce(json_agg(w order by w.n desc), '[]') from (
                select x.nama as name, count(*) as n,
                       mode() within group (order by l.jenis) as jenis,
                       count(*) filter (where l.jenis='sakit') as sakit,
                       count(*) filter (where l.jenis='izin') as izin,
                       count(*) filter (where l.jenis='alpa') as alpa
                from laporan l join siswa x on x.id = l.siswa_id
                where l.kelas = k and l.status = 'diterima' and l.dari > d - 30
                group by x.id, x.nama having count(*) >= 2 order by count(*) desc limit 6) w)
  );
end $$;

create function simpan_laporan(p_token text, p json) returns json
language plpgsql security definer set search_path = public as $$
declare
  s staff := _auth(p_token); x siswa; l laporan; v_id uuid := nullif(p->>'id','')::uuid;
  v_jenis text := p->>'jenis'; v_ket text := trim(coalesce(p->>'ket',''));
  v_dari date := (p->>'dari')::date; v_sampai date := (p->>'sampai')::date;
  v_lamp uuid; v_file text; v_oleh text := _pendek(s.nama); d date := _today();
begin
  select * into x from siswa where id = (p->>'sid')::int;
  if not found then raise exception 'Siswa tidak ditemukan.'; end if;
  if s.role = 'guru' and x.kelas is distinct from s.kelas then raise exception 'Siswa ini bukan dari kelas Anda.'; end if;
  if v_jenis not in ('sakit','izin') then raise exception 'Pilih Sakit atau Izin.'; end if;
  if length(v_ket) < 5 then raise exception 'Tulis keterangan minimal 5 karakter supaya alasannya jelas.'; end if;
  if length(v_ket) > 300 then raise exception 'Keterangan maksimal 300 karakter.'; end if;
  if v_dari is null or v_sampai is null or v_sampai < v_dari then raise exception 'Tanggal selesai tidak boleh lebih awal dari tanggal mulai.'; end if;
  if v_sampai - v_dari > 30 then raise exception 'Periode maksimal 31 hari.'; end if;

  if v_id is not null then
    select * into l from laporan where id = v_id and siswa_id = x.id;
    if not found then raise exception 'Laporan tidak ditemukan.'; end if;
  elsif _ada_laporan(x.id, d) then
    raise exception 'Siswa ini sudah punya laporan hari ini. Ubah laporan yang ada lewat tabel.';
  end if;

  v_lamp := _simpan_lampiran(p->'file');
  v_file := case when v_lamp is not null then (select nama from lampiran where id = v_lamp) else l.file_nama end;
  if v_jenis = 'sakit' and (v_sampai - v_dari + 1) > 2 and v_file is null then
    raise exception 'Sakit lebih dari 2 hari wajib melampirkan surat dokter.';
  end if;

  if v_id is null then
    insert into laporan(siswa_id, kelas, jenis, ket, dari, sampai, pelapor, sumber, status, verif, file_nama, lampiran_id, oleh)
    values (x.id, x.kelas, v_jenis, v_ket, v_dari, v_sampai, left(coalesce(p->>'pelapor',''),80), 'sekolah', 'diterima',
            case when v_file is not null then 'menunggu' end, v_file, v_lamp, v_oleh)
    returning * into l;
    perform _log(v_oleh || ' menyimpan laporan ' || initcap(v_jenis) || ' untuk ' || x.nama || '.');
  else
    if l.lampiran_id is not null and v_lamp is not null then delete from lampiran where id = l.lampiran_id; end if;
    update laporan set jenis = v_jenis, ket = v_ket, dari = v_dari, sampai = v_sampai,
      status = 'diterima', oleh = v_oleh, updated_at = now(),
      file_nama = v_file, lampiran_id = coalesce(v_lamp, l.lampiran_id),
      verif = case when v_file is null then null when v_lamp is not null or l.verif is null then 'menunggu' else l.verif end,
      alasan = case when v_lamp is not null then null else l.alasan end
    where id = v_id returning * into l;
    perform _log(v_oleh || case when l.sumber = 'ortu' and l.no is not null then ' memeriksa & menerima laporan ' else ' mengubah laporan ' end
                 || x.nama || ' menjadi ' || initcap(v_jenis) || '.');
  end if;
  if coalesce((p->>'notif')::boolean, false) then
    perform _log('Konfirmasi dijadwalkan ke orang tua ' || x.nama || '.');
  end if;
  return _lap_json(l);
end $$;

create function terima_laporan(p_token text, p_ids uuid[]) returns int
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); n int := 0; r record;
begin
  for r in select l.id, x.nama, l.jenis from laporan l join siswa x on x.id = l.siswa_id
           where l.id = any(p_ids) and l.status = 'masuk' and (s.role <> 'guru' or l.kelas = s.kelas)
  loop
    update laporan set status = 'diterima', oleh = _pendek(s.nama), updated_at = now(),
      verif = case when file_nama is not null then 'menunggu' end where id = r.id;
    perform _log(_pendek(s.nama) || ' menerima laporan ' || initcap(r.jenis) || ' ' || r.nama || ' dari orang tua.');
    n := n + 1;
  end loop;
  return n;
end $$;

create function tandai_alpa(p_token text, p_kelas text default null) returns int
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); k text := _kelas_untuk(s, p_kelas); d date := _today(); n int;
begin
  insert into laporan(siswa_id, kelas, jenis, ket, dari, sampai, pelapor, sumber, status, oleh)
  select x.id, x.kelas, 'alpa', '', d, d, 'Sistem (lewat batas jam)', 'sekolah', 'diterima', _pendek(s.nama)
  from siswa x where x.kelas = k
    and not exists (select 1 from hadir h where h.siswa_id = x.id and h.hari = d)
    and not _ada_laporan(x.id, d);
  get diagnostics n = row_count;
  if n > 0 then perform _log(_pendek(s.nama) || ' menandai ' || n || ' siswa ' || k || ' sebagai Alpa sekaligus.'); end if;
  return n;
end $$;

create function lampiran_get(p_token text, p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); r record;
begin
  select a.nama, a.mime, a.data, l.kelas into r from laporan l join lampiran a on a.id = l.lampiran_id where l.id = p_id;
  if not found then raise exception 'Lampiran tidak ditemukan.'; end if;
  if s.role = 'guru' and r.kelas is distinct from s.kelas then raise exception 'Anda tidak punya akses untuk lampiran ini.'; end if;
  return json_build_object('name', r.nama, 'mime', r.mime, 'data', r.data);
end $$;

-- ======================= VERIFIKASI (TU/ADMIN) =======================
create function verif_list(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']);
begin
  return (select coalesce(json_agg(json_build_object('id', l.id, 'name', x.nama, 'kelas', l.kelas, 'jenis', l.jenis,
            'ket', l.ket, 'file', l.file_nama, 'lampiran', l.lampiran_id is not null, 'jam', _jam(l.created_at),
            'verif', l.verif, 'alasan', l.alasan) order by l.created_at desc), '[]')
          from laporan l join siswa x on x.id = l.siswa_id
          where l.file_nama is not null and l.status = 'diterima' and l.verif is not null
            and (l.verif = 'menunggu' or l.updated_at > now() - interval '14 days'));
end $$;

create function verif_set(p_token text, p_id uuid, p_status text, p_alasan text default null) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']); r record;
begin
  if p_status not in ('disetujui','ditolak') then raise exception 'Status tidak valid.'; end if;
  if p_status = 'ditolak' and length(trim(coalesce(p_alasan,''))) < 5 then raise exception 'Tulis alasan penolakan, minimal 5 karakter.'; end if;
  select l.jenis, l.kelas, x.nama into r from laporan l join siswa x on x.id = l.siswa_id where l.id = p_id and l.verif is not null;
  if not found then raise exception 'Surat tidak ditemukan.'; end if;
  update laporan set verif = p_status, updated_at = now(),
    alasan = case when p_status = 'ditolak' then left(trim(p_alasan), 200) end where id = p_id;
  perform _log(_pendek(s.nama) || case when p_status = 'disetujui' then ' menyetujui surat ' || initcap(r.jenis) || ' '
               || r.nama || ' (' || r.kelas || ').' else ' menolak surat ' || r.nama || ': ' || left(trim(p_alasan),200) end);
end $$;

-- ======================= REKAP =======================
create function _rekap(d date) returns table(kelas text, wali text, siswa int, hadir int, sakit int, izin int, alpa int, belum int)
language sql stable set search_path = public as $$
  select k.id,
    coalesce((select st.nama from staff st where st.kelas = k.id and st.role = 'guru' and st.active), k.wali),
    (select count(*) from siswa x where x.kelas = k.id)::int,
    (select count(*) from hadir h join siswa x on x.id = h.siswa_id where x.kelas = k.id and h.hari = d)::int,
    (select count(*) from laporan l where l.kelas = k.id and l.status='diterima' and l.jenis='sakit' and d between l.dari and l.sampai)::int,
    (select count(*) from laporan l where l.kelas = k.id and l.status='diterima' and l.jenis='izin'  and d between l.dari and l.sampai)::int,
    (select count(*) from laporan l where l.kelas = k.id and l.status='diterima' and l.jenis='alpa'  and d between l.dari and l.sampai)::int,
    (select count(*) from siswa x where x.kelas = k.id
       and not exists (select 1 from hadir h where h.siswa_id = x.id and h.hari = d)
       and not _ada_laporan(x.id, d))::int
  from kelas k order by k.urut $$;

create function rekap(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']);
begin
  perform _seed_hari(_today());
  return (select json_agg(json_build_array(r.kelas, r.wali, r.siswa, r.hadir, r.sakit, r.izin, r.alpa, r.belum) order by r.kelas) from _rekap(_today()) r);
end $$;

create function kirim_pengingat(p_token text) returns int
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']); daftar text; n int;
begin
  select string_agg(r.kelas, ', '), count(*) into daftar, n from _rekap(_today()) r where r.belum > 0;
  if n > 0 then perform _log(_pendek(s.nama) || ' mengirim pengingat ke wali kelas ' || daftar || '.'); end if;
  return n;
end $$;

-- ======================= PENGGUNA (ADMIN) =======================
create function users_list(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']);
begin
  return (select json_agg(json_build_object('u', uid, 'name', nama, 'role', role, 'kelas', coalesce(kelas,''),
            'active', active, 'temp', must_change, 'nopw', pw_hash is null,
            'last', case when last_login is null then 'Belum pernah' else _jam(last_login) end)
          order by case role when 'admin' then 0 when 'tu' then 1 else 2 end, uid) from staff);
end $$;

create function user_buat(p_token text, p_nama text, p_uid text, p_role text, p_kelas text) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := _auth(p_token, array['admin']); tmp text := _temp_pw(); v_kelas text;
begin
  p_uid := lower(trim(coalesce(p_uid,''))); p_nama := trim(coalesce(p_nama,''));
  if length(p_nama) < 3 then raise exception 'Isi nama lengkap.'; end if;
  if p_uid !~ '^[a-z0-9._]{3,30}$' then raise exception 'ID pengguna 3–30 karakter: huruf kecil, angka, titik, atau garis bawah.'; end if;
  if p_role not in ('admin','tu','guru') then raise exception 'Peran tidak valid.'; end if;
  if exists (select 1 from staff where uid = p_uid) then raise exception 'ID pengguna sudah dipakai.'; end if;
  v_kelas := case when p_role = 'guru' then nullif(p_kelas,'') end;
  if p_role = 'guru' and v_kelas is null then raise exception 'Pilih kelas untuk wali kelas.'; end if;
  if v_kelas is not null and exists (select 1 from staff where kelas = v_kelas and active and role = 'guru') then
    raise exception 'Kelas % sudah punya wali kelas aktif.', v_kelas;
  end if;
  insert into staff(uid, nama, role, kelas, pw_hash, must_change) values (p_uid, left(p_nama,80), p_role, v_kelas, crypt(tmp, gen_salt('bf',10)), true);
  perform _log('Admin membuat akun ' || upper(p_role) || ' ' || p_uid || '.', 'admin');
  return json_build_object('u', p_uid, 'temp', tmp);
end $$;

create function user_toggle(p_token text, p_uid text) returns boolean
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']); u staff;
begin
  select * into u from staff where uid = p_uid;
  if not found then raise exception 'Akun tidak ditemukan.'; end if;
  if u.uid = s.uid then raise exception 'Tidak bisa menonaktifkan akun sendiri.'; end if;
  if not u.active and u.role = 'guru' and exists (select 1 from staff where kelas = u.kelas and active and role = 'guru' and uid <> u.uid) then
    raise exception 'Kelas % sudah punya wali kelas aktif. Nonaktifkan dulu yang lama.', u.kelas;
  end if;
  update staff set active = not active where uid = p_uid;
  if u.active then delete from sesi where uid = p_uid; end if;
  perform _log('Admin ' || case when u.active then 'menonaktifkan' else 'mengaktifkan' end || ' akun ' || p_uid || '.', 'admin');
  return not u.active;
end $$;

create function user_reset(p_token text, p_uid text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := _auth(p_token, array['admin']); tmp text := _temp_pw();
begin
  if p_uid = s.uid then raise exception 'Gunakan "Ganti sandi" untuk akun Anda sendiri.'; end if;
  update staff set pw_hash = crypt(tmp, gen_salt('bf',10)), must_change = true where uid = p_uid;
  if not found then raise exception 'Akun tidak ditemukan.'; end if;
  delete from sesi where uid = p_uid;
  delete from percobaan where kunci = 'login:' || p_uid;
  perform _log('Admin mereset kata sandi akun ' || p_uid || '.', 'admin');
  return tmp;
end $$;

create function reset_demo(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']);
begin
  delete from laporan where true; delete from lampiran where true; delete from hadir where true; delete from hari_demo where true;
  delete from log_audit where true; delete from percobaan where true; delete from jejak where true;
  delete from staff where uid not in ('admin','tu.sari','guru.firman','guru.rahma','guru.budi');
  perform _seed_dasar();
  delete from sesi where uid <> s.uid;
  perform _seed_hari(_today());
  perform _log('Admin mengembalikan data demo ke kondisi awal.');
end $$;

-- ======================= LOG =======================
create function log_list(p_token text) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token);
begin
  return (select coalesce(json_agg(json_build_object('t', _jam(at), 'm', msg, 'scope', scope) order by at desc, id desc), '[]')
          from (select * from log_audit where scope = 'all' or s.role = 'admin' order by at desc, id desc limit 150) x);
end $$;

create function log_tulis(p_token text, p_msg text) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token);
begin perform _log(_pendek(s.nama) || ' ' || left(coalesce(p_msg,''), 120)); end $$;

-- ======================= FORM ORANG TUA (TANPA LOGIN) =======================
create function ortu_kelas() returns json language sql stable security definer set search_path = public as
$$ select json_agg(id order by urut) from kelas $$;

create function ortu_siswa(p_kelas text) returns json language sql stable security definer set search_path = public as
$$ select coalesce(json_agg(json_build_object('id', id, 'name', nama) order by nama), '[]') from siswa where kelas = p_kelas $$;

-- cocokkan 4 angka terakhir NIS; salah 3x -> dikunci (60 dtk, berlipat)
create function _ortu_nis(p_sid int, p_nis text) returns json language plpgsql set search_path = public as $$
declare x siswa; w int; r json; k text := 'nis:' || _ip();
begin
  w := _terkunci(k);
  if w > 0 then return json_build_object('ok', false, 'msg', 'NIS salah terlalu sering. Coba lagi dalam ' || w || ' detik.'); end if;
  select * into x from siswa where id = p_sid;
  if not found then return json_build_object('ok', false, 'msg', 'Pilih nama anak.'); end if;
  if coalesce(p_nis,'') !~ '^\d{4}$' then return json_build_object('ok', false, 'msg', 'Isi 4 angka terakhir NIS anak.'); end if;
  if right(x.nis, 4) <> p_nis then
    insert into log_audit(msg, scope) values ('Form orang tua: NIS tidak cocok untuk ' || x.nama || '.', 'admin');
    r := _gagal(k, 3, 60);
    if r->>'wait' is not null then
      return json_build_object('ok', false, 'msg', 'NIS salah 3 kali. Form dikunci ' || (r->>'wait') || ' detik. Hubungi wali kelas jika lupa NIS.');
    end if;
    return json_build_object('ok', false, 'msg', '4 angka NIS tidak cocok dengan nama anak. Cek kartu pelajar.');
  end if;
  delete from percobaan where kunci = k;
  return json_build_object('ok', true);
end $$;

create function ortu_cek(p_sid int, p_nis text) returns json
language plpgsql security definer set search_path = public as $$
declare r json; d date := _today();
begin
  r := _ortu_nis(p_sid, p_nis);
  if not (r->>'ok')::boolean then return r; end if;
  return json_build_object('ok', true,
    'ada', _ada_laporan(p_sid, d),
    'hadir', exists (select 1 from hadir where siswa_id = p_sid and hari = d));
end $$;

create function ortu_kirim(p json) returns json
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
  v_lamp := _simpan_lampiran(p->'file');
  if v_lamp is not null then select nama into v_file from lampiran where id = v_lamp; end if;
  v_no := _no_baru();
  insert into laporan(no, siswa_id, kelas, jenis, ket, dari, sampai, pelapor, sumber, status, file_nama, lampiran_id)
  values (v_no, x.id, x.kelas, v_jenis, v_ket, v_dari, v_sampai,
          v_rel || ' ' || split_part(x.nama, ' ', 1) || ' (' || v_nama || ') · form orang tua', 'ortu', 'masuk', v_file, v_lamp);
  perform _log('Laporan ' || initcap(v_jenis) || ' untuk ' || x.nama || ' masuk dari form orang tua (' || v_no || ').');
  return json_build_object('ok', true, 'no', v_no, 'file', v_file);
end $$;

create function ortu_status(p_no text) returns json
language plpgsql security definer set search_path = public as $$
declare l laporan; n text;
begin
  if not _boleh('status:' || _ip(), 30, 600) then
    return json_build_object('ok', false, 'msg', 'Terlalu banyak pencarian. Coba lagi beberapa menit lagi.');
  end if;
  select * into l from laporan where no = upper(trim(coalesce(p_no,'')));
  if not found then return json_build_object('ok', false, 'msg', 'Nomor laporan tidak ditemukan. Periksa kembali, atau hubungi wali kelas.'); end if;
  select nama into n from siswa where id = l.siswa_id;
  -- nama disamarkan: "Intan S."
  n := split_part(n, ' ', 1) || coalesce(' ' || nullif(left(split_part(n, ' ', 2), 1), '') || '.', '');
  return json_build_object('ok', true, 'no', l.no, 'name', n, 'kelas', l.kelas, 'jenis', l.jenis,
    'dari', l.dari, 'sampai', l.sampai, 'status', l.status, 'file', l.file_nama is not null,
    'verif', coalesce(l.verif,''), 'alasan', l.alasan);
end $$;

-- ======================= HAK AKSES FUNGSI =======================
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  login(text, text), sesi_cek(text), logout(text, boolean), ganti_sandi(text, text, text),
  data_harian(text, text), simpan_laporan(text, json), terima_laporan(text, uuid[]), tandai_alpa(text, text),
  lampiran_get(text, uuid), verif_list(text), verif_set(text, uuid, text, text),
  rekap(text), kirim_pengingat(text), users_list(text), user_buat(text, text, text, text, text),
  user_toggle(text, text), user_reset(text, text), reset_demo(text), log_list(text), log_tulis(text, text),
  ortu_kelas(), ortu_siswa(text), ortu_cek(int, text), ortu_kirim(json), ortu_status(text)
to anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
