-- Hadirin v0.6 — absensi scan wajah
-- Yang disimpan hanya "descriptor" wajah: 128 angka hasil CNN (bukan foto).
-- Pendaftaran wajah wajib mencatat persetujuan orang tua (data biometrik = data pribadi spesifik, UU PDP).

create table wajah (
  siswa_id    int primary key references siswa(id) on delete cascade,
  descriptors jsonb not null,           -- array 3..10 x 128 angka
  persetujuan text not null,            -- siapa yang menyatakan persetujuan orang tua
  oleh        text not null,
  updated_at  timestamptz not null default now()
);
alter table wajah enable row level security;
revoke all on wajah from anon, authenticated;

create function _cek_kelas_siswa(s staff, p_sid int) returns siswa
language plpgsql stable set search_path = public as $$
declare x siswa;
begin
  select * into x from siswa where id = p_sid;
  if not found then raise exception 'Siswa tidak ditemukan.'; end if;
  if s.role = 'guru' and x.kelas is distinct from s.kelas then raise exception 'Siswa ini bukan dari kelas Anda.'; end if;
  return x;
end $$;

-- Data wajah untuk satu kelas (dipakai pencocokan di browser kamera kelas)
create function wajah_list(p_token text, p_kelas text default null) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); k text := _kelas_untuk(s, p_kelas);
begin
  return (select coalesce(json_agg(json_build_object('sid', w.siswa_id, 'name', x.nama, 'd', w.descriptors,
            'n', jsonb_array_length(w.descriptors), 'at', _jam(w.updated_at)) order by x.nama), '[]')
          from wajah w join siswa x on x.id = w.siswa_id where x.kelas = k);
end $$;

create function wajah_simpan(p_token text, p_sid int, p_desc jsonb, p_persetujuan text) returns int
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); x siswa; n int; v jsonb;
begin
  x := _cek_kelas_siswa(s, p_sid);
  if length(trim(coalesce(p_persetujuan,''))) < 3 then
    raise exception 'Isi nama orang tua/wali yang memberi persetujuan.';
  end if;
  if jsonb_typeof(p_desc) <> 'array' then raise exception 'Data wajah tidak valid.'; end if;
  n := jsonb_array_length(p_desc);
  if n < 3 or n > 10 then raise exception 'Ambil 3 sampai 10 sampel wajah.'; end if;
  for v in select * from jsonb_array_elements(p_desc) loop
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) <> 128
       or exists (select 1 from jsonb_array_elements(v) e where jsonb_typeof(e) <> 'number' or abs(e::text::numeric) > 2) then
      raise exception 'Data wajah tidak valid.';
    end if;
  end loop;
  insert into wajah(siswa_id, descriptors, persetujuan, oleh) values (x.id, p_desc, left(trim(p_persetujuan), 80), _pendek(s.nama))
  on conflict (siswa_id) do update set descriptors = excluded.descriptors, persetujuan = excluded.persetujuan,
    oleh = excluded.oleh, updated_at = now();
  perform _log(_pendek(s.nama) || ' mendaftarkan wajah ' || x.nama || ' (' || n || ' sampel, persetujuan: ' || left(trim(p_persetujuan), 80) || ').');
  return n;
end $$;

create function wajah_hapus(p_token text, p_sid int) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); x siswa;
begin
  x := _cek_kelas_siswa(s, p_sid);
  delete from wajah where siswa_id = x.id;
  perform _log(_pendek(s.nama) || ' menghapus data wajah ' || x.nama || '.');
end $$;

-- Dipanggil kamera kelas saat wajah dikenali + lolos cek kedip
create function hadir_scan(p_token text, p_sid int, p_jarak numeric) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); x siswa; d date := _today(); n int; telat boolean := false;
begin
  x := _cek_kelas_siswa(s, p_sid);
  if not exists (select 1 from wajah where siswa_id = x.id) then raise exception 'Wajah siswa ini belum terdaftar.'; end if;
  if p_jarak is null or p_jarak < 0 or p_jarak > 0.6 then raise exception 'Kecocokan wajah terlalu rendah.'; end if;
  insert into hadir(siswa_id, hari) values (x.id, d) on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then return json_build_object('baru', false, 'name', x.nama); end if;
  -- datang setelah ditandai Alpa hari ini -> Alpa dibatalkan
  delete from laporan where siswa_id = x.id and jenis = 'alpa' and dari = d and sampai = d;
  get diagnostics n = row_count; telat := n > 0;
  perform _log('Kamera ' || x.kelas || ': ' || x.nama || ' hadir (kecocokan ' || round((1 - p_jarak) * 100) || '%)'
               || case when telat then ', Alpa dibatalkan karena datang terlambat.' else '.' end);
  return json_build_object('baru', true, 'name', x.nama, 'telat', telat);
end $$;

-- reset demo juga menghapus data wajah
create or replace function reset_demo(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']);
begin
  delete from wajah where true;
  delete from laporan where true; delete from lampiran where true; delete from hadir where true; delete from hari_demo where true;
  delete from log_audit where true; delete from percobaan where true; delete from jejak where true;
  delete from staff where uid not in ('admin','tu.sari','guru.firman','guru.rahma','guru.budi');
  perform _seed_dasar();
  delete from sesi where uid <> s.uid;
  perform _seed_hari(_today());
  perform _log('Admin mengembalikan data demo ke kondisi awal.');
end $$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  login(text, text), sesi_cek(text), logout(text, boolean), ganti_sandi(text, text, text),
  data_harian(text, text), simpan_laporan(text, json), terima_laporan(text, uuid[]), tandai_alpa(text, text),
  lampiran_get(text, uuid), verif_list(text), verif_set(text, uuid, text, text),
  rekap(text), kirim_pengingat(text), users_list(text), user_buat(text, text, text, text, text),
  user_toggle(text, text), user_reset(text, text), reset_demo(text), log_list(text), log_tulis(text, text),
  ortu_kelas(), ortu_siswa(text), ortu_cek(int, text), ortu_kirim(json), ortu_status(text),
  wajah_list(text, text), wajah_simpan(text, int, jsonb, text), wajah_hapus(text, int), hadir_scan(text, int, numeric)
to anon, authenticated;
