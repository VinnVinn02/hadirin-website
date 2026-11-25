-- Hadirin v0.7 — nomor WhatsApp orang tua + data untuk tombol "Kirim WA" (wa.me)
-- Pesan TIDAK dikirim dari server. Website hanya membuka WhatsApp di perangkat guru
-- dengan pesan yang sudah terisi, guru yang menekan Kirim.
-- Nomor HP orang tua = data pribadi: hanya bisa dibaca staf lewat RPC, guru hanya kelasnya sendiri.

alter table siswa add column if not exists hp_ortu text
  check (hp_ortu is null or hp_ortu ~ '^62[0-9]{8,13}$');

-- Ubah 08xx / +62xx / 62xx menjadi format 62xxxxxxxxx. Kosong -> null.
create or replace function _hp_normal(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if d = '' then return null; end if;
  if d like '0%' then d := '62' || substr(d, 2); end if;
  if d like '8%' then d := '62' || d; end if;
  if d !~ '^62[0-9]{8,13}$' then
    raise exception 'Nomor WhatsApp tidak valid. Contoh yang benar: 0812 3456 7890.';
  end if;
  return d;
end $$;

-- Nomor WA orang tua + jumlah HARI tidak hadir 30 hari terakhir, per siswa di satu kelas.
-- Jumlah hari dipakai di pesan, karena orang tua cenderung meremehkan total absen anaknya.
create or replace function kontak_ortu(p_token text, p_kelas text default null) returns json
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); k text := _kelas_untuk(s, p_kelas); d date := _today(); awal date := d - 29;
begin
  return (select coalesce(json_agg(json_build_object(
            'sid', x.id, 'hp', x.hp_ortu,
            'sakit', coalesce(t.sakit, 0), 'izin', coalesce(t.izin, 0), 'alpa', coalesce(t.alpa, 0)) order by x.nama), '[]')
          from siswa x
          left join lateral (
            select sum(n) filter (where jenis = 'sakit') as sakit,
                   sum(n) filter (where jenis = 'izin')  as izin,
                   sum(n) filter (where jenis = 'alpa')  as alpa
            from (select l.jenis, (least(l.sampai, d) - greatest(l.dari, awal) + 1) as n
                  from laporan l
                  where l.siswa_id = x.id and l.status = 'diterima'
                    and l.dari <= d and l.sampai >= awal) q
          ) t on true
          where x.kelas = k);
end $$;

create or replace function hp_ortu_set(p_token text, p_sid int, p_hp text) returns text
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); x siswa; v text := _hp_normal(p_hp);
begin
  x := _cek_kelas_siswa(s, p_sid);
  update siswa set hp_ortu = v where id = x.id;
  perform _log(_pendek(s.nama) || case when v is null then ' menghapus' else ' menyimpan' end
               || ' nomor WA orang tua ' || x.nama || '.');
  return v;
end $$;

-- Catat di log audit setiap kali guru membuka WA ke orang tua (tanpa isi pesan / nomor).
create or replace function wa_catat(p_token text, p_sid int, p_jenis text) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token); x siswa;
begin
  x := _cek_kelas_siswa(s, p_sid);
  perform _log(_pendek(s.nama) || ' menghubungi orang tua ' || x.nama || ' lewat WhatsApp ('
               || left(coalesce(p_jenis, '-'), 20) || ').');
end $$;

grant execute on function
  kontak_ortu(text, text), hp_ortu_set(text, int, text), wa_catat(text, int, text)
to anon, authenticated;

notify pgrst, 'reload schema';
