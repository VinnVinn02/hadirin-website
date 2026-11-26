-- Hadirin v0.15 — matikan reset_demo untuk pemakaian sungguhan
-- reset_demo() memanggil _seed_dasar(), yang mengembalikan akun admin/tu.sari/guru.firman ke sandi demo
-- (admin123 dst., tertulis di repo publik) dan mengisi ulang siswa contoh. Di server produksi itu berbahaya.
-- Tombolnya sudah dihapus dari aplikasi; fungsi ini juga ditolak di server supaya tidak bisa dipanggil langsung.
-- Aman dijalankan ulang.

create or replace function reset_demo(p_token text) returns void
language plpgsql security definer set search_path = public as $$
declare s staff := _auth(p_token, array['admin']);
begin
  raise exception 'Reset data demo sudah dimatikan untuk pemakaian sungguhan.';
end $$;

revoke execute on function _seed_dasar() from public, anon, authenticated;

notify pgrst, 'reload schema';
