-- Hadirin v0.10 — enkripsi descriptor wajah saat disimpan (data biometrik, UU PDP)
-- Sebelumnya `wajah.descriptors` (jsonb) disimpan polos. Sekarang dienkripsi AES-256 (pgcrypto)
-- memakai kunci yang disimpan di Supabase Vault. Enkripsi/dekripsi terjadi di server, sehingga
-- kode front-end (app.js) TIDAK perlu diubah: wajah_simpan tetap menerima descriptor polos,
-- wajah_list tetap mengembalikan descriptor polos.
--
-- Prasyarat: fitur Vault Supabase aktif (bawaan semua proyek, termasuk Free).
-- Darurat — bila migrasi ini gagal karena Vault, seluruh migrasi dibatalkan otomatis (transaksi SQL),
-- tidak ada perubahan sebagian.

-- 1. Kunci acak di Vault (sekali saja)
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'hadirin_wajah_key') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'),
      'hadirin_wajah_key',
      'Kunci AES-256 untuk enkripsi descriptor wajah Hadirin (dibuat otomatis oleh migrasi v0.10).');
  end if;
end $$;

-- 2. Pembaca kunci (hanya dipakai fungsi internal; tidak diekspos ke klien)
create or replace function _wajah_key() returns text
language sql stable security definer set search_path = public, vault as
$$ select decrypted_secret from vault.decrypted_secrets where name = 'hadirin_wajah_key' limit 1 $$;

revoke execute on function _wajah_key() from public, anon, authenticated;

-- 3. Ubah kolom jadi bytea; data lama (jika ada) langsung dienkripsi
alter table wajah alter column descriptors type bytea
  using extensions.pgp_sym_encrypt(descriptors::text, _wajah_key(), 'cipher-algo=aes256, compress-algo=1');

-- 4. Simpan: validasi dulu, lalu enkripsi
create or replace function wajah_simpan(p_token text, p_sid int, p_desc jsonb, p_persetujuan text) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := _auth(p_token); x siswa; n int; v jsonb; k text := _wajah_key();
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
  insert into wajah(siswa_id, descriptors, persetujuan, oleh)
  values (x.id, pgp_sym_encrypt(p_desc::text, k, 'cipher-algo=aes256, compress-algo=1'), left(trim(p_persetujuan), 80), _pendek(s.nama))
  on conflict (siswa_id) do update set descriptors = excluded.descriptors, persetujuan = excluded.persetujuan,
    oleh = excluded.oleh, updated_at = now();
  perform _log(_pendek(s.nama) || ' mendaftarkan wajah ' || x.nama || ' (' || n || ' sampel, persetujuan: ' || left(trim(p_persetujuan), 80) || ').');
  return n;
end $$;

-- 5. Baca: dekripsi sebelum dikembalikan ke klien
create or replace function wajah_list(p_token text, p_kelas text default null) returns json
language plpgsql security definer set search_path = public, extensions as $$
declare s staff := _auth(p_token); k text := _kelas_untuk(s, p_kelas); key text := _wajah_key();
begin
  return (select coalesce(json_agg(json_build_object('sid', w.siswa_id, 'name', x.nama,
            'd', d.ds, 'n', jsonb_array_length(d.ds), 'at', _jam(w.updated_at)) order by x.nama), '[]')
          from wajah w join siswa x on x.id = w.siswa_id
          cross join lateral (select pgp_sym_decrypt(w.descriptors, key, 'cipher-algo=aes256, compress-algo=1')::jsonb as ds) d
          where x.kelas = k);
end $$;

notify pgrst, 'reload schema';
