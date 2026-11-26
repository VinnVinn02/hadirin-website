// Membuat public/assets/og-image.png (1200x630) dari deploy/og/og-image.html memakai Edge/Chrome headless.
// Pemakaian: node deploy/make-og.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(__dirname, 'og', 'og-image.html');
const out = path.join(root, 'public', 'assets', 'og-image.png');
const candidates = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean);
const browser = candidates.find(p => fs.existsSync(p));
if (!browser) throw new Error('Edge/Chrome tidak ditemukan. Set variabel BROWSER ke path browser.');
execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
  '--virtual-time-budget=5000', '--window-size=1200,630', '--screenshot=' + out, require('url').pathToFileURL(src).href], { stdio: 'inherit' });
console.log('OK -> ' + out);
