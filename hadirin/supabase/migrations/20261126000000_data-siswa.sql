-- Hadirin v0.12 — kelola data siswa & kelas dari aplikasi (Admin + TU)
--   * Tambah / ubah / hapus siswa satu per satu
--   * Impor banyak siswa sekaligus dari CSV/Excel (NIS, nama, kelas, no. WA ortu opsional)
--   * Tambah kelas, ubah nama wali kelas, hapus kelas kosong
--   * Saklar "data contoh harian" (Admin): matikan supaya kehadiran tidak lagi diisi otomatis
-- Jalankan SETELAH semua migrasi sebelumnya. Aman dijalankan ulang (idempoten).

-- ---------- 1. Pengaturan + saklar data contoh ----------
create table if not exists pengaturan (
  kunci text primary key,
  nilai text not null
);
alter table pengaturan enable row level security;
revoke all on pengaturan from anon, authenticated;

create or replace function _demo_aktif() returns boolean language sql stable set search_path = public as
$$ select coalesce((select nilai from pengaturan where kunci = 'data_contoh'), 'on') = 'on' $$;

-- _seed_hari asli diganti nama, lalu dibungkus pemeriksaan saklar.
do $$
begin
  if not exists (select 1 from pg_proc where proname = '_seed_hari_isi') then
    alter function _seed_hari(date) rename to _seed_hari_isi;
  end if;
end $$;

create or replace function _seed_hari(d date) returns void language plpgsql set search_path = public as $$
begin
  if not _demo_aktif() then return; end if;
  perform _seed_hari_isi(d);
end $$;

-- ---------- 2. Validasi ----------
create or replace function _nis_ok(p text) returns text language plpgsql immutable as $$
declare v text := upper(regexp_replace(trim(coalesce(p, '')), '\s+', '', 'g'));
begin
  if v !~ '^[0-9A-Z.\-/]{3,20}$' then
    raise exception 'NIS "%" tidak valid: 3–20 karakter berupa angka/huruf.', left(coalesce(p, ''), 30);
  end if;
  return v;
end $$;

create or replace function _nama_ok(p text) returns text language plpgsql immutable as $$
declare v text := regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g');
begin
  if length(v) < 2 or length(v) > 80 then raise exception 'Nama siswa wajib diisi (2–80 karakter).'; end if;
  return v;
end $$;

create or replace function _kelas_nama_ok(p text) returns text language plpgsql immutable as $$
declare v text := regexp_replace(trim(coalesce(p, '')), '\s+', ' ', 'g');
begin
  if v !~ '^[A-Za-z0-9][A-Za-z0-9 .\-]{0,19}$' then
    raise exception 'Nama kelas "%" tidak valid: 1–20 karakter (huruf, angka, spasi, titik, strip). Contoh: XI IPA 1.', left(coalesce(p, ''), 30);
  end if;
  return v;
end $$;

-- ---------- 3. Daftar kelas + siswa ----------
create or replace function siswa_list(p_token text, p_kelas text default null) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']); k text;
begin
  k := case when p_kelas is not null and exists (select 1 from kelas where id = p_kelas) then p_kelas
            else (select id from kelas order by urut, id limit 1) end;
  return json_build_object(
    'kelas', k,
    'demo', _demo_aktif(),
    'kelasList', (select coalesce(json_agg(json_build_object(
                    'id', kl.id, 'wali', kl.wali, 'n', (select count(*) from siswa x where x.kelas = kl.id),
                    'guru', (select st.nama from staff st where st.kelas = kl.id and st.role = 'guru' and st.active limit 1))
                  order by kl.urut, kl.id), '[]') from kelas kl),
    'siswa', (select coalesce(json_agg(json_build_object(
                'id', x.id, 'nis', x.nis, 'name', x.nama, 'kelas', x.kelas, 'hp', x.hp_ortu,
                'wajah', exists (select 1 from wajah w where w.siswa_id = x.id))
              order by x.nama), '[]') from siswa x where x.kelas = k),
    'total', (select count(*) from siswa)
  );
end $$;

-- ---------- 4. Tambah / ubah satu siswa ----------
create or replace function siswa_simpan(p_token text, p_id int, p_nis text, p_nama text, p_kelas text, p_hp text default null)
returns json language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']);
  v_nis text := _nis_ok(p_nis); v_nama text := _nama_ok(p_nama); v_hp text := _hp_normal(p_hp); x siswa;
