-- Pengujian pengerasan (hardening) — tidak butuh sesi login.
-- Jalankan di Supabase → SQL Editor (paste lalu Run).

-- 1. _magic_cocok: menerima byte yang benar
do $$ begin
  if not _magic_cocok('image/jpeg', encode(decode('ffd8ffe000104a464946','hex'),'base64')) then
    raise exception 'GAGAL: JPEG valid ditolak';
  end if;
  if not _magic_cocok('image/png', encode(decode('89504e470d0a1a0a0000000d49484452','hex'),'base64')) then
    raise exception 'GAGAL: PNG valid ditolak';
  end if;
  if not _magic_cocok('application/pdf', encode(decode('255044462d312e34','hex'),'base64')) then
    raise exception 'GAGAL: PDF valid ditolak';
  end if;
  if not _magic_cocok('image/webp', encode(decode('524946461234567857454250','hex'),'base64')) then
    raise exception 'GAGAL: WEBP valid ditolak';
  end if;
  raise notice 'OK: _magic_cocok menerima magic bytes yang benar';
end $$;

-- 2. _magic_cocok: menolak isi yang tidak cocok
do $$ begin
  if _magic_cocok('image/jpeg', encode(decode('48656c6c6f20776f726c64','hex'),'base64')) then
    raise exception 'GAGAL: isi teks dianggap JPEG';
  end if;
  if _magic_cocok('application/pdf', encode(decode('89504e470d0a1a0a','hex'),'base64')) then
    raise exception 'GAGAL: PNG dianggap PDF';
  end if;
  if _magic_cocok('image/webp', encode(decode('5249464600000000','hex'),'base64')) then
    raise exception 'GAGAL: RIFF tanpa WEBP diterima';
  end if;
  raise notice 'OK: _magic_cocok menolak isi yang tidak cocok';
end $$;

-- 3. _simpan_lampiran: menerima JPEG valid lalu bersihkan
do $$ declare v uuid;
begin
  v := _simpan_lampiran(json_build_object('name','uji.jpg','mime','image/jpeg',
        'data', encode(decode('ffd8ffe000104a464946','hex'),'base64')));
  if v is null then raise exception 'GAGAL: JPEG valid ditolak _simpan_lampiran'; end if;
  delete from lampiran where id = v;
  raise notice 'OK: _simpan_lampiran menerima JPEG valid';
end $$;

-- 4. _simpan_lampiran: menolak isi palsu
do $$ declare v uuid;
begin
  begin
    v := _simpan_lampiran(json_build_object('name','palsu.jpg','mime','image/jpeg',
          'data', encode(decode('68616c6f','hex'),'base64')));
    raise exception 'GAGAL: lampiran isi palsu tidak ditolak';
  exception when others then
    if sqlstate = 'P0001' then raise notice 'OK: _simpan_lampiran menolak isi palsu';
    else raise; end if;
  end;
end $$;

-- 5. _pw_problem: kebijakan sandi
do $$ begin
  if _pw_problem('pendek1', 'x') is null then raise exception 'GAGAL: sandi <8 diterima'; end if;
  if _pw_problem('tanpaangka', 'x') is null then raise exception 'GAGAL: sandi tanpa angka diterima'; end if;
  if _pw_problem('12345678', 'x') is null then raise exception 'GAGAL: sandi tanpa huruf diterima'; end if;
  if _pw_problem('KuatSekali123', 'x') is not null then raise exception 'GAGAL: sandi valid ditolak'; end if;
  raise notice 'OK: _pw_problem memeriksa kebijakan sandi';
end $$;

-- 6. _hp_normal: normalisasi nomor WA
do $$ begin
  if _hp_normal('0812 3456 7890') <> '6281234567890' then raise exception 'GAGAL: 08xx tidak dinormalisasi'; end if;
  if _hp_normal('+62 812-3456-7890') <> '6281234567890' then raise exception 'GAGAL: +62xx tidak dinormalisasi'; end if;
  if _hp_normal('81234567890') <> '6281234567890' then raise exception 'GAGAL: 8xx tidak dinormalisasi'; end if;
  raise notice 'OK: _hp_normal menormalisasi nomor WA';
end $$;
