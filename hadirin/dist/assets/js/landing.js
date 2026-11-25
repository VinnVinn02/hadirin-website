// Hadirin — skrip halaman depan (publik).
// Link lama dari grup WA (https://domain/#lapor, #lapor?k=KELAS, #cek) diteruskan ke aplikasi di /app.
(function () {
  function forward() {
    var h = location.hash;
    if (!/^#(lapor|cek)/.test(h)) return false;
    location.replace((location.protocol === 'file:' ? 'app.html' : '/app') + h);
    return true;
  }
  if (forward()) return;
  window.addEventListener('hashchange', forward);
  // Dimuat di <head> tanpa defer supaya pengalihan di atas terjadi secepat mungkin.
  document.addEventListener('DOMContentLoaded', function () {
    var y = document.getElementById('tahun');
    if (y) y.textContent = String(new Date().getFullYear());
  });
})();