begin
  if not exists (select 1 from kelas where id = p_kelas) then raise exception 'Kelas % belum ada. Tambahkan kelasnya dulu.', p_kelas; end if;
  if exists (select 1 from siswa where nis = v_nis and (p_id is null or id <> p_id)) then
    raise exception 'NIS % sudah dipakai siswa lain.', v_nis;
  end if;
  if p_id is null then
    insert into siswa(nis, nama, kelas, hp_ortu) values (v_nis, v_nama, p_kelas, v_hp) returning * into x;
    perform _log(_pendek(s.nama) || ' menambah siswa ' || x.nama || ' (' || x.kelas || ').', 'all');
  else
    update siswa set nis = v_nis, nama = v_nama, kelas = p_kelas, hp_ortu = v_hp where id = p_id returning * into x;
    if not found then raise exception 'Siswa tidak ditemukan.'; end if;
    perform _log(_pendek(s.nama) || ' mengubah data siswa ' || x.nama || ' (' || x.kelas || ').', 'all');
  end if;
  return json_build_object('id', x.id, 'nis', x.nis, 'name', x.nama, 'kelas', x.kelas, 'hp', x.hp_ortu);
end $$;

-- ---------- 5. Hapus siswa (beserta laporan, lampiran, wajah, kehadiran) ----------
create or replace function siswa_hapus(p_token text, p_id int) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']); x siswa;
begin
  select * into x from siswa where id = p_id;
  if not found then raise exception 'Siswa tidak ditemukan.'; end if;
  delete from lampiran where id in (select lampiran_id from laporan where siswa_id = x.id and lampiran_id is not null);
  delete from siswa where id = x.id;   -- hadir, laporan, wajah ikut terhapus (on delete cascade)
  perform _log(_pendek(s.nama) || ' menghapus siswa ' || x.nama || ' (NIS ' || x.nis || ', ' || x.kelas || ').', 'all');
end $$;

