-- Hadirin v0.13 — cari siswa (NIS / nama) + halaman detail siswa
--   * siswa_cari   : cari di semua kelas (guru: hanya kelasnya sendiri), maks 20 hasil
--   * siswa_detail : data diri, status wajah (tanpa data biometrik), kehadiran 60 hari terakhir,
--                    semua laporan sakit/izin/alpa + lampiran surat. Setiap pembukaan dicatat di log audit (UU PDP).
-- Catatan: Hadirin TIDAK menyimpan foto wajah. Yang ada hanya lampiran surat dari orang tua/sekolah.
-- Aman dijalankan ulang.

create or replace function siswa_cari(p_token text, p_q text) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); q text := trim(coalesce(p_q, ''));
begin
  if length(q) < 2 then return '[]'::json; end if;
  if s.role = 'guru' and s.kelas is null then raise exception 'Akun guru ini belum terhubung ke kelas.'; end if;
  return (select coalesce(json_agg(json_build_object('id', x.id, 'nis', x.nis, 'name', x.nama, 'kelas', x.kelas)
            order by (x.nis = upper(q)) desc, (x.nis ilike q || '%') desc, x.nama), '[]')
          from (select * from siswa x
                where (x.nis ilike '%' || q || '%' or x.nama ilike '%' || q || '%')
                  and (s.role <> 'guru' or x.kelas = s.kelas)
                order by (x.nis = upper(q)) desc, (x.nis ilike q || '%') desc, x.nama
                limit 20) x);
end $$;

create or replace function siswa_detail(p_token text, p_sid int) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); x siswa; d date := _today(); awal date := d - 59;
begin
  x := _cek_kelas_siswa(s, p_sid);
  perform _log(_pendek(s.nama) || ' membuka data siswa ' || x.nama || ' (NIS ' || x.nis || ').', 'admin');
  return json_build_object(
    'id', x.id, 'nis', x.nis, 'name', x.nama, 'kelas', x.kelas, 'hp', x.hp_ortu,
    'wali', (select wali from kelas where id = x.kelas),
    'hari', d,
    'wajah', (select json_build_object('persetujuan', w.persetujuan, 'oleh', w.oleh, 'at', _jam(w.updated_at),
                                       'tgl', (w.updated_at at time zone 'Asia/Jakarta')::date)
              from wajah w where w.siswa_id = x.id),
    'hadir', (select coalesce(json_agg(h.hari order by h.hari desc), '[]') from hadir h
              where h.siswa_id = x.id and h.hari between awal and d),
    'laporan', (select coalesce(json_agg(_lap_json(l) order by l.dari desc, l.created_at desc), '[]')
                from (select * from laporan where siswa_id = x.id order by dari desc, created_at desc limit 100) l)
  );
end $$;

grant execute on function siswa_cari(text, text), siswa_detail(text, int) to anon, authenticated;

notify pgrst, 'reload schema';
