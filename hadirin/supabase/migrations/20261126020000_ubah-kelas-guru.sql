-- Hadirin v0.14 — Admin bisa mengubah kelas yang dipegang akun guru (wali kelas)
--   * p_kelas null / '' = lepaskan guru dari kelas
--   * satu kelas tetap hanya boleh punya satu wali kelas aktif
--   * bila nama wali di daftar kelas masih kosong, diisi otomatis dengan nama guru
-- Aman dijalankan ulang.

create or replace function user_kelas_set(p_token text, p_uid text, p_kelas text) returns text
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']); u staff; v text := nullif(trim(coalesce(p_kelas, '')), '');
begin
  select * into u from staff where uid = p_uid;
  if not found then raise exception 'Akun tidak ditemukan.'; end if;
  if u.role <> 'guru' then raise exception 'Hanya akun guru yang bisa dihubungkan ke kelas.'; end if;
  if v is not null then
    if not exists (select 1 from kelas where id = v) then raise exception 'Kelas % belum ada. Tambahkan dulu di menu Data siswa.', v; end if;
    if u.active and exists (select 1 from staff where kelas = v and role = 'guru' and active and uid <> u.uid) then
      raise exception 'Kelas % sudah punya wali kelas aktif (%). Lepaskan dulu dari akun itu.', v,
        (select uid from staff where kelas = v and role = 'guru' and active and uid <> u.uid limit 1);
    end if;
  end if;
  update staff set kelas = v where uid = u.uid;
  if v is not null then
    update kelas set wali = left(u.nama, 80) where id = v and coalesce(trim(wali), '') = '';
  end if;
  delete from sesi where uid = u.uid;   -- sesi lama memakai kelas lama: minta login ulang
  perform _log('Admin ' || case when v is null then 'melepas akun ' || u.uid || ' dari kelas'
                                else 'menjadikan akun ' || u.uid || ' wali kelas ' || v end || '.', 'admin');
  return v;
end $$;

grant execute on function user_kelas_set(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';