-- ---------- 6. Impor banyak siswa ----------
-- p_rows: [{"nis":"..","nama":"..","kelas":"..","hp":".."}, ...]  (maks 3000 baris)
-- NIS yang sudah ada -> nama/kelas/hp diperbarui. Baris yang salah dilewati dan dilaporkan.
create or replace function siswa_impor(p_token text, p_rows json, p_buat_kelas boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']);
  r json; i int; v_nis text; v_nama text; v_kelas text; v_hp text;
  n_baru int := 0; n_ubah int := 0; n_kelas int := 0; salah json[] := '{}'; ada boolean;
begin
  if p_rows is null or json_typeof(p_rows) <> 'array' then raise exception 'Data impor tidak valid.'; end if;
  if json_array_length(p_rows) = 0 then raise exception 'File tidak berisi data siswa.'; end if;
  if json_array_length(p_rows) > 3000 then raise exception 'Maksimal 3000 baris sekali impor. Pecah file menjadi beberapa bagian.'; end if;

  for r, i in select value, ordinality from json_array_elements(p_rows) with ordinality loop
    begin
      v_nis := _nis_ok(r->>'nis');
      v_nama := _nama_ok(r->>'nama');
      v_kelas := _kelas_nama_ok(r->>'kelas');
      v_hp := _hp_normal(r->>'hp');
      -- cocokkan nama kelas tanpa beda huruf besar/kecil
      select id into v_kelas from kelas where lower(id) = lower(v_kelas)
        union all select v_kelas limit 1;
      if not exists (select 1 from kelas where id = v_kelas) then
        if not p_buat_kelas then raise exception 'Kelas % belum ada.', v_kelas; end if;
        insert into kelas(id, wali, urut) values (v_kelas, '', coalesce((select max(urut) from kelas), 0) + 1);
        n_kelas := n_kelas + 1;
      end if;
      ada := exists (select 1 from siswa where nis = v_nis);
      insert into siswa(nis, nama, kelas, hp_ortu) values (v_nis, v_nama, v_kelas, v_hp)
      on conflict (nis) do update set nama = excluded.nama, kelas = excluded.kelas,
        hp_ortu = coalesce(excluded.hp_ortu, siswa.hp_ortu);
      if ada then n_ubah := n_ubah + 1; else n_baru := n_baru + 1; end if;
    exception when others then
      salah := salah || json_build_object('baris', i, 'nis', left(coalesce(r->>'nis', ''), 20), 'alasan', sqlerrm);
    end;
  end loop;

  perform _log(_pendek(s.nama) || ' mengimpor data siswa: ' || n_baru || ' baru, ' || n_ubah || ' diperbarui'
               || case when n_kelas > 0 then ', ' || n_kelas || ' kelas baru' else '' end
               || case when cardinality(salah) > 0 then ', ' || cardinality(salah) || ' baris dilewati' else '' end || '.', 'all');
  return json_build_object('baru', n_baru, 'diubah', n_ubah, 'kelasBaru', n_kelas,
                           'dilewati', to_json(salah[1:50]), 'jumlahDilewati', cardinality(salah));
end $$;

-- ---------- 7. Kelas ----------
-- p_baru = true: tambah kelas baru. false: ubah nama wali kelas yang tampil.
create or replace function kelas_simpan(p_token text, p_id text, p_wali text, p_baru boolean) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']); v_id text; v_wali text := left(trim(coalesce(p_wali, '')), 80);
begin
  if p_baru then
    v_id := _kelas_nama_ok(p_id);
    if exists (select 1 from kelas where lower(id) = lower(v_id)) then raise exception 'Kelas % sudah ada.', v_id; end if;
    insert into kelas(id, wali, urut) values (v_id, v_wali, coalesce((select max(urut) from kelas), 0) + 1);
    perform _log(_pendek(s.nama) || ' menambah kelas ' || v_id || '.', 'all');
  else
    update kelas set wali = v_wali where id = p_id;
    if not found then raise exception 'Kelas tidak ditemukan.'; end if;
    perform _log(_pendek(s.nama) || ' mengubah wali kelas ' || p_id || '.', 'all');
  end if;
end $$;

create or replace function kelas_hapus(p_token text, p_id text) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin','tu']);
begin
  if not exists (select 1 from kelas where id = p_id) then raise exception 'Kelas tidak ditemukan.'; end if;
  if exists (select 1 from siswa where kelas = p_id) then raise exception 'Kelas % masih berisi siswa. Pindahkan atau hapus siswanya dulu.', p_id; end if;
  if exists (select 1 from staff where kelas = p_id) then raise exception 'Kelas % masih terhubung ke akun wali kelas. Ubah akun itu dulu di menu Pengguna.', p_id; end if;
  delete from laporan where kelas = p_id;
  delete from kelas where id = p_id;
  perform _log(_pendek(s.nama) || ' menghapus kelas ' || p_id || '.', 'all');
end $$;

-- ---------- 8. Saklar data contoh (Admin) ----------
-- p_kosongkan: hapus kehadiran HARI INI (data contoh) supaya absensi kamera mulai dari nol.
create or replace function data_contoh_set(p_token text, p_aktif boolean, p_kosongkan boolean default false) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']); n int := 0;
begin
  insert into pengaturan(kunci, nilai) values ('data_contoh', case when p_aktif then 'on' else 'off' end)
  on conflict (kunci) do update set nilai = excluded.nilai;
  if not p_aktif and p_kosongkan then
    delete from hadir where hari = _today(); get diagnostics n = row_count;
  end if;
  perform _log(_pendek(s.nama) || case when p_aktif then ' menyalakan' else ' mematikan' end || ' data contoh harian'
               || case when n > 0 then ' dan mengosongkan ' || n || ' kehadiran hari ini' else '' end || '.', 'admin');
  return json_build_object('demo', p_aktif, 'dihapus', n);
end $$;

-- ---------- Hak akses ----------
revoke execute on function _demo_aktif(), _seed_hari_isi(date), _nis_ok(text), _nama_ok(text), _kelas_nama_ok(text)
  from public, anon, authenticated;
grant execute on function
  siswa_list(text, text), siswa_simpan(text, int, text, text, text, text), siswa_hapus(text, int),
  siswa_impor(text, json, boolean), kelas_simpan(text, text, text, boolean), kelas_hapus(text, text),
  data_contoh_set(text, boolean, boolean)
to anon, authenticated;

notify pgrst, 'reload schema';
