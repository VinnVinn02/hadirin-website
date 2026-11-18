// Hadirin — gabungkan index.html + style.css + app.js + favicon menjadi satu file.
// Pemakaian:  node deploy/build-single.js
// Hasil    :  dist/index.html + dist/vercel.json (header keamanan untuk Vercel)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.resolve(__dirname, '..');
const pub = path.join(root, 'public');
const read = p => fs.readFileSync(path.join(pub, p), 'utf8');

let html = read('index.html');
const css = read('assets/css/style.css');
// Konfigurasi Supabase (URL + publishable/anon key — memang publik, akses dijaga RLS + fungsi RPC)
const cfgPath = path.join(root, 'supabase', 'config.json');
if (!fs.existsSync(cfgPath)) throw new Error('supabase/config.json belum ada. Salin dari config.example.json lalu isi.');
const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(cfg.url || '')) throw new Error('supabase/config.json: url tidak valid');
if (!cfg.key || /service_role|sb_secret_/.test(cfg.key)) throw new Error('supabase/config.json: key harus anon/publishable, JANGAN service_role/secret');
try { const p = JSON.parse(Buffer.from(cfg.key.split('.')[1] || '', 'base64').toString()); if (p.role && p.role !== 'anon') throw new Error('key bukan anon'); } catch (e) { if (e.message === 'key bukan anon') throw e; }
const js = read('assets/js/app.js').replace('__SUPABASE_URL__', cfg.url).replace('__SUPABASE_KEY__', cfg.key);
const svg = read('assets/favicon.svg').trim();

const replaceOnce = (src, needle, repl) => {
  if (!src.includes(needle)) throw new Error('Tidak ditemukan di index.html: ' + needle);
  return src.replace(needle, () => repl);
};

// Isi script persis seperti yang akan ditulis, supaya hash CSP cocok
const scriptBody = `\n${js.replace(/<\/script/gi, '<\\/script')}\n`;
const scriptHash = crypto.createHash('sha256').update(scriptBody, 'utf8').digest('base64');

// CSP: hanya script inline dengan hash ini yang boleh jalan (mencegah XSS menjalankan kode lain)
const csp = [
  "default-src 'none'",
  `script-src 'self' 'sha256-${scriptHash}'`,  // 'self' = vendor/face-api.js (dimuat saat kamera dibuka)
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${cfg.url}`,
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests"
].join('; ');

html = replaceOnce(html, '<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">',
  `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(svg)}" type="image/svg+xml">`);
html = replaceOnce(html, '<link rel="stylesheet" href="assets/css/style.css">', `<style>\n${css}\n</style>`);
// Script inline tidak mengenal "defer", jadi dipindah ke akhir <body>.
html = replaceOnce(html, '<script src="assets/js/app.js" defer></script>\n', '');
html = replaceOnce(html, '</body>', `<script>${scriptBody}</script>\n</body>`);
// frame-ancestors tidak berlaku lewat <meta>, jadi versi meta tanpa itu; versi lengkap dikirim lewat header (vercel.json)
html = replaceOnce(html, '<meta charset="utf-8">',
  `<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp.replace("; frame-ancestors 'none'", '')}">`);

const vercel = {
  cleanUrls: true,
  headers: [{
    source: '/(.*)',
    headers: [
      { key: 'Content-Security-Policy', value: csp },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()' },
      { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      { key: 'Cache-Control', value: 'no-cache' }
    ]
  }, {
    // aturan terakhir menang: model CNN & library boleh di-cache seminggu
    source: '/(models|vendor)/(.*)',
    headers: [{ key: 'Cache-Control', value: 'public, max-age=604800' }]
  }]
};

const out = path.join(root, 'dist');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'vercel.json'), JSON.stringify(vercel, null, 2) + '\n');
fs.writeFileSync(path.join(out, '.nojekyll'), '');
// Library + model CNN pengenal wajah (disajikan dari domain sendiri, bukan CDN)
for (const dir of ['vendor', 'models']) {
  fs.mkdirSync(path.join(out, dir), { recursive: true });
  for (const f of fs.readdirSync(path.join(pub, dir))) fs.copyFileSync(path.join(pub, dir, f), path.join(out, dir, f));
}
console.log('OK -> dist/index.html (' + Math.round(html.length / 1024) + ' KB), dist/vercel.json');
