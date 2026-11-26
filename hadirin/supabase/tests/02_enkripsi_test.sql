-- Pengujian enkripsi descriptor wajah.
-- SYARAT: migrasi `20261119010000_enkripsi-wajah.sql` sudah dijalankan.
-- Jalankan di Supabase → SQL Editor (paste lalu Run).

do $$ declare k text; enc bytea; dec text; sampel text := '[[0.1,0.2],[-0.5,0.9]]';
begin
  k := _wajah_key();
  if k is null or length(k) = 0 then raise exception 'GAGAL: kunci Vault kosong'; end if;
  enc := pgp_sym_encrypt(sampel, k, 'cipher-algo=aes256, compress-algo=1');
  dec := pgp_sym_decrypt(enc, k, 'cipher-algo=aes256, compress-algo=1');
  if dec <> sampel then raise exception 'GAGAL: round-trip enkripsi tidak sama'; end if;
  if dec::jsonb is null then raise exception 'GAGAL: hasil dekripsi bukan JSON valid'; end if;
  raise notice 'OK: round-trip enkripsi descriptor wajah';
end $$;

-- pastikan kolom sudah bytea (bukan jsonb)
do $$ begin
  if (select data_type from information_schema.columns where table_name='wajah' and column_name='descriptors') <> 'bytea' then
    raise exception 'GAGAL: kolom wajah.descriptors belum bytea';
  end if;
  raise notice 'OK: kolom wajah.descriptors bertipe bytea';
end $$;
